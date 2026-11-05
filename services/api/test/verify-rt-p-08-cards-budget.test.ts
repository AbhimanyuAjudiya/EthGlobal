/**
 * Red-team verification variant for RT-P-08 (POST /sponsor/:id/cards: count ≤ what the remaining budget pays for):
 * the regression mints ONE batch larger than the budget. Here the batches are each within budget but together are not —
 * sequentially (a re-run of the print step after a failure) and concurrently. Property: the campaign never has more
 * unredeemed campaign-funded cards than (budget − spent) / pricePerClaim, so every printed PIN can be redeemed.
 */
import { describe, expect, it, vi } from 'vitest';

import { sponsorCardsRequest } from './support/client.js';
import { harness, SPONSOR_KEY, type Harness } from './support/harness.js';

const mint = async (h: Harness, count: number) => {
  const body = await sponsorCardsRequest(SPONSOR_KEY, h.deps.chainId, h.campaignId, {
    count,
    mb: 300,
    issuedAt: h.clock.now(),
  });
  const res = await h.json(`/sponsor/${h.campaignId}/cards`, body);
  return {
    status: res.status,
    cards: res.status === 201 ? ((await res.json()) as { cards: unknown[] }).cards.length : 0,
  };
};

describe('verify RT-P-08: outstanding cards count against the budget', () => {
  // Regression RT-P-08 (fixed): the check was (budget − spent) / price per batch; minted-but-unredeemed cards were not
  // subtracted and concurrent batches had no reservation. Open cards now count, and a batch reserves its slots.
  it('budget for 6 claims: 4 cards, then 4 more ⇒ at most 6 cards in total [RT-P-08]', async () => {
    const h = await harness({ campaign: { budget: 3_000_000n } }); // 0.50 per claim ⇒ 6 claims
    const a = await mint(h, 4);
    const b = await mint(h, 4);
    expect(a.cards + b.cards).toBeLessThanOrEqual(6);
    expect([a.status, b.status]).toEqual([201, 409]);
    expect((await mint(h, 2)).status).toBe(201); // exactly the remainder still mints
    expect((await mint(h, 1)).status).toBe(409);
  });

  // Regression RT-P-08 (fixed)
  it('budget for 6 claims: two concurrent batches of 4 ⇒ at most 6 cards in total [RT-P-08]', async () => {
    const h = await harness({ campaign: { budget: 3_000_000n } });
    const [a, b] = await Promise.all([mint(h, 4), mint(h, 4)]);
    expect(a.cards + b.cards).toBeLessThanOrEqual(6);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });

  it('budget for 6 claims: five concurrent batches of 2 ⇒ exactly three mint [RT-P-08]', async () => {
    const h = await harness({ campaign: { budget: 3_000_000n } });
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => mint(h, 2)));
    expect(rs.reduce((n, r) => n + r.cards, 0)).toBe(6);
    expect(rs.filter((r) => r.status === 201)).toHaveLength(3);
  });

  it('a failed batch frees its reservation: the next batch mints the full budget [RT-P-08]', async () => {
    const h = await harness({ campaign: { budget: 3_000_000n } });
    const put = vi.spyOn(h.deps.stores.gifts, 'create').mockRejectedValueOnce(new Error('down'));
    expect((await mint(h, 1)).status).toBeGreaterThanOrEqual(500);
    put.mockRestore();
    expect((await mint(h, 6)).status).toBe(201);
  });

  it('control: one batch of 6 on a budget for 6 ⇒ 201', async () => {
    const h = await harness({ campaign: { budget: 3_000_000n } });
    expect((await mint(h, 6)).status).toBe(201);
  });
});
