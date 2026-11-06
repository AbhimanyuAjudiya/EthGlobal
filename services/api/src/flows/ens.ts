/**
 * ENSv2 campaign names (ens/README.md). After POST /sponsor answers 201 the campaign gets `<slug>.<parent>` on Sepolia
 * in the background: the slug is picked once and saved on the campaign entity (`ens.status: 'pending'`) before any
 * transaction, each transaction is appended as its receipt lands, and the job ends `registered` or, after the
 * retries, `failed`. The registrar (CampaignNames) is idempotent, so a retry or a restart (`resumeOnBoot`) never
 * sends a step twice. Nothing here can fail or delay the registration: every error stays inside this module.
 */
import { isAdapterError, type CampaignNames } from '@ethglobal/adapters';
import type { Campaign } from '@ethglobal/octroi';
import { ENS_SLUG_PATTERN, type Hex } from '@ethglobal/protocol/ids';
import type { CampaignEns } from '@ethglobal/protocol/schemas';

import { SerialQueue } from '../chain.js';

import type { Deps } from '../deps.js';

/** The waits before attempts 2, 3, …; after the last one the name is `failed`. */
export const ENS_RETRY_MS: readonly number[] = [10_000, 60_000, 300_000, 1_800_000];
/** Failures a retry cannot fix. */
const PERMANENT = new Set(['invalid_name', 'invalid_expiry', 'conflict']);

/** kebab-case of the campaign name ([a-z0-9-], 3–40); a name with too few latin letters ⇒ `campaign-<id prefix>`. */
export function slugFor(name: string, id: string): string {
  const base = name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return ENS_SLUG_PATTERN.test(base) ? base : `campaign-${id.slice(2, 8).toLowerCase()}`;
}

/** "1 GB · 7 days" from the bundle a verified human gets. */
export const bundleText = (c: Pick<Campaign, 'bundleMb' | 'validityDays'>): string => {
  const mb = c.bundleMb.orb;
  const size = mb >= 1000 && mb % 1000 === 0 ? `${mb / 1000} GB` : `${mb} MB`;
  return `${size} · ${c.validityDays} ${c.validityDays === 1 ? 'day' : 'days'}`;
};

type JobDeps = Pick<Deps, 'stores' | 'logger' | 'now' | 'chainId' | 'dataDrop' | 'env'>;

export class EnsJobs {
  readonly #queue = new SerialQueue();
  /** Slugs this process handed out: a pending one is not on-chain yet, so isAvailable() alone would hand it out twice. */
  readonly #taken = new Set<string>();
  /** Queued, running or waiting for a retry. */
  #open = 0;
  #waiters: (() => void)[] = [];

  constructor(
    private readonly deps: JobDeps,
    private readonly names: CampaignNames,
    private readonly retryMs: readonly number[] = ENS_RETRY_MS,
  ) {}

