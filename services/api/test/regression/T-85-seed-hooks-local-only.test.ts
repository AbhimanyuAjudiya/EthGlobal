/** T-85, AP18: X-Seed-* hooks work (and are logged) in MODE=local only; in live a request behaves like a control request. */
import { describe, expect, it } from 'vitest';

import { T0 } from '@ethglobal/adapters/testing';

import { eventFields } from '../support/campaign.js';
import { buyGift, DAY, harness, issueTickets, type Harness } from '../support/harness.js';

/** Live claims admit organizer-issued passes only, so the live harness runs a ticket-gated event campaign. */
const seeded = async (live: boolean) => {
  const h = await harness(live ? { campaign: { event: eventFields(T0) } } : {});
  if (live) h.deps.env.MODE = 'live';
  return h;
};
const cardHook = (h: Harness) =>
  h.json('/gift', { name: 'bob.eth', mb: 1000 }, { 'x-seed-card-campaign': h.campaignId });

describe('T-85 seed hooks are local-only', () => {
  it('live: X-Seed-Card-Campaign without payment ⇒ 402, no card, no DataDrop.claim', async () => {
    const h = await seeded(true);
    const res = await cardHook(h);
    expect(res.status).toBe(402);
    expect(await h.adapters.ledger.query({ annotations: { type: 'gift' } })).toHaveLength(0);
    expect(h.dataDrop.claimedEvents).toHaveLength(0);
  });

  it('live: X-Seed-Validity-S on /claim and X-Seed-Claim-Window-S on /gift are ignored', async () => {
    const h = await seeded(true);
    const [ticketPass] = await issueTickets(h, ['seat-1']);
    const claim = await h.claim({
      ticketPass: ticketPass!,
      headers: { 'x-seed-validity-s': '90' },
    });
    expect(((await claim.res.json()) as { expiresAt: number }).expiresAt).toBe(
      h.clock.now() + 7 * DAY,
    );
    const gift = await buyGift(h, 'bob.eth', 1000, { 'x-seed-claim-window-s': '5' });
    expect(gift.claimBy).toBe(h.clock.now() + 7 * DAY);
    expect(h.lines.join('')).not.toMatch(/seed-hook/);
  });

  it('local: the same three hooks work and log event seed-hook', async () => {
    const h = await seeded(false);
    expect((await cardHook(h)).status).toBe(201);
    const claim = await h.claim({ headers: { 'x-seed-validity-s': '90' } });
    expect(((await claim.res.json()) as { expiresAt: number }).expiresAt).toBe(
      h.clock.now() + 90_000,
    );
    expect((await buyGift(h, 'bob.eth', 1000, { 'x-seed-claim-window-s': '5' })).claimBy).toBe(
      h.clock.now() + 5000,
    );
    expect(h.lines.join('').match(/"event":"seed-hook"/g)?.length).toBe(3);
  });
});
