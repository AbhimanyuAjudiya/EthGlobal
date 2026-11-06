/** T-71, AP11: a claimed (delivered) gift is never refunded; refunds come from the treasury port under its daily cap. */
import { describe, expect, it } from 'vitest';

import { anvilKeys } from '@ethglobal/adapters/testing';

import { buyGift, claimGiftBySignature, DAY, harness, reclaimGift } from '../support/harness.js';

describe('T-71 reclaim', () => {
  it('delivered gift ⇒ 409 claimed even after the escrow expired; two lapsed gifts over the daily cap ⇒ the second 503', async () => {
    const h = await harness({ env: { TREASURY_MAX_USD6_PER_DAY: '5000000' } }); // one $4.00 refund, not two
    const delivered = await buyGift(h, 'bob.eth');
    expect((await claimGiftBySignature(h, delivered.giftId, anvilKeys[1])).status).toBe(201);
    const a = await buyGift(h, 'alice.eth');
    const b = await buyGift(h, 'alice.eth');
    h.clock.advance(7 * DAY + 1);
    expect((await reclaimGift(h, delivered.giftId)).status).toBe(409);
    expect((await reclaimGift(h, a.giftId)).status).toBe(200);
    expect((await reclaimGift(h, b.giftId)).status).toBe(503);
    expect(h.treasury.refunds().map((r) => r.memo)).toEqual([a.giftId]);
  });
});
