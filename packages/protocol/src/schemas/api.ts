/** Request and response bodies of `services/api` (INTERFACES §1.6, §7). */
import { z } from 'zod';

import { AUDIENCE, CHALLENGE_PATHS } from '../ids.js';
import {
  caipNetworkSchema,
  digitsSchema,
  evmAddressSchema,
  hex32Schema,
  hexSchema,
  mbSchema,
  msSchema,
  safeTextSchema,
  sealedBoxSchema,
  tierSchema,
  type VerificationLevel,
} from './common.js';
import {
  campaignSchema,
  entitlementKindSchema,
  entitlementStatusSchema,
  hcsRefSchema,
  receiptSchema,
  topUpPolicySchema,
  usageSourceSchema,
} from './entities.js';
import { acceptTemplateSchema, paymentResponseSchema } from './x402.js';

// ── Personhood: the IDKit 4.6.0 result, forwarded unchanged to POST /api/v4/verify/{rp_id} (API-FACTS §4.3–4.4)

/**
 * A proof element. API-FACTS §4.3 shows 0x-hex; the pinned `@worldcoin/idkit-core@4.6.0` d.ts documents
 * decimal strings for V4 `proof[]` — both are accepted (Decisions D-9).
 */
const proofElementSchema = z.string().regex(/^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/, 'field element');

/** `ResponseItemV4`: 'proof_of_human' | 'passport' | 'mnc' | 'selfie'; `nullifier` is a decimal string. */
const idkitResponseV4Schema = z
  .object({
    identifier: z.string().max(32),
    issuer_schema_id: z.int().optional(),
    nullifier: z.string().regex(/^\d{1,78}$/),
    expires_at_min: z.int().optional(),
    proof: z.array(proofElementSchema).length(5),
    signal_hash: hexSchema,
    sybil_score: z.number().optional(),
  })
  .loose();
/** `ResponseItemV3` (legacy): 'orb' | 'secure_document' | 'document' | 'device' | 'selfie' [partly unverified]. */
const idkitResponseV3Schema = z
  .object({
    identifier: z.string().max(32),
    merkle_root: hexSchema,
    nullifier: z.string().max(80),
    proof: z.union([hexSchema, z.array(hexSchema).max(8)]),
    signal_hash: hexSchema,
    max_age: z.int().optional(),
  })
  .loose();

/**
 * IDKit 4.6 result (A-25), forwarded to the verifier UNCHANGED (`.loose()` keeps fields we do not model). Uniqueness
 * proofs only: session results (`session_id`) are rejected. V4 `nullifier` is a decimal string; V3 legacy
 * (`allow_legacy_proofs`) carries hex. The tier is never read from here — only from the verifier's response (T-22).
 */
export const personhoodProofSchema = z
  .discriminatedUnion('protocol_version', [
    z
      .object({
        protocol_version: z.literal('4.0'),
        nonce: z.string().max(80),
        action: z.string().max(64),
        environment: z.string().max(16).optional(),
        responses: z.array(idkitResponseV4Schema).min(1).max(4),
      })
      .loose(),
    z
      .object({
        protocol_version: z.literal('3.0'),
        nonce: z.string().max(80),
        action: z.string().max(64),
        responses: z.array(idkitResponseV3Schema).min(1).max(4),
      })
      .loose(),
  ])
  .superRefine((proof, ctx) => {
    if ('session_id' in proof) {
      ctx.addIssue({
        code: 'custom',
        path: ['session_id'],
        message: 'session proofs are not accepted',
      });
    }
  });
export type PersonhoodProof = z.infer<typeof personhoodProofSchema>;

/**
 * The ONE identifier → level mapping (A-26); live verifier, mock and tests all use it. Unknown identifiers map to
 * undefined (no tier). `passport`/`mnc` are NFC documents (secure_document); `selfie`/`face` are liveness only (device).
 */
