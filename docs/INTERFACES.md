# INTERFACES — the single source of truth for every cross-workstream type

**Status:** binding for every builder agent and every human commit in `v0` and in-window. **Owner:** architect; changes land here first, then in `packages/protocol`, then anywhere else. **Companions:** `docs/ARCHITECTURE.md` (why), `docs/build-briefs/*.md` (who builds what; they copy from this file verbatim and must not restate it differently), `docs/THREAT-MODEL.md` (the properties the red team tests; T-numbers below refer to its §5), `research/committee/DECISION.md` §6.2–6.5 (the committee's module list; §13 of this file records every amendment to it).

If a brief and this file disagree, **this file wins** and the brief is fixed. If code and this file disagree, the code is wrong until this file is changed by the architect.

---

## 0. How to read this file

- Code blocks are the public surface of each package, in the language it ships in. Everything else in a package is private.
- `[verify Wed]` marks an external API shape reconstructed from documentation the sandbox cannot reach; the live adapter codes against it, the fixture recorded at the Wednesday pre-deploy corrects it, and the fixture becomes the truth.
- Package names are the real workspace names: `@ethglobal/protocol` (new), `@ethglobal/crypto` (new), `@ethglobal/eip3009` (new), `@ethglobal/octroi` (new), `@ethglobal/adapters` (exists), `@ethglobal/ui` (exists), `@ethglobal/contracts` (exists), `@ethglobal/api` (exists), `@ethglobal/agent` (new), `@ethglobal/web` (exists).

### 0.1 Conventions that are not negotiable

| Concern | Rule | Owner |
|---|---|---|
| Money | `bigint` micro-USD (`Usd6`; `$0.40 = 400_000n`). On the wire: decimal **string** of base units (`"400000"`). Never a float, never `1e18`, never HBAR priced in app code. | `@ethglobal/protocol/units` |
| Data | integer **MB**, decimal (1 MB = 10⁶ bytes, **1 GB = 1000 MB**). Reseller bytes → `Math.floor(bytes / 1e6)`. | `@ethglobal/protocol/units` |
| Time | `number` **ms since epoch** for every timestamp in TypeScript (`expiresAt`, `usageAsOf`, `createdAt`, `claimBy`, `exp`); **seconds** for `Ledger.expiresIn`, EIP-3009 `validAfter`/`validBefore`, and on-chain. Every module takes `now: () => number` (ms) — never `Date.now()` inside logic. | each module |
| Identifiers | `Hex` = `0x`-prefixed lower-case; `bytes32` as 66-char hex; EVM addresses are compared lower-cased and rendered checksummed; Hedera accounts `0.0.<n>`; networks are CAIP-2 strings. | `@ethglobal/protocol/ids` |
| Validation | zod 4 schemas in `@ethglobal/protocol/schemas` are the **only** definition of every wire and ledger shape; types are `z.infer<>` of them. Nobody hand-writes a duplicate interface. | `@ethglobal/protocol` |
| HTTP | one client (`httpJson`) with timeout, JSON, zod-validated responses, injectable `fetch`; raw `fetch` is allowed only inside it and inside the fixture transport. | `@ethglobal/protocol/http` |
| x402 | one codec for the three headers and one `fetchWithPayment` loop; signing is injected. | `@ethglobal/protocol/x402` |
| Hashing / AEAD / HMAC | `@noble/*` only, synchronous, in one package. | `@ethglobal/crypto` |
| EIP-712 / EIP-3009 | one typed-data builder, one digest, one recover, one calldata encoder. | `@ethglobal/eip3009` |
| Ledger access | nobody calls `ledger.put/query` with hand-built annotations except the stores in `@ethglobal/octroi/store`. | `@ethglobal/octroi` |
| Errors | one code table; adapters throw `AdapterError(adapter, code)`; the API maps once. | `@ethglobal/protocol/errors` → `services/api/src/errors.ts` |
| Test helpers | fake clock, Anvil roles, fixture loader/transport, payload builders, contract suites. | `@ethglobal/adapters/testing` |

---

## 1. `@ethglobal/protocol` — `packages/protocol`

Leaf package. Dependencies: `zod` only. Browser-safe. Build: `tsc -p tsconfig.build.json` → `dist/` (same layout as `@ethglobal/adapters`). Subpath exports: `.`, `./schemas`, `./x402`, `./units`, `./ids`, `./errors`, `./events`, `./http`, `./typed-data`, `./pin`.

### 1.1 `ids.ts`

```ts
export type Hex = `0x${string}`;
export type Address = `0x${string}`;

export const NETWORKS = {
  anvil: 'eip155:31337',
  baseSepolia: 'eip155:84532',
  hederaTestnet: 'hedera:testnet',
} as const;
export type Network = (typeof NETWORKS)[keyof typeof NETWORKS];
export const isEvmNetwork = (network: string): boolean => network.startsWith('eip155:');
export const isHederaNetwork = (network: string): boolean => network.startsWith('hedera:');
/** Networks the API may ever advertise in accepts[] while SALES_ENABLED is false (T-52). */
export const TESTNET_NETWORKS: readonly string[] = [NETWORKS.anvil, NETWORKS.baseSepolia, NETWORKS.hederaTestnet];

export const USDC_DECIMALS = 6;
/** Asset ids per network. Anvil's MockUSDC3009 comes from deploy/addresses.anvil.json at runtime. */
export const USDC_ASSET = {
  [NETWORKS.baseSepolia]: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  [NETWORKS.hederaTestnet]: '0.0.429274', // HTS id; EVM alias 0x0000000000000000000000000000000000068cDa
} as const;

export const WORLD_ACTION = 'recharge-welcome';
export const AUDIENCE = 'recharge';
export const CHALLENGE_PATHS = ['/claim', '/gift/claim', '/gift/reclaim', '/card/redeem'] as const;
export type ChallengePath = (typeof CHALLENGE_PATHS)[number];

export const STEP_MB = 100;
export const MAX_BUNDLE_MB = 300;
export const MAX_MB_PER_PURCHASE = 3000;
export const DEFAULT_VALIDITY_DAYS = 7;
export const CHALLENGE_TTL_S = 120;
export const PAYMENT_VALIDITY_S = 300;
export const WEBHOOK_WINDOW_S = 300;
export const ENTITLEMENT_CACHE_S = 60;
export const GIFT_CLAIM_WINDOW_S = 7 * 86_400;   // the escrow entity's expiresIn: after this the gift cannot be claimed
export const GIFT_RECLAIM_WINDOW_S = 30 * 86_400; // after claimBy the sender may reclaim while the gift receipt still exists
export const RECEIPT_TTL_S = 30 * 86_400;
export const AGENT_POLICY_TTL_S = 30 * 86_400;
export const KEY_VERSION = 'v1';

export const ENTITY_TYPES = ['entitlement', 'campaign', 'gift', 'nonce', 'receipt', 'agentpolicy'] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

/** Annotation (Arkiv attribute) names. Never a secret, a nullifier, an ICCID, a PIN or an LPA (T-37). */
export const ANN = {
  type: 'type', key: 'key', kind: 'kind', status: 'status', tier: 'tier', campaignId: 'campaignId',
  sponsor: 'sponsor', iccidHash: 'iccidHash', namehash: 'namehash', pinKey: 'pinKey', serial: 'serial',
  state: 'state', nonce: 'nonce', entitlementKeyHash: 'entitlementKeyHash', receiptKind: 'receiptKind',
  day: 'day', owner: 'owner', expiresAt: 'expiresAt', // numeric; T-35 reads min(ledger expiry, this)
} as const;

/** Logical keys. The ledger assigns its own entity key; stores index by ANN.key = one of these. */
export const keys = {
  entitlementFree: (quotaKey: Hex) => `ent:${KEY_VERSION}:${quotaKey}`,
  entitlementPaid: (payer: string, nonce: Hex) => `paid:${payer.toLowerCase()}:${nonce.toLowerCase()}`,
  entitlementGift: (giftId: Hex) => `giftent:${giftId.toLowerCase()}`,
  gift: (giftId: Hex) => `gift:${giftId.toLowerCase()}`,
  nonce: (nonce: Hex) => `nonce:${nonce.toLowerCase()}`,
  receipt: (network: string, tx: string) => `rcpt:${network}:${tx.toLowerCase()}`,
  campaign: (id: Hex) => `camp:${id.toLowerCase()}`,
  agentPolicy: (entitlementKey: string) => `policy:${entitlementKey}`,
} as const;

/** UTC day bucket for the agent's daily cap (T-30: "day is UTC and stated"). */
export const dayBucket = (nowMs: number): number => Math.floor(nowMs / 86_400_000);
/** On-chain hour bucket mirror of DataDrop (seconds / 3600). */
export const hourBucket = (nowMs: number): number => Math.floor(nowMs / 3_600_000);
```

### 1.2 `units.ts`

```ts
export type Usd6 = bigint;
export const USD6_PER_USD = 1_000_000n;
/** '0.40' → 400000n. Rejects negatives, >6 decimals, exponents, NaN. */
export function usd6(decimal: string): Usd6;
/** 400000n → '$0.40' (two decimals, en-US, exact; no floats). `{ unit: 'USDC' }` → '$0.40 USDC'. */
export function formatUsd6(value: Usd6, opts?: { unit?: 'USDC' | '' }): string;
export function usd6ToWire(value: Usd6): string;        // '400000'
export function usd6FromWire(value: string): Usd6;      // throws on non-digits

export function mbFromBytes(bytes: number | bigint): number;       // floor(bytes / 1e6)
export function bytesFromMb(mb: number): bigint;                   // mb × 1e6
/** '300 MB' below 1000; '1.5 GB' at/above (one decimal); NBSP before the unit; en-IN grouping. */
export function formatMb(mb: number): string;
export function assertMbStep(mb: number, stepMb: number, maxMb: number): void; // throws RechargeError('invalid_request')
/** ceil(mb / stepMb) × priceUsd6PerStep; mb must already satisfy assertMbStep. */
export function priceUsd6(mb: number, stepMb: number, priceUsd6PerStep: Usd6): Usd6;

export const SECONDS = { minute: 60, hour: 3_600, day: 86_400 } as const;
/** Seconds from now until expiresAtMs, never below 1 (Ledger.expiresIn must be a positive integer). */
export function secondsUntil(expiresAtMs: number, nowMs: number): number;
export function formatAsOf(ms: number, tz?: string): string;      // 'usage as of 14:02'
export function formatExpiry(expiresAtMs: number, nowMs: number, tz?: string): string; // 'Expires in 6 d 22 h · Sun 15 Nov 09:12 IST'
```

### 1.3 `schemas/common.ts`

```ts
import { z } from 'zod';
export const hexSchema = z.string().regex(/^0x[0-9a-fA-F]*$/, 'hex');
export const hex32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'bytes32');
export const hex24Schema = z.string().regex(/^0x[0-9a-fA-F]{48}$/, 'bytes24');
export const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'address');
export const hederaAccountSchema = z.string().regex(/^0\.0\.\d{1,12}$/, 'hedera account');
export const digitsSchema = z.string().regex(/^\d{1,30}$/, 'integer string');   // Usd6 on the wire
export const caipNetworkSchema = z.string().regex(/^[a-z0-9]{3,8}:[A-Za-z0-9._-]{1,32}$/, 'caip-2');
export const msSchema = z.int().nonnegative();
export const mbSchema = z.int().nonnegative().max(1_000_000);
export const tierSchema = z.enum(['orb', 'document', 'device', 'none']);
export const verificationLevelSchema = z.enum(['orb', 'device', 'document', 'secure_document']);
/** Printable ASCII + Devanagari block only (T-70). */
export const safeTextSchema = (max: number) => z.string().min(1).max(max).regex(/^[\x20-\x7Eऀ-ॿ]+$/);
/** LPA activation string; a third `$` segment (confirmation code) is optional (T-39). */
export const LPA_PATTERN = /^LPA:1\$[A-Za-z0-9.\-]+\$[A-Za-z0-9\-]+(\$[A-Za-z0-9\-]*)?$/;
export const lpaSchema = z.string().regex(LPA_PATTERN, 'lpa');
export const sealedBoxSchema = z.object({ v: z.literal(1), epk: hex32Schema, nonce: hex24Schema, ct: hexSchema });
export type SealedBox = z.infer<typeof sealedBoxSchema>;
```

### 1.4 `schemas/entities.ts` — ledger payloads (Arkiv entities)

Every entity is `{ payload: JSON.stringify(<schema>), annotations: <listed>, expiresIn: <listed> }`. Payloads are world-readable (TB-5): nothing below is secret.

```ts
export const entitlementKindSchema = z.enum(['free', 'paid', 'gift', 'card']);
export const entitlementStatusSchema = z.enum(['pending-profile', 'ready', 'installed', 'active']);
export const usageSourceSchema = z.enum(['none', 'webhook', 'poll', 'simulated']);

export const entitlementSchema = z.object({
  v: z.literal(1),
  key: z.string().min(8).max(160),          // keys.entitlement*
  kind: entitlementKindSchema,
  status: entitlementStatusSchema,
  tier: tierSchema,
  campaignId: hex32Schema.optional(),
  planId: z.string().max(64),
  mbTotal: mbSchema,
  mbUsed: mbSchema,
  usageAsOf: msSchema,
  usageSource: usageSourceSchema,
  iccidHash: hex32Schema.optional(),        // sha256(iccid): the clear ICCID never reaches the ledger (T-37)
  iccidEnc: sealedBoxSchema.optional(),     // ICCID sealed to the server's own key (crypto.sealToServer)
  sealedRef: z.string().max(200).optional(),// BlobStore ref of the sealed LPA; never the LPA, never returned by /me
  payer: z.string().max(64).optional(),
  network: caipNetworkSchema.optional(),
  createdAt: msSchema,
  expiresAt: msSchema,
}).refine((e) => e.mbUsed <= e.mbTotal, { message: 'mbUsed must not exceed mbTotal' });
export type Entitlement = z.infer<typeof entitlementSchema>;
// annotations: { type:'entitlement', key, kind, status, tier, campaignId?, iccidHash?, expiresAt }
// expiresIn: secondsUntil(expiresAt, now)

export const campaignSchema = z.object({
  v: z.literal(1),
  id: hex32Schema,
  sponsor: evmAddressSchema,
  name: safeTextSchema(64),
  bundleMb: z.object({ orb: mbSchema.max(300), document: mbSchema.max(300), device: z.literal(0) }),
  pricePerClaimUsd6: digitsSchema,
  maxClaims: z.int().positive(),
  claimsPerHour: z.int().positive(),
  validityDays: z.int().min(1).max(30),
  wholesaleUsd6PerGb: digitsSchema,
  idResaleUsd6: digitsSchema,              // 500000 unless the sponsor has evidence otherwise
  planId: z.string().max(64),              // reseller plan used for this campaign's bundles
  network: caipNetworkSchema,              // where DataDrop lives
  contract: evmAddressSchema,
  createdAt: msSchema,
  expiresAt: msSchema,
});                                         // paused/budget/spent live on-chain, never here
export type CampaignPayload = z.infer<typeof campaignSchema>;
// annotations: { type:'campaign', key: keys.campaign(id), sponsor, expiresAt } ; expiresIn: secondsUntil(expiresAt)

export const giftSchema = z.object({
  v: z.literal(1),
  giftId: hex32Schema,
  kind: z.enum(['gift', 'card']),
  state: z.enum(['open', 'claimed']),
  name: z.string().max(255).optional(),    // ENSIP-15 normalised
  namehash: hex32Schema.optional(),
  to: evmAddressSchema.nullable(),         // resolved at purchase; claim re-resolves (T-43)
  mb: mbSchema,
  validityDays: z.int().min(1).max(30),
  pinKey: hex32Schema,                     // HMAC(secret, 'pin' ‖ pin): lookup key, brute-force-proof off-ledger
  serial: z.string().regex(/^[0-9a-f]{8}$/), // public: printed on the card and in the QR; = giftId.slice(2, 10)
  fundedBy: z.enum(['payment', 'campaign']),
  campaignId: hex32Schema.optional(),
  paidTx: z.string().max(128).optional(),
  payer: z.string().max(64).optional(),    // who paid (EVM address or Hedera account); the only party who may reclaim
  usd6: digitsSchema.optional(),           // what was paid, for the reclaim amount
  network: caipNetworkSchema.optional(),
  message: safeTextSchema(80).optional(),
  createdAt: msSchema,
  claimBy: msSchema,
  claimedKey: z.string().optional(),       // entitlement key once claimed
});
export type Gift = z.infer<typeof giftSchema>;
// annotations: { type:'gift', key: keys.gift(giftId), kind, state, namehash?, pinKey, serial, campaignId?, expiresAt: claimBy }
// expiresIn: secondsUntil(claimBy) — the escrow dies by protocol at claimBy and the gift can no longer be claimed.
// Reclaim (architecture decision D-7): after claimBy the sender may POST /gift/reclaim; eligibility is decided from the
// receipts (kind 'gift' present, no 'gift-claim', no 'gift-reclaim') AND the escrow entity being gone; a ledger error is 503, never a refund.

export const nonceSchema = z.object({
  v: z.literal(1), nonce: hex32Schema, audience: z.string().max(32), path: z.string().max(64),
  exp: msSchema, consumedAt: msSchema,
});
// annotations: { type:'nonce', key: keys.nonce(nonce), nonce } ; expiresIn: CHALLENGE_TTL_S. Written on consume (T-45).

export const receiptKindSchema = z.enum(['claim', 'provision', 'topup', 'agent-topup', 'gift', 'gift-claim', 'gift-reclaim', 'card-redeem']);
export const receiptSchema = z.object({
  v: z.literal(1),
  key: z.string(),                          // keys.receipt(network, tx) or `rcpt:ledger:<uuid>` for free claims
  kind: receiptKindSchema,
  entitlementKeyHash: hex32Schema,          // sha256(entitlementKey) — never the key itself on receipts (T-44)
  campaignId: hex32Schema.optional(),
  mb: mbSchema.optional(),
  usd6: digitsSchema.optional(),
  network: caipNetworkSchema.optional(),
  tx: z.string().max(128).optional(),
  payer: z.string().max(64).optional(),
  uaid: z.string().max(200).optional(),
  hcs: z.object({ topic: z.string(), sequence: z.int().nonnegative() }).optional(),
  at: msSchema,
});
export type Receipt = z.infer<typeof receiptSchema>;
// annotations: { type:'receipt', key, receiptKind: kind, entitlementKeyHash, campaignId?, day: dayBucket(at) }
// expiresIn: RECEIPT_TTL_S

export const topUpPolicySchema = z.object({
  maxUsd6PerDay: digitsSchema,
  thresholdMb: mbSchema,
  stepMb: z.int().multipleOf(100).min(100).max(300),
  paused: z.boolean(),
  topUpOnExpiry: z.boolean(),
  expiryLeadS: z.int().min(60).max(86_400),  // buy when expiresAt − now ≤ lead; an expired entity cannot be extended
});
export type TopUpPolicyWire = z.infer<typeof topUpPolicySchema>;
export const agentPolicySchema = z.object({
  v: z.literal(1), entitlementKey: z.string(), owner: evmAddressSchema, policy: topUpPolicySchema,
  updatedAt: msSchema, lastExpiryBought: msSchema.optional(),      // T-30: expiry fires once per expiresAt value
});
// annotations: { type:'agentpolicy', key: keys.agentPolicy(entitlementKey), owner } ; expiresIn: AGENT_POLICY_TTL_S
```

### 1.5 `schemas/x402.ts` — wire types of the x402 v2 flow

These replace the hand-written `PaymentResource`, `PaymentRequirements`, `PaymentRequired`, `PaymentAuthorization`, `PaymentPayload`, `VerifyResult`, `SettleResult` in `packages/adapters/src/types.ts`, which re-exports the inferred types (§3).

```ts
export const paymentResourceSchema = z.object({ url: z.url(), description: z.string().max(200), mimeType: z.string().max(80) });

export const paymentRequirementsSchema = z.object({
  scheme: z.literal('exact'),
  network: caipNetworkSchema,
  asset: z.string().max(64),
  amount: digitsSchema,                      // base units (USDC 6-dec)
  payTo: z.string().max(64),                 // EVM address on eip155:*, Hedera account id on hedera:*
  maxTimeoutSeconds: z.int().positive().max(3_600),
  extra: z.record(z.string(), z.unknown()).optional(),
}).superRefine((r, ctx) => {
  const ok = r.network.startsWith('eip155:') ? /^0x[0-9a-fA-F]{40}$/.test(r.payTo)
           : r.network.startsWith('hedera:') ? /^0\.0\.\d{1,12}$/.test(r.payTo) : false;
  if (!ok) ctx.addIssue({ code: 'custom', path: ['payTo'], message: 'payTo does not match network' });
});
export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;
/** accepts[] entry before the per-request amount is known. */
export type AcceptTemplate = Omit<PaymentRequirements, 'amount'>;

export const paymentRequiredSchema = z.object({
  x402Version: z.literal(2),
  resource: paymentResourceSchema,
  accepts: z.array(paymentRequirementsSchema).min(1).max(8),
  error: z.string().max(200).optional(),
});
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;

export const paymentAuthorizationSchema = z.object({
  from: evmAddressSchema, to: evmAddressSchema, value: digitsSchema,
  validAfter: z.int().nonnegative(), validBefore: z.int().positive(), nonce: hex32Schema, // seconds
});
export type PaymentAuthorization = z.infer<typeof paymentAuthorizationSchema>;
export const evmExactPayloadSchema = z.object({ signature: hexSchema, authorization: paymentAuthorizationSchema });
/** Hedera exact scheme: a frozen, signed HTS transfer serialised as base64 transaction bytes. [verify Wed] */
export const hederaExactPayloadSchema = z.object({ signedTransaction: z.base64(), memo: z.string().max(100).optional() });

export const paymentPayloadSchema = z.object({
  x402Version: z.literal(2),
  accepted: paymentRequirementsSchema,
  payload: z.union([evmExactPayloadSchema, hederaExactPayloadSchema]),
});
export type PaymentPayload = z.infer<typeof paymentPayloadSchema>;
export const isEvmExact = (p: PaymentPayload['payload']): p is z.infer<typeof evmExactPayloadSchema> => 'authorization' in p;

export const verifyResultSchema = z.discriminatedUnion('isValid', [
  z.object({ isValid: z.literal(true), payer: z.string().max(64) }),
  z.object({ isValid: z.literal(false), invalidReason: z.string().max(80) }),
]);
export type VerifyResult = z.infer<typeof verifyResultSchema>;
export const settleResultSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), transaction: z.string().min(10).max(128), network: caipNetworkSchema, payer: z.string().max(64) }),
  z.object({ success: z.literal(false), errorReason: z.string().max(80), network: caipNetworkSchema }),
]);
export type SettleResult = z.infer<typeof settleResultSchema>;
/** Body of the PAYMENT-RESPONSE header. */
export const paymentResponseSchema = settleResultSchema;
```

### 1.6 `schemas/api.ts` — request and response bodies of `services/api`

```ts
export const personhoodProofSchema = z.object({
  proof: hexSchema, merkle_root: hexSchema, nullifier_hash: hexSchema, verification_level: verificationLevelSchema,
});
export const challengeRequestSchema = z.object({
  audience: z.literal(AUDIENCE), path: z.enum(CHALLENGE_PATHS), sessionPubKey: hex32Schema,
});
export const challengeSchema = z.object({
  nonce: hex32Schema, audience: z.literal(AUDIENCE), path: z.enum(CHALLENGE_PATHS), exp: msSchema, signal: hex32Schema,
});
export type ChallengeWire = z.infer<typeof challengeSchema>;

export const claimRequestSchema = z.object({
  proof: personhoodProofSchema, campaignId: hex32Schema, challenge: challengeSchema, sessionPubKey: hex32Schema,
});
export const receiptRefSchema = z.object({
  arkivKey: z.string(),                    // ledger entity key of the entitlement (shown as "Plan written to Arkiv · …")
  hcs: z.object({ topic: z.string(), sequence: z.int().nonnegative() }).optional(),
});
/** Returned by /claim, /esim/provision, /gift/claim, /card/redeem. sealedLpa appears exactly once (T-31). */
export const entitledResponseSchema = z.object({
  entitlementKey: z.string(), kind: entitlementKindSchema, status: entitlementStatusSchema, tier: tierSchema,
  mbTotal: mbSchema, expiresAt: msSchema, validityDays: z.int(),
  sealedLpa: sealedBoxSchema.optional(),   // absent when status = 'pending-profile'
  claimTx: z.string().optional(),          // DataDrop.claim tx (free lane / card)
  settlement: paymentResponseSchema.optional(),
  receipt: receiptRefSchema,
});
export const topUpResponseSchema = z.object({
  entitlementKey: z.string(), mbTotal: mbSchema, mbUsed: mbSchema, expiresAt: msSchema,
  settlement: paymentResponseSchema, receipt: receiptRefSchema,
});
export const provisionQuerySchema = z.object({ mb: z.coerce.number().int(), planId: z.string().max(64).optional() });
export const topUpQuerySchema = z.object({ key: z.string().min(8).max(160), mb: z.coerce.number().int() });

export const giftRequestSchema = z.object({ name: z.string().min(3).max(255), mb: z.int().multipleOf(100).min(100).max(3000), message: safeTextSchema(80).optional() });
export const giftResponseSchema = z.object({
  giftId: hex32Schema, serial: z.string(), pin: z.string().regex(/^\d{16}$/), name: z.string(), to: evmAddressSchema,
  mb: mbSchema, claimBy: msSchema, settlement: paymentResponseSchema, receipt: receiptRefSchema,
});
export const giftClaimRequestSchema = z.union([
  z.object({ giftId: hex32Schema, signature: hexSchema, recipient: evmAddressSchema, challenge: challengeSchema, sessionPubKey: hex32Schema }),
  z.object({ pin: z.string().regex(/^\d{16}$/), challenge: challengeSchema, sessionPubKey: hex32Schema }),
]);
export const giftReclaimRequestSchema = z.object({ giftId: hex32Schema, payer: evmAddressSchema, signature: hexSchema, challenge: challengeSchema });
export const giftReclaimResponseSchema = z.object({
  giftId: hex32Schema, refundedUsd6: digitsSchema, feeUsd6: digitsSchema, network: caipNetworkSchema, tx: z.string(), receipt: receiptRefSchema,
});
export const cardPreviewSchema = z.object({
  serial: z.string(), mb: mbSchema, sponsorName: z.string().optional(), state: z.enum(['open', 'claimed', 'expired']), claimBy: msSchema,
});
export const cardRedeemRequestSchema = z.object({ pin: z.string().regex(/^\d{16}$/), challenge: challengeSchema, sessionPubKey: hex32Schema });

export const meResponseSchema = z.object({
  entitlementKey: z.string(), kind: entitlementKindSchema, status: entitlementStatusSchema, tier: tierSchema,
  campaignId: hex32Schema.optional(), sponsorName: z.string().optional(),
  mbTotal: mbSchema, mbUsed: mbSchema, remainingMb: mbSchema, usageAsOf: msSchema, usageSource: usageSourceSchema,
  expiresAt: msSchema, arkivKey: z.string(),
  ledgerReadAt: msSchema, cached: z.boolean(), degraded: z.boolean(),
  network: caipNetworkSchema.optional(),
});
export const receiptPublicSchema = receiptSchema.omit({ entitlementKeyHash: true, key: true });
export const receiptsResponseSchema = z.object({ receipts: z.array(receiptPublicSchema) });

export const plansResponseSchema = z.object({
  mode: z.enum(['local', 'live']),
  campaign: z.object({
    id: hex32Schema, name: z.string(), sponsor: evmAddressSchema, bundleMb: z.object({ orb: mbSchema, document: mbSchema, device: z.literal(0) }),
    remainingClaims: z.int().nonnegative(), maxClaims: z.int(), paused: z.boolean(), expiresAt: msSchema, network: caipNetworkSchema,
  }).nullable(),
  paid: z.object({ stepMb: z.literal(100), priceUsd6PerStep: digitsSchema, validityDays: z.int(), accepts: z.array(paymentRequirementsSchema.omit({ amount: true })) }),
  gift: z.object({ sizesMb: z.array(mbSchema), claimWindowS: z.int() }),
  simulated: z.object({ usage: z.boolean(), personhood: z.boolean() }),
});

export const sponsorRegisterSchema = z.object({ campaign: campaignSchema.omit({ v: true, createdAt: true }), auth: z.object({ issuedAt: msSchema, signature: hexSchema }) });
export const sponsorViewSchema = z.object({
  campaign: campaignSchema, chain: z.object({ budgetUsd6: digitsSchema, spentUsd6: digitsSchema, paused: z.boolean(), claims: z.int(), claimsThisHour: z.int(), hourBucket: z.int() }),
  claims: z.array(z.object({ at: msSchema, campaignClaimKey: hex32Schema, tier: tierSchema, mb: mbSchema, usd6: digitsSchema, tx: z.string().optional(), status: z.string() })),
  expiring: z.array(z.object({ arkivKey: z.string(), remainingMb: mbSchema, expiresAt: msSchema, tier: tierSchema })),
  auditKey: hex32Schema.optional(),        // shown once, on the first authenticated read after registration
});
export const agentPolicyPutSchema = z.object({ entitlementKey: z.string(), owner: evmAddressSchema, policy: topUpPolicySchema, issuedAt: msSchema, signature: hexSchema });
export const agentPolicyViewSchema = z.object({ policy: topUpPolicySchema, owner: evmAddressSchema, spentTodayUsd6: digitsSchema, updatedAt: msSchema, lastTickAt: msSchema.optional() });

export const errorBodySchema = z.object({ error: z.string(), message: z.string(), details: z.unknown().optional(), requestId: z.string().optional() });
export const healthSchema = z.object({ ok: z.boolean(), mode: z.enum(['local', 'live']), chainId: z.number().optional(), error: z.string().optional() });
```

### 1.7 `schemas/webhooks.ts` and `schemas/hcs.ts`

```ts
export const usageEventSchema = z.object({
  provider: z.enum(['mock', 'esimaccess', 'megaesim', 'inventory']), eventId: z.string().max(128),
  iccid: z.string().regex(/^\d{18,22}$/), usedMb: mbSchema, totalMb: mbSchema, asOf: msSchema,
  status: z.enum(['ready', 'installed', 'active', 'expired']).optional(),
});
export type UsageEvent = z.infer<typeof usageEventSchema>;
/** The mock reseller's own webhook envelope; real providers have their own (adapters map them to UsageEvent). */
export const mockWebhookEnvelopeSchema = z.object({ events: z.array(usageEventSchema) });
// Mock signature: header `x-recharge-signature` = hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`),
// header `x-recharge-timestamp` = unix seconds, header `x-recharge-event-id` (T-34).

