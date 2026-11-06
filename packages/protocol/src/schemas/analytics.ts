/**
 * GET /sponsor/:id/analytics: the campaign's World ID claims, their plans and the chain counters, aggregated. Nothing
 * here identifies a claimer: no plan key, no ledger index, no entitlement hash, no claim key, no payer. Arkiv entity
 * keys and claim transactions are public proofs, as on GET /sponsor/:id.
 */
import { z } from 'zod';

import { caipNetworkSchema, digitsSchema, hex32Schema, msSchema } from './common.js';

const count = z.int().nonnegative();
/** A share of `funnel.claimed`, 0..1. */
const rate = z.number().min(0).max(1);
/** An expired plan whose bundle size both tiers share has no recoverable tier: `unknown`. */
export const analyticsTierSchema = z.enum(['orb', 'document', 'unknown']);

export const notInstalledRowSchema = z.object({
  claimedAt: msSchema,
  tier: analyticsTierSchema,
  /** The stored status (the reseller's ESIM_STATUS webhook and /me reads keep it fresh); no vendor call per row. */
  status: z.enum(['pending-profile', 'ready']),
  /** When the reseller last reported on this eSIM; absent while it never has. */
  statusAsOf: msSchema.optional(),
  ageHours: count,
  /** The plan's expiry: the bundle lapses unused then. */
  expiresAt: msSchema,
  claimTx: z.string().max(128).optional(),
  /** The plan's Arkiv entity. */
  arkivKey: z.string(),
});

export const sponsorAnalyticsSchema = z.object({
  campaignId: hex32Schema,
  network: caipNetworkSchema,
  /** When this answer was built (money and windows are computed at this instant). */
  asOf: msSchema,
  /** When the ledger was read: cached per campaign, at most 30 s before `asOf`. */
  scannedAt: msSchema,
  /** A ledger read hit `scanCap` rows: the counts cover only the rows read (lower bounds). */
  sampled: z.boolean(),
  scanCap: count,
  totals: z.object({
    claims: count,
    /** One claim per human per campaign (World ID), so this equals `claims`. */
    uniqueHumans: count,
    byTier: z.object({ orb: count, document: count, unknown: count }),
    /** Σ mbTotal: a live plan's own total; an expired one's bundle plus its paid top-ups. */
    mbDelivered: count,
    /** Σ mbUsed of the live plans (an expired plan's usage left the ledger with it). */
    mbUsed: count,
    /** mbUsed / live plans, rounded. */
    avgMbUsed: count,
  }),
  money: z.object({
    budgetUsd6: digitsSchema,
    spentUsd6: digitsSchema,
    remainingUsd6: digitsSchema,
    pricePerClaimUsd6: digitsSchema,
    /** floor(remaining / price). */
    remainingClaims: count,
    /** Claims per hour over the last 24 h. */
    burnPerHour: z.number().nonnegative(),
    /** When the budget runs out at `burnPerHour`; null with no claim in 24 h. May fall after `endsAt`. */
    runOutAt: msSchema.nullable(),
    endsAt: msSchema,
    daysLeft: z.number().nonnegative(),
  }),
  /** 14 IST days, oldest first, zero-filled; `start` is the IST midnight. */
  daily: z.array(
    z.object({ day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), start: msSchema, claims: count }),
  ),
  /** 48 on-chain hour buckets (UTC hours), oldest first, zero-filled; `at` is the hour's start. */
  hourly: z.array(z.object({ at: msSchema, claims: count })),
  hourlyCap: count,
  /** Stages and their share of `claimed`. installed ⊇ active; notInstalled = pending + ready (live plans). */
  funnel: z.object({
    claimed: count,
    installed: count,
    active: count,
    toppedUp: count,
    notInstalled: count,
    installedRate: rate,
    activeRate: rate,
    toppedUpRate: rate,
    notInstalledRate: rate,
    /** Paid top-ups (human or agent) bought for these plans, and what they paid. */
    topUps: count,
    topUpRevenueUsd6: digitsSchema,
  }),
  status: z.object({
    pending: count,
    ready: count,
    installed: count,
    active: count,
    expired: count,
  }),
  notInstalled: z.object({
    count,
    /** What the sponsor paid for them: count × price per claim. */
    usd6: digitsSchema,
    /** Oldest first, at most 100 (the oldest lapse first). */
    rows: z.array(notInstalledRowSchema),
  }),
  proof: z.object({
    /** spent / price on DataDrop (campaign-funded cards included). */
    onChainClaims: count,
    claimTxs: count,
    arkivReceipts: count,
    arkivPlans: count,
    hcsMessages: count,
  }),
  /** Newest first, at most 20; `arkivKey` is the claim receipt's entity. */
  latest: z.array(
    z.object({
      at: msSchema,
      tier: analyticsTierSchema,
      tx: z.string().max(128).optional(),
      arkivKey: z.string(),
    }),
  ),
});

export type AnalyticsTier = z.infer<typeof analyticsTierSchema>;
export type NotInstalledRow = z.infer<typeof notInstalledRowSchema>;
export type SponsorAnalytics = z.infer<typeof sponsorAnalyticsSchema>;
