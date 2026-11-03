/** ReceiptStore (INTERFACES §1.4; T-30, T-44). Receipts carry sha256(entitlementKey), never the key. */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
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

export class ReceiptStore {
  readonly #repo: Repo<Receipt>;

  constructor(ledger: Ledger, now: () => number) {
    this.#repo = new Repo(ledger, now, receiptCodec);
  }

  add(r: Receipt): Promise<LedgerPutResult> {
    return this.#repo.create(r);
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
    const rows = await this.#repo.findAll({
      [ANN.receiptKind]: kind,
      [ANN.entitlementKeyHash]: lower(entitlementKeyHash),
      [ANN.day]: day,
    });
    return rows.reduce((sum, { payload }) => sum + usd6FromWire(payload.usd6 ?? '0'), 0n);
  }
}