const hcsBase = { v: z.literal(1), at: z.iso.datetime(), svc: z.enum(['api', 'agent']), ent: hex32Schema /* sha256(entitlementKey) */ };
export const hcsMessageSchema = z.discriminatedUnion('t', [
  z.object({ ...hcsBase, t: z.literal('claim'), campaign: hex32Schema, claimKey: hex32Schema, tier: tierSchema, mb: mbSchema, tx: z.string() }),
  z.object({ ...hcsBase, t: z.literal('settle'), kind: z.enum(['provision', 'topup', 'gift']), network: caipNetworkSchema, tx: z.string(), payer: z.string(), usd6: digitsSchema, mb: mbSchema }),
  z.object({ ...hcsBase, t: z.literal('gift'), giftId: hex32Schema, namehash: hex32Schema.optional(), mb: mbSchema, tx: z.string() }),
  z.object({ ...hcsBase, t: z.literal('gift-claim'), giftId: hex32Schema }),
  z.object({ ...hcsBase, t: z.literal('gift-reclaim'), giftId: hex32Schema, network: caipNetworkSchema, tx: z.string(), usd6: digitsSchema, feeUsd6: digitsSchema }),
  z.object({ ...hcsBase, t: z.literal('card-redeem'), giftId: hex32Schema, claimKey: hex32Schema, tx: z.string() }),
  z.object({ ...hcsBase, t: z.literal('agent-topup'), uaid: z.string().max(200), network: caipNetworkSchema, tx: z.string(), usd6: digitsSchema, mb: mbSchema, reason: z.enum(['threshold', 'expiry']) }),
]);
export type HcsMessage = z.infer<typeof hcsMessageSchema>;
export const HCS_MAX_BYTES = 1024; // one chunk; encode() throws above it (T-44)
```

### 1.8 `x402.ts` — the one header codec and the one 402 client loop

```ts
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';
export const SESSION_PUBKEY_HEADER = 'X-Session-Pubkey';   // hex32; required on paid routes that deliver an LPA

