/** AP11 — gift reclaim and the treasury (T-71, N5). */
import { describe, expect, it, vi } from 'vitest';

import { AdapterError } from '@ethglobal/adapters';
import { anvilKeys } from '@ethglobal/adapters/testing';

import {
  buyGift,
  DAY,
  errorOf,
  harness,
  HUMAN_KEY,
  payerSessionKey,
  reclaimGift,
  redeemPin,
  addressOf,
  signGiftReclaim,
  reasonOf,
} from './fixture.js';

describe('attack: reclaim (AP11)', () => {
  it('a gift-claim receipt write that fails ⇒ the claim is 503 with no LPA (the receipt precedes delivery); the later reclaim refunds the undelivered gift', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    const add = vi.spyOn(h.deps.stores.receipts, 'add').mockImplementation(async (r) => {
      if (r.kind === 'gift-claim') throw new AdapterError('ledger', 'unavailable', 'arkiv down');
      return { key: 'x', expiresAt: null };
    });
    const claim = await redeemPin(h, gift.pin, '/gift/claim');
    expect(claim.status).toBe(503);
    expect(await claim.text()).not.toMatch(/sealedLpa/);
    add.mockRestore();
    expect(h.reseller.orders()).toHaveLength(0);
    h.clock.advance(7 * DAY + 1);
    expect((await reclaimGift(h, gift.giftId)).status).toBe(200);
  });

  it('two concurrent reclaims ⇒ exactly one refund; the other 409', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    h.clock.advance(7 * DAY + 1);
    const [a, b] = await Promise.all([reclaimGift(h, gift.giftId), reclaimGift(h, gift.giftId)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(h.treasury.refunds()).toHaveLength(1);
  });

  it('a GiftReclaim signed for gift A replayed for gift B ⇒ 401; a consumed reclaim challenge replayed ⇒ 409', async () => {
    const h = await harness();
    const a = await buyGift(h, 'bob.eth', 100);
    const b = await buyGift(h, 'alice.eth', 100);
    h.clock.advance(7 * DAY + 1);
    expect((await reclaimGift(h, b.giftId, HUMAN_KEY, { signFor: a.giftId })).status).toBe(401);
    const payer = addressOf(HUMAN_KEY);
    const ch = await h.challengeFor('/gift/reclaim', payerSessionKey(payer));
    const signature = await signGiftReclaim(HUMAN_KEY, h.deps.chainId, {
      giftId: a.giftId as `0x${string}`,
      nonce: ch.nonce as `0x${string}`,
    });
    expect(
      (await h.json('/gift/reclaim', { giftId: a.giftId, payer, signature, challenge: ch })).status,
    ).toBe(200);
    expect(
      await errorOf(
        await h.json('/gift/reclaim', { giftId: a.giftId, payer, signature, challenge: ch }),
      ),
    ).toBe('replay');
  });

  // T-71e fixed (protocol A-36): RECEIPT_TTL_S = claim window + reclaim window + 1 d = 38 d, so the receipt is there.
  it('day 31 after a 7-day gift: the gift receipt (RECEIPT_TTL_S = 38 d) is still there ⇒ reclaimed', async () => {
    const h = await harness();
    const gift = await buyGift(h, 'bob.eth', 100);
    h.clock.advance(31 * DAY);
    const res = await reclaimGift(h, gift.giftId);
    expect(res.status).toBe(200);
  });

  it('a Hedera-account payer cannot sign GiftReclaim{payer: address} ⇒ 400 (documented: Hedera-paid gifts are not reclaimable)', async () => {
    const h = await harness();
    const ch = await h.challengeFor('/gift/reclaim', payerSessionKey(addressOf(anvilKeys[0])));
    expect(
      (
        await h.json('/gift/reclaim', {
          giftId: `0x${'01'.repeat(32)}`,
          payer: '0.0.5005',
          signature: '0x00',
          challenge: ch,
        })
      ).status,
    ).toBe(400);
  });
});
