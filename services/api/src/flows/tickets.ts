/** Private organizer-issued ticket passes. A public campaign URL is never an admission credential. */
import { hmacKey } from '@ethglobal/crypto';
import type { Campaign, Entitlement } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';

import { fail } from '../errors.js';

import type { Deps } from '../deps.js';

export interface CampaignTicket {
  reference: string;
  passHash: Hex;
  issuedAt: number;
  binding?: { claimKey: Hex; sessionPubKey: Hex; recoveryKeyHash: Hex; boundAt: number };
}

/** One atomic durable row per campaign: a failed batch write cannot issue a partial second batch. */
export interface TicketBook {
  campaignId: Hex;
  tickets: CampaignTicket[];
  nonces: Record<string, Hex>;
}

/** The private ticket registry outlives public campaign TTL, so post-event capability flags remain correct. */
export const isEventPlan = (deps: Deps, entitlement: Entitlement): boolean =>
  entitlement.campaignId !== undefined &&
  deps.campaignTickets.has(entitlement.campaignId.toLowerCase());

export const ticketPass = (
  deps: Pick<Deps, 'secret'>,
  campaignId: string,
  reference: string,
): Hex =>
  hmacKey(deps.secret, 'campaign-ticket-pass-v1', `${campaignId.toLowerCase()}:${reference}`);

const passHash = (deps: Pick<Deps, 'secret'>, pass: string): Hex =>
  hmacKey(deps.secret, 'campaign-ticket-index-v1', pass.toLowerCase());

export const ticketRecord = (
  deps: Pick<Deps, 'secret'>,
  campaignId: Hex,
  reference: string,
  now: number,
): CampaignTicket => ({
  reference,
  passHash: passHash(deps, ticketPass(deps, campaignId, reference)),
  issuedAt: now,
});

/** Validate before spending a World proof; bind only after the verifier supplies its actual claim key. */
export function ticketAdmission(
  deps: Deps,
  campaign: Campaign,
  input: { ticketPass?: string; eventNoticeVersion?: 1; sessionPubKey: Hex; recoveryKeyHash?: Hex },
): (claimKey: Hex) => Promise<boolean> {
  if (!campaign.event?.ticketRequired) throw fail('ticket_required');
  if (campaign.event.reclaimUnused && input.eventNoticeVersion !== campaign.event.noticeVersion)
    throw fail('invalid_request', { detail: 'accept the disclosed event cancellation terms' });
  if (!input.ticketPass || !/^0x[0-9a-f]{64}$/i.test(input.ticketPass) || !input.recoveryKeyHash)
    throw fail('ticket_required');
  const id = campaign.id.toLowerCase() as Hex;
  const hash = passHash(deps, input.ticketPass);
  const find = () =>
    deps.campaignTickets.get(id)?.tickets.find((ticket) => ticket.passHash === hash);
  const initial = find();
  if (!initial) throw fail('ticket_invalid');
  const matchesHolder = (ticket: CampaignTicket) =>
    !ticket.binding ||
    (ticket.binding.sessionPubKey === input.sessionPubKey &&
      ticket.binding.recoveryKeyHash === input.recoveryKeyHash);
  if (!matchesHolder(initial)) throw fail('ticket_used');
  return (claimKey) =>
    deps.mutex.run(`tickets:${id}`, async () => {
      const book = deps.campaignTickets.get(id);
      const ticket = find();
      if (!book || !ticket || !matchesHolder(ticket)) throw fail('ticket_used');
      if (ticket.binding) {
        if (ticket.binding.claimKey !== claimKey) throw fail('ticket_used');
        return true;
      }
      // Also prevent a human consuming multiple issued tickets for this one campaign.
      if (book.tickets.some((row) => row.binding?.claimKey === claimKey)) throw fail('ticket_used');
      const binding = {
        claimKey,
        sessionPubKey: input.sessionPubKey,
        recoveryKeyHash: input.recoveryKeyHash!,
        boundAt: deps.now(),
      };
      deps.campaignTickets.set(id, {
        ...book,
        tickets: book.tickets.map((row) => (row.passHash === hash ? { ...row, binding } : row)),
      });
      return true;
    });
}