export function encodePaymentRequired(v: PaymentRequired): string;   // base64(JSON)
export function decodePaymentRequired(h: string): PaymentRequired;   // base64 → JSON → zod parse; throws RechargeError('invalid_request')
export function encodePaymentPayload(v: PaymentPayload): string;
export function decodePaymentPayload(h: string): PaymentPayload;      // rejects > 16 KiB before decoding
export function encodePaymentResponse(v: SettleResult): string;
export function decodePaymentResponse(h: string): SettleResult;
export function paymentRequired(input: { resource: PaymentResource; accepts: PaymentRequirements[]; error?: string }): PaymentRequired;
/** Binding of an LPA-delivering purchase to the buyer's session key (T-32): the EIP-3009 nonce IS keccak256(sessionPubKey). */
export function sessionNonce(sessionPubKey: Hex, keccak256: (bytes: Uint8Array) => Hex): Hex;

export interface PaymentSigner {
  /** Choose the accepts[] entry this wallet can pay, or undefined to give up. Must check network/asset/payTo against its own allow-list (T-56). */
  choose(accepts: PaymentRequirements[]): PaymentRequirements | undefined;
  /** Produce the PAYMENT-SIGNATURE body for the chosen entry. `nonce` is the required EIP-3009 nonce when the route binds a session key. */
  sign(req: PaymentRequirements, ctx: { resource: PaymentResource; nonce?: Hex; now: number }): Promise<PaymentPayload>;
}
export interface FetchWithPaymentResult { response: Response; required?: PaymentRequired; paid?: PaymentPayload; settlement?: SettleResult }
/** GET/POST once; on 402 decode, sign, retry once with PAYMENT-SIGNATURE; never signs twice for one call. */
export function fetchWithPayment(input: {
  fetch: typeof fetch; url: string; init?: RequestInit; signer: PaymentSigner; now: () => number;
  sessionPubKey?: Hex; keccak256?: (bytes: Uint8Array) => Hex; timeoutMs?: number;
}): Promise<FetchWithPaymentResult>;
```

### 1.9 `errors.ts`

```ts
export const ERROR_CODES = {
  invalid_request: 400, invalid_proof: 401, unauthorized: 401, payment_required: 402, invalid_payment: 402, settlement_failed: 402,
  not_found: 404, name_unresolved: 404, replay: 409, already_claimed: 409, campaign_exists: 409, budget_exhausted: 409,
  campaign_expired: 410, expired: 410, campaign_paused: 423, hourly_cap: 429, daily_cap: 429, rate_limited: 429,
  provisioning_pending: 202, ledger_unavailable: 503, reseller_unavailable: 503, facilitator_unavailable: 503, chain_unavailable: 503,
  internal_error: 500,
} as const;
export type ErrorCode = keyof typeof ERROR_CODES;
export class RechargeError extends Error {
  readonly name = 'RechargeError';
  constructor(readonly code: ErrorCode, message?: string, readonly details?: unknown, readonly retryable = false);
  get status(): number;
}
/** Adapter codes (AdapterError.code) → ErrorCode. One table; services/api/src/errors.ts applies it. */
export const ADAPTER_CODE_MAP: Readonly<Record<string, ErrorCode>>; // already_verified→replay, invalid_proof→invalid_proof, invalid_response→reseller_unavailable, nonce_already_used→invalid_payment, unavailable→ledger_unavailable, …
```

### 1.10 `events.ts`

```ts
export const DATADROP_EVENTS = ['ModeSet', 'CampaignCreated', 'Claimed', 'Paused', 'Refunded', 'AttestorSet'] as const;
export const DATADROP_ERRORS = ['AlreadyClaimed', 'CampaignPaused', 'CampaignExpired', 'HourlyCap', 'BudgetExhausted', 'CampaignExists', 'NotAttestor', 'NotSponsor', 'NotRefundable', 'InvalidCampaign', 'NotHedera'] as const;
export const HCS_TYPES = ['claim', 'settle', 'gift', 'gift-claim', 'gift-reclaim', 'card-redeem', 'agent-topup'] as const;
/** pino `event` field values; the only structured log vocabulary (ARCHITECTURE §9). */
export const LOG_EVENTS = ['request', 'decision', 'claim.tx', 'settle', 'provision', 'topup', 'webhook', 'ledger.op', 'cache', 'agent.tick', 'agent.buy', 'agent.skip', 'degraded'] as const;
```

### 1.11 `http.ts`

```ts
export class HttpError extends Error { constructor(readonly status: number, readonly body: unknown, readonly url: string) }
export interface HttpJsonOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; headers?: Record<string, string>; body?: unknown;
  timeoutMs?: number;             // default 10_000
  fetch?: typeof fetch;           // injected; the fixture transport in tests, a recording wrapper on Wed
  schema?: z.ZodType<T>;          // response body validated when given
  allowStatus?: number[];         // e.g. [402] to receive the body instead of throwing
}
export async function httpJson<T = unknown>(url: string, opts?: HttpJsonOptions<T>): Promise<{ status: number; headers: Headers; data: T }>;
```

### 1.12 `typed-data.ts` — the three EIP-712 messages the API verifies (viem `verifyTypedData` in the API; protocol only defines them)

```ts
export const rechargeDomain = (chainId: number) => ({ name: 'Recharge', version: '1', chainId }) as const;
export const GIFT_CLAIM_TYPES = { GiftClaim: [
  { name: 'giftId', type: 'bytes32' }, { name: 'namehash', type: 'bytes32' }, { name: 'recipient', type: 'address' },
  { name: 'audience', type: 'string' }, { name: 'nonce', type: 'bytes32' } /* challenge nonce: one-shot (T-53) */ ] } as const;
