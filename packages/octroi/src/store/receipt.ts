/** ReceiptStore (INTERFACES §1.4; T-30, T-44). Receipts carry sha256(entitlementKey), never the key. */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import { ANN, dayBucket, RECEIPT_TTL_S, type Hex } from '@ethglobal/protocol/ids';
import { receiptSchema, type Receipt } from '@ethglobal/protocol/schemas';
import { usd6FromWire } from '@ethglobal/protocol/units';

import { lower, Repo, type Codec, type Found } from './common.js';

const receiptCodec: Codec<Receipt> = {
  type: 'receipt',
  schema: receiptSchema,
  key: (r) => r.key,
  annotations: (r) => ({
    [ANN.receiptKind]: r.kind,
    [ANN.entitlementKeyHash]: lower(r.entitlementKeyHash),
    [ANN.campaignId]: lower(r.campaignId),
    [ANN.day]: dayBucket(r.at),
  }),
  expiresIn: () => RECEIPT_TTL_S,
};

const payloads = (rows: Found<Receipt>[]): Receipt[] => rows.map((row) => row.payload);
const sumUsd6 = (rows: Found<Receipt>[]): bigint =>
  rows.reduce((sum, { payload }) => sum + usd6FromWire(payload.usd6 ?? '0'), 0n);

export class ReceiptStore {
  readonly #repo: Repo<Receipt>;

  constructor(ledger: Ledger, now: () => number) {
    this.#repo = new Repo(ledger, now, receiptCodec);
  }

  add(r: Receipt): Promise<LedgerPutResult> {
    return this.#repo.create(r);
  }

  /** The live receipt with this logical key, or null (one exact lookup: no other receipt is read). */
  async byKey(key: string): Promise<Receipt | null> {
    return (await this.#repo.byKey(key))?.payload ?? null;
  }

  async forEntitlement(entitlementKeyHash: Hex): Promise<Receipt[]> {
    return payloads(
      await this.#repo.findAll({ [ANN.entitlementKeyHash]: lower(entitlementKeyHash) }),
    );
  }

  async forCampaign(campaignId: Hex): Promise<Receipt[]> {
    return payloads(await this.#repo.findAll({ [ANN.campaignId]: lower(campaignId) }));
  }

  /** Σ usd6 of the receipts of exactly this kind, entitlement and UTC day (the agent's cap, T-30). */
  async spentUsd6(entitlementKeyHash: Hex, kind: Receipt['kind'], day: number): Promise<bigint> {
    return sumUsd6(
      await this.#repo.findAll({
        [ANN.receiptKind]: kind,
        [ANN.entitlementKeyHash]: lower(entitlementKeyHash),
        [ANN.day]: day,
      }),
    );
  }

  /** Every receipt of this kind on this UTC day, across entitlements (the treasury's daily cap, A-38). */
  async byKindAndDay(kind: Receipt['kind'], day: number): Promise<Receipt[]> {
    return payloads(await this.#repo.findAll({ [ANN.receiptKind]: kind, [ANN.day]: day }));
  }

  /** Σ usd6 of every receipt of this kind on this UTC day (A-38): ledger-backed, so it survives restarts. */
  async spentUsd6ForDay(kind: Receipt['kind'], day: number): Promise<bigint> {
    return sumUsd6(await this.#repo.findAll({ [ANN.receiptKind]: kind, [ANN.day]: day }));
  }

  /**
   * Merge `patch` into the live receipt under compare-and-swap (A-38; e.g. a pending refund receipt gets its tx).
   * `v` and `key` never change; annotations are re-derived; the lifetime is kept. Missing ⇒ RechargeError('not_found').
   */
  async patch(key: string, patch: Partial<Receipt>): Promise<Receipt> {
    const found = await this.#repo.mutate(
      key,
      (existing) => ({ payload: { ...existing.payload, ...patch, v: 1, key } }),
      () => new RechargeError('not_found', `no live receipt ${key}`),
    );
    return found.payload;
  }
}
