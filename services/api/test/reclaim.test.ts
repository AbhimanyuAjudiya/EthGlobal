import { describe, expect, it, vi } from 'vitest';

import { anvilKeys } from '@ethglobal/adapters/testing';

import {
  buyGift,
  claimGiftBySignature,
  DAY,
  errorOf,
  harness,
  hcsMessages,
  reclaimGift,
  STRANGER_KEY,
  reasonOf,
} from './support/harness.js';

const lapsed = async (env: Record<string, string> = {}) => {
  const h = await harness({ env });
  const gift = await buyGift(h, 'bob.eth', 1000);
  return { h, gift, lapse: () => h.clock.advance(7 * DAY + 1) };
};

describe('POST /gift/reclaim', () => {
  it('before claimBy → 409 too-early', async () => {
    const { h, gift } = await lapsed();
    const res = await reclaimGift(h, gift.giftId);
    expect(await reasonOf(res)).toEqual([409, 'too-early']);
  });

  it('after claimBy with the escrow gone → 200, refund usd6 − fee, a gift-reclaim receipt with the tx, HCS', async () => {
    const { h, gift, lapse } = await lapsed({ GIFT_RECLAIM_FEE_USD6: '10000' });
    lapse();
    const res = await reclaimGift(h, gift.giftId);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { refundedUsd6: string; feeUsd6: string; tx: string };
    expect(body).toMatchObject({ refundedUsd6: '3990000', feeUsd6: '10000' });
    expect(h.treasury.refunds()).toEqual([
      expect.objectContaining({ usd6: 3_990_000n, tx: body.tx }),
    ]);
    const receipts = await h.adapters.ledger.query({
      annotations: { type: 'receipt', receiptKind: 'gift-reclaim' },
    });
    expect(receipts.some((r) => r.payload.includes(body.tx))).toBe(true);
    expect(hcsMessages(h).at(-1)).toMatchObject({ t: 'gift-reclaim', tx: body.tx });
  });

  it('claimed gift → 409; second reclaim → 409 already-reclaimed; wrong payer → 401', async () => {
    const { h, gift, lapse } = await lapsed();
    const other = await buyGift(h, 'alice.eth');
    expect((await claimGiftBySignature(h, other.giftId, anvilKeys[0], 'alice.eth')).status).toBe(
      201,
    );
    lapse();
    expect((await reclaimGift(h, other.giftId)).status).toBe(409);
    expect((await reclaimGift(h, gift.giftId, STRANGER_KEY)).status).toBe(401);
    expect((await reclaimGift(h, gift.giftId)).status).toBe(200);
    const second = await reclaimGift(h, gift.giftId);
    expect(await reasonOf(second)).toEqual([409, 'already-reclaimed']);
    expect(h.treasury.refunds()).toHaveLength(1);
  });

  it('ledger throws → 503 and no refund', async () => {
    const { h, gift, lapse } = await lapsed();
    lapse();
    const challenge = vi.spyOn(h.adapters.ledger, 'query');
    challenge.mockImplementation(async (q) => {
      if (q?.annotations?.type === 'receipt') throw new Error('arkiv down');
      return [];
    });
    const res = await reclaimGift(h, gift.giftId);
    expect(res.status).toBe(503);
    expect(h.treasury.refunds()).toHaveLength(0);
  });

  it('treasury throws → 503, the pending receipt is kept, a retry does not refund twice', async () => {
    const { h, gift, lapse } = await lapsed();
    lapse();
    h.treasury.failNext = true;
    expect(await errorOf(await reclaimGift(h, gift.giftId))).toBe('chain_unavailable');
    expect((await reclaimGift(h, gift.giftId)).status).toBe(409);
    expect(h.treasury.refunds()).toHaveLength(0);
    const pending = await h.adapters.ledger.query({
      annotations: { type: 'receipt', receiptKind: 'gift-reclaim' },
    });
    expect(pending).toHaveLength(1);
  });

  it('daily treasury cap → 503 and no transfer', async () => {
    const { h, gift, lapse } = await lapsed({ TREASURY_MAX_USD6_PER_DAY: '1000000' });
    lapse();
    const res = await reclaimGift(h, gift.giftId);
    expect([res.status, await errorOf(res)]).toEqual([503, 'chain_unavailable']);
    expect(h.treasury.refunds()).toHaveLength(0);
  });
});