export const GIFT_RECLAIM_TYPES = { GiftReclaim: [
  { name: 'giftId', type: 'bytes32' }, { name: 'payer', type: 'address' }, { name: 'nonce', type: 'bytes32' } /* challenge nonce: one-shot */ ] } as const;
export const SPONSOR_LOGIN_TYPES = { SponsorLogin: [
  { name: 'campaignId', type: 'bytes32' }, { name: 'sponsor', type: 'address' }, { name: 'issuedAt', type: 'uint256' } /* ms; valid 1 h */ ] } as const;
export const AGENT_POLICY_TYPES = { AgentPolicy: [
  { name: 'entitlementKey', type: 'string' }, { name: 'owner', type: 'address' }, { name: 'policyHash', type: 'bytes32' } /* keccak256(canonical JSON of policy) */, { name: 'issuedAt', type: 'uint256' } ] } as const;
export function canonicalJson(value: unknown): string; // sorted keys, no whitespace; the only canonicaliser
```

### 1.13 `pin.ts`

```ts
/** 16 digits = 15 CSPRNG digits + Verhoeff check digit; `randomBytes` is injected (crypto.getRandomValues / noble). */
export function generatePin(randomBytes: (n: number) => Uint8Array): string;
export function isValidPin(pin: string): boolean;          // length, digits, Verhoeff
export function formatPin(pin: string): string;            // '4821 9930 1127 5064'
export function serialFromGiftId(giftId: Hex): string;     // giftId.slice(2, 10)
```

---

## 2. `@ethglobal/crypto` — `packages/crypto`

Leaf. Dependencies: `@noble/ciphers`, `@noble/curves`, `@noble/hashes`. Browser-safe, synchronous. Nothing hand-rolled (T-33).

```ts
export interface SessionKeypair { publicKey: Uint8Array /* 32 */; secretKey: Uint8Array /* 32 */ }
export function generateSessionKeypair(): SessionKeypair;                    // X25519; the PWA keeps it in memory only (T-60)
export function zeroize(bytes: Uint8Array): void;

/** X25519(ephemeral, recipient) → HKDF-SHA256(salt = epk ‖ recipientPk, info = 'recharge/lpa/v1', 32) → XChaCha20-Poly1305 with a fresh 24-byte nonce. */
export function sealLpa(lpa: string, recipientPublicKey: Uint8Array, aad: Uint8Array): SealedBox;
export function openLpa(box: SealedBox, secretKey: Uint8Array, aad: Uint8Array): string;   // throws SealError on any mismatch
/** aad = utf8(`${nonce}|${entitlementKey}`): nonce = payment nonce (paid lanes) or challenge nonce (free/gift/card). */
export function lpaAad(nonce: Hex, entitlementKey: string): Uint8Array;

/** Server-side symmetric sealing (ICCID at rest on the public ledger). key = HKDF(serverSealKey, info 'recharge/server/v1'). */
export function sealToServer(key: Uint8Array, plaintext: string, aad: Uint8Array): SealedBox;  // epk is zero-filled
export function openFromServer(key: Uint8Array, box: SealedBox, aad: Uint8Array): string;

export function sha256(data: Uint8Array | string): Uint8Array;
export function sha256Hex(data: Uint8Array | string): Hex;
export function keccak256(data: Uint8Array): Hex;
export function hmacSha256(key: Uint8Array, ...parts: (Uint8Array | string)[]): Uint8Array;
export function hmacKey(secret: Uint8Array, ...parts: (Uint8Array | string)[]): Hex;        // hex32 of hmacSha256
export function randomBytes(n: number): Uint8Array;
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
export function hexToBytes(hex: Hex): Uint8Array; export function bytesToHex(bytes: Uint8Array): Hex;
export function utf8(s: string): Uint8Array; export function concat(...parts: Uint8Array[]): Uint8Array;

/**
 * Webhook MAC check (T-34): `signature` is hex or base64 HMAC-SHA256(secret, canonical). `timestamp` is unix SECONDS;
 * values > 1e11 (milliseconds) are rejected; |now/1000 − timestamp| ≤ windowSec in both directions; constant-time compare.
 * Providers with their own scheme build `canonical` themselves; the default canonical is `${timestamp}.${rawBody}`.
 */
export function verifyWebhookSignature(secret: Uint8Array, canonical: string, signature: string, timestamp: number, nowMs: number, windowSec?: number): boolean;
export class SealError extends Error {}
```

---

## 3. `@ethglobal/adapters` — additions to the scaffold (`packages/adapters`)

Dependencies: `@ethglobal/protocol`, `@ethglobal/crypto`, `@ethglobal/eip3009`; `live/` additionally `@arkiv-network/sdk`, `@hashgraph/sdk`, `viem`. Subpath exports: `.` (ports, mocks, factory, codec re-exports — browser-safe), `./live` (Node only), `./testing`.

### 3.1 `src/types.ts` — final shape (existing ports unchanged unless listed)

```ts
export type { Hex, Address } from '@ethglobal/protocol/ids';
export type { PaymentResource, PaymentRequirements, PaymentRequired, PaymentAuthorization, PaymentPayload, VerifyResult, SettleResult } from '@ethglobal/protocol/schemas';

export interface LedgerPutInput { payload: string; annotations?: Annotations; expiresIn?: number }  // unchanged
export interface LedgerEntity { key: string; payload: string; annotations: Annotations; createdAt: number; expiresAt: number | null } // unchanged
export interface Ledger {
  put(input: LedgerPutInput): Promise<LedgerPutResult>;
  get(key: string): Promise<LedgerEntity | null>;
  query(query?: LedgerQuery): Promise<LedgerEntity[]>;
  /** Replace payload and/or annotations; reset the lifetime when expiresIn is given. The returned key may differ (Arkiv); callers re-index by ANN.key. */
  update(key: string, patch: { payload?: string; annotations?: Annotations }, expiresIn?: number): Promise<LedgerPutResult>;
}

export type ResellerName = 'mock' | 'esimaccess' | 'megaesim' | 'inventory';
export interface EsimPlan { id: string; provider: ResellerName; name: string; country: 'IN'; dataMb: number; validityDays: number; wholesaleUsd6: bigint }
export interface EsimProfile { iccid: string; lpa: string; planId: string; provider: ResellerName; orderId: string; status: 'ready' | 'installed' | 'active' | 'expired' }
export interface EsimUsage { iccid: string; usedMb: number; totalMb: number; asOf: number; status?: EsimProfile['status'] }
export type WebhookVerdict = { ok: true; eventId: string } | { ok: false; reason: 'missing_headers' | 'bad_signature' | 'skew' | 'replay' };
export interface Reseller {
  readonly name: ResellerName;
  plans(country: 'IN'): Promise<EsimPlan[]>;
  /** One profile per order. A second call with the same idempotencyKey returns the same profile, never a second one (T-40). */
  order(planId: string, opts: { idempotencyKey: string }): Promise<EsimProfile>;
  topUp(iccid: string, mb: number, opts: { idempotencyKey: string }): Promise<{ orderId: string; totalMb: number }>;
  usage(iccid: string): Promise<EsimUsage>;
  /** Pure: checks headers + HMAC + skew + its own replay cache. Never throws. */
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, now: number): WebhookVerdict;
  parseWebhook(rawBody: string): UsageEvent[];      // zod-validated; throws AdapterError('reseller','invalid_response')
}

export interface ConsensusLog {                      // modelled on HCS
  submit(topic: string, message: string): Promise<{ sequence: number; consensusAt: number; txId: string }>;
  read(topic: string, fromSequence?: number): Promise<Array<{ sequence: number; message: string; consensusAt: number }>>;
}
export interface BlobStore {                         // modelled on Swarm (bzz)
  put(bytes: Uint8Array, contentType: string): Promise<{ ref: string }>;
  get(ref: string): Promise<Uint8Array | null>;
}
/** Outbound USDC from the service's payout wallet — gift reclaims only. Bounded by TREASURY_MAX_USD6_PER_DAY in the API. */
export interface Treasury {
  refund(input: { network: string; to: string; usd6: bigint; memo: string }): Promise<{ tx: string }>;
  balanceUsd6(network: string): Promise<bigint>;
}

