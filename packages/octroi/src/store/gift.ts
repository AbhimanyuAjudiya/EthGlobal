/** GiftStore: the escrow entity whose lifetime IS the claim window (INTERFACES §1.4, A-17; T-43, T-48). */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import { ANN, keys, type Hex } from '@ethglobal/protocol/ids';
import { giftSchema, type Gift } from '@ethglobal/protocol/schemas';

import { lifetimeUntil, lower, Repo, type Codec, type Found } from './common.js';

const giftCodec: Codec<Gift> = {
  type: 'gift',
  schema: giftSchema,
  key: (g) => keys.gift(g.giftId as Hex),
  annotations: (g) => ({
    [ANN.kind]: g.kind,
    [ANN.state]: g.state,
    [ANN.namehash]: lower(g.namehash),
    [ANN.pinKey]: lower(g.pinKey),
    [ANN.serial]: g.serial,
    [ANN.campaignId]: lower(g.campaignId),
    [ANN.expiresAt]: g.claimBy,
  }),
  expiresIn: (g, now) => lifetimeUntil(g.claimBy, now),
};

export class GiftStore {
  readonly #repo: Repo<Gift>;

  constructor(ledger: Ledger, now: () => number) {
    this.#repo = new Repo(ledger, now, giftCodec);
  }

  create(g: Gift): Promise<LedgerPutResult> {
    return this.#repo.create(g);
  }

  /** Open escrows for an ENS namehash (the third load-bearing read, DECISION §2(4)). */
  openByNamehash(namehash: Hex): Promise<Found<Gift>[]> {
    return this.#repo.findAll({ [ANN.namehash]: lower(namehash), [ANN.state]: 'open' });
  }

  byPinKey(pinKey: Hex): Promise<Found<Gift> | null> {
    return this.#repo.findOne({ [ANN.pinKey]: lower(pinKey) });
  }

  bySerial(serial: string): Promise<Found<Gift> | null> {
    return this.#repo.findOne({ [ANN.serial]: serial.toLowerCase() });
  }

  /**
   * open → claimed with the entitlement key; idempotent for the same key, RechargeError('already_claimed')
   * for a different one, RechargeError('not_found') once the escrow has expired (no claim after claimBy).
   */
  async markClaimed(giftId: Hex, entitlementKey: string): Promise<void> {
    const existing = await this.#repo.byKey(keys.gift(giftId));
    if (!existing) throw new RechargeError('not_found', `no live gift ${giftId}`);
    const { payload } = existing;
    if (payload.state === 'claimed') {
      if (payload.claimedKey === entitlementKey) return;
      throw new RechargeError('already_claimed', `gift ${giftId} already claimed`);
    }
    await this.#repo.replace(existing, {
      ...payload,
      state: 'claimed',
      claimedKey: entitlementKey,
    });
  }
}
