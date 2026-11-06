/**
 * The ticket allowlist: in MODE=live a ticketed campaign is disclosed only to the holder of a valid organizer-issued
 * pass (POST /ticket/preview); GET /plans never names one, with or without ?campaign=. A campaign without a ticket
 * gate is named to anyone who asks for it by id (the sponsor's claim link). MODE=local keeps the public default.
 */
import { describe, expect, it } from 'vitest';

import { T0 } from '@ethglobal/adapters/testing';
import { plansResponseSchema } from '@ethglobal/protocol/schemas';

import { eventFields } from './support/campaign.js';
import { sponsorTicketsRequest } from './support/client.js';
import { errorOf, harness, issueTickets, SPONSOR_KEY } from './support/harness.js';

/** Idempotency-Key (32–128 url-safe chars): the preview binds the pass to this holder's recovery key. */
const RECOVERY = 'preview-recovery-0123456789abcdef0123456789';
const SESSION = `0x${'ab'.repeat(32)}`;

const eventHarness = async (mode: 'local' | 'live') => {
  const h = await harness({ campaign: { event: eventFields(T0) } });
  h.deps.env.MODE = mode;
  return h;
};

describe('ticket allowlist', () => {
  it('live: GET /plans never names a campaign; /ticket/preview returns its terms for a valid, unrevoked pass', async () => {
    const h = await eventHarness('live');
    const [pass] = await issueTickets(h, ['seat-1']);
    for (const path of ['/plans', `/plans?campaign=${h.campaignId}`]) {
      const plans = plansResponseSchema.parse(await (await h.get(path)).json());
      expect(plans.mode).toBe('live');
      expect(plans.campaign).toBeNull();
    }
    const preview = (ticketPass: string) =>
      h.json(
        '/ticket/preview',
        { campaignId: h.campaignId, ticketPass, sessionPubKey: SESSION },
        { 'idempotency-key': RECOVERY },
      );
    const ok = await preview(pass!);
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { valid: true; campaignId: string; plans: unknown };
    expect(body.campaignId).toBe(h.campaignId);
    expect(plansResponseSchema.parse(body.plans).campaign).toMatchObject({
      id: h.campaignId,
      name: 'Mumbai Welcome',
      event: { ticketRequired: true, destinationCountry: 'IN' },
    });
    expect(await errorOf(await preview(`0x${'99'.repeat(32)}`))).toBe('ticket_invalid');

    const revoke = await sponsorTicketsRequest(SPONSOR_KEY, h.deps.chainId, h.campaignId, {
      ticketRefs: ['seat-1'],
      issuedAt: h.clock.now(),
      revoke: true,
    });
    expect((await h.json(`/sponsor/${h.campaignId}/tickets/revoke`, revoke)).status).toBe(200);
    expect(await errorOf(await preview(pass!))).toBe('ticket_invalid');
  });

  it('live: a campaign without a ticket gate is named to whoever asks for it by id, never by default', async () => {
    const h = await harness();
    h.deps.env.MODE = 'live';
    const asked = plansResponseSchema.parse(
      await (await h.get(`/plans?campaign=${h.campaignId}`)).json(),
    );
    expect(asked.mode).toBe('live');
    expect(asked.campaign?.id).toBe(h.campaignId);
    expect(plansResponseSchema.parse(await (await h.get('/plans')).json()).campaign).toBeNull();
  });

  it('local: GET /plans?campaign= still answers for the registered campaign', async () => {
    const h = await eventHarness('local');
    const plans = plansResponseSchema.parse(
      await (await h.get(`/plans?campaign=${h.campaignId}`)).json(),
    );
    expect(plans.mode).toBe('local');
    expect(plans.campaign?.id).toBe(h.campaignId);
  });
});