export interface Adapters {
  mode: AdapterMode; ledger: Ledger; personhood: Personhood; payments: PaymentRail; inference: Inference;
  names: NameResolver; reseller: Reseller; consensus: ConsensusLog; blobs: BlobStore; treasury: Treasury;
}
export type AdapterName = Exclude<keyof Adapters, 'mode'>;
```

`PaymentRail` keeps `createPaymentRequirement / verify / settle`; `verify`/`settle` take the union payload and must return `invalidReason: 'unsupported_scheme'` for a payload shape they do not implement. `Personhood.verify` **must** compare `context.signal` with the proof's binding when a signal is given (scaffold gap, T-19): `MockPersonhood` takes `{ expectSignal: true }` and `fixtureProof(level, signal)` builds matching proofs.

### 3.2 Factory and options

```ts
export interface LocalAdapterOptions {
  now?: () => number; names?: readonly NameRecord[]; inference?: MockInferenceOptions;
  reseller?: { usageMbPerMinute?: number; plans?: EsimPlan[]; webhookSecret?: Uint8Array; failNextOrder?: boolean };
  personhood?: { expectSignal?: boolean };
}
export function createAdapters(mode: 'local', options?: LocalAdapterOptions): Adapters;
// `live`: import { createLiveAdapters, liveConfigSchema } from '@ethglobal/adapters/live'
export interface MockReseller extends Reseller {
  advanceUsage(iccid: string, mb: number): void;             // the "simulated usage" clock
  signedWebhook(events: UsageEvent[], now: number): { body: string; headers: Record<string, string> };
  orders(): ReadonlyArray<{ idempotencyKey: string; profile: EsimProfile }>;
}
export class MockConsensusLog implements ConsensusLog { messages(topic: string): readonly string[] }
export class MemoryBlobStore implements BlobStore {}
export class MockTreasury implements Treasury { refunds(): ReadonlyArray<{ network: string; to: string; usd6: bigint; memo: string; tx: string }> } // deterministic tx hashes; `failNext` switch
```

### 3.3 `@ethglobal/adapters/live`

```ts
export const liveConfigSchema: z.ZodType<LiveConfig>;   // zod over process.env (see §12 for the variables)
export function createLiveAdapters(config: LiveConfig, deps?: { fetch?: typeof fetch; now?: () => number; logger?: Pick<Console, 'info' | 'warn'> }): Adapters;
export class ArkivLedger implements Ledger { constructor(opts: { client: ArkivClientLike; blockTimeMs: number; now: () => number }) } // seconds→blocks rounded UP, drift logged (T-35)
export class WorldCloudPersonhood implements Personhood { constructor(opts: { appId: string; fetch?: typeof fetch; baseUrl?: string }) }
export class RemoteFacilitator implements PaymentRail { constructor(opts: { url: string; fetch?: typeof fetch; allowedHosts: string[]; networks: string[] }) }
export class SelfRunFacilitator implements PaymentRail { constructor(opts: { publicClient; relayer: Relayer; token: Address; chainId: number; network: string; now: () => number; perFromRateLimit?: number }) }
export class RoutingPaymentRail implements PaymentRail { constructor(rails: Record<string /* network */, PaymentRail>) }
export class EsimAccessReseller implements Reseller { constructor(opts: { accessCode: string; secret: string; webhookSecret: string; fetch?: typeof fetch; baseUrl?: string; now: () => number }) }
export class MegaEsimReseller implements Reseller { constructor(opts: { apiKey: string; webhookSecret: string; fetch?: typeof fetch; baseUrl?: string; now: () => number }) }
export class InventoryReseller implements Reseller { constructor(opts: { file: string; sealKey: Uint8Array; now: () => number }) }   // fixtures/inventory.enc (T-41)
export class FallbackReseller implements Reseller { constructor(primary: Reseller, fallback: Reseller) }   // order() falls back; usage/topUp do not
export class HcsLog implements ConsensusLog { constructor(opts: { client: HederaClientLike; mirrorUrl: string; fetch?: typeof fetch }) }
export function hcs14Uaid(input: { registry: 'hedera'; name: string; version: string; protocol: 'x402'; nativeId: string; skills?: string[] }): string; // [verify Wed] against the HCS-14 spec vector in fixtures/hcs/hcs14-vector.json
export class EnsResolver implements NameResolver { constructor(opts: { mainnetClient; fallbackClient? }) }  // viem normalize + getEnsAddress/getEnsText (T-43)
export class SwarmBlobStore implements BlobStore { constructor(opts: { beeUrl: string; postageBatchId: string; fetch?: typeof fetch }) }
export class EvmTreasury implements Treasury { constructor(opts: { walletClient; publicClient; token: Address; network: string }) }        // ERC-20 transfer from the payout wallet
export class HederaTreasury implements Treasury { constructor(opts: { client: HederaClientLike; tokenId: string; network: string }) }    // HTS TransferTransaction
export class RoutingTreasury implements Treasury { constructor(byNetwork: Record<string, Treasury>) }
```

### 3.4 `@ethglobal/adapters/testing`

```ts
export const T0: number;                                            // Date.UTC(2026, 10, 3, 12)
export function fakeClock(start?: number): { now: () => number; advance(ms: number): void; set(ms: number): void };
export const anvilAccounts: readonly Address[];                     // ten, mnemonic "test test … junk"
export const anvilKeys: readonly Hex[];                             // the matching private keys (public; never fund elsewhere)
export const anvilRoles: { deployer: 0; payout: 1; attestor: 2; sponsor: 3; agent: 4; human: 5; relayer: 6; stranger: 7 };
export function loadFixture<T = unknown>(relPath: string): T;      // from <repo>/fixtures
/** Replays recorded HTTP exchanges; throws FixtureMiss({method,url,body}) on an unmatched request so request shapes are asserted. */
export function fixtureFetch(relPath: string, opts?: { strictBody?: boolean }): typeof fetch;
export function fixtureProof(level: VerificationLevel, signal?: Hex, seed?: string): PersonhoodProof;
export function paymentPayload(req: PaymentRequirements, overrides?: Partial<PaymentAuthorization>, signature?: Hex): PaymentPayload;
export function requirementInput(overrides?: Partial<PaymentRequirementInput>): PaymentRequirementInput;
/** Contract suites: the same assertions run against every implementation of a port. */
export function describeLedger(name: string, make: () => Promise<{ ledger: Ledger; clock: ReturnType<typeof fakeClock> }>): void;
export function describeReseller(name: string, make: () => Promise<Reseller>): void;
export function describeConsensusLog(name: string, make: () => Promise<ConsensusLog>): void;
export function describePersonhood(name: string, make: () => Promise<Personhood>): void;
export function describePaymentRail(name: string, make: () => Promise<{ rail: PaymentRail; signer?: (auth: PaymentAuthorization) => Promise<Hex> }>): void;
export function describeNameResolver(name: string, make: () => Promise<NameResolver>): void;
export function describeBlobStore(name: string, make: () => Promise<BlobStore>): void;
```

---

## 4. `@ethglobal/eip3009` — `packages/eip3009`

Leaf. Dependency: `viem`. Shared by `SelfRunFacilitator`, the PWA payer, the agent payer and the forge test vectors.

```ts
export interface Authorization3009 { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex }
export const TRANSFER_WITH_AUTHORIZATION_TYPES, RECEIVE_WITH_AUTHORIZATION_TYPES, CANCEL_AUTHORIZATION_TYPES; // viem TypedData objects
/** Never hard-code name/version: Circle USDC is ("USD Coin","2") on most chains but testnet deployments differ; read them (readDomain) and record per chain in fixtures/eip3009/domains.json. */
export function domain(token: Address, chainId: number, name: string, version: string): TypedDataDomain;
export async function readDomain(publicClient: PublicClient, token: Address): Promise<{ name: string; version: string; chainId: number }>; // ERC-5267 eip712Domain(), fallback name()/version()
export function typedDataTransferWithAuthorization(d: TypedDataDomain, a: Authorization3009): TypedDataDefinition;
export function typedDataReceiveWithAuthorization(d: TypedDataDomain, a: Authorization3009): TypedDataDefinition;
export function digestTransferWithAuthorization(d: TypedDataDomain, a: Authorization3009): Hex;
export function digestReceiveWithAuthorization(d: TypedDataDomain, a: Authorization3009): Hex;
/** Rejects high-s and v ∉ {0,1,27,28}; accepts 65-byte and EIP-2098 64-byte forms explicitly (T-17). */
export async function recoverSigner(digest: Hex, signature: Hex): Promise<Address>;
export function encodeTransferWithAuthorization(a: Authorization3009, signature: Hex): Hex;  // bytes-signature overload
export function encodeReceiveWithAuthorization(a: Authorization3009, signature: Hex): Hex;
export function fromPaymentAuthorization(p: PaymentAuthorization): Authorization3009;
export function toPaymentAuthorization(a: Authorization3009): PaymentAuthorization;
export const EIP3009_ABI: Abi; // transferWithAuthorization(bytes sig), receiveWithAuthorization(bytes sig), cancelAuthorization, authorizationState, Transfer event, AuthorizationUsed event
export interface Relayer { submit(token: Address, data: Hex): Promise<{ hash: Hex; status: 'success' | 'reverted' }> }
export function createViemRelayer(opts: { walletClient: WalletClient; publicClient: PublicClient; simulate?: boolean }): Relayer; // eth_call before send (T-16)
```

---

## 5. `@ethglobal/octroi` — `packages/octroi`

Pure rules plus the ledger stores. Dependencies: `@ethglobal/protocol`, `@ethglobal/crypto`, `@ethglobal/adapters` (ports only — never `./live`). No I/O except through the injected `Ledger`, `Personhood`, `PaymentRail`.

```ts
export type Tier = 'orb' | 'document' | 'device' | 'none';
/** Only from the verifier's response level, never from the request body (T-22). */
export function tierFromLevel(level: VerificationLevel): Tier;   // orb→orb, document|secure_document→document, device→device

export interface Campaign extends Omit<CampaignPayload, 'pricePerClaimUsd6' | 'wholesaleUsd6PerGb' | 'idResaleUsd6' | 'v'> {
  pricePerClaimUsd6: bigint; wholesaleUsd6PerGb: bigint; idResaleUsd6: bigint;
  actionCheck?: (claimKey: Hex) => Promise<boolean>;             // v1: action-conditioned campaigns (DECISION Table D §2(1)b)
}
/** Chain-side facts the caller reads from DataDrop before decide() (T-24: before verify). */
export interface CampaignCounters { paused: boolean; budgetUsd6: bigint; spentUsd6: bigint; claimsThisHour: number; hourBucket: number; claimed?: boolean }
export function campaignFromPayload(p: CampaignPayload): Campaign;
export function campaignToPayload(c: Campaign): CampaignPayload;

export type Entitlement = import('@ethglobal/protocol/schemas').Entitlement;

export function quotaKey(secret: Uint8Array, nullifierHash: Hex): Hex;                 // HMAC(secret, 'quota' ‖ nullifier): global pseudonym, server-side only
export function auditKey(secret: Uint8Array, campaignId: Hex): Uint8Array;             // HMAC(secret, 'audit' ‖ campaignId): handed to the sponsor once
export function campaignClaimKey(audit: Uint8Array, nullifierHash: Hex): Hex;          // HMAC(audit, nullifier): the published, per-campaign pseudonym
export function onchainClaimKey(campaignId: Hex, cck: Hex): Hex;                        // keccak256(campaignId ‖ cck) = DataDrop claimKey

/** min(c.bundleMb[tier], floor(0.8 × idResale / (wholesale / 1000 MB)), 300) in integer Usd6 math; device|none → 0; wholesale ≤ 0 → cap only (T-23). */
export function sizeBundle(c: Pick<Campaign, 'bundleMb' | 'idResaleUsd6' | 'wholesaleUsd6PerGb'>, tier: Tier): number;

export interface Challenge { nonce: Hex; audience: string; path: ChallengePath; exp: number; signal: Hex }
/**
 * nonce = random16 ‖ HMAC(secret, random16 ‖ audience ‖ path ‖ exp ‖ sessionPubKey)[0..16]; exp = now + CHALLENGE_TTL_S × 1000;
 * signal = keccak256(nonce ‖ utf8(audience)). No ledger write at issue time; the MAC makes forgery impossible and binds the session key (T-32, T-45).
 */
export function challenge(audience: string, path: ChallengePath, sessionPubKey: Hex, now: number, secret: Uint8Array): Challenge;
export function signalFor(nonce: Hex, audience: string): Hex;
export type ConsumeResult = 'ok' | 'replayed' | 'expired' | 'invalid' | 'unavailable';
/** Checks MAC + session key + exp, then the in-memory set synchronously BEFORE any await, then the ledger; writes the nonce entity before returning 'ok'. 'unavailable' ⇒ caller denies (fail closed) (T-20). */
export function consumeChallenge(ledger: Ledger, cache: Set<string>, c: Challenge, sessionPubKey: Hex, now: number, secret: Uint8Array): Promise<ConsumeResult>;

export type DenyReason = 'replay' | 'paused' | 'cap' | 'budget' | 'invalid-proof' | 'invalid-payment' | 'expired' | 'no-campaign' | 'ledger-unavailable' | 'invalid-request';
export type Decision =
  | { kind: 'serve-free'; entitlement: Entitlement; claimKey: Hex; campaignClaimKey: Hex; tier: Tier; mb: number }
  | { kind: 'serve-paid'; entitlement: Entitlement; settlement: Extract<SettleResult, { success: true }>; requirements: PaymentRequirements }
  | { kind: 'payment-required'; body: PaymentRequired }
  | { kind: 'deny'; reason: DenyReason; detail?: string };

