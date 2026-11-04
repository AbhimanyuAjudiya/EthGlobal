/** AP10 — gifts and scratch cards (T-43, T-47, T-48, T-53). */
import { describe, expect, it } from 'vitest';

import { anvilAccounts, anvilKeys } from '@ethglobal/adapters/testing';

import {
  buyGift,
  claimGiftBySignature,
  harness,
  MutableNames,
  redeemPin,
  seedCard,
} from './fixture.js';

describe('attack: gifts and cards (AP10)', () => {
  it('homoglyph and zero-width names ⇒ 400; "BOB.ETH " normalises to bob.eth', async () => {
    const h = await harness();
    expect((await h.json('/gift', { name: 'bоb.eth', mb: 100 })).status).toBe(400);
    expect((await h.json('/gift', { name: 'bo​b.eth', mb: 100 })).status).toBe(400);
    expect((await h.json('/gift', { name: 'BOB.ETH ', mb: 100 })).status).toBe(402);
  });

  it('re-pointing the name between gift and claim: the NEW owner can claim, the old cannot', async () => {
    const names = new MutableNames();
    const h = await harness({ overrides: { adapters: { names } } });
    const gift = await buyGift(h, 'bob.eth', 100);
    names.set({ name: 'bob.eth', address: anvilAccounts[9] });
    expect((await claimGiftBySignature(h, gift.giftId, anvilKeys[1])).status).toBe(401);
    expect((await claimGiftBySignature(h, gift.giftId, anvilKeys[9])).status).toBe(201);
  });

  it('two concurrent redemptions of one PIN ⇒ one 201, the other 409/410; DataDrop.claim once', async () => {
    const h = await harness();
    const card = await seedCard(h);
    const [a, b] = await Promise.all([redeemPin(h, card.pin), redeemPin(h, card.pin)]);
    expect([a.status, b.status].sort()).toEqual([201, 410]);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('a gift PIN and its signature path cannot both be used (one escrow, one entitlement)', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    expect((await redeemPin(h, gift.pin, '/gift/claim')).status).toBe(201);
    expect((await claimGiftBySignature(h, gift.giftId, anvilKeys[1])).status).toBe(409);
  });
});
