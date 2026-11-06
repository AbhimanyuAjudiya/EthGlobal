/** Organizer-only ticket issuance. SponsorLogin is read-only here; issuing/recovering passes needs a signed write. */

import type { Hex } from '@ethglobal/protocol/ids';
import {
  sponsorTicketsRequestSchema,
  type SponsorTicketsRequest,
} from '@ethglobal/protocol/schemas';
import {
  canonicalTicketRefs,
  rechargeDomain,
  sponsorTicketsHash,
  SPONSOR_TICKETS_TTL_MS,
  SPONSOR_TICKETS_TYPES,
} from '@ethglobal/protocol/typed-data';

import { WindowLimiter } from '../admission.js';
import { inputOf, type AppEnv } from '../context.js';
import { fail } from '../errors.js';
import { archiveCampaign, campaignHistory } from '../flows/campaign-history.js';
import { ticketPass, ticketRecord, type TicketBook  } from '../flows/tickets.js';
import { sponsorFromHeader, SPONSOR_FUTURE_SKEW_MS } from '../middleware/sponsor-auth.js';
import { validateJson } from '../middleware/validate.js';
import { signedBy } from '../signatures.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';
import type { Address } from 'viem';

const ID = /^0x[0-9a-f]{64}$/i;

export function registerSponsorTickets(app: Hono<AppEnv>, deps: Deps): void {
  const batches = new WindowLimiter(5, 60_000, deps.now);
  app.post('/sponsor/:id/tickets', validateJson(sponsorTicketsRequestSchema), async (c) => {
    if (!ID.test(c.req.param('id'))) throw fail('invalid_request');
    const id = c.req.param('id').toLowerCase() as Hex;
    const { ticketRefs, auth } = inputOf<SponsorTicketsRequest>(c);
    let references: string[];
    try {
      references = canonicalTicketRefs(ticketRefs);
    } catch {
      throw fail('invalid_request', { detail: 'invalid ticket references' });
    }
    const ticketsHash = await sponsorTicketsHash(references);
    const now = deps.now();
    if (
      auth.issuedAt < now - SPONSOR_TICKETS_TTL_MS ||
      auth.issuedAt > now + SPONSOR_FUTURE_SKEW_MS
    )
      throw fail('unauthorized', { detail: 'ticket signature expired' });
    if (
      !(await signedBy({
        address: auth.sponsor as Address,
        domain: rechargeDomain(deps.chainId),
        types: SPONSOR_TICKETS_TYPES,
        primaryType: 'SponsorTickets',
        message: {
          campaignId: id,
          sponsor: auth.sponsor as Address,
          ticketsHash,
          nonce: auth.nonce as Hex,
          issuedAt: BigInt(auth.issuedAt),
        },
        signature: auth.signature as Hex,
      }))
    )
      throw fail('unauthorized');
    const rate = batches.hit(id);
    if (!rate.ok) throw fail('rate_limited', { retryAfterS: rate.retryAfterS });
    return deps.mutex.run(`tickets:${id}`, async () => {
      const [found, chain] = await Promise.all([
        deps.stores.campaigns.get(id),
        deps.dataDrop.campaign(id),
      ]);
      if (
        found?.payload.sponsor.toLowerCase() !== auth.sponsor.toLowerCase() ||
        chain.sponsor.toLowerCase() !== auth.sponsor.toLowerCase()
      )
        throw fail('unauthorized');
      if (!found.payload.event?.ticketRequired) throw fail('ticket_required');
      if (Math.min(found.payload.expiresAt, chain.expiresAt, found.payload.event.endsAt) <= now)
        throw fail('campaign_expired');
      if (chain.paused) throw fail('campaign_paused');
      const previous: TicketBook = deps.campaignTickets.get(id) ?? {
        campaignId: id,
        tickets: [],
        nonces: {},
      };
      const nonce = auth.nonce.toLowerCase();
      const prior = previous.nonces[nonce];
      if (prior !== undefined && prior !== ticketsHash) throw fail('replay');
      const existing = new Set(previous.tickets.map((ticket) => ticket.reference));
      const fresh = references.filter((reference) => !existing.has(reference));
      const funded = chain.pricePerClaim > 0n ? chain.budget / chain.pricePerClaim : 0n;
      if (
        BigInt(previous.tickets.length + fresh.length) > funded ||
        previous.tickets.length + fresh.length > found.payload.maxClaims
      )
        throw fail('budget_exhausted', { detail: 'fund one claim for every issued ticket' });
      // Atomic persistence precedes the only response containing passes. Exact recovery derives the same pass.
      deps.campaignTickets.set(id, {
        ...previous,
        tickets: [
          ...previous.tickets,
          ...fresh.map((reference) => ticketRecord(deps, id, reference, now)),
        ],
        nonces: { ...previous.nonces, [nonce]: ticketsHash },
      });
      c.header('Cache-Control', 'no-store');
      return c.json(
        {
          campaignId: id,
          issuedAt: now,
          tickets: references.map((reference) => ({
            reference,
            pass: ticketPass(deps, id, reference),
          })),
        },
        201,
      );
    });
  });

  app.get('/sponsor/:id/tickets', async (c) => {
    if (!ID.test(c.req.param('id'))) throw fail('unauthorized');
    const id = c.req.param('id').toLowerCase() as Hex;
    const sponsor = await sponsorFromHeader(deps, c.req.header('authorization'), id);
    const [found, chain] = await Promise.all([
      campaignHistory(deps, id),
      deps.dataDrop.campaign(id),
    ]);
    if (
      found?.sponsor.toLowerCase() !== sponsor.toLowerCase() ||
      chain.sponsor.toLowerCase() !== sponsor.toLowerCase()
    )
      throw fail('unauthorized');
    archiveCampaign(deps, found);
    c.header('Cache-Control', 'no-store');
    return c.json({
      campaignId: id,
      tickets: (deps.campaignTickets.get(id)?.tickets ?? []).map((ticket) => ({
        reference: ticket.reference,
        issuedAt: ticket.issuedAt,
        status: ticket.binding ? 'reserved' : 'issued',
      })),
    });
  });
}