export interface OctroiDeps {
  ledger: Ledger; personhood: Personhood; payments: PaymentRail; secret: Uint8Array; now: () => number;
  action: string;                      // WORLD_ACTION
  priceUsd6PerStep: bigint; stepMb: number; maxMbPerPurchase: number; validityDays: number;
  accepts: AcceptTemplate[];           // local: [eip155:31337 MockUSDC]; demo: [eip155:84532 USDC, hedera:testnet USDC]
  keccak256: (bytes: Uint8Array) => Hex;
}
export interface DecideRequest {
  resource: PaymentResource;
  mb: number;                          // requested step multiple (paid) or ignored (free: sizeBundle decides)
  proof?: PersonhoodProof; challenge?: Challenge; sessionPubKey?: Hex;
  payment?: PaymentPayload; requireSessionKey?: boolean;   // true on routes that deliver an LPA ⇒ nonce must equal sessionNonce(sessionPubKey)
  campaign?: Campaign; counters?: CampaignCounters;
  existingEntitlement?: Entitlement | null;                // looked up by the caller after verify via EntitlementStore (T-18)
}
/**
 * Order: request validity → (free) campaign liveness/budget/hour-cap from counters → consumeChallenge → personhood.verify →
 * tier/sizeBundle (0 ⇒ payment-required) → quota/claim keys → replay (existing entitlement or counters.claimed) → serve-free.
 * (paid) accepts deep-equality incl. exact amount → session-nonce binding → verify → settle → serve-paid. Nothing is persisted here.
 */
export function decide(req: DecideRequest, deps: OctroiDeps): Promise<Decision>;
export function buildAccepts(deps: Pick<OctroiDeps, 'accepts' | 'priceUsd6PerStep' | 'stepMb'>, mb: number): PaymentRequirements[];

export interface TopUpPolicy { maxUsd6PerDay: bigint; thresholdMb: number; stepMb: number; paused: boolean; topUpOnExpiry: boolean; expiryLeadS: number }
export type TopUpVerdict =
  | { buy: false; reason: 'ok' | 'paused' | 'cap' | 'expired' | 'already-bought-for-expiry' }
  | { buy: true; mb: number; reason: 'threshold' | 'expiry'; costUsd6: bigint };
/** Pure. 'expiry' only when expiresAt − now ≤ expiryLeadS×1000 and lastExpiryBought !== expiresAt; cap: spent + cost ≤ max (T-30). */
export function shouldTopUp(e: Entitlement, p: TopUpPolicy, spentTodayUsd6: bigint, now: number, stepPriceUsd6: bigint, lastExpiryBought?: number): TopUpVerdict;
export function policyFromWire(w: TopUpPolicyWire): TopUpPolicy; export function policyToWire(p: TopUpPolicy): TopUpPolicyWire;

/**
 * Gift reclaim rule (D-7). Pure. The caller passes what it read: the escrow (null once expired), the receipts for giftId, and whether the
 * ledger answered. 'refund' only when: ledger ok ∧ gift receipt exists ∧ receipt.payer == payer ∧ no 'gift-claim' ∧ no 'gift-reclaim' ∧
 * escrow === null ∧ now ≥ claimBy ∧ now < claimBy + GIFT_RECLAIM_WINDOW_S×1000. Amount = usd6 − min(feeUsd6, usd6).
 */
export type GiftReclaimVerdict =
  | { kind: 'refund'; to: string; network: string; usd6: bigint; feeUsd6: bigint }
  | { kind: 'deny'; reason: 'too-early' | 'claimed' | 'already-reclaimed' | 'not-payer' | 'unknown-gift' | 'window-closed' | 'ledger-unavailable' };
export function decideGiftReclaim(input: {
  giftId: Hex; payer: string; now: number; escrow: Gift | null; receipts: Receipt[]; ledgerOk: boolean; feeUsd6: bigint;
}): GiftReclaimVerdict;

// store/ — the only code that builds annotations (ARCHITECTURE §8 rule 9)
export interface Found<T> { entityKey: string; payload: T; expiresAt: number | null }
export class EntitlementStore {
  constructor(ledger: Ledger, now: () => number);
  getByKey(key: string): Promise<Found<Entitlement> | null>;   // query {type:'entitlement', key}; expired if gone OR annotations.expiresAt < now (T-35)
  getByIccidHash(iccidHash: Hex): Promise<Found<Entitlement> | null>;
  create(e: Entitlement): Promise<LedgerPutResult>;
  patch(key: string, patch: Partial<Entitlement>, opts?: { expiresAt?: number }): Promise<Found<Entitlement>>;
  expiringWithin(ms: number, limit?: number): Promise<Found<Entitlement>[]>;   // sponsor dashboard
}
export class NonceStore { constructor(ledger: Ledger, now: () => number); consumed(nonce: Hex): Promise<boolean>; consume(c: Challenge, now: number): Promise<void> }
export class GiftStore { constructor(ledger: Ledger, now: () => number); create(g: Gift): Promise<LedgerPutResult>; openByNamehash(namehash: Hex): Promise<Found<Gift>[]>; byPinKey(pinKey: Hex): Promise<Found<Gift> | null>; bySerial(serial: string): Promise<Found<Gift> | null>; markClaimed(giftId: Hex, entitlementKey: string): Promise<void> }
export class CampaignStore { constructor(ledger: Ledger, now: () => number); get(id: Hex): Promise<Found<Campaign> | null>; put(c: Campaign): Promise<LedgerPutResult>; list(): Promise<Found<Campaign>[]> }
export class ReceiptStore { constructor(ledger: Ledger, now: () => number); add(r: Receipt): Promise<LedgerPutResult>; forEntitlement(entitlementKeyHash: Hex): Promise<Receipt[]>; forCampaign(campaignId: Hex): Promise<Receipt[]>; spentUsd6(entitlementKeyHash: Hex, kind: Receipt['kind'], day: number): Promise<bigint> }
export class AgentPolicyStore { constructor(ledger: Ledger, now: () => number); get(entitlementKey: string): Promise<Found<AgentPolicyWire> | null>; put(p: AgentPolicyWire): Promise<LedgerPutResult>; all(): Promise<Found<AgentPolicyWire>[]> }
```

---

## 6. `@ethglobal/contracts` — `packages/contracts`

### 6.1 `src/interfaces/IDataDrop.sol`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// @title IDataDrop — sponsor pools that pay the service once per verified human (claimKey), with an hourly cap, pause and refund.
interface IDataDrop {
    struct Campaign {
        address sponsor;        // slot 0
        uint96 pricePerClaim;   // USDC 6-dec; paid to `payout` per claim
        uint128 budget;         // slot 1: USDC pulled at creation (token mode) or declared (LEDGER_ONLY)
        uint128 spent;
        uint32 claimsPerHour;   // slot 2
        uint64 expiresAt;       // unix seconds; no claims at or after
        uint64 pausedSince;     // 0 when not paused; set on false→true, cleared on true→false
        bool paused;
    }

    event ModeSet(bool ledgerOnly);
    event CampaignCreated(bytes32 indexed id, address indexed sponsor, uint128 budget, uint96 pricePerClaim, uint32 claimsPerHour, uint64 expiresAt);
    event Claimed(bytes32 indexed id, bytes32 indexed claimKey, uint96 paid, uint64 hourBucket);
    event Paused(bytes32 indexed id, bool paused, address by);
    event Refunded(bytes32 indexed id, uint128 amount);
    event AttestorSet(address attestor);

    error AlreadyClaimed(); error CampaignPaused(); error CampaignExpired(); error HourlyCap(); error BudgetExhausted();
    error CampaignExists(); error InvalidCampaign(); error NotAttestor(); error NotSponsor(); error NotRefundable(); error NotHedera();

    /// @notice Creates a campaign and (token mode) pulls `budget` USDC from msg.sender. Reverts CampaignExists if `id` is taken,
    ///         InvalidCampaign unless budget ≥ pricePerClaim > 0, claimsPerHour > 0, expiresAt > block.timestamp.
    function createCampaign(bytes32 id, uint128 budget, uint96 pricePerClaim, uint32 claimsPerHour, uint64 expiresAt) external;
    /// @notice onlyAttestor. claimKey = keccak256(abi.encodePacked(id, campaignClaimKey)). Pays pricePerClaim to `payout` (token mode).
    function claim(bytes32 id, bytes32 claimKey) external;
    /// @notice Sponsor may set either value; the attestor may only set `true`; anyone else reverts NotSponsor.
    function pause(bytes32 id, bool paused_) external;
    /// @notice Sponsor only; after expiresAt, or when paused for ≥ 24 h. Transfers budget − spent, then sets budget = spent.
    function refund(bytes32 id) external;
    function setAttestor(address attestor) external;           // owner (Ownable2Step)
    /// @notice Hedera only (chainid 295/296): HTS precompile associateToken(address(this), token). Reverts NotHedera elsewhere.
    function associateHts(address token) external;             // owner

    function claimed(bytes32 id, bytes32 claimKey) external view returns (bool);
    function claimsInHour(bytes32 id, uint64 hourBucket) external view returns (uint32);
    function campaigns(bytes32 id) external view returns (Campaign memory);
    function ledgerOnly() external view returns (bool);        // usdc == address(0)
    function usdc() external view returns (address);
    function payout() external view returns (address);
    function attestor() external view returns (address);
    function currentHourBucket() external view returns (uint64); // block.timestamp / 3600
}
// constructor(IERC20 usdc_, address payout_, address attestor_, address owner_)
```

### 6.2 `src/interfaces/IEIP3009.sol` (implemented by `MockUSDC3009`; mirrors Circle FiatTokenV2_2)

```solidity
interface IEIP3009 {
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);
    event AuthorizationCanceled(address indexed authorizer, bytes32 indexed nonce);
    function authorizationState(address authorizer, bytes32 nonce) external view returns (bool);
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
    function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external;
    function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
    function receiveWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, bytes calldata signature) external;
    function cancelAuthorization(address authorizer, bytes32 nonce, uint8 v, bytes32 r, bytes32 s) external;
}
// MockUSDC3009: ERC20("USD Coin","USDC"), decimals() == 6, EIP712("USD Coin","2"), open mint(address,uint256) (test token only).
// Typehashes (verbatim): "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
// "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)",
// "CancelAuthorization(address authorizer,bytes32 nonce)".
```

### 6.3 Artefacts other packages consume

- `packages/contracts/abi/DataDrop.json`, `abi/MockUSDC3009.json` — `forge inspect <C> abi --json`, committed; `pnpm abi:check` fails CI on drift (T-12). Exported as `@ethglobal/contracts/abi/DataDrop.json`.
- `packages/contracts/deploy/addresses.<slug>.json` — written by `Deploy.s.sol` (`vm.writeJson`), committed for live chains, git-ignored for `anvil`:
  ```json
  { "chainId": 31337, "network": "eip155:31337", "ledgerOnly": false, "dataDrop": "0x…", "usdc": "0x…", "usdcHts": "", "payout": "0x…", "attestor": "0x…", "owner": "0x…", "deployer": "0x…", "deployedAt": 1762171200, "txs": { "dataDrop": "0x…", "usdc": "0x…" } }
  ```
- `deploy/chains.json` gains per chain `"usdc"` (EVM address or `""`) and `"usdcHts"` (`"0.0.429274"` on 296, else `""`). Keys stay alphabetical (`stdJson` decodes sorted).

---

## 7. `services/api` — HTTP contract (`@ethglobal/api`)

Base URL `NEXT_PUBLIC_API_URL` (local `http://127.0.0.1:8787`). JSON everywhere; `Content-Type: application/json` required on bodies; every response carries `X-Request-Id`; every non-2xx body is `errorBodySchema`; all mutations are `POST`/`PUT` (T-47). Schemas in §1.6.

