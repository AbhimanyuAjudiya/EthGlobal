/**
 * Ledger payloads (Arkiv entities, INTERFACES §1.4). Every entity is
 * `{ payload: JSON.stringify(<schema>), annotations: <listed>, expiresIn: <listed> }`. Payloads are
 * world-readable (TB-5): nothing below is secret. Annotations are built only by `@ethglobal/octroi/store`.
 */
import { z } from 'zod';

import { MAX_BUNDLE_MB, PLAN_MB, STEP_MB } from '../ids.js';
import {
  caipNetworkSchema,
  digitsSchema,
  evmAddressSchema,
  hex32Schema,
  mbSchema,
  msSchema,
  safeTextSchema,
  sealedBoxSchema,
  tierSchema,
} from './common.js';

export const entitlementKindSchema = z.enum(['free', 'paid', 'gift', 'card']);
export const entitlementStatusSchema = z.enum(['pending-profile', 'ready', 'installed', 'active']);
export const usageSourceSchema = z.enum(['none', 'webhook', 'poll', 'simulated']);

export const entitlementSchema = z
  .object({
    v: z.literal(1),
    key: z.string().min(8).max(160), // keys.entitlement*
    kind: entitlementKindSchema,
    status: entitlementStatusSchema,
    tier: tierSchema,
    campaignId: hex32Schema.optional(),
    planId: z.string().max(64),
    mbTotal: mbSchema,
    mbUsed: mbSchema,
    usageAsOf: msSchema,
    usageSource: usageSourceSchema,
    /** sha256(iccid): the clear ICCID never reaches the ledger (T-37). */
    iccidHash: hex32Schema.optional(),
    /** ICCID sealed to the server's own key (crypto.sealToServer). */
    iccidEnc: sealedBoxSchema.optional(),
    /** BlobStore ref of the sealed LPA; never the LPA, never returned by /me. */
    sealedRef: z.string().max(200).optional(),
    payer: z.string().max(64).optional(),
    network: caipNetworkSchema.optional(),
    /**
     * sha256(utf8(key) ‖ sessionPubKey) of the session that obtained it (A-35, T-73 b): proves "holder of this
     * session" for the first agent-policy registration. Bound to the key, so it links nothing across entitlements.
     */
    holderHash: hex32Schema.optional(),
    createdAt: msSchema,
    expiresAt: msSchema,
  })
  .refine((e) => e.mbUsed <= e.mbTotal, {
    message: 'mbUsed must not exceed mbTotal',
    path: ['mbUsed'],
  });
export type Entitlement = z.infer<typeof entitlementSchema>;
// annotations: { type:'entitlement', key: 'hk:' + sha256(utf8(key)), kind, status, tier, campaignId?, iccidHash?, expiresAt }
// payload.key on the ledger is the same 'hk:' index, never the capability (A-34, RT-O-01).
// expiresIn: secondsUntil(expiresAt, now)

/** paused/budget/spent live on-chain, never here. */
export const campaignSchema = z.object({
  v: z.literal(1),
  id: hex32Schema,
  sponsor: evmAddressSchema,
  name: safeTextSchema(64),
  /** Up to one eSIM (1 GB); campaigns registered at the old 300 MB cap stay valid. */
  bundleMb: z.object({
    orb: mbSchema.max(MAX_BUNDLE_MB),
    document: mbSchema.max(MAX_BUNDLE_MB),
    device: z.literal(0),
  }),
  pricePerClaimUsd6: digitsSchema,
  maxClaims: z.int().positive(),
  claimsPerHour: z.int().positive(),
  validityDays: z.int().min(1).max(30),
  wholesaleUsd6PerGb: digitsSchema,
  /** 500000 unless the sponsor has evidence otherwise. */
  idResaleUsd6: digitsSchema,
  /** Reseller plan used for this campaign's bundles. */
  planId: z.string().max(64),
  /** Where DataDrop lives. */
  network: caipNetworkSchema,
  contract: evmAddressSchema,
  createdAt: msSchema,
  expiresAt: msSchema,
});
export type CampaignPayload = z.infer<typeof campaignSchema>;
// annotations: { type:'campaign', key: keys.campaign(id), sponsor, expiresAt } ; expiresIn: secondsUntil(expiresAt)

export const giftSchema = z.object({
  v: z.literal(1),
  giftId: hex32Schema,
  kind: z.enum(['gift', 'card']),
  state: z.enum(['open', 'claimed']),
  /** ENSIP-15 normalised. */
  name: z.string().max(255).optional(),
  namehash: hex32Schema.optional(),
  /** Resolved at purchase; claim re-resolves (T-43). */
  to: evmAddressSchema.nullable(),
  mb: mbSchema,
  validityDays: z.int().min(1).max(30),
  /** HMAC(secret, 'pin' ‖ pin): lookup key, brute-force-proof off-ledger. */
  pinKey: hex32Schema,
  /** Public: printed on the card and in the QR; = giftId.slice(2, 10). */
  serial: z.string().regex(/^[0-9a-f]{8}$/),
  fundedBy: z.enum(['payment', 'campaign']),
  campaignId: hex32Schema.optional(),
  paidTx: z.string().max(128).optional(),
  /** Who paid (EVM address or Hedera account); the only party who may reclaim. */
  payer: z.string().max(64).optional(),
  /** What was paid, for the reclaim amount. */
  usd6: digitsSchema.optional(),
  network: caipNetworkSchema.optional(),
  message: safeTextSchema(80).optional(),
  createdAt: msSchema,
  claimBy: msSchema,
  /** Entitlement key once claimed. */
  claimedKey: z.string().optional(),
});
export type Gift = z.infer<typeof giftSchema>;
// annotations: { type:'gift', key: keys.gift(giftId), kind, state, namehash?, pinKey, serial, campaignId?, expiresAt: claimBy }
// expiresIn: secondsUntil(claimBy) — the escrow dies by protocol at claimBy and the gift can no longer be claimed.
// Reclaim (D-7): after claimBy the sender may POST /gift/reclaim; eligibility is decided from the receipts
// (kind 'gift' present, no 'gift-claim', no 'gift-reclaim') AND the escrow entity being gone; a ledger error is 503.

