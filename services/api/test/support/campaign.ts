/** The one test campaign shape (descriptive fields as POST /sponsor takes them, and as the ledger stores them). */

import { campaignFromPayload, type Campaign } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import type { CampaignEvent, SponsorRegister } from '@ethglobal/protocol/schemas';

import type { Address } from 'viem';

type Fields = SponsorRegister['campaign'];

/** POST /sponsor's `campaign`: 300/160 MB bundles, $0.50 a claim, Anvil, plan in-300mb-7d; override what differs. */
export const campaignFields = (
  o: { id: Hex; sponsor: Address; contract: Address; expiresAt: number } & Partial<Fields>,
): Fields => ({
  name: 'Mumbai Welcome',
  bundleMb: { orb: 300, document: 160, device: 0 },
  pricePerClaimUsd6: '500000',
  maxClaims: 2000,
  claimsPerHour: 120,
  validityDays: 7,
  wholesaleUsd6PerGb: '1140000',
  idResaleUsd6: '500000',
  planId: 'in-300mb-7d',
  network: 'eip155:31337',
  ...o,
});

/** A ticket-gated event (`event.ticketRequired`): two days from `startsAt` (inside the 7-day plan), no reclaim. */
export const eventFields = (startsAt: number, o: Partial<CampaignEvent> = {}): CampaignEvent => ({
  destinationCountry: 'IN',
  startsAt,
  endsAt: startsAt + 2 * 86_400_000,
  reclaimAfter: startsAt + 2 * 86_400_000,
  ticketRequired: true,
  reclaimUnused: false,
  refundBasis: 'claim-price',
  noticeVersion: 1,
  ...o,
});

/** The ledger form (CampaignStore.put). */
export const storedCampaign = ({
  createdAt,
  ...o
}: Parameters<typeof campaignFields>[0] & { createdAt: number }): Campaign =>
  campaignFromPayload({ v: 1, ...campaignFields(o), createdAt });