| Method & path | Request | Success | Gate / notes |
|---|---|---|---|
| `GET /healthz` | — | `healthSchema` | exists |
| `GET /plans` | — | `plansResponseSchema` | public; cached 60 s |
| `POST /challenge` | `challengeRequestSchema` | `challengeSchema` | 10/min/IP; no ledger write |
| `POST /claim` | `claimRequestSchema` | `entitledResponseSchema` (201; 202 when `pending-profile`) | 5/min/IP; `octroi()` free lane; attestor `DataDrop.claim` |
| `GET /esim/provision?mb=&planId=` | header `PAYMENT-SIGNATURE` (optional), `X-Session-Pubkey` (required) | 402 `paymentRequiredSchema` + header `PAYMENT-REQUIRED`; or 201 `entitledResponseSchema` + header `PAYMENT-RESPONSE` | `octroi()` paid lane; nonce must equal `sessionNonce` |
| `GET /esim/topup?key=&mb=` | header `PAYMENT-SIGNATURE` (optional) | 402 …; or 200 `topUpResponseSchema` + `PAYMENT-RESPONSE` | per-ICCID daily cap `TOPUPS_PER_ICCID_PER_DAY` (default 20) |
| `POST /gift` | `giftRequestSchema` + optional `PAYMENT-SIGNATURE` | 402 …; or 201 `giftResponseSchema` + `PAYMENT-RESPONSE` | `names.resolve` **before** the 402 (T-43); 404 `name_unresolved` |
| `POST /gift/claim` | `giftClaimRequestSchema` | `entitledResponseSchema` | challenge path `/gift/claim`; EIP-712 `GiftClaim` by the **currently** resolved address, or PIN |
| `POST /gift/reclaim` | `giftReclaimRequestSchema` | `giftReclaimResponseSchema` | challenge path `/gift/reclaim`; EIP-712 `GiftReclaim` by the gift's `payer`; `decideGiftReclaim`; writes a pending `gift-reclaim` receipt **before** `treasury.refund`, patches the tx after; per-giftId mutex; `TREASURY_MAX_USD6_PER_DAY` |
| `GET /card/:serial` | — | `cardPreviewSchema` | read-only; 404 for unknown; constant-time |
| `POST /card/redeem` | `cardRedeemRequestSchema` | `entitledResponseSchema` | 10/min/IP; challenge path `/card/redeem`; campaign-funded cards call `DataDrop.claim` |
| `POST /webhooks/reseller/:provider` | raw body + provider headers | 204 | `reseller.verifyWebhook`; 401 on failure; 409 on replay; never 500 |
| `GET /me/:key` | — | `meResponseSchema` | 60-s cache (read path only, T-51); `?refresh=1` polls `reseller.usage` ≤ 1/min/ICCID; 404 unknown; 410 `expired` |
| `GET /me/:key/receipts` | — | `receiptsResponseSchema` | ledger query |
| `GET /sponsor/:id` | header `Authorization: Recharge-Sponsor <base64 {sponsor, issuedAt, signature}>` | `sponsorViewSchema` | EIP-712 `SponsorLogin`, issuedAt within 1 h, signer == campaign sponsor |
| `POST /sponsor` | `sponsorRegisterSchema` | 201 `{ id, auditKey }` | signer == `campaign.sponsor` and == on-chain `campaigns(id).sponsor` |
| `PUT /agent/policy` | `agentPolicyPutSchema` | 200 `agentPolicyViewSchema` | EIP-712 `AgentPolicy`; owner must equal the entitlement's `payer` (paid) or be the first owner registered for a free entitlement |
| `GET /agent/policy/:key` | — | `agentPolicyViewSchema` | public read (policy is public on the ledger anyway) |
| `GET /facilitator/supported` · `POST /facilitator/verify` · `POST /facilitator/settle` | x402 facilitator API `{ x402Version, paymentPayload, paymentRequirements }` | `{ kinds }` · `verifyResultSchema` · `settleResultSchema` | the self-run facilitator (EVM exact), also usable by third parties |
| `GET /openapi.json` | — | OpenAPI 3.1 | generated from the schemas; committed; `pnpm openapi:check` |

**Middleware order (fixed):** `requestId → logger → securityHeaders (no-store, nosniff, no-referrer) → cors(allow-list) → rateLimit(ip; X-Forwarded-For only when TRUST_PROXY=1) → bodyLimit(64 KiB) → idempotency(Idempotency-Key, 24 h, POST only) → validate(zod) → x402() → octroi() → handler → errorMapper`.

**Decision → HTTP:** `payment-required → 402`; `deny: replay → 409 replay`; `paused → 423 campaign_paused`; `cap → 429 hourly_cap`; `budget → 409 budget_exhausted`; `invalid-proof → 401`; `invalid-payment → 402 invalid_payment`; `expired → 410`; `no-campaign → 404 not_found`; `ledger-unavailable → 503`; `invalid-request → 400`.

---

## 8. `services/agent` — `@ethglobal/agent`

```ts
export const agentConfigSchema = z.object({
  MODE: z.enum(['local', 'live']).default('local'),
  AGENT_API_URL: z.url(),
  AGENT_WATCH_KEYS: z.string().default(''),          // comma list; empty ⇒ every agentpolicy entity whose owner == AGENT_OWNER
  AGENT_OWNER: evmAddressSchema.optional(),
  AGENT_TICK_MS: z.coerce.number().int().min(1_000).default(60_000),   // 5_000 in local
  AGENT_DRY_RUN: z.coerce.boolean().default(false),
  AGENT_ONCE: z.coerce.boolean().default(false),
  AGENT_PAYTO_ALLOWLIST: z.string(),                  // comma list of `<network>|<asset>|<payTo>` pinned from /plans at install time (T-56)
  AGENT_MAX_USD6_PER_STEP: digitsSchema.default('1000000'),
  AGENT_EVM_PRIVATE_KEY: hex32Schema.optional(),      // Anvil #4 locally; Base Sepolia key live
  AGENT_HEDERA_ACCOUNT_ID: hederaAccountSchema.optional(), AGENT_HEDERA_PRIVATE_KEY: z.string().optional(),
  AGENT_UAID: z.string().optional(),                  // computed by hcs14Uaid on first run and persisted to .agent/uaid
  HCS_TOPIC_ID: z.string().optional(), HEDERA_MIRROR_URL: z.url().optional(),
  LLM_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
});
export interface Payer extends PaymentSigner { readonly network: string; balanceUsd6(): Promise<bigint> }
export interface TickResult { key: string; verdict: TopUpVerdict; bought?: { mb: number; usd6: bigint; tx: string; network: string; hcsSequence?: number }; skipped?: string }
export function tick(deps: AgentDeps, key: string): Promise<TickResult>;   // read ledger → spentToday → shouldTopUp → fetchWithPayment → HCS receipt
/** The only object an LLM ever sees; no free text (T-55). */
export interface NotificationFacts { mbRemaining: number; mbTotal: number; expiresAt: number; boughtMb: number; spentTodayUsd6: string; capUsd6: string; reason: 'threshold' | 'expiry' | 'cap' | 'paused' }
export function phraseNotification(facts: NotificationFacts, llm?: Inference): Promise<string>;
```
CLI: `recharge-agent [--once] [--dry-run] [--key <entitlementKey>]`.

---

## 9. Event names, topics, headers — one list

