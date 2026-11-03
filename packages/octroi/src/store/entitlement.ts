/** EntitlementStore (INTERFACES §5; T-35, T-36, T-37). */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import { ANN, type Hex } from '@ethglobal/protocol/ids';
import { entitlementSchema, type Entitlement } from '@ethglobal/protocol/schemas';

import { lifetimeUntil, lower, Repo, type Codec, type Found } from './common.js';

const entitlementCodec: Codec<Entitlement> = {
  type: 'entitlement',
  schema: entitlementSchema,
  key: (e) => e.key,
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

export class EntitlementStore {
  readonly #repo: Repo<Entitlement>;

  constructor(
    ledger: Ledger,
    private readonly now: () => number,
  ) {
    this.#repo = new Repo(ledger, now, entitlementCodec);
  }

  /** By logical key (`ent:v1:…`, `paid:…`, `giftent:…`); expired if gone OR annotations.expiresAt ≤ now. */
  getByKey(key: string): Promise<Found<Entitlement> | null> {
    return this.#repo.byKey(key);
  }

  getByIccidHash(iccidHash: Hex): Promise<Found<Entitlement> | null> {
    return this.#repo.findOne({ [ANN.iccidHash]: lower(iccidHash) });
  }

  create(e: Entitlement): Promise<LedgerPutResult> {
    return this.#repo.create(e);
  }

  /**
   * Merges `patch`, keeps the logical key, re-derives annotations. The lifetime changes only through
   * `opts.expiresAt`; an expired or missing entity is never resurrected (RechargeError('not_found')).
   */
  async patch(
    key: string,
    patch: Partial<Entitlement>,
    opts: { expiresAt?: number } = {},
  ): Promise<Found<Entitlement>> {
    if (patch.expiresAt !== undefined && patch.expiresAt !== opts.expiresAt) {
      throw new RechargeError('invalid_request', 'change expiresAt through opts.expiresAt');
    }
    const existing = await this.#repo.byKey(key);
    if (!existing) throw new RechargeError('not_found', `no live entitlement ${key}`);
    const expiresAt = opts.expiresAt ?? existing.payload.expiresAt;
    const next: Entitlement = { ...existing.payload, ...patch, v: 1, key, expiresAt };
    const expiresIn =
      opts.expiresAt === undefined ? undefined : lifetimeUntil(opts.expiresAt, this.now());
    return this.#repo.replace(existing, next, expiresIn);
  }

  /** Live entitlements whose expiresAt − now ≤ ms, soonest first (sponsor dashboard). */
  async expiringWithin(ms: number, limit = DEFAULT_LIST_LIMIT): Promise<Found<Entitlement>[]> {
    const horizon = this.now() + ms;
    const all = await this.#repo.findAll();
    return all
      .filter((found) => found.payload.expiresAt <= horizon)
      .sort((a, b) => a.payload.expiresAt - b.payload.expiresAt)
      .slice(0, Math.max(0, limit));
  }
}