  /** Starts (or resumes) the campaign's name in the background; never throws, never waits. */
  enqueue(id: Hex, attempt = 1): void {
    this.#open += 1;
    void this.#queue
      .run(() => this.#attempt(id, attempt))
      .catch((error: unknown) => this.#retry(id, attempt, error))
      .finally(() => this.#settle());
  }

  /** Names left `pending` by a stopped process. */
  async resumeOnBoot(): Promise<void> {
    try {
      for (const found of await this.deps.stores.campaigns.list())
        if (found.payload.ens?.status === 'pending') this.enqueue(found.payload.id as Hex);
    } catch (error) {
      this.deps.logger.warn({ event: 'ens', err: errName(error) }, 'ens: resume on boot failed');
    }
  }

  /** Resolves once nothing is queued, running or waiting for a retry (tests, shutdown). */
  idle(): Promise<void> {
    return this.#open === 0 ? Promise.resolve() : new Promise((done) => this.#waiters.push(done));
  }

  #settle(): void {
    this.#open -= 1;
    if (this.#open === 0) for (const done of this.#waiters.splice(0)) done();
  }

  #retry(id: Hex, attempt: number, error: unknown): void {
    const wait = this.retryMs[attempt - 1];
    if (wait === undefined) {
      this.deps.logger.warn(
        { event: 'ens', campaign: id, attempt, err: errName(error) },
        'ens: gave up',
      );
      return;
    }
    this.deps.logger.warn(
      { event: 'ens', campaign: id, attempt, err: errName(error), retryInMs: wait },
      'ens: will retry',
    );
    this.#open += 1;
    setTimeout(() => {
      this.enqueue(id, attempt + 1);
      this.#settle();
    }, wait).unref?.();
  }

  async #attempt(id: Hex, attempt: number): Promise<void> {
    const found = await this.deps.stores.campaigns.get(id);
    if (!found || found.payload.ens?.status === 'registered') return;
    const campaign = found.payload;
    let ens: CampaignEns =
      campaign.ens === undefined
        ? await this.#claimName(campaign)
        : { ...campaign.ens, status: 'pending' };
    const slug = ens.name.slice(0, -(this.names.parent.length + 1));
    this.#taken.add(slug);
    try {
      const out = await this.names.ensureCampaignName({
        campaignId: id,
        slug,
        sponsor: campaign.sponsor as Hex,
        expiresAt: campaign.expiresAt,
        records: this.#records(campaign, slug, found.entityKey),
        onTx: async (step, hash) => {
          ens = { ...ens, txs: [...ens.txs, { step, hash }].slice(-16) };
          this.deps.logger.info({ event: 'ens', campaign: id, step, tx: hash }, 'ens: tx');
          await this.#save(id, ens);
        },
      });
      await this.#save(id, { ...ens, resolver: out.resolver, status: 'registered' });
      this.deps.logger.info({ event: 'ens', campaign: id, name: ens.name }, 'ens: name registered');
    } catch (error) {
      const permanent = isAdapterError(error) && PERMANENT.has(error.code);
      if (permanent || attempt > this.retryMs.length) {
        await this.#save(id, { ...ens, status: 'failed' });
        this.deps.logger.warn(
          { event: 'ens', campaign: id, err: errName(error) },
          'ens: name failed',
        );
        return;
      }
      throw error;
    }
  }

  /** The first free slug (`base`, `base-2`, …), saved as `pending` before any transaction. */
  async #claimName(campaign: Campaign): Promise<CampaignEns> {
    const base = slugFor(campaign.name, campaign.id);
    for (let n = 1; n < 100; n += 1) {
      const suffix = n === 1 ? '' : `-${n}`;
      const slug = `${base.slice(0, 40 - suffix.length).replace(/-+$/, '')}${suffix}`;
      if (this.#taken.has(slug) || !(await this.names.isAvailable(slug))) continue;
      this.#taken.add(slug);
      const ens: CampaignEns = { name: `${slug}.${this.names.parent}`, status: 'pending', txs: [] };
      await this.#save(campaign.id as Hex, ens);
      return ens;
    }
    throw new Error(`ens: no free name for ${base}`);
  }

  /** Recharge's records (the sponsor cannot change them; `description` is only the initial value). */
  #records(c: Campaign, slug: string, entityKey: string): Record<string, string> {
    return {
      url: `${this.deps.env.ENS_APP_URL.replace(/\/+$/, '')}/c/${slug}`,
      'recharge.campaign': c.id,
      'recharge.pool': `eip155:${this.deps.chainId}:${this.deps.dataDrop.address}`,
      'recharge.bundle': bundleText(c),
      ...(/^0x[0-9a-fA-F]{64}$/.test(entityKey) ? { 'recharge.arkiv': entityKey } : {}),
      description: c.name,
    };
  }

  /** Read-modify-write of the campaign entity: only `ens` changes. */
  async #save(id: Hex, ens: CampaignEns): Promise<void> {
    const found = await this.deps.stores.campaigns.get(id);
    if (found) await this.deps.stores.campaigns.put({ ...found.payload, ens });
  }
}

const errName = (error: unknown): string =>
  isAdapterError(error)
    ? `${error.code}: ${error.message}`
    : error instanceof Error
      ? error.name
      : 'error';