- **Contract events:** `ModeSet(bool)`, `CampaignCreated(bytes32,address,uint128,uint96,uint32,uint64)`, `Claimed(bytes32,bytes32,uint96,uint64)`, `Paused(bytes32,bool,address)`, `Refunded(bytes32,uint128)`, `AttestorSet(address)`; `MockUSDC3009`: ERC-20 `Transfer`, `AuthorizationUsed`, `AuthorizationCanceled`.
- **HCS message types (`t`):** `claim`, `settle`, `gift`, `gift-claim`, `gift-reclaim`, `card-redeem`, `agent-topup`. One topic per deployment (`HCS_TOPIC_ID`), created by a human on Wed; agent messages carry `uaid`.
- **HTTP headers:** `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, `X-Session-Pubkey`, `X-Request-Id`, `Idempotency-Key`, `Authorization: Recharge-Sponsor …`, webhook `x-recharge-signature` / `x-recharge-timestamp` / `x-recharge-event-id` (mock reseller).
- **Ledger annotations:** §1.1 `ANN`; entity types §1.1 `ENTITY_TYPES`; logical key prefixes `ent:v1:`, `paid:`, `giftent:`, `gift:`, `nonce:`, `rcpt:`, `camp:`, `policy:`.
- **Log events:** §1.10 `LOG_EVENTS`.
- **PWA ↔ API:** no cookies; the PWA stores `entitlementKey`s and opened LPAs in IndexedDB (device-local), never the session secret.

---

## 10. Fixture catalogue — `fixtures/`

Recorded exchanges: `{ "name", "recordedAt", "exchanges": [ { "request": { "method", "url", "headers"?, "body"? }, "response": { "status", "headers"?, "body" } } ] }`. `fixtureFetch` matches on method + URL (path + sorted query) and, with `strictBody`, on canonical JSON body.

| Path | Content | Recorded by |
|---|---|---|
| `fixtures/world/verify-ok.json`, `verify-max-verifications.json`, `verify-invalid-proof.json`, `verify-malformed.json`, `hash-to-field-vectors.json` | `POST /api/v2/verify/{app_id}` exchanges; IDKit `hashToField` vectors | orchestrator from docs; Integrations Wed |
| `fixtures/facilitator/x402org/{supported,verify-ok,settle-ok,settle-nonce-used,verify-invalid}.json` | EVM exact scheme | orchestrator from the x402 spec; Wed |
| `fixtures/facilitator/hedera/{supported,verify-ok,settle-ok}.json` | Hedera exact scheme `[verify Wed]` | Integrations Wed 14:00 |
| `fixtures/reseller/esimaccess/{plans,order,query,topup,usage,webhook-usage}.json` | eSIM Access open API | orchestrator from docs; Integrations Tue/Wed |
| `fixtures/reseller/megaesim/*.json` | MegaeSIM sandbox | Integrations Tue (instant sandbox) |
| `fixtures/arkiv/{create,get,query,update,expired}.json` | SDK-level exchanges (JSON-RPC bodies) | Integrations Wed |
| `fixtures/hcs/{submit-receipt,mirror-messages,hcs14-vector}.json` | SDK receipt shape, mirror REST page, one HCS-14 UAID vector from the spec | orchestrator; Wed |
| `fixtures/ens/{resolve-ok,resolve-null,text-avatar}.json` | viem `getEnsAddress`/`getEnsText` RPC exchanges | orchestrator |
| `fixtures/eip3009/{vectors.json,domains.json}` | Circle-layout typed-data digests + signatures produced by `forge` and viem (must agree); per-chain `(name, version)` | contracts + eip3009 workstreams |
| `fixtures/swarm/{upload,download}.json` | Bee gateway `POST /bzz`, `GET /bzz/{ref}` | Wed |
| `fixtures/demo/{campaign.json,entitlements.json,gift.json,cards.json}` | what `scripts/demo-seed.ts` creates | ops-demo |
| `fixtures/inventory.enc` (git-ignored) + `fixtures/inventory.example.json` | pre-bought profiles, sealed; the example holds `LPA:1$local.test$…` only | Integrations |

---

## 11. Environment contract — additions to `.env.example`

```
# Octroi / keys (never NEXT_PUBLIC_; on-site generated in live; local uses Anvil roles)
OCTROI_SECRET=                 # 32 bytes hex; HMAC root (quota, audit, pin, challenge MAC). ≥ 32 bytes enforced (T-29)
SERVER_SEAL_KEY=               # 32 bytes hex; seals ICCIDs at rest
ATTESTOR_PRIVATE_KEY=          # DataDrop.claim; local: Anvil #2
RELAYER_PRIVATE_KEY=           # self-run facilitator; local: Anvil #6
PAYOUT_ADDRESS=                # x402 payTo on EVM networks and DataDrop payout; local: Anvil #1
PAYOUT_HEDERA_ACCOUNT=         # x402 payTo on hedera:testnet
TREASURY_PRIVATE_KEY=          # key of PAYOUT_ADDRESS, used ONLY for gift reclaims (EvmTreasury); local: Anvil #1
TREASURY_HEDERA_PRIVATE_KEY=   # key of PAYOUT_HEDERA_ACCOUNT, same purpose
TREASURY_MAX_USD6_PER_DAY=50000000   # $50/day of reclaims; the API refuses beyond it (503 treasury cap, logged)
GIFT_RECLAIM_FEE_USD6=0        # deducted from a reclaim to cover the network fee (testnet: 0)
DATADROP_ADDRESS=              # optional override of deploy/addresses.<slug>.json
X402_FACILITATOR=self          # mock | self | remote (local default: self when ANVIL_RPC_URL answers, else mock)
X402_FACILITATOR_URL_EVM=      # remote facilitator for eip155:*; host must be in the allow-list (T-42)
X402_FACILITATOR_URL_HEDERA=   # remote facilitator for hedera:testnet
X402_NETWORKS=eip155:31337     # comma list of accepts[] networks; must ⊂ TESTNET_NETWORKS unless SALES_ENABLED=true and LEGAL_MEMO_OK=true (T-52)
PRICE_USD6_PER_STEP=400000     # $0.40 per 100 MB
VALIDITY_DAYS=7
TOPUPS_PER_ICCID_PER_DAY=20
SALES_ENABLED=false
LEGAL_MEMO_OK=false
TRUST_PROXY=0
CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:3000
PRINT_TOKEN=                   # protects /print/cards (T-64)
# Reseller
RESELLER=mock                  # mock | esimaccess | megaesim | inventory ; RESELLER_FALLBACK=inventory
ESIMACCESS_ACCESS_CODE= ESIMACCESS_SECRET= ESIMACCESS_WEBHOOK_SECRET= ESIMACCESS_BASE_URL=https://api.esimaccess.com/api/v1/open
MEGAESIM_API_KEY= MEGAESIM_WEBHOOK_SECRET= MEGAESIM_BASE_URL=
MOCK_RESELLER_WEBHOOK_SECRET=  # local webhook simulator
INVENTORY_FILE=fixtures/inventory.enc INVENTORY_SEAL_KEY=
# World (server side)
WORLD_APP_ID= WORLD_ACTION=recharge-welcome WORLD_VERIFY_BASE_URL=https://developer.worldcoin.org
# Arkiv
ARKIV_RPC_URL= ARKIV_WS_URL= ARKIV_PRIVATE_KEY= ARKIV_CHAIN_ID=60138453025 ARKIV_BLOCK_TIME_MS=2000
# Hedera / HCS
HEDERA_ACCOUNT_ID= HEDERA_PRIVATE_KEY= HCS_TOPIC_ID= HEDERA_MIRROR_URL=https://testnet.mirrornode.hedera.com
# ENS
ENS_RPC_URL= ENS_FALLBACK_RPC_URL=
# Swarm
SWARM_BEE_URL= SWARM_POSTAGE_BATCH=
# Agent (see §8)
AGENT_API_URL=http://127.0.0.1:8787 AGENT_TICK_MS=5000 AGENT_WATCH_KEYS= AGENT_OWNER= AGENT_PAYTO_ALLOWLIST= AGENT_MAX_USD6_PER_STEP=1000000
AGENT_EVM_PRIVATE_KEY= AGENT_HEDERA_ACCOUNT_ID= AGENT_HEDERA_PRIVATE_KEY= AGENT_UAID= AGENT_DRY_RUN=0 AGENT_ONCE=0 LLM_PROVIDER=none
# Web (public)
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 NEXT_PUBLIC_MODE=local NEXT_PUBLIC_ANVIL_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_WORLD_APP_ID= NEXT_PUBLIC_WORLD_ACTION=recharge-welcome NEXT_PUBLIC_EXPLORER_EVM= NEXT_PUBLIC_EXPLORER_HEDERA=https://hashscan.io/testnet NEXT_PUBLIC_ARKIV_EXPLORER=
```
`services/api/src/env.ts` rejects: `MODE=live` with any Anvil key in `ATTESTOR_PRIVATE_KEY`/`RELAYER_PRIVATE_KEY`/`ARKIV_PRIVATE_KEY`; `LOG_LEVEL=debug|trace` in live; `OCTROI_SECRET` shorter than 32 bytes; `X402_NETWORKS` outside the testnet set without both sales flags.

---

## 12. Dependency rules (enforced by eslint `no-restricted-imports` zones in `eslint.config.js`; see ARCHITECTURE §4)

| Package | May import | Never imports |
|---|---|---|
| `@ethglobal/protocol`, `@ethglobal/crypto`, `@ethglobal/eip3009` | third-party only | any `@ethglobal/*` |
| `@ethglobal/adapters` | protocol, crypto, eip3009 | octroi, ui, services, apps |
| `@ethglobal/octroi` | protocol, crypto, adapters (`.` only) | `adapters/live`, ui, services, apps |
| `@ethglobal/ui` | protocol (`./units`, types) | adapters, octroi, crypto, eip3009, services, apps |
| `services/api` | protocol, crypto, eip3009, adapters (incl. `/live`), octroi, contracts/abi | agent, web, ui |
| `services/agent` | protocol, crypto, eip3009, adapters (incl. `/live`), octroi | api, web, ui |
| `apps/web` | protocol, crypto, eip3009, ui, contracts/abi | adapters, octroi, services |
| `scripts/` | anything except `apps/web` internals | — |

Nobody imports another package's `src/` or `dist/` path; package names and subpath exports only.

---

## 13. Amendments to DECISION §6.2 (recorded so nobody relitigates them in a brief)

| # | DECISION said | This file says | Why |
|---|---|---|---|
| A-1 | `sizeBundle … (wholesaleUsdPerGb / 1024)` | `/ 1000`, integer `Usd6` math | §6.5's own acceptance test ("$2.50/GB → ≤ 160 MB") only holds with 1 GB = 1000 MB; floats are banned on money paths (T-08, T-23). |
| A-2 | `wholesaleUsdPerGb: number; idResaleUsd: number; maxUsdPerDay: number; priceUsd6PerStep: bigint` (mixed) | all money `bigint` micro-USD; wire = digit strings | one units module, no floats. |
| A-3 | `challenge(audience, path, now)`; `consumeChallenge(ledger, cache, c, now)` | both take `sessionPubKey` and `secret`; nonce carries a MAC | unforgeable without an issue-time ledger write (T-45); binds the session key for the free lane (T-32). |
| A-4 | `Decision.deny.reason` seven values | adds `no-campaign`, `ledger-unavailable`, `invalid-request` | infra failures must map to 503/400, not 403. |
| A-5 | `PaymentPayload.payload = { signature, authorization }` | union with the Hedera exact payload | the Hedera scheme is not EIP-3009. |
| A-6 | `payTo: Address` | `payTo: string`, validated per network | Hedera account ids. |
| A-7 | x402 codec and wire types in `@ethglobal/adapters` | moved to `@ethglobal/protocol`; adapters re-exports the types | the PWA must not import adapters; one codec. |
| A-8 | entitlement keys look like ledger keys | logical keys are the `key` annotation; stores in `@ethglobal/octroi/store` own all ledger access | Arkiv assigns entity keys; one query shape (T-36). |
| A-9 | `claimKey = keccak256(campaignId ‖ HMAC(secret, nullifier))` | `keccak256(campaignId ‖ HMAC(auditKey_c, nullifier))`, `auditKey_c = HMAC(secret, campaignId)`; `ent:v1:<HMAC(secret, nullifier)>` stays the global entitlement key | gives the sponsor a real per-campaign audit key (DECISION Table B Q-SEC-Octroi-2) and makes published claim lists unlinkable across campaigns. |
| A-10 | `GET /card/:pin` returns the entitlement | `GET /card/:serial` previews; `POST /card/redeem { pin }` redeems | GET must have no side effects (T-47). |
| A-11 | `Reseller.order(planId)`, `verifyWebhook(rawBody, signature, timestamp)` | `order(planId, { idempotencyKey })`, `verifyWebhook(rawBody, headers, now)`, `parseWebhook` | idempotent retries (T-40); provider-specific headers. |
| A-12 | `recoverSigner` synchronous | `Promise<Address>` | viem's recover is async. |
| A-13 | `TopUpPolicy.topUpOnExpiry` buys "on expiry" | buys when `expiresAt − now ≤ expiryLeadS`; once per `expiresAt` | an expired entity has vanished and cannot be extended (T-30, T-35). |
| A-14 | `shouldTopUp(e, p, spentTodayUsd, now)` | adds `stepPriceUsd6`, `lastExpiryBought` | the cap needs the price; expiry must fire once. |
| A-15 | routes list | adds `GET /me/:key/receipts`, `PUT/GET /agent/policy`, `/facilitator/*`, `/openapi.json`, `GET /card/:serial`; `/card/:pin` removed | receipts screen, agent sheet persistence, self-run facilitator, OpenAPI deliverable. |
| A-16 | Adapters bundle `+ reseller, consensus` | `+ reseller, consensus, blobs, treasury` | Swarm bonus needs a blob port; gift reclaims need an outbound-USDC port. |
| A-17 | gifts "escrow" with a claim-window `expiresIn` (rule for lapsed gifts unspecified) | the escrow entity's `expiresIn` **is** the claim window; after it the sender reclaims via `POST /gift/reclaim` (USDC returned minus `GIFT_RECLAIM_FEE_USD6`, for `GIFT_RECLAIM_WINDOW_S`), decided by `decideGiftReclaim` from the receipts plus the escrow's absence | design pass finding (coordinator, 3 Nov): the `/gift` copy must state what happens; the absence of the expired escrow is what authorises the refund — expiry stays load-bearing. |

---

## 14. The interfaces workstream (how this file becomes code; 2 agent-hours, lands first in wave 1)

**Create:** `packages/protocol/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,src/ids.ts,src/units.ts,src/errors.ts,src/events.ts,src/http.ts,src/x402.ts,src/typed-data.ts,src/pin.ts,src/schemas/{index,common,entities,x402,api,webhooks,hcs}.ts,test/*.test.ts}`; `packages/crypto/*` **complete** (§2 is ~150 lines of `@noble` wrappers and octroi needs it on day one; tests: seal/open round trip, wrong key, wrong AAD, flipped byte, 10⁴ distinct nonces, webhook MAC ±299/±301 s, ms timestamp rejected, HMAC vectors); `packages/eip3009/*` skeleton (package.json, tsconfig, `src/index.ts` exporting the §4 signatures as `throw new Error('not implemented')` stubs so dependants compile — the adapters-live workstream implements it); `packages/adapters/src/types.ts` edits (§3.1), `src/index.ts` re-exports, `package.json` subpath exports (`./live`, `./testing`), `src/testing/index.ts` with `fakeClock`, `T0`, `anvilAccounts`/`anvilKeys`/`anvilRoles`, `loadFixture`, `fixtureFetch`, `paymentPayload`, `requirementInput`, `fixtureProof`; `eslint.config.js` zones (§12) and a `no-restricted-syntax` rule banning bare `fetch(` outside `packages/protocol/src/http.ts` and `packages/adapters/src/testing/`; `.env.example` additions (§11); `pnpm-workspace.yaml` catalog entries for `zod`, `viem`, `@noble/*`, `fast-check`, `@playwright/test` and `minimumReleaseAge: 3 days` (T-65); `.jscpd.json` unchanged (1 %).

**Tests (vitest):** every schema accepts its fixture example and rejects one mutation per field class; `units`: `usd6('0.40') === 400000n`, `formatUsd6(400000n) === '$0.40'`, `priceUsd6(300, 100, 400000n) === 1200000n`, `assertMbStep(199, 100, 3000)` throws `invalid_request`, `mbFromBytes(1_073_741_824) === 1073`; `x402`: header round-trips, `decodePaymentPayload` rejects > 16 KiB and a payload whose `accepted.payTo` mismatches its network, `fetchWithPayment` signs at most once and surfaces `PAYMENT-RESPONSE`; `pin`: Verhoeff vectors, 10⁴ generated PINs all valid and distinct; `typed-data.canonicalJson` is stable under key order; `errors`: every code has a status and every `ADAPTER_CODE_MAP` value is a code.

**Definition of done:** `pnpm -r build && pnpm lint && pnpm typecheck && pnpm test && pnpm dupcheck` green; `apps/web` builds importing `@ethglobal/protocol` (no Node built-ins leak); the scaffold's adapter tests still pass with types re-exported from protocol; `docs/INTERFACES.md` §1 code blocks and `packages/protocol/src` agree (a reviewer diffs them).