export const IDENTIFIER_LEVEL: Readonly<Record<string, VerificationLevel>> = Object.freeze({
  proof_of_human: 'orb',
  orb: 'orb',
  passport: 'secure_document',
  mnc: 'secure_document',
  secure_document: 'secure_document',
  document: 'document',
  device: 'device',
  selfie: 'device',
  face: 'device',
});
export const verificationLevelFromIdentifier = (
  identifier: string,
): VerificationLevel | undefined =>
  Object.hasOwn(IDENTIFIER_LEVEL, identifier) ? IDENTIFIER_LEVEL[identifier] : undefined;

/** Backend-signed RP context IDKit 4 requires (A-25); snake_case so the PWA passes it to IDKit.request() as is. */
export const rpContextRequestSchema = z.object({
  audience: z.literal(AUDIENCE),
  path: z.enum(CHALLENGE_PATHS),
});
export const rpContextSchema = z.object({
  rp_id: z.string().regex(/^(rp|app)_[A-Za-z0-9]{1,64}$/),
  nonce: hexSchema,
  /** unix seconds */
  created_at: z.int().positive(),
  /** unix seconds */
  expires_at: z.int().positive(),
  signature: hexSchema,
  app_id: z.string().max(80),
  action: z.string().max(64),
  environment: z.enum(['production', 'staging']),
});
export type RpContext = z.infer<typeof rpContextSchema>;

// ── Challenges and claims

const challengePathSchema = z.enum(CHALLENGE_PATHS);
export const challengeRequestSchema = z.object({
  audience: z.literal(AUDIENCE),
  path: challengePathSchema,
  sessionPubKey: hex32Schema,
});
export const challengeSchema = z.object({
  nonce: hex32Schema,
  audience: z.literal(AUDIENCE),
  path: challengePathSchema,
  exp: msSchema,
  signal: hex32Schema,
});
export type ChallengeWire = z.infer<typeof challengeSchema>;

export const claimRequestSchema = z.object({
  proof: personhoodProofSchema,
  campaignId: hex32Schema,
  challenge: challengeSchema,
  sessionPubKey: hex32Schema,
});
export const receiptRefSchema = z.object({
  /** Ledger entity key of the entitlement (shown as "Plan written to Arkiv · …"). */
  arkivKey: z.string(),
  hcs: hcsRefSchema.optional(),
});
/** Returned by /claim, /esim/provision, /gift/claim, /card/redeem. sealedLpa appears exactly once (T-31). */
export const entitledResponseSchema = z.object({
  entitlementKey: z.string(),
  kind: entitlementKindSchema,
  status: entitlementStatusSchema,
  tier: tierSchema,
  mbTotal: mbSchema,
  expiresAt: msSchema,
  validityDays: z.int(),
  /** Absent when status = 'pending-profile'. */
  sealedLpa: sealedBoxSchema.optional(),
  /** DataDrop.claim tx (free lane / card). */
  claimTx: z.string().optional(),
  settlement: paymentResponseSchema.optional(),
  receipt: receiptRefSchema,
});
export const topUpResponseSchema = z.object({
  entitlementKey: z.string(),
  mbTotal: mbSchema,
  mbUsed: mbSchema,
  expiresAt: msSchema,
  settlement: paymentResponseSchema,
  receipt: receiptRefSchema,
});
/** `mb` must be PLAN_MB on both routes (a legacy plan tops up in PLAN_MB steps); the route refuses others before any 402. */
export const provisionQuerySchema = z.object({
  mb: z.coerce.number().int(),
  planId: z.string().max(64).optional(),
});
export const topUpQuerySchema = z.object({
  key: z.string().min(8).max(160),
  mb: z.coerce.number().int(),
});

// ── Gifts and cards

