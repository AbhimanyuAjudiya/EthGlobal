/**
 * Red-team verification variant for RT-P-08 (POST /sponsor/:id/cards: count ≤ what the remaining budget pays for):
 * the regression mints ONE batch larger than the budget. Here the batches are each within budget but together are not —
 * sequentially (a re-run of the print step after a failure) and concurrently. Property: the campaign never has more
 * unredeemed campaign-funded cards than (budget − spent) / pricePerClaim, so every printed PIN can be redeemed.
 */
import { describe, expect, it } from 'vitest';

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
  // RT-FINDING RT-P-08: the check is (budget − spent) / price per batch; minted-but-unredeemed cards are not subtracted.
  it('budget for 6 claims: 4 cards, then 4 more ⇒ at most 6 cards in total_RTFINDING', async () => {
    const h = await harness({ campaign: { budget: 3_000_000n } }); // 0.50 per claim ⇒ 6 claims
    const a = await mint(h, 4);
    const b = await mint(h, 4);
    expect(a.cards + b.cards).toBeLessThanOrEqual(6);
  });

  // RT-FINDING RT-P-08
  it('budget for 6 claims: two concurrent batches of 4 ⇒ at most 6 cards in total_RTFINDING', async () => {
    const h = await harness({ campaign: { budget: 3_000_000n } });
    const [a, b] = await Promise.all([mint(h, 4), mint(h, 4)]);
    expect(a.cards + b.cards).toBeLessThanOrEqual(6);
  });

  it('control: one batch of 6 on a budget for 6 ⇒ 201', async () => {
    const h = await harness({ campaign: { budget: 3_000_000n } });
    expect((await mint(h, 6)).status).toBe(201);
  });
});