export const nonceSchema = z.object({
  v: z.literal(1),
  nonce: hex32Schema,
  audience: z.string().max(32),
  path: z.string().max(64),
  exp: msSchema,
  /** exp − CHALLENGE_TTL_S × 1000 (A-37, RT-O-04). */
  issuedAt: msSchema.optional(),
  consumedAt: msSchema,
});
export type NoncePayload = z.infer<typeof nonceSchema>;
// annotations: { type:'nonce', key: keys.nonce(nonce), nonce } ; expiresIn: NONCE_TTL_S (≥ acceptance window + skew,
// A-37). Written on consume (T-45), create-if-absent (A-32).

/**
 * A claim lock or settlement marker (A-33): written create-if-absent so the ledger, not the process, is the
 * one-claim / one-serve guard. Its key is `claim:` + an opaque digest; it carries no identifier.
 */
export const claimSchema = z.object({
  v: z.literal(1),
  /** keys.claim(digest) */
  key: z.string().startsWith('claim:').max(80),
  /** 'once': a once-only API marker — a gift's LPA delivered, an audit key shown (A-42, RT-A-04/06). */
  scope: z.enum(['free-live', 'free-campaign', 'settlement', 'once']),
  expiresAt: msSchema,
});
export type ClaimLock = z.infer<typeof claimSchema>;
// annotations: { type:'claim', key: keys.claim(digest), expiresAt } ; expiresIn: secondsUntil(expiresAt)

export const receiptKindSchema = z.enum([
  'claim',
  'provision',
  'topup',
  'agent-topup',
  'gift',
  'gift-claim',
  'gift-reclaim',
  'card-redeem',
  /**
   * POST /plan/cancel, one per entitlement (logical key `rcpt:ledger:plan-cancel:<entitlementKeyHash>`), written
   * before the vendor cancel: no tx = pending (the vendor or the treasury did not answer; the operator reconciles,
   * nothing is paid twice) · tx = refunded · usd6 '0' = aborted (the vendor refused; nothing refunded, terminal).
   */
  'plan-cancel',
]);
export const hcsRefSchema = z.object({ topic: z.string(), sequence: z.int().nonnegative() });
export const receiptSchema = z.object({
  v: z.literal(1),
  /** keys.receipt(network, tx) or `rcpt:ledger:<uuid>` for free claims. */
  key: z.string(),
  kind: receiptKindSchema,
  /** sha256(entitlementKey) — never the key itself on receipts (T-44). */
  entitlementKeyHash: hex32Schema,
  campaignId: hex32Schema.optional(),
  mb: mbSchema.optional(),
  usd6: digitsSchema.optional(),
  network: caipNetworkSchema.optional(),
  tx: z.string().max(128).optional(),
  payer: z.string().max(64).optional(),
  uaid: z.string().max(200).optional(),
  hcs: hcsRefSchema.optional(),
  at: msSchema,
});
export type Receipt = z.infer<typeof receiptSchema>;
// annotations: { type:'receipt', key, receiptKind: kind, entitlementKeyHash, campaignId?, day: dayBucket(at) }
// expiresIn: RECEIPT_TTL_S

export const topUpPolicySchema = z.object({
  maxUsd6PerDay: digitsSchema,
  thresholdMb: mbSchema,
  /**
   * The API sells PLAN_MB steps only; 100–900 still parse so stored legacy policies load (the agent skips their
   * buys, `step-not-sold`).
   */
  stepMb: z.int().multipleOf(STEP_MB).min(STEP_MB).max(PLAN_MB),
  paused: z.boolean(),
  topUpOnExpiry: z.boolean(),
  /** Buy when expiresAt − now ≤ lead; an expired entity cannot be extended. */
  expiryLeadS: z.int().min(60).max(86_400),
});
export type TopUpPolicyWire = z.infer<typeof topUpPolicySchema>;
export const agentPolicySchema = z.object({
  v: z.literal(1),
  entitlementKey: z.string(),
  owner: evmAddressSchema,
  policy: topUpPolicySchema,
  updatedAt: msSchema,
  /** T-30: expiry fires once per expiresAt value. */
  lastExpiryBought: msSchema.optional(),
});
export type AgentPolicyWire = z.infer<typeof agentPolicySchema>;
// annotations: { type:'agentpolicy', key: keys.agentPolicy(entitlementKey), owner } ; expiresIn: AGENT_POLICY_TTL_S