const pinSchema = z.string().regex(/^\d{16}$/);
export const giftRequestSchema = z.object({
  name: z.string().min(3).max(255),
  /** A paid gift is exactly PLAN_MB (the route refuses any other size before the 402); local seed cards may differ. */
  mb: z.int().multipleOf(100).min(100).max(3000),
  message: safeTextSchema(80).optional(),
});
export const giftResponseSchema = z.object({
  giftId: hex32Schema,
  serial: z.string(),
  pin: pinSchema,
  name: z.string(),
  to: evmAddressSchema,
  mb: mbSchema,
  claimBy: msSchema,
  settlement: paymentResponseSchema,
  receipt: receiptRefSchema,
});
export const giftClaimRequestSchema = z.union([
  z.object({
    giftId: hex32Schema,
    signature: hexSchema,
    recipient: evmAddressSchema,
    challenge: challengeSchema,
    sessionPubKey: hex32Schema,
  }),
  z.object({ pin: pinSchema, challenge: challengeSchema, sessionPubKey: hex32Schema }),
]);
export const giftReclaimRequestSchema = z.object({
  giftId: hex32Schema,
  payer: evmAddressSchema,
  signature: hexSchema,
  challenge: challengeSchema,
});
export const giftReclaimResponseSchema = z.object({
  giftId: hex32Schema,
  refundedUsd6: digitsSchema,
  feeUsd6: digitsSchema,
  network: caipNetworkSchema,
  tx: z.string(),
  receipt: receiptRefSchema,
});
export const cardPreviewSchema = z.object({
  serial: z.string(),
  mb: mbSchema,
  sponsorName: z.string().optional(),
  state: z.enum(['open', 'claimed', 'expired']),
  claimBy: msSchema,
});
export const cardRedeemRequestSchema = z.object({
  pin: pinSchema,
  challenge: challengeSchema,
  sessionPubKey: hex32Schema,
});

// ── Plan cancel (POST /plan/cancel): the payer of an unused paid plan gets its payment back, minus the reclaim fee

export const planCancelRequestSchema = z.object({
  entitlementKey: z.string().min(8).max(160),
  payer: evmAddressSchema,
  /** A /plan/cancel challenge whose session key is the payer address padded to 32 bytes. */
  challenge: challengeSchema,
  issuedAt: msSchema,
  /** EIP-712 CancelPlan { entitlementKey, payer, nonce: challenge.nonce, issuedAt } by the payer. */
  signature: hexSchema,
});
/** The cancel refund; no `tx` = pending (the treasury did not answer; the operator completes it, never twice). */
export const planRefundSchema = z.object({
  network: caipNetworkSchema,
  usd6: digitsSchema,
  tx: z.string().optional(),
});
/** 200 = refunded; 202 = cancelled at the vendor, refund pending. */
export const planCancelResponseSchema = z.object({
  cancelledAt: msSchema,
  refund: planRefundSchema,
  receipt: receiptRefSchema,
});
export type PlanCancelRequest = z.infer<typeof planCancelRequestSchema>;
export type PlanCancelResponse = z.infer<typeof planCancelResponseSchema>;
export type PlanRefund = z.infer<typeof planRefundSchema>;

// ── Reads

export const meResponseSchema = z.object({
  entitlementKey: z.string(),
  kind: entitlementKindSchema,
  status: entitlementStatusSchema,
  tier: tierSchema,
  campaignId: hex32Schema.optional(),
  sponsorName: z.string().optional(),
  mbTotal: mbSchema,
  mbUsed: mbSchema,
  remainingMb: mbSchema,
  usageAsOf: msSchema,
  usageSource: usageSourceSchema,
  expiresAt: msSchema,
  arkivKey: z.string(),
  ledgerReadAt: msSchema,
  cached: z.boolean(),
  degraded: z.boolean(),
  network: caipNetworkSchema.optional(),
  // POST /plan/cancel: what it would refund now, and to whom (paid, unused, never topped up or cancelled) …
  refundable: z
    .object({ usd6: digitsSchema, network: caipNetworkSchema, to: evmAddressSchema })
    .optional(),
  // … or, once cancelled, when (= expiresAt) and the refund
  cancelledAt: msSchema.optional(),
  refund: planRefundSchema.optional(),
});
export const receiptPublicSchema = receiptSchema.omit({ entitlementKeyHash: true, key: true });
export const receiptsResponseSchema = z.object({ receipts: z.array(receiptPublicSchema) });

