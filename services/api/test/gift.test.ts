import { describe, expect, it, vi } from 'vitest';

import { anvilKeys } from '@ethglobal/adapters/testing';
import { isValidPin } from '@ethglobal/protocol/pin';

import {
  buyGift,
  claimGiftBySignature,
  DAY,
  errorOf,
  harness,
  hcsMessages,
  redeemPin,
  STRANGER_KEY,
} from './support/harness.js';

const BOB = anvilKeys[1];

describe('POST /gift', () => {
  it('unresolvable name → 404 before any 402, and the resolver is asked first', async () => {
    const h = await harness();
    const verify = vi.spyOn(h.adapters.payments, 'verify');
    const res = await h.json('/gift', { name: 'nobody.eth', mb: 1000 });
    expect([res.status, await errorOf(res), res.headers.get('PAYMENT-REQUIRED')]).toEqual([
      404,
      'name_unresolved',
      null,
    ]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('bob.eth → 402 → pay → 201 with pin, serial, claimBy = now + 7 d; the escrow lives exactly the claim window', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    expect(isValidPin(gift.pin)).toBe(true);
    expect(gift).toMatchObject({
      serial: gift.giftId.slice(2, 10),
      name: 'bob.eth',
      mb: 1000,
      claimBy: h.clock.now() + 7 * DAY,
    });
    const [escrow] = await h.adapters.ledger.query({ annotations: { type: 'gift' } });
    expect(escrow?.expiresAt).toBe(gift.claimBy);
    expect(escrow?.payload).toMatch(/"pinKey"/);
    expect(escrow?.payload).not.toContain(gift.pin);
    expect(hcsMessages(h).at(-1)).toMatchObject({ t: 'gift', giftId: gift.giftId });
  });

  it('normalises names (ENSIP-15) and refuses unnormalisable ones', async () => {
    const h = await harness();
    expect((await h.json('/gift', { name: 'BOB.ETH', mb: 100 })).status).toBe(402);
    expect((await h.json('/gift', { name: 'bo​b.eth', mb: 100 })).status).toBe(400);
  });
});

describe('POST /gift/claim', () => {
  it('by signature of the resolved address → 201 giftent:<id>, gift claimed, HCS gift-claim', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    const res = await claimGiftBySignature(h, gift.giftId, BOB);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { entitlementKey: string }).entitlementKey).toBe(
      `giftent:${gift.giftId}`,
    );
    const [escrow] = await h.adapters.ledger.query({ annotations: { type: 'gift' } });
    expect(escrow?.annotations.state).toBe('claimed');
    expect(hcsMessages(h).at(-1)).toMatchObject({ t: 'gift-claim', giftId: gift.giftId });
  });

  it('by a wrong signer → 401; by PIN → 201; after claimBy → 410', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    expect((await claimGiftBySignature(h, gift.giftId, STRANGER_KEY)).status).toBe(401);
    expect((await redeemPin(h, gift.pin, '/gift/claim')).status).toBe(201);
    const late = await buyGift(h, 'alice.eth', 100);
    h.clock.advance(7 * DAY + 1);
    expect((await claimGiftBySignature(h, late.giftId, anvilKeys[0], 'alice.eth')).status).toBe(
      410,
    );
  });
});
