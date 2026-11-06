/** GiftStore: the escrow entity whose lifetime IS the claim window (INTERFACES §1.4, A-17; T-43, T-48). */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import { ANN, keys, type Hex } from '@ethglobal/protocol/ids';
import { giftSchema, type Gift } from '@ethglobal/protocol/schemas';

import { entitlementIndex } from '../keys.js';
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
    return this.#repo.create(
      g.claimedKey === undefined ? g : { ...g, claimedKey: entitlementIndex(g.claimedKey) },
    );
  }

  /** Open escrows for an ENS namehash (the third load-bearing read, DECISION §2(4)). */
  openByNamehash(namehash: Hex): Promise<Found<Gift>[]> {
    return this.#repo.findAll({ [ANN.namehash]: lower(namehash), [ANN.state]: 'open' });
  }

  /**
   * Open (unredeemed, unexpired) campaign-funded scratch cards of one campaign (RT-P-08, A-45): each is a claim the
   * campaign's remaining budget has promised, so a new card batch is sized against budget − these.
   */
  async openCampaignCards(campaignId: Hex): Promise<Found<Gift>[]> {
    const rows = await this.#repo.findAll({
      [ANN.kind]: 'card',
      [ANN.state]: 'open',
      [ANN.campaignId]: lower(campaignId),
    });
    return rows.filter((g) => g.payload.fundedBy === 'campaign');
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
   * Compare-and-swap (A-32, RT-O-06): of N concurrent claims with different keys exactly one succeeds; the
   * others re-read the claimed row and get already_claimed.
   */
  async markClaimed(giftId: Hex, entitlementKey: string): Promise<void> {
    const index = entitlementIndex(entitlementKey);
    await this.#repo.mutate(
      keys.gift(giftId),
      (existing) => {
        const { payload } = existing;
        if (payload.state === 'claimed') {
          if (payload.claimedKey !== undefined && entitlementIndex(payload.claimedKey) === index)
            return {
              payload: payload.claimedKey === index ? payload : { ...payload, claimedKey: index },
            };
          throw new RechargeError('already_claimed', `gift ${giftId} already claimed`);
        }
        return { payload: { ...payload, state: 'claimed', claimedKey: index } };
      },
      () => new RechargeError('not_found', `no live gift ${giftId}`),
    );
  }
}