const bundleMbSchema = z.object({ orb: mbSchema, document: mbSchema, device: z.literal(0) });
export const plansResponseSchema = z.object({
  mode: z.enum(['local', 'live']),
  campaign: z
    .object({
      id: hex32Schema,
      name: z.string(),
      sponsor: evmAddressSchema,
      bundleMb: bundleMbSchema,
      remainingClaims: z.int().nonnegative(),
      maxClaims: z.int(),
      paused: z.boolean(),
      expiresAt: msSchema,
      network: caipNetworkSchema,
    })
    .nullable(),
  paid: z.object({
    /** The pricing step: a size costs ceil(mb / stepMb) × priceUsd6PerStep. */
    stepMb: z.literal(100),
    priceUsd6PerStep: digitsSchema,
    validityDays: z.int(),
    accepts: z.array(acceptTemplateSchema),
    /** The only sizes GET /esim/provision and GET /esim/topup sell ([PLAN_MB]); absent from an older API. */
    sizesMb: z.array(mbSchema).optional(),
  }),
  /** sizesMb: the only sizes a paid POST /gift sells. */
  gift: z.object({ sizesMb: z.array(mbSchema), claimWindowS: z.int() }),
  simulated: z.object({ usage: z.boolean(), personhood: z.boolean() }),
});

// ── Sponsors and the agent

const signedAuth = { issuedAt: msSchema, signature: hexSchema };
export const sponsorRegisterSchema = z.object({
  campaign: campaignSchema.omit({ v: true, createdAt: true }),
  auth: z.object(signedAuth),
});
/** POST /sponsor/:id/cards (A-43): campaign-funded scratch cards, signed `SponsorCards` by the on-chain sponsor. */
export const sponsorCardsRequestSchema = z.object({
  count: z.int().min(1).max(200),
  mb: z.int().multipleOf(100).min(100).max(3000),
  auth: z.object({ sponsor: evmAddressSchema, nonce: hex32Schema, ...signedAuth }),
});
/** 201: the PINs appear once, here; the ledger keeps only serials and PIN HMACs. */
export const sponsorCardsResponseSchema = z.object({
  campaignId: hex32Schema,
  mb: mbSchema,
  claimBy: msSchema,
  cards: z.array(z.object({ serial: z.string(), pin: pinSchema, mb: mbSchema })),
});
export const sponsorViewSchema = z.object({
  campaign: campaignSchema,
  chain: z.object({
    budgetUsd6: digitsSchema,
    spentUsd6: digitsSchema,
    paused: z.boolean(),
    claims: z.int(),
    claimsThisHour: z.int(),
    hourBucket: z.int(),
  }),
  claims: z.array(
    z.object({
      at: msSchema,
      campaignClaimKey: hex32Schema,
      tier: tierSchema,
      mb: mbSchema,
      usd6: digitsSchema,
      tx: z.string().optional(),
      status: z.string(),
    }),
  ),
  expiring: z.array(
    z.object({
      arkivKey: z.string(),
      remainingMb: mbSchema,
      expiresAt: msSchema,
      tier: tierSchema,
    }),
  ),
  /** Shown once, on the first authenticated read after registration. */
  auditKey: hex32Schema.optional(),
});
export const agentPolicyPutSchema = z.object({
  entitlementKey: z.string(),
  owner: evmAddressSchema,
  policy: topUpPolicySchema,
  /**
   * The X-Session-Pubkey of the session that obtained the entitlement (A-35, T-73 b): required for the FIRST
   * registration of a free / gift / card entitlement that carries a holderHash; ignored otherwise.
   */
  sessionPubKey: hex32Schema.optional(),
  ...signedAuth,
});
/** The policy's World ID Agent Pass (docs/WORLD_AGENT_PASS.md), as GET /agent/policy/:key reports it. */
export const agentPassViewSchema = z.object({
  state: z.enum(['none', 'pending', 'armed', 'denied', 'expired']),
  /** armed: ms until which the agent may buy under the policy. */
  passUntil: msSchema.optional(),
  /** pending: what the human opens (the device code never leaves the API). */
  userCode: z.string().max(64).optional(),
  verificationUri: z.string().max(2048).optional(),
  verificationUriComplete: z.string().max(2048).optional(),
  expiresAt: msSchema.optional(),
  /** denied | expired: the OAuth error or `invalid_pass`. */
  reason: z.string().max(64).optional(),
  /** MODE=local simulator (never in live). */
  simulated: z.boolean().optional(),
});
export const agentPassStartSchema = z.object({
  verification_uri: z.string().max(2048),
  verification_uri_complete: z.string().max(2048).optional(),
  user_code: z.string().max(64),
  expires_in: z.int().positive(),
  interval: z.int().positive(),
});
export const agentPassPollSchema = z.object({
  state: z.enum(['pending', 'approved', 'denied', 'expired']),
  reason: z.string().max(64).optional(),
  /** pending: seconds before the next poll (slow_down adds five). */
  retryInS: z.int().positive().optional(),
  passUntil: msSchema.optional(),
});
export const agentPolicyViewSchema = z.object({
  policy: topUpPolicySchema,
  owner: evmAddressSchema,
  spentTodayUsd6: digitsSchema,
  updatedAt: msSchema,
  lastTickAt: msSchema.optional(),
  /** Present when the API has WORLD_AGENT_PASS_CLIENT_ID (the feature is off otherwise). */
  pass: agentPassViewSchema.optional(),
});

