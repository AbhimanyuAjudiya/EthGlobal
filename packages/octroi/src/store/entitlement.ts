/**
 * EntitlementStore (INTERFACES §5; T-35, T-36, T-37). The entitlement key is a capability (`/me/:key`): it never
 * reaches the ledger. Annotation AND payload carry `entitlementIndex(key)` = `hk:` + sha256(key) instead (A-34,
 * RT-O-01); a lookup by capability hashes first, and the payload handed back carries the capability again.
 */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import { ANN, type Hex } from '@ethglobal/protocol/ids';
import { entitlementSchema, type Entitlement } from '@ethglobal/protocol/schemas';

import { entitlementIndex, INDEX_PREFIX } from '../keys.js';
import { lifetimeUntil, lower, Repo, type Codec, type Found } from './common.js';

const entitlementCodec: Codec<Entitlement> = {
  type: 'entitlement',
  schema: entitlementSchema,
  key: (e) => entitlementIndex(e.key),
  annotations: (e) => ({
    [ANN.kind]: e.kind,
    [ANN.status]: e.status,
    [ANN.tier]: e.tier,
    [ANN.campaignId]: lower(e.campaignId),
    [ANN.iccidHash]: lower(e.iccidHash),
    [ANN.expiresAt]: e.expiresAt,
  }),
  expiresIn: (e, now) => lifetimeUntil(e.expiresAt, now),
};

const DEFAULT_LIST_LIMIT = 100;

const isIndex = (key: string): boolean => key.startsWith(INDEX_PREFIX);
/** The stored form: the key replaced by its index. */
const stored = (e: Entitlement): Entitlement => ({ ...e, key: entitlementIndex(e.key) });
/** The caller's form: the key it looked up by (a capability, or — server-internal reads — the index). */
const as = (found: Found<Entitlement>, key: string): Found<Entitlement> => ({
  ...found,
  payload: { ...found.payload, key },
});

export class EntitlementStore {
  readonly #repo: Repo<Entitlement>;

  constructor(
    ledger: Ledger,
    private readonly now: () => number,
  ) {
    this.#repo = new Repo(ledger, now, entitlementCodec);
  }

  /**
   * By capability (`ent:v1:…`, `paid:…`, `giftent:…`); expired if gone OR annotations.expiresAt ≤ now. An index
   * (`hk:…`, readable off the ledger) is NOT a capability and finds nothing: this is the `/me/:key` check.
   */
  async getByKey(key: string): Promise<Found<Entitlement> | null> {
    if (typeof key !== 'string' || isIndex(key)) return null;
    const found = await this.#repo.byKey(entitlementIndex(key));
    return found && as(found, key);
  }

  /** Server-internal (usage webhook): the payload's `key` is the index; `patch` accepts it. */
  getByIccidHash(iccidHash: Hex): Promise<Found<Entitlement> | null> {
    return this.#repo.findOne({ [ANN.iccidHash]: lower(iccidHash) });
  }

  /** Create-if-absent (A-32): a live entitlement with the same key anywhere ⇒ RechargeError('replay'). */
  async create(e: Entitlement): Promise<LedgerPutResult> {
    const valid = this.#repo.validate(e);
    if (isIndex(valid.key)) {
      throw new RechargeError('invalid_request', 'an entitlement is created by its capability');
    }
    return this.#repo.create(stored(valid));
  }

  /**
   * Merges `patch` into a FRESH read under compare-and-swap, retried on conflict (A-32, RT-O-06: a concurrent
   * usage patch and top-up both land). Keeps the logical key, re-derives annotations. The lifetime changes only
   * through `opts.expiresAt`; an expired or missing entity is never resurrected (RechargeError('not_found')).
   * `key` is the capability or (server-internal) the index. A function patch is computed from the fresh row on
   * every attempt, so a relative change (`(e) => ({ mbTotal: e.mbTotal + 100 })`, a top-up) never loses a
   * concurrent one.
   */
  async patch(
    key: string,
    patch: Partial<Entitlement> | ((current: Entitlement) => Partial<Entitlement>),
    opts: { expiresAt?: number | ((current: Entitlement) => number | undefined) } = {},
  ): Promise<Found<Entitlement>> {
    const checked = (changes: Partial<Entitlement>): Partial<Entitlement> => {
      if (changes.expiresAt !== undefined && changes.expiresAt !== opts.expiresAt) {
        throw new RechargeError('invalid_request', 'change expiresAt through opts.expiresAt');
      }
      return changes;
    };
    // a static patch is refused before any read; a function patch on each fresh row
    const changesFor =
      typeof patch === 'function'
        ? (current: Entitlement) => checked(patch(current))
        : (
            (fixed) => () =>
              fixed
          )(checked(patch));
    const index = entitlementIndex(key);
    const found = await this.#repo.mutate(
      index,
      (existing) => {
        const current = { ...existing.payload, key };
        const changes = changesFor(current);
        const requestedExpiry =
          typeof opts.expiresAt === 'function' ? opts.expiresAt(current) : opts.expiresAt;
        const expiresAt = requestedExpiry ?? existing.payload.expiresAt;
        const next: Entitlement = { ...existing.payload, ...changes, v: 1, key: index, expiresAt };
        const expiresIn =
          requestedExpiry === undefined ? undefined : lifetimeUntil(requestedExpiry, this.now());
        return { payload: next, ...(expiresIn === undefined ? {} : { expiresIn }) };
      },
      () => new RechargeError('not_found', `no live entitlement ${index}`),
    );
    return as(found, key);
  }

  /** At most `limit` live entitlements of this campaign and kind (sponsor analytics). Keys are indexes. */
  forCampaign(
    campaignId: Hex,
    kind: Entitlement['kind'],
    limit: number,
  ): Promise<Found<Entitlement>[]> {
    return this.#repo.findAll({ [ANN.campaignId]: lower(campaignId), [ANN.kind]: kind }, limit);
  }

  /** Live entitlements whose expiresAt − now ≤ ms, soonest first (sponsor dashboard). Keys are indexes. */
  async expiringWithin(ms: number, limit = DEFAULT_LIST_LIMIT): Promise<Found<Entitlement>[]> {
    const horizon = this.now() + ms;
    const all = await this.#repo.findAll();
    return all
      .filter((found) => found.payload.expiresAt <= horizon)
      .sort((a, b) => a.payload.expiresAt - b.payload.expiresAt)
      .slice(0, Math.max(0, limit));
  }
}