export const errorBodySchema = z.object({
  error: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export const healthSchema = z.object({
  ok: z.boolean(),
  mode: z.enum(['local', 'live']),
  chainId: z.number().optional(),
  error: z.string().optional(),
});

// ── Inferred types
export type RpContextRequest = z.infer<typeof rpContextRequestSchema>;
export type ChallengeRequest = z.infer<typeof challengeRequestSchema>;
export type ClaimRequest = z.infer<typeof claimRequestSchema>;
export type ReceiptRef = z.infer<typeof receiptRefSchema>;
export type EntitledResponse = z.infer<typeof entitledResponseSchema>;
export type TopUpResponse = z.infer<typeof topUpResponseSchema>;
export type ProvisionQuery = z.infer<typeof provisionQuerySchema>;
export type TopUpQuery = z.infer<typeof topUpQuerySchema>;
export type GiftRequest = z.infer<typeof giftRequestSchema>;
export type GiftResponse = z.infer<typeof giftResponseSchema>;
export type GiftClaimRequest = z.infer<typeof giftClaimRequestSchema>;
export type GiftReclaimRequest = z.infer<typeof giftReclaimRequestSchema>;
export type GiftReclaimResponse = z.infer<typeof giftReclaimResponseSchema>;
export type CardPreview = z.infer<typeof cardPreviewSchema>;
export type CardRedeemRequest = z.infer<typeof cardRedeemRequestSchema>;
export type MeResponse = z.infer<typeof meResponseSchema>;
export type ReceiptPublic = z.infer<typeof receiptPublicSchema>;
export type ReceiptsResponse = z.infer<typeof receiptsResponseSchema>;
export type PlansResponse = z.infer<typeof plansResponseSchema>;
export type SponsorRegister = z.infer<typeof sponsorRegisterSchema>;
export type SponsorCardsRequest = z.infer<typeof sponsorCardsRequestSchema>;
export type SponsorCardsResponse = z.infer<typeof sponsorCardsResponseSchema>;
export type SponsorView = z.infer<typeof sponsorViewSchema>;
export type AgentPolicyPut = z.infer<typeof agentPolicyPutSchema>;
export type AgentPolicyView = z.infer<typeof agentPolicyViewSchema>;
export type AgentPassView = z.infer<typeof agentPassViewSchema>;
export type AgentPassStart = z.infer<typeof agentPassStartSchema>;
export type AgentPassPoll = z.infer<typeof agentPassPollSchema>;
export type ErrorBody = z.infer<typeof errorBodySchema>;
export type Health = z.infer<typeof healthSchema>;
