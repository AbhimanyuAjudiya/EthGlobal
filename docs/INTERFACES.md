# INTERFACES — the single source of truth for every cross-workstream type

**Status:** binding for every builder agent and every human commit in `v0` and in-window. **Owner:** architect; changes land here first, then in `packages/protocol`, then anywhere else. **Companions:** `docs/ARCHITECTURE.md` (why), `docs/build-briefs/*.md` (who builds what; they copy from this file verbatim and must not restate it differently), `docs/THREAT-MODEL.md` (the properties the red team tests; T-numbers below refer to its §5), `research/committee/DECISION.md` §6.2–6.5 (the committee's module list; §13 of this file records every amendment to it).

If a brief and this file disagree, **this file wins** and the brief is fixed. If code and this file disagree, the code is wrong until this file is changed by the architect.

---

## 0. How to read this file

- Code blocks are the public surface of each package, in the language it ships in. Everything else in a package is private.
- `[verify Wed]` marks an external API shape reconstructed from documentation the sandbox cannot reach; the live adapter codes against it, the fixture recorded at the Wednesday pre-deploy corrects it, and the fixture becomes the truth.
- **`docs/vendor/API-FACTS.md`** (verified 3 Nov 2026 against pinned vendor repos and npm tarballs) is the reference for every vendor shape, package name and version below. Where this file and the fact sheet disagreed, this file was amended (§13, A-18…A-30). Only the items the fact sheet marks **[unverified]** remain `[verify Wed]`; everything else is coded as stated and a recording that contradicts it is a finding, not a silent fix.
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
  [NETWORKS.hederaTestnet]: '0.0.429274', // HTS id, 6 decimals (A-20); EVM long-zero alias 0x0000000000000000000000000000000000068cDa
} as const;
/**
 * EIP-712 domain of USDC per EVM network (A-21). Circle's Base Sepolia USDC signs as name "USDC"; Ethereum, Base mainnet and
 * World Chain sign as "USD Coin"; version is "2" everywhere. The API copies this into accepts[].extra and every EVM signer takes
 * the domain from accepts[].extra — never from a literal. readDomain() cross-checks it wherever an RPC is reachable.
 */
export const USDC_EIP712_DOMAIN: Readonly<Record<string, { name: string; version: string }>> = {
  [NETWORKS.anvil]: { name: 'USD Coin', version: '2' },     // MockUSDC3009 (§6.2)
  [NETWORKS.baseSepolia]: { name: 'USDC', version: '2' },   // 0x036CbD53842c5426634e7929541eC2318f3dCF7e
  'eip155:8453': { name: 'USD Coin', version: '2' },          // Base mainnet; never advertised while SALES_ENABLED=false
};
/** Hedera transactions are valid for at most 180 s (A-20): accepts[].maxTimeoutSeconds on hedera:* never exceeds this. */
export const HEDERA_MAX_TIMEOUT_S = 180;

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
export const RECEIPT_TTL_S = GIFT_CLAIM_WINDOW_S + GIFT_RECLAIM_WINDOW_S + 86_400; // 38 d (A-36)
export const NONCE_TTL_S = 300;                       // consumed-nonce lifetime ≥ acceptance window + skew + drift (A-37)
export const AGENT_POLICY_TTL_S = 30 * 86_400;
export const KEY_VERSION = 'v1';

export const ENTITY_TYPES = ['entitlement', 'campaign', 'gift', 'nonce', 'receipt', 'agentpolicy', 'claim'] as const; // 'claim': A-33
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
  claim: (digest: Hex) => `claim:${digest}`,            // A-33: digest is already an HMAC/sha256
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
// annotations: { type:'entitlement', key: entitlementIndex(key) = 'hk:'+sha256(key), kind, status, tier, campaignId?, iccidHash?, expiresAt }
// payload.key on the ledger is the same index — the capability never reaches the ledger (A-34). holderHash?: A-35.
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
// annotations: { type:'nonce', key: keys.nonce(nonce), nonce } ; expiresIn: NONCE_TTL_S (A-37); issuedAt?. Written on consume, create-if-absent (T-45, A-32).
// claimSchema { v, key: keys.claim(digest), scope: 'free-live'|'free-campaign'|'settlement'|'once', expiresAt } ; annotations { type:'claim', key, expiresAt } (A-33; 'once': A-42)

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
export const paymentResourceSchema = z.object({ url: z.url(), description: z.string().max(200), mimeType: z.string().max(80) }); // v2 also allows serviceName/tags/iconUrl; we never send them

export const paymentRequirementsSchema = z.object({
  scheme: z.literal('exact'),
  network: caipNetworkSchema,
  asset: z.string().max(64),
  amount: digitsSchema,                      // base units (USDC 6-dec). x402 v2 name; v1's `maxAmountRequired` must never appear (A-18)
  payTo: z.string().max(64),                 // EVM address on eip155:*, Hedera account id on hedera:*
  maxTimeoutSeconds: z.int().positive().max(3_600),
  extra: z.record(z.string(), z.unknown()).optional(), // eip155: { name, version } = the token's EIP-712 domain; hedera: { feePayer: '0.0.x' } (A-20, A-21)
}).superRefine((r, ctx) => {
  const ok = r.network.startsWith('eip155:') ? /^0x[0-9a-fA-F]{40}$/.test(r.payTo)
           : r.network.startsWith('hedera:') ? /^0\.0\.\d{1,12}$/.test(r.payTo) : false;
  if (!ok) ctx.addIssue({ code: 'custom', path: ['payTo'], message: 'payTo does not match network' });
  if (r.network.startsWith('eip155:') && (typeof r.extra?.name !== 'string' || typeof r.extra?.version !== 'string'))
    ctx.addIssue({ code: 'custom', path: ['extra'], message: 'EVM exact needs extra.name and extra.version (EIP-712 domain)' });
  if (r.network.startsWith('hedera:')) {
    if (typeof r.extra?.feePayer !== 'string' || !/^0\.0\.\d{1,12}$/.test(r.extra.feePayer))
      ctx.addIssue({ code: 'custom', path: ['extra', 'feePayer'], message: 'Hedera exact needs extra.feePayer (facilitator account)' });
    if (r.maxTimeoutSeconds > HEDERA_MAX_TIMEOUT_S) ctx.addIssue({ code: 'custom', path: ['maxTimeoutSeconds'], message: 'Hedera tx valid ≤ 180 s' });
  }
});
export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;
/** accepts[] entry before the per-request amount is known. */
export type AcceptTemplate = Omit<PaymentRequirements, 'amount'>;

export const paymentRequiredSchema = z.object({
  x402Version: z.literal(2),
  resource: paymentResourceSchema,
  accepts: z.array(paymentRequirementsSchema).min(1).max(8),
  error: z.string().max(200).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(), // v2 field; we send {} or omit (no `agentkit` extension in v0, A-25)
});
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;

export const paymentAuthorizationSchema = z.object({
  from: evmAddressSchema, to: evmAddressSchema, value: digitsSchema,
  validAfter: z.int().nonnegative(), validBefore: z.int().positive(), nonce: hex32Schema, // seconds
});
export type PaymentAuthorization = z.infer<typeof paymentAuthorizationSchema>;
export const evmExactPayloadSchema = z.object({ signature: hexSchema, authorization: paymentAuthorizationSchema });
/** Hedera exact scheme (`@x402/hedera` 2.29.0, A-20): base64 of a partially-signed TransferTransaction whose transactionId.accountId == accepted.extra.feePayer; the facilitator co-signs and submits. */
export const hederaExactPayloadSchema = z.object({ transaction: z.base64().max(8_192) });

export const paymentPayloadSchema = z.object({
  x402Version: z.literal(2),
  resource: paymentResourceSchema.optional(),   // v2 clients echo it; ignored by the server
  accepted: paymentRequirementsSchema,
  payload: z.union([evmExactPayloadSchema, hederaExactPayloadSchema]),
  extensions: z.record(z.string(), z.unknown()).optional(),
});
export type PaymentPayload = z.infer<typeof paymentPayloadSchema>;
export const isEvmExact = (p: PaymentPayload['payload']): p is z.infer<typeof evmExactPayloadSchema> => 'authorization' in p;

export const verifyResultSchema = z.discriminatedUnion('isValid', [
  z.object({ isValid: z.literal(true), payer: z.string().max(64) }),
  z.object({ isValid: z.literal(false), invalidReason: z.string().max(80), payer: z.string().max(64).optional() }),
]);
export type VerifyResult = z.infer<typeof verifyResultSchema>;
export const settleResultSchema = z.discriminatedUnion('success', [
  z.object({ success: z.literal(true), transaction: z.string().min(10).max(128), network: caipNetworkSchema, payer: z.string().max(64) }),
  z.object({ success: z.literal(false), errorReason: z.string().max(80), network: caipNetworkSchema,
             transaction: z.string().max(128).optional(), payer: z.string().max(64).optional() }), // spec sends transaction: ""; 'settlement_pending' carries the tx and is non-terminal
]);
export type SettleResult = z.infer<typeof settleResultSchema>;
// Hedera facilitators put the tx id (`0.0.x@seconds.nanos`) in `transaction`; a body with only `transactionId` is normalised into `transaction` by the adapter before parsing (A-20).
/** Body of the PAYMENT-RESPONSE header. */
export const paymentResponseSchema = settleResultSchema;
```

### 1.6 `schemas/api.ts` — request and response bodies of `services/api`

```ts
/**
 * IDKit 4.6 result (A-25), forwarded to the verifier UNCHANGED (`.loose()` keeps fields we do not model). Uniqueness proofs only:
 * session results (`session_id`) are rejected. V4 `nullifier` is a decimal string; V3 legacy (`allow_legacy_proofs`) carries hex.
 * The tier is never read from here — only from the verifier's response (T-22).
 */
const idkitResponseV4Schema = z.object({
  identifier: z.string().max(32),                 // 'proof_of_human' | 'passport' | 'mnc' | 'selfie'
  issuer_schema_id: z.int().optional(), nullifier: z.string().regex(/^\d{1,78}$/), expires_at_min: z.int().optional(),
  proof: z.array(hexSchema).length(5), signal_hash: hexSchema, sybil_score: z.number().optional(),
}).loose();
const idkitResponseV3Schema = z.object({
  identifier: z.string().max(32),                 // 'orb' | 'secure_document' | 'document' | 'device' | 'selfie' [partly unverified]
  merkle_root: hexSchema, nullifier: z.string().max(80), proof: z.union([hexSchema, z.array(hexSchema).max(8)]),
  signal_hash: hexSchema, max_age: z.int().optional(),
}).loose();
export const personhoodProofSchema = z.discriminatedUnion('protocol_version', [
  z.object({ protocol_version: z.literal('4.0'), nonce: z.string().max(80), action: z.string().max(64), environment: z.string().max(16).optional(),
             responses: z.array(idkitResponseV4Schema).min(1).max(4) }).loose(),
  z.object({ protocol_version: z.literal('3.0'), nonce: z.string().max(80), action: z.string().max(64),
             responses: z.array(idkitResponseV3Schema).min(1).max(4) }).loose(),
]);
export type PersonhoodProof = z.infer<typeof personhoodProofSchema>;   // adapters re-exports this as its PersonhoodProof
/** The ONE identifier → level mapping (A-26); live verifier, mock and tests all use it. Unknown identifiers map to undefined (no tier). */
export const IDENTIFIER_LEVEL: Readonly<Record<string, VerificationLevel>> = {
  proof_of_human: 'orb', orb: 'orb', passport: 'secure_document', mnc: 'secure_document', secure_document: 'secure_document',
  document: 'document', device: 'device', selfie: 'device', face: 'device',
};
export function verificationLevelFromIdentifier(identifier: string): VerificationLevel | undefined;
/** Backend-signed RP context IDKit 4 requires (A-25); snake_case so the PWA passes it to IDKit.request() as is. */
export const rpContextRequestSchema = z.object({ audience: z.literal(AUDIENCE), path: z.enum(CHALLENGE_PATHS) });
export const rpContextSchema = z.object({
  rp_id: z.string().regex(/^(rp|app)_[A-Za-z0-9]{1,64}$/), nonce: hexSchema, created_at: z.int().positive(), expires_at: z.int().positive(), // unix seconds
  signature: hexSchema, app_id: z.string().max(80), action: z.string().max(64), environment: z.enum(['production', 'staging']),
});
export type RpContext = z.infer<typeof rpContextSchema>;
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

Dependencies: `@ethglobal/protocol`, `@ethglobal/crypto`, `@ethglobal/eip3009`; `live/` additionally `@arkiv-network/sdk@1.0.1`, `@x402/hedera@2.29.0` (which pins `@hiero-ledger/sdk@2.90.1` — import Hedera SDK symbols through `@x402/hedera`'s re-exports so exactly one SDK copy exists; never `@hashgraph/sdk`, A-22), `viem`. Subpath exports: `.` (ports, mocks, factory, codec re-exports — browser-safe), `./live` (Node only), `./testing`.

### 3.1 `src/types.ts` — final shape (existing ports unchanged unless listed)

```ts
export type { Hex, Address } from '@ethglobal/protocol/ids';
export type { PaymentResource, PaymentRequirements, PaymentRequired, PaymentAuthorization, PaymentPayload, VerifyResult, SettleResult } from '@ethglobal/protocol/schemas';

/** A-32: `ifAbsent` = create-if-absent on the (type, key) annotations of this writer's live rows; else AdapterError('ledger','conflict'). */
export interface LedgerPutInput { payload: string; annotations?: Annotations; expiresIn?: number; ifAbsent?: boolean }
/** A-32: `version` is the ledger's revision (1 on put, +1 per update); absent only on hand-built entities (read as 1). */
export interface LedgerEntity { key: string; payload: string; annotations: Annotations; createdAt: number; expiresAt: number | null; version?: number }
/** A-32: `ifVersion` = compare-and-swap; a stale version ⇒ AdapterError('ledger','conflict') and nothing changes. */
export interface LedgerUpdatePatch { payload?: string; annotations?: Annotations; ifVersion?: number }
export interface Ledger {
  put(input: LedgerPutInput): Promise<LedgerPutResult>;
  get(key: string): Promise<LedgerEntity | null>;
  query(query?: LedgerQuery): Promise<LedgerEntity[]>;
  /** Replace payload and/or annotations; reset the lifetime when expiresIn is given; bump version. The returned key may differ (Arkiv); callers re-index by ANN.key. */
  update(key: string, patch: LedgerUpdatePatch, expiresIn?: number): Promise<LedgerPutResult>;
}
// Contract (describeLedger, both InMemoryLedger and ArkivLedger): of N concurrent ifAbsent puts of one (type, key) exactly one
// succeeds; of two concurrent ifVersion updates from one version exactly one applies. ArkivLedger: exact within a process
// (serialised per key); across processes best effort — create-then-re-read, oldest (createdAt, key) wins, the loser tombstones
// its row; `rev` u64 attribute for the version [verify Wed: Arkiv has no conditional create/update] (A-32).

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

`PersonhoodProof` becomes the IDKit 4 result (re-exported from §1.6) and `PersonhoodContext` gains the challenge `signal`; `PersonhoodResult { nullifierHash: Hex; level: VerificationLevel }` is unchanged — live adapters normalise the verifier's credential identifier to a level with `verificationLevelFromIdentifier` (`proof_of_human|orb → orb`, `passport|mnc → secure_document`, `document → document` — both document levels give the document tier — `device|selfie|face → device`; unknown → `invalid_proof`) and a V4 decimal nullifier to hex32 (A-25). `PaymentRail` keeps `createPaymentRequirement / verify / settle`; `verify`/`settle` take the union payload and must return `invalidReason: 'unsupported_scheme'` for a payload shape they do not implement. `Personhood.verify` **must** compare `context.signal` with the proof's binding when a signal is given (scaffold gap, T-19): `MockPersonhood` takes `{ expectSignal: true }` and `fixtureProof(level, signal)` builds matching proofs.

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
/** @arkiv-network/sdk 1.0.1 on rabdi (chain 7794095) by default (A-23); expiresIn seconds → `expiration: ExpirationTime.fromSeconds(ceil to 2-s blocks)`, ≤ 7,884,000 blocks (A-24); drift logged (T-35). */
export class ArkivLedger implements Ledger { constructor(opts: { client: ArkivClientLike; blockTimeMs: number; now: () => number }) }
/** IDKit 4 cloud verify: POST {baseUrl = https://developer.world.org}/api/v4/verify/{rpId}, body = the IDKit result unchanged (A-25). */
export class WorldCloudPersonhood implements Personhood { constructor(opts: { rpId: string; action: string; environment: 'production' | 'staging'; fetch?: typeof fetch; baseUrl?: string }) }
/** Issues the backend-signed rp_context (idkit-core/signing signRequest; key never leaves the API). Local mode: a fixed test key. */
export function createRpContextSigner(opts: { appId: string; rpId: string; action: string; environment: 'production' | 'staging'; signingKeyHex: Hex; ttlS?: number; now: () => number }): { issue(): Promise<RpContext> };
/** x402 v2 facilitator (`/supported`, `/verify`, `/settle`); default https://x402.org/facilitator for eip155:84532 and hedera:testnet; Hedera fee payer read from /supported kinds[].extra.feePayer (A-20). */
export class RemoteFacilitator implements PaymentRail { constructor(opts: { url: string; fetch?: typeof fetch; allowedHosts: string[]; networks: string[]; expectFeePayer?: Record<string, string> }) }
export class SelfRunFacilitator implements PaymentRail { constructor(opts: { publicClient; relayer: Relayer; token: Address; chainId: number; network: string; now: () => number; perFromRateLimit?: number }) }
export class RoutingPaymentRail implements PaymentRail { constructor(rails: Record<string /* network */, PaymentRail>) }
/** PRIMARY reseller (A-27). HMAC-signed RT-* headers on every call; webhooks are unsigned per the docs ⇒ URL token + sender-IP allow-list, and payloads are hints re-checked with /esim/query. */
export class EsimAccessReseller implements Reseller { constructor(opts: { accessCode: string; signingKey?: string /* default = accessCode, per the official reference */; webhookToken: string; webhookIps?: string[]; fetch?: typeof fetch; baseUrl?: string; now: () => number }) }
/** FIXTURE-ONLY STUB (A-28): no public API docs exist. Every method throws AdapterError('reseller','unavailable') unless constructed over recorded fixtures; liveConfigSchema refuses RESELLER=megaesim. */
export class MegaEsimReseller implements Reseller { constructor(opts: { fixtureFetch?: typeof fetch; baseUrl?: string; now: () => number }) }
export class InventoryReseller implements Reseller { constructor(opts: { file: string; sealKey: Uint8Array; now: () => number }) }   // fixtures/inventory.enc (T-41)
export class FallbackReseller implements Reseller { constructor(primary: Reseller, fallback: Reseller) }   // order() falls back; usage/topUp do not
export class HcsLog implements ConsensusLog { constructor(opts: { client: HederaClientLike /* @hiero-ledger/sdk Client via @x402/hedera */; mirrorUrl: string; fetch?: typeof fetch }) }
/**
 * HCS-14 self-issued UAID (A-29): `uaid:aid:<base58(sha384(JSON.stringify({ skills, name, nativeId, protocol, registry, version })))>;uid=0;registry=<registry>;nativeId=<nativeId>;proto=<protocol>`,
 * keys in exactly that order, strings trimmed, protocol/registry lower-cased, skills sorted integers. Conformance test against @hashgraphonline/standards-sdk createUaid (devDependency).
 */
export function hcs14Uaid(input: { registry: 'hedera'; name: string; version: string; protocol: 'x402'; nativeId: string /* CAIP-10 hedera:testnet:0.0.x */; skills?: number[] }): string;
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
export const anvilRoles: { deployer: 0; payout: 1; attestor: 2; sponsor: 3; agent: 4; human: 5; relayer: 6; stranger: 7; treasury: 8 };   // treasury added by A-31
export function loadFixture<T = unknown>(relPath: string): T;      // from <repo>/fixtures
/** Replays recorded HTTP exchanges; throws FixtureMiss({method,url,body}) on an unmatched request so request shapes are asserted. */
export function fixtureFetch(relPath: string, opts?: { strictBody?: boolean }): typeof fetch;
/** IDKit-4-shaped result (V4 for orb/document, V3 'device' for device) whose signal_hash = hashToField(signal); MockPersonhood({ expectSignal }) checks exactly that (A-25). */
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
/** The domain name is configurable per chain (A-21): Base Sepolia USDC = ("USDC","2"), mainnets = ("USD Coin","2"); callers pass it from accepts[].extra (protocol USDC_EIP712_DOMAIN). Recorded per chain in fixtures/eip3009/domains.json. */
export function domain(token: Address, chainId: number, name: string, version: string): TypedDataDomain;
/** The one builder the exact-EVM payload signers use (PWA EvmWalletSigner, agent EvmPayer, testing paymentPayload): domain from accepted.extra.{name,version}, chainId from the eip155 reference, verifyingContract = asset. Throws on a missing/non-string name or version. */
export function domainFromRequirements(req: { network: string; asset: string; extra?: Record<string, unknown> }): TypedDataDomain;
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
// Capabilities and their ledger index (A-34, RT-O-01): the key IS the /me capability and never reaches the ledger.
export function freeEntitlementKey(secret: Uint8Array, campaignId: Hex, nullifierHash: Hex): string;   // ent:v1:HMAC(secret,'entfree'‖campaignId‖nullifier) — per campaign
export function paidEntitlementKey(secret: Uint8Array, network: string, payer: string, nonce: string): string; // paid:<payer>:HMAC(secret,'paid'‖network‖payer‖nonce|keccak(tx))
export function entitlementIndex(key: string): string;                                   // 'hk:' + sha256(utf8(key)) (= receipts' entitlementKeyHash); idempotent
export function holderHash(entitlementKey: string, sessionPubKey: Hex): Hex;             // sha256(utf8(key) ‖ spk): the claiming session (A-35)

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
/** Checks MAC + session key + exp (now == exp still accepted), then the in-memory set synchronously BEFORE any await, then the ledger; writes the nonce entity create-if-absent (A-32) with expiresIn NONCE_TTL_S = 300 (A-37) before returning 'ok'. 'unavailable' ⇒ caller denies (fail closed) (T-20). A malformed clock ⇒ 'invalid'; challenge() with a > 255-byte field or a non-integer clock throws RechargeError('invalid_request') (RT-O-07). */
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
  existingEntitlement?: Entitlement | null;                // optional caller knowledge; decide() looks the replay up itself (A-33)
}
/**
 * Order: request validity (hostile shapes ⇒ deny, never a TypeError) → (free) campaign/counters validated like stored data →
 * campaign liveness/budget/hour-cap from counters → consumeChallenge → personhood.verify → tier/sizeBundle (0 ⇒ payment-required)
 * → keys (a malformed verifier nullifier ⇒ deny invalid-proof 'verifier_nullifier') → replay: this campaign's entitlement, this
 * campaign's claim record (survives the entitlement, RT-O-08) and the human's live lock of any claim day in the last 30 → actionCheck
 * → reserve the live lock + claim record create-if-absent (A-33; a lost race ⇒ deny replay 'claim_lock') → serve-free.
 * (paid) accepts deep-equality on the RAW echo incl. exact amount → strict parse; everything after uses ONLY the parsed payload
 * (RT-O-02) → session-nonce binding → verify (nonce_already_used continues to settle for the facilitator's front-run recovery, T-15)
 * → settle → settlement marker create-if-absent (one serve per tx, RT-O-05: a duplicate ⇒ 'nonce_already_used' or replay
 * 'settlement') → serve-paid. Persisted here: the consumed nonce, the claim locks and the settlement marker — never an entitlement.
 */
export function decide(req: DecideRequest, deps: OctroiDeps): Promise<Decision>;
export function buildAccepts(deps: Pick<OctroiDeps, 'accepts' | 'priceUsd6PerStep' | 'stepMb'>, mb: number): PaymentRequirements[];

export interface TopUpPolicy { maxUsd6PerDay: bigint; thresholdMb: number; stepMb: number; paused: boolean; topUpOnExpiry: boolean; expiryLeadS: number }
export type TopUpVerdict =
  | { buy: false; reason: 'ok' | 'paused' | 'cap' | 'expired' | 'already-bought-for-expiry' }
  | { buy: true; mb: number; reason: 'threshold' | 'expiry'; costUsd6: bigint };
/** Pure. 'expiry' only when expiresAt − now ≤ expiryLeadS×1000 and lastExpiryBought !== expiresAt; cap: spent + cost ≤ max (T-30). stepPrice ≤ 0, spent < 0 or a non-finite now ⇒ { buy: false, reason: 'ok' } (RT-O-07). */
export function shouldTopUp(e: Entitlement, p: TopUpPolicy, spentTodayUsd6: bigint, now: number, stepPriceUsd6: bigint, lastExpiryBought?: number): TopUpVerdict;
export function policyFromWire(w: TopUpPolicyWire): TopUpPolicy; export function policyToWire(p: TopUpPolicy): TopUpPolicyWire;

/**
 * Gift reclaim rule (D-7). Pure. The caller passes what it read: the escrow (null once expired), the receipts for giftId, and whether the
 * ledger answered. 'refund' only when: ledger ok ∧ gift receipt exists ∧ receipt.payer == payer ∧ no 'gift-claim' ∧ no 'gift-reclaim' ∧
 * escrow === null ∧ now ≥ claimBy ∧ now < claimBy + GIFT_RECLAIM_WINDOW_S×1000. Amount = usd6 − max(feeUsd6, 0); fee ≥ usd6 ⇒ deny 'nothing-to-refund' (A-39).
 */
export type GiftReclaimVerdict =
  | { kind: 'refund'; to: string; network: string; usd6: bigint; feeUsd6: bigint }
  | { kind: 'deny'; reason: 'too-early' | 'claimed' | 'already-reclaimed' | 'not-payer' | 'unknown-gift' | 'window-closed' | 'ledger-unavailable' | 'nothing-to-refund' };
export function decideGiftReclaim(input: {
  giftId: Hex; payer: string; now: number; escrow: Gift | null; receipts: Receipt[]; ledgerOk: boolean; feeUsd6: bigint;
}): GiftReclaimVerdict;

// store/ — the only code that builds annotations (ARCHITECTURE §8 rule 9)
export interface Found<T> { entityKey: string; payload: T; expiresAt: number | null; version: number }   // version: the CAS token (A-32)
// Every create is create-if-absent (duplicate ⇒ RechargeError('replay')); every read-modify-write (patch, markClaimed, upsert) is a
// compare-and-swap on a fresh read, retried up to 8 times (A-32, RT-O-03/06).
export class EntitlementStore {
  constructor(ledger: Ledger, now: () => number);
  getByKey(key: string): Promise<Found<Entitlement> | null>;   // by CAPABILITY: query {type, key: entitlementIndex(key)}; an 'hk:' index finds nothing (A-34); payload.key = the capability
  getByIccidHash(iccidHash: Hex): Promise<Found<Entitlement> | null>;   // server-internal: payload.key is the index
  create(e: Entitlement): Promise<LedgerPutResult>;            // stores annotation AND payload key = entitlementIndex(e.key)
  patch(key: string, patch: Partial<Entitlement> | ((current: Entitlement) => Partial<Entitlement>), opts?: { expiresAt?: number }): Promise<Found<Entitlement>>; // key: capability or index; function form for relative changes (A-38)
  expiringWithin(ms: number, limit?: number): Promise<Found<Entitlement>[]>;   // sponsor dashboard (index keys)
}
export class NonceStore { constructor(ledger: Ledger, now: () => number); consumed(nonce: Hex): Promise<boolean>; consume(c: Challenge, now: number): Promise<void> }  // consume: create-if-absent, a second ⇒ replay
export class ClaimStore { constructor(ledger: Ledger, now: () => number); held(key: string): Promise<boolean>; reserve(key: string, scope: ClaimLock['scope'], expiresAt: number): Promise<boolean> } // A-33
export function mayRegisterPolicy(input: { entitlement: Entitlement; existing: AgentPolicyWire | null; owner: string; sessionPubKey?: Hex }): 'ok' | 'not-owner' | 'holder-proof-required'; // A-35
export class GiftStore { constructor(ledger: Ledger, now: () => number); create(g: Gift): Promise<LedgerPutResult>; openByNamehash(namehash: Hex): Promise<Found<Gift>[]>; byPinKey(pinKey: Hex): Promise<Found<Gift> | null>; bySerial(serial: string): Promise<Found<Gift> | null>; markClaimed(giftId: Hex, entitlementKey: string): Promise<void> }
export class CampaignStore { constructor(ledger: Ledger, now: () => number); get(id: Hex): Promise<Found<Campaign> | null>; put(c: Campaign): Promise<LedgerPutResult>; list(): Promise<Found<Campaign>[]> }
export class ReceiptStore { constructor(ledger: Ledger, now: () => number); add(r: Receipt): Promise<LedgerPutResult>; forEntitlement(entitlementKeyHash: Hex): Promise<Receipt[]>; forCampaign(campaignId: Hex): Promise<Receipt[]>; spentUsd6(entitlementKeyHash: Hex, kind: Receipt['kind'], day: number): Promise<bigint>;
  byKindAndDay(kind: Receipt['kind'], day: number): Promise<Receipt[]>; spentUsd6ForDay(kind: Receipt['kind'], day: number): Promise<bigint>; patch(key: string, patch: Partial<Receipt>): Promise<Receipt> } // A-38
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

**Wave-1 red-team fixes (RT-C-01…07; `IDataDrop` above is unchanged; additions live in `DataDrop` and its ABI `abi/DataDrop.json`):**
- **Campaign ids (RT-C-02).** `scopedCampaignId(address sponsor, uint64 salt) pure → bytes32` = `sponsor (20 bytes) ‖ 0x00000000 ‖ salt (8 bytes)`. Only `sponsor` can `createCampaign` a scoped id (anyone else gets `NotSponsor()`), so it cannot be squatted or front-run. Any other id stays first come, never reusable and never overwritten. **Every production/demo campaign uses a scoped id**, and `services/api` and `scripts/demo-seed.ts` **pin `(id, sponsor)`** from config: a campaign whose on-chain `sponsor` differs is treated as `no-campaign` and never claimed against.
- **LEDGER_ONLY (RT-C-01).** `createCampaign` requires `ledgerSponsor(msg.sender)`, an owner-managed allow-list (`setLedgerSponsor(address,bool)` onlyOwner, event `LedgerSponsorSet(address indexed sponsor, bool allowed)`); otherwise `NotSponsor()`. Token mode stays permissionless. Every create in both modes also emits `CampaignFunded(bytes32 indexed id, address indexed funder, uint128 amount)`: tokens moved in token mode, a declaration by an allow-listed sponsor in LEDGER_ONLY (read `ModeSet` / `ledgerOnly()`).
- **Refund recipient (RT-C-03).** `refund(bytes32 id, address to)`: sponsor-only, `to != 0`, same eligibility rules as `refund(id)`.
- **`renounceOwnership()` (RT-C-06)** is `pure` and always reverts `RenounceDisabled()`.
- **Over-budget check (RT-C-07).** `claim` checks `price > budget − spent` first, so it reports `BudgetExhausted` across the whole `uint128` range.
- **HTS read-back.** `htsAssociated(address) → bool` (SUCCESS recorded by `associateHts`) and `isHtsAssociated(address) → bool` (the recorded flag, and the token's HIP-719 `isAssociated()` must not deny it [verify Wed]). `Deploy.s.sol` requires the latter after associating.
- **Extra errors in the ABI** (outside `DATADROP_ERRORS`): `ZeroAddress`, `HtsAssociationFailed(int64)`, `NotUsdc`, `BudgetNotReceived`, `RenounceDisabled`. **Extra events:** `HtsAssociated(address indexed token)`, `CampaignFunded`, `LedgerSponsorSet`.

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
  { "chainId": 31337, "network": "eip155:31337", "ledgerOnly": false, "dataDrop": "0x…", "usdc": "0x…", "usdcHts": "", "payout": "0x…", "attestor": "0x…", "owner": "0x…", "pendingOwner": "0x0000000000000000000000000000000000000000", "deployer": "0x…", "deployedAt": 1762171200, "txs": { "dataDrop": "0x…", "usdc": "0x…" } }
  ```
  `owner` is the **on-chain** `owner()` at deploy time. `pendingOwner` (added by RT-C-05) is the nominated cold owner that still has to call `acceptOwnership()`, or the zero address when there is none. On Hedera in token mode, `owner` is the deployer until the cold owner accepts. `CHAIN=<id> RPC_URL=… pnpm deploy:txs` refreshes both fields from the chain. Consumers (API `/healthz`, the drill) must treat a non-zero `pendingOwner` as "rotation key not yet in place".
- `deploy/chains.json` gains per chain `"usdc"` (EVM address or `""`) and `"usdcHts"` (`"0.0.429274"` on 296, else `""`). Keys stay alphabetical (`stdJson` decodes sorted).

---

## 7. `services/api` — HTTP contract (`@ethglobal/api`)

Base URL `NEXT_PUBLIC_API_URL` (local `http://127.0.0.1:8787`). JSON everywhere; `Content-Type: application/json` required on bodies; every response carries `X-Request-Id`; every non-2xx body is `errorBodySchema`; all mutations are `POST`/`PUT` (T-47). Schemas in §1.6.

| Method & path | Request | Success | Gate / notes |
|---|---|---|---|
| `GET /healthz` | — | `healthSchema` | exists |
| `GET /plans` | — | `plansResponseSchema` | public; cached 60 s |
| `POST /challenge` | `challengeRequestSchema` | `challengeSchema` | 10/min/IP; no ledger write |
| `POST /world/rp-context` | `rpContextRequestSchema` | `rpContextSchema` | 10/min/IP; no ledger write; signs with `WORLD_RP_SIGNING_KEY` (idkit-core `signRequest`, ttl 300 s); the PWA calls it after `/challenge` and before `IDKit.request` (A-25) |
| `POST /claim` | `claimRequestSchema` | `entitledResponseSchema` (201; 202 when `pending-profile`) | 5/min/IP; `octroi()` free lane; attestor `DataDrop.claim` |
| `GET /esim/provision?mb=&planId=` | header `PAYMENT-SIGNATURE` (optional), `X-Session-Pubkey` (required) | 402 `paymentRequiredSchema` + header `PAYMENT-REQUIRED`; or 201 `entitledResponseSchema` + header `PAYMENT-RESPONSE` | `octroi()` paid lane; nonce must equal `sessionNonce` |
| `GET /esim/topup?key=&mb=` | header `PAYMENT-SIGNATURE` (optional) | 402 …; or 200 `topUpResponseSchema` + `PAYMENT-RESPONSE` | per-ICCID daily cap `TOPUPS_PER_ICCID_PER_DAY` (default 20) |
| `POST /gift` | `giftRequestSchema` + optional `PAYMENT-SIGNATURE` | 402 …; or 201 `giftResponseSchema` + `PAYMENT-RESPONSE` | `names.resolve` **before** the 402 (T-43); 404 `name_unresolved` |
| `POST /gift/claim` | `giftClaimRequestSchema` | `entitledResponseSchema` | challenge path `/gift/claim`; EIP-712 `GiftClaim` by the **currently** resolved address, or PIN |
| `POST /gift/reclaim` | `giftReclaimRequestSchema` | `giftReclaimResponseSchema` | challenge path `/gift/reclaim`; EIP-712 `GiftReclaim` by the gift's `payer`; `decideGiftReclaim`; writes a pending `gift-reclaim` receipt **before** `treasury.refund`, patches the tx after; per-giftId mutex; `TREASURY_MAX_USD6_PER_DAY` |
| `GET /card/:serial` | — | `cardPreviewSchema` | read-only; 404 for unknown; constant-time |
| `POST /card/redeem` | `cardRedeemRequestSchema` | `entitledResponseSchema` | 10/min/IP; challenge path `/card/redeem`; campaign-funded cards call `DataDrop.claim` |
| `POST /webhooks/reseller/:provider` | raw body + provider headers (`esimaccess`: `?token=` = `ESIMACCESS_WEBHOOK_TOKEN`) | 204 | `reseller.verifyWebhook`; 401 on failure; 409 on replay; never 500; for `esimaccess` each event triggers an authoritative `reseller.usage(iccid)` read before any patch (A-27) |
| `GET /me/:key` | — | `meResponseSchema` | 60-s cache (read path only, T-51); `?refresh=1` polls `reseller.usage` ≤ 1/min/ICCID; 404 unknown; 410 `expired` |
| `GET /me/:key/receipts` | — | `receiptsResponseSchema` | ledger query |
| `GET /sponsor/:id` | header `Authorization: Recharge-Sponsor <base64 {sponsor, issuedAt, signature}>` | `sponsorViewSchema` | EIP-712 `SponsorLogin`, issuedAt within 1 h, signer == campaign sponsor |
| `POST /sponsor` | `sponsorRegisterSchema` | 201 `{ id, auditKey }` | signer == `campaign.sponsor` and == on-chain `campaigns(id).sponsor` |
| `POST /sponsor/:id/cards` | `sponsorCardsRequestSchema` `{ count ≤ 200, mb, auth: { sponsor, nonce, issuedAt, signature } }` | 201 `sponsorCardsResponseSchema` `{ campaignId, mb, claimBy, cards: [{ serial, pin, mb }] }` | **A-43.** The sponsor's write credential: EIP-712 `SponsorCards{campaignId, sponsor, count, mb, nonce, issuedAt}` (`SPONSOR_CARDS_TYPES`), issuedAt within 10 min (60 s future skew), signer == the registered and on-chain sponsor; a SponsorLogin (read bearer) is 401; nonce one-shot (409 `replay`); unpaused (423), unexpired, count ≤ (budget − spent) / pricePerClaim (409 `budget_exhausted`); 5 batches/min/campaign (429); not idempotent (a cached replay would re-show PINs); PINs only in this body, ledger keeps serial + PIN HMAC, log keeps the count; live and local |
| `PUT /agent/policy` | `agentPolicyPutSchema` | 200 `agentPolicyViewSchema` | EIP-712 `AgentPolicy`; owner must equal the entitlement's `payer` (paid) or be the first owner registered for a free entitlement |
| `GET /agent/policy/:key` | — | `agentPolicyViewSchema` | public read (policy is public on the ledger anyway) |
| `GET /facilitator/supported` · `POST /facilitator/verify` · `POST /facilitator/settle` | x402 facilitator API `{ x402Version, paymentPayload, paymentRequirements }` | `{ kinds, extensions: [], signers }` · `verifyResultSchema` · `settleResultSchema` | the self-run facilitator (EVM exact), also usable by third parties |
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
  AGENT_PAYTO_ALLOWLIST: z.string(),                  // comma list of `<network>|<asset>|<payTo>` (+ `|<feePayer>` on hedera:*, A-20) pinned from /plans at install time (T-56)
  AGENT_MAX_USD6_PER_STEP: digitsSchema.default('1000000'),
  AGENT_EVM_PRIVATE_KEY: hex32Schema.optional(),      // Anvil #4 locally; Base Sepolia key live
  AGENT_HEDERA_ACCOUNT_ID: hederaAccountSchema.optional(), AGENT_HEDERA_PRIVATE_KEY: z.string().optional(), // ECDSA (PrivateKey.fromStringECDSA); account associated with 0.0.429274
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
CLI: `recharge-agent [--once] [--dry-run] [--key <entitlementKey>]`. Live wallet: `@hashgraph/hedera-agent-kit@4.2.0` (`HederaAgentAPI`, core account/token/consensus plugins, `AgentMode.AUTONOMOUS`) for balance, association and the HCS receipt; the x402 payload itself comes from `@x402/hedera/exact/client` (`createClientHederaSigner` + `ExactHederaScheme`) wrapped as a `PaymentSigner`, because the Agent Kit does not speak x402 (A-22).

---

## 9. Event names, topics, headers — one list

- **Contract events:** `ModeSet(bool)`, `CampaignCreated(bytes32,address,uint128,uint96,uint32,uint64)`, `Claimed(bytes32,bytes32,uint96,uint64)`, `Paused(bytes32,bool,address)`, `Refunded(bytes32,uint128)`, `AttestorSet(address)`; `MockUSDC3009`: ERC-20 `Transfer`, `AuthorizationUsed`, `AuthorizationCanceled`.
- **HCS message types (`t`):** `claim`, `settle`, `gift`, `gift-claim`, `gift-reclaim`, `card-redeem`, `agent-topup`. One topic per deployment (`HCS_TOPIC_ID`), created by a human on Wed; agent messages carry `uaid`.
- **HTTP headers:** `PAYMENT-REQUIRED`, `PAYMENT-SIGNATURE`, `PAYMENT-RESPONSE`, `X-Session-Pubkey`, `X-Request-Id`, `Idempotency-Key`, `Authorization: Recharge-Sponsor …`, webhook `x-recharge-signature` / `x-recharge-timestamp` / `x-recharge-event-id` (mock reseller); eSIM Access outbound `RT-AccessCode` / `RT-Timestamp` (ms) / `RT-RequestID` / `RT-Signature` (A-27).
- **Ledger annotations:** §1.1 `ANN`; entity types §1.1 `ENTITY_TYPES`; logical key prefixes `ent:v1:`, `paid:`, `giftent:`, `gift:`, `nonce:`, `rcpt:`, `camp:`, `policy:`, `claim:` (A-33); entitlement index `hk:` (A-34).
- **Log events:** §1.10 `LOG_EVENTS`.
- **PWA ↔ API:** no cookies; the PWA stores `entitlementKey`s and opened LPAs in IndexedDB (device-local), never the session secret.

---

## 10. Fixture catalogue — `fixtures/`

Recorded exchanges: `{ "name", "recordedAt", "exchanges": [ { "request": { "method", "url", "headers"?, "body"? }, "response": { "status", "headers"?, "body" } } ] }`. `fixtureFetch` matches on method + URL (path + sorted query) and, with `strictBody`, on canonical JSON body.

| Path | Content | Recorded by |
|---|---|---|
| `fixtures/world/{verify-ok-v4,verify-ok-v3-legacy,verify-replayed,verify-all-failed,verify-malformed}.json`, `hash-to-field-vectors.json`, `rp-context-vector.json` | `POST /api/v4/verify/{rp_id}` exchanges (body = IDKit result unchanged); `hashToField` vectors from API-FACTS §4.2; one `signRequest` message/signature pair (A-25) | orchestrator from API-FACTS; Integrations Wed |
| `fixtures/facilitator/x402org/{supported,verify-ok,settle-ok,settle-nonce-used,verify-invalid}.json` | EVM exact (`eip155:84532`, `extra { name: "USDC", version: "2" }`) and Hedera kinds as listed by `https://x402.org/facilitator/supported` | orchestrator from the x402 spec @ 0e6e8c5; Wed |
| `fixtures/facilitator/hedera/{supported,verify-ok,settle-ok}.json` | Hedera exact (`hedera:testnet`, `extra.feePayer`, payload `{ transaction }`, settle `transaction` = `0.0.x@s.n`) from x402.org, fallback Blocky402 / Launa | orchestrator from `@x402/hedera@2.29.0`; Integrations Wed 14:00 |
| `fixtures/reseller/esimaccess/{balance,plans,order,query,query-pending,topup,usage,cancel,webhook-data-usage,webhook-check-health}.json` | eSIM Access open API with signed `RT-*` headers (A-27) | orchestrator from `esimaccess-api@b9421b3`; Integrations Wed (real `ac`, webhook body) |
| `fixtures/reseller/megaesim/README.md` only | no public API; stays empty unless the vendor supplies docs on-site (A-28) | Integrations, only if docs arrive |
| `fixtures/arkiv/{create,get,query,update,expired}.json` | `ArkivClientLike`-level exchanges for `@arkiv-network/sdk@1.0.1` on rabdi 7794095 (A-23) | orchestrator; Integrations Wed |
| `fixtures/hcs/{submit-receipt,mirror-messages,hcs14-vector}.json` | `@hiero-ledger/sdk` receipt shape, mirror REST page, one HCS-14 UAID vector computed with `@hashgraphonline/standards-sdk@0.1.192` (A-29) | orchestrator; Wed |
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
TREASURY_PRIVATE_KEY=          # a SEPARATE refund wallet (not PAYOUT_ADDRESS), funded ≤ TREASURY_MAX_USD6_PER_DAY, used ONLY for gift reclaims (EvmTreasury); local: Anvil #8 (`anvilRoles.treasury`, A-31)
TREASURY_HEDERA_ACCOUNT= TREASURY_HEDERA_PRIVATE_KEY=   # separate Hedera refund account (ECDSA, associated with 0.0.429274), same purpose
TREASURY_MAX_USD6_PER_DAY=50000000   # $50/day of reclaims; the API refuses beyond it (503 treasury cap, logged)
GIFT_RECLAIM_FEE_USD6=0        # deducted from a reclaim to cover the network fee (testnet: 0)
DATADROP_ADDRESS=              # optional override of deploy/addresses.<slug>.json
X402_FACILITATOR=self          # mock | self | remote (local default: self when ANVIL_RPC_URL answers, else mock)
X402_FACILITATOR_URL_EVM=https://x402.org/facilitator      # host must be in the allow-list (T-42): x402.org, api.testnet.blocky402.com, testnet.facilitator.launa.dev, localhost
X402_FACILITATOR_URL_HEDERA=https://x402.org/facilitator   # fallback https://api.testnet.blocky402.com (fee payer 0.0.7162784)
X402_NETWORKS=eip155:31337     # comma list of accepts[] networks; must ⊂ TESTNET_NETWORKS unless SALES_ENABLED=true and LEGAL_MEMO_OK=true (T-52)
PRICE_USD6_PER_STEP=400000     # $0.40 per 100 MB
VALIDITY_DAYS=7
TOPUPS_PER_ICCID_PER_DAY=20
SALES_ENABLED=false
LEGAL_MEMO_OK=false
TRUST_PROXY=0
CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:3000   # live: none by default, never localhost (A-42)
AGENT_PAYERS=                  # X-Agent-Uaid allow-list (T-77); local Anvil #4; live none, never Anvil (A-42)
STATE_FILE=                    # sealed durable API state; required in live, on a persistent volume (A-42)
HOST=127.0.0.1                 # listen address; MODE=local refuses non-loopback; live VPS sets 0.0.0.0 only without a reverse proxy (A-43)
PRINT_TOKEN=                   # protects /print/cards (T-64)
# Reseller
RESELLER=mock                  # mock | esimaccess | megaesim | inventory ; RESELLER_FALLBACK=inventory
ESIMACCESS_ACCESS_CODE= ESIMACCESS_SIGNING_KEY= ESIMACCESS_WEBHOOK_TOKEN= ESIMACCESS_BASE_URL=https://api.esimaccess.com/api/v1/open   # signing key defaults to the access code (A-27)
ESIMACCESS_WEBHOOK_IPS=3.1.131.226,54.254.74.88,18.136.190.97,18.136.60.197,18.136.19.137
# MegaeSIM: no variables — fixture-only stub (A-28); RESELLER=megaesim is refused in live
MOCK_RESELLER_WEBHOOK_SECRET=  # local webhook simulator
INVENTORY_FILE=fixtures/inventory.enc INVENTORY_SEAL_KEY=
# World (server side)
WORLD_APP_ID= WORLD_RP_ID= WORLD_RP_SIGNING_KEY= WORLD_ACTION=recharge-welcome WORLD_ENVIRONMENT=production WORLD_VERIFY_BASE_URL=https://developer.world.org   # signing key: Portal shows it once; server secret only (A-25)
# Arkiv — rabdi testnet; Kaolin (60138453025) is retired (A-23). tiramisu 7738577 is the configurable alternative if Arkiv judges ask for it.
ARKIV_CHAIN_ID=7794095 ARKIV_RPC_URL=https://rpc.rabdi.db-chain.testnet.arkiv.network ARKIV_WS_URL=wss://rpc.rabdi.db-chain.testnet.arkiv.network
ARKIV_ACCESS_KEY=              # hub.arkiv.network/access-keys; appended as the last RPC path segment (not a secret, never logged anyway)
ARKIV_PRIVATE_KEY= ARKIV_BLOCK_TIME_MS=2000 ARKIV_EXPLORER=https://rabdi.explorer.arkiv.network   # gas: tGLM from hub.arkiv.network/faucet
# Hedera / HCS
HEDERA_ACCOUNT_ID= HEDERA_PRIVATE_KEY= HCS_TOPIC_ID= HEDERA_MIRROR_URL=https://testnet.mirrornode.hedera.com   # ECDSA keys (PrivateKey.fromStringECDSA)
X402_HEDERA_FEE_PAYER=         # optional pin; must equal the facilitator's /supported extra.feePayer (x402.org advertises 0.0.9185802) (A-20)
# ENS
ENS_RPC_URL= ENS_FALLBACK_RPC_URL=
# Swarm
SWARM_BEE_URL= SWARM_POSTAGE_BATCH=
# Agent (see §8)
AGENT_API_URL=http://127.0.0.1:8787 AGENT_TICK_MS=5000 AGENT_WATCH_KEYS= AGENT_OWNER= AGENT_PAYTO_ALLOWLIST= AGENT_MAX_USD6_PER_STEP=1000000
AGENT_EVM_PRIVATE_KEY= AGENT_HEDERA_ACCOUNT_ID= AGENT_HEDERA_PRIVATE_KEY= AGENT_UAID= AGENT_DRY_RUN=0 AGENT_ONCE=0 LLM_PROVIDER=none
# Web (public)
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787 NEXT_PUBLIC_MODE=local NEXT_PUBLIC_ANVIL_RPC_URL=http://127.0.0.1:8545
NEXT_PUBLIC_WORLD_APP_ID= NEXT_PUBLIC_WORLD_ACTION=recharge-welcome NEXT_PUBLIC_WORLD_ENVIRONMENT=production NEXT_PUBLIC_EXPLORER_EVM= NEXT_PUBLIC_EXPLORER_HEDERA=https://hashscan.io/testnet NEXT_PUBLIC_ARKIV_EXPLORER=https://rabdi.explorer.arkiv.network
```
`services/api/src/env.ts` rejects: `MODE=live` with any Anvil key in `ATTESTOR_PRIVATE_KEY`/`RELAYER_PRIVATE_KEY`/`ARKIV_PRIVATE_KEY`; `LOG_LEVEL=debug|trace` in live; `OCTROI_SECRET` shorter than 32 bytes; `X402_NETWORKS` outside the testnet set without both sales flags; in live: `RESELLER=megaesim` (A-28), a missing `WORLD_RP_ID`/`WORLD_RP_SIGNING_KEY` (A-25), `ARKIV_CHAIN_ID=60138453025` (Kaolin, retired, A-23).

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
| A-18 | (scaffold, briefs, some prior art) x402 terms as `maxAmountRequired` and loose `PaymentRequired`/`SettleResult` shapes | x402 **v2**: `accepts[].amount` (atomic-unit digit string) is the only amount field; `PaymentRequired.extensions?`, `PaymentPayload.resource?`/`extensions?`; verify-failure `payer?`; settle-failure `transaction?` (`""`) and `payer?`; `settlement_pending` is non-terminal and carries the tx | `docs/vendor/API-FACTS.md` §1.3–1.5 (spec `x402@0e6e8c5` §5–7). `maxAmountRequired` is the v1 name; a v2 facilitator rejects it. The forbidden-pattern / semgrep sets should flag the string in app code. |
| A-19 | x402 implemented only by our codec; no reference packages named | reference packages pinned at **`@x402/{core,evm,hedera,fetch,hono}@2.29.0`** (catalog). `@ethglobal/protocol/x402` stays the **one** codec and loop in app code; `@x402/core` is a devDependency of `@ethglobal/protocol` for a conformance test (our encode ⇄ their decode, both directions, on every fixture); `@x402/hedera/exact/client` builds the Hedera payload in the agent (A-22); the legacy v1 packages (`x402`, `x402-hono`, `x402-fetch`, …) are banned | API-FACTS §1.1. Interop is proved against the reference, not asserted; one codec still owns the wire (no-duplication rule). |
| A-20 | Hedera exact payload `{ signedTransaction, memo }` `[verify Wed]`; Hedera facilitator "hedera-dev"; fee payer unspecified | network id **`hedera:testnet`** (never `hedera:296`/`eip155:296` for x402); asset HTS **`0.0.429274`**, 6 dp; `accepts[].extra.feePayer` = the facilitator's account (from `/supported` kinds `extra`; x402.org advertises `0.0.9185802`, Blocky402 `0.0.7162784`); payload **`{ transaction: <base64 partially-signed TransferTransaction> }`** with `transactionId.accountId == feePayer`; `maxTimeoutSeconds ≤ 180`; settlement tx id `0.0.x@s.n` read from `transaction` (fallback `transactionId`); payer **and** payee associated with the token; `payTo` a plain `0.0.x` (aliases rejected) | API-FACTS §1.6–1.7, §2.2 (`@x402/hedera@2.29.0`, `scheme_exact_hedera.md`). The schema now enforces `extra.feePayer` and the 180-s cap. |
| A-21 | eip3009 `domain()` comment "("USD Coin","2") on most chains"; Base Sepolia name unknown | per-chain EIP-712 domain is **data**: `USDC_EIP712_DOMAIN` in `@ethglobal/protocol/ids` — Base Sepolia **`"USDC"`**, mainnets `"USD Coin"`, version `"2"`; the API puts it in `accepts[].extra`; `@ethglobal/eip3009` gains `domainFromRequirements(req)` and every exact-EVM payload builder (PWA, agent, `paymentPayload()` test builder, `SelfRunFacilitator`) takes the name from `extra`, cross-checked with `readDomain()` where an RPC answers; `MockUSDC3009` stays `"USD Coin"` | API-FACTS §1.3, §1.8, §7 (`FiatTokenV2_2._domainSeparator`, x402 `defaultAssets.ts`). A hard-coded "USD Coin" produces a signature Base Sepolia rejects. |
| A-22 | `@hashgraph/sdk`; `hedera-agent-kit` (v3 toolkit) | Hedera SDK **`@hiero-ledger/sdk@2.90.1`**, imported through `@x402/hedera`'s re-exports (one SDK copy; `pnpm why @hiero-ledger/sdk` shows one); keys via `PrivateKey.fromStringECDSA`; Agent Kit **`@hashgraph/hedera-agent-kit@4.2.0`** (`HederaAgentAPI` + core plugins, `AgentMode.AUTONOMOUS`; `RETURN_BYTES` for human-in-the-loop) — the Agent Kit is the agent's wallet and HCS tool, `@x402/hedera` produces the x402 payload | API-FACTS §2.5–2.6: `@hashgraph/sdk` stopped at 2.81.0; unscoped `hedera-agent-kit` 3.8.2 is deprecated; two SDK copies break `instanceof`. |
| A-23 | Arkiv **Kaolin**, chain `60138453025`; ETH faucet | Arkiv SDK **`@arkiv-network/sdk@1.0.1`**, default network **rabdi** (chain **7794095**, `https://rpc.rabdi.db-chain.testnet.arkiv.network/<accessKey>`, explorer `rabdi.explorer.arkiv.network`, gas **tGLM** from `hub.arkiv.network/faucet`, access key from `hub.arkiv.network/access-keys`); tiramisu 7738577 configurable if Arkiv judges ask; **Kaolin is retired — removed everywhere** (env, briefs, DISCLOSURE template, checklists) and refused by `env.ts`; Arkiv is not a `DataDrop` target, so `deploy/chains.json` gets no Arkiv record | API-FACTS §3.1–3.2 (`arkiv-sdk@1.0.1 src/chains/rabdi.ts`, `db-chain-networks@8af442e`). DECISION §6.6/§7.2/§7.3 say "Kaolin"; read rabdi there (the committee text is not edited). |
| A-24 | Ledger `expiresIn` seconds → BTL blocks passed as `expiresIn` | the port keeps `expiresIn` (seconds); `ArkivLedger` maps it to **`expiration: ExpirationTime.fromSeconds(ceil(s / 2) × 2)`** (whole 2-s blocks, rounded up), rejects `> 7,884,000 × 2 s` (~182.5 d) with `invalid_request`, reads expiry from `$expiresAt` (a block number) → ms; one `defineSchema('recharge.<type>.v1', …)` per `ENTITY_TYPES` entry: payload = non-indexed `bytes()`, `ANN.*` = indexed `str()`, `expiresAt` = indexed `u64()`; queries via `select().from(schema).where(and(eq…))`, ≤ 100 rows per page, paginated by `$key` | API-FACTS §3.3: the old `expiresIn`/BTL option is gone from the SDK. Expiry stays load-bearing (T-35). |
| A-25 | IDKit "current major"; v2 proof `{ proof, merkle_root, nullifier_hash, verification_level }`; `POST /api/v2/verify/{app_id}`; "Agent Pass" | **`@worldcoin/idkit@4.6.0` / `@worldcoin/idkit-core@4.6.0`** (never `^2`/`^3`; `idkit-standalone` is discontinued). IDKit 4 needs a **backend-signed `rp_context`**: new route `POST /world/rp-context` (`signRequest` from `@worldcoin/idkit-core/signing`, `WORLD_RP_SIGNING_KEY` server-only, ttl 300 s). The PWA: `/challenge` → `/world/rp-context` → `IDKit.request({ app_id, action, rp_context, allow_legacy_proofs: true, environment }).preset(documentLegacy({ signal: challenge.signal }))` (preset choice `[verify Wed]` with World) → forwards the result **unchanged**. Verify: **`POST https://developer.world.org/api/v4/verify/{rp_id}`**; assert `success`, `action`, `environment`, every `signal_hash == hashToField(signal)`; level from the response identifier; decimal nullifier → hex32. **"Agent Pass" has no public docs**: World's product is AgentKit (beta, an x402 `agentkit` extension on World Chain); not built in v0, the "IDKit humans only" label stays | API-FACTS §4.1–4.6 (`developer-docs@b07e972`, `idkit-core@4.6.0` types). The v2 endpoint pairs only with the v2 widget. |
| A-26 | `personhoodProofSchema` (v2 fields); `fixtureProof` encodes the signal in proof bytes | `personhoodProofSchema` = IDKit 4 V4/V3 union, `.loose()`; `rpContextSchema`, `rpContextRequestSchema`, `IDENTIFIER_LEVEL` / `verificationLevelFromIdentifier` (the one identifier → level map) added (§1.6); `fixtureProof` builds an IDKit-shaped result with `signal_hash = hashToField(signal)` and `MockPersonhood({ expectSignal })` checks that, as the live verifier does | follows A-25; the mock must enforce what production enforces (T-19). |
| A-27 | eSIM Access: `RT-Signature = HMAC(secret, …)`; webhooks "signed with the same RT-* headers"; order body with `amount`/`price`; usage by ICCID | eSIM Access is the **primary** reseller. Outbound: `RT-AccessCode`, `RT-Timestamp` (ms), `RT-RequestID` (uuid), `RT-Signature` = lower-case hex HMAC-SHA256(key = accessCode by default, `timestamp + requestId + accessCode + rawBody`); 8 req/s client limiter; `/esim/order { transactionId, packageInfoList:[{ packageCode, count:1 }] }`, poll `/esim/query` every 3 s ≤ 30 s (empty `ac` ⇒ `pending-profile`); top-up needs `esimTranNo` (resolved by `/esim/query { iccid }`) and a top-up `packageCode` from `/package/list { iccid }`; error codes `101003/401001 → unauthorized`, `200007 → unavailable`, `310402 → re-query`. **Webhooks carry no documented signature**: `verifyWebhook` checks a URL token (`ESIMACCESS_WEBHOOK_TOKEN`) + the documented sender IPs + a body-hash replay cache, and the API treats each event as a hint, re-reading `reseller.usage(iccid)` before any patch; `CHECK_HEALTH` → 204 | API-FACTS §5.1 (`esimaccess-api@b9421b3`). An unsigned webhook must never move a balance on its own numbers (T-34). |
| A-28 | MegaeSIM primary with an "instant sandbox" | MegaeSIM has **no public API docs**: `MegaEsimReseller` is a **fixture-only stub** (throws `unavailable`; contract suite skipped until a vendor-supplied recording exists); `liveConfigSchema`/`env.ts` refuse `RESELLER=megaesim`. Chain: `RESELLER=esimaccess`, `RESELLER_FALLBACK=inventory` (`InventoryReseller` over the sealed pre-bought file) | API-FACTS §5.2 (two searches, Nov 2026). The round-3 sandbox claim is unverified. |
| A-29 | `hcs14Uaid` = sha256 of canonical JSON, string skills, no `uid` | `id = base58(sha384(JSON.stringify({ skills, name, nativeId, protocol, registry, version })))` with exactly that key order, skills sorted **integers**; `uaid:aid:<id>;uid=0;registry=…;nativeId=<CAIP-10 hedera:testnet:0.0.x>;proto=…`; conformance against `@hashgraphonline/standards-sdk@0.1.192` `createUaid` | API-FACTS §2.7 (`standards-sdk@04f97c8:src/hcs-14`). |
| A-30 | `GET /facilitator/supported` → `{ kinds }`; remote facilitator allow-list `x402.org, *.hedera.com` | our self-run `supported` returns the v2 shape `{ kinds, extensions: [], signers: { "eip155:*": [relayer] } }`; remote allow-list = `x402.org`, `api.testnet.blocky402.com`, `testnet.facilitator.launa.dev`, `localhost`; default URL for both EVM and Hedera is `https://x402.org/facilitator`, Blocky402 the Hedera fallback | API-FACTS §1.5–1.6. |
| A-31 | treasury = the payout key (`TREASURY_PRIVATE_KEY` = key of `PAYOUT_ADDRESS`) | the treasury is a **separate** refund wallet (EVM and Hedera), funded with at most one day's `TREASURY_MAX_USD6_PER_DAY`; `payout` keys never sit on the API host | red team `PLAN.md` §9 / T-71: a compromised API must not be able to drain the payout balance; the drain bound becomes the treasury float. |
| A-32 | (§3.1) the Ledger port has `put/get/query/update` and nothing atomic; stores check-then-put (RT-O-03 A-L6) | **Atomic primitives on the port** (adapters): `LedgerPutInput.ifAbsent` (create-if-absent on (type, key)), `LedgerEntity.version` (1 on put, +1 per update), `update(key, { …, ifVersion })` (compare-and-swap); failure = `AdapterError('ledger','conflict')` (new code, protocol `ADAPTER_CODE_MAP.conflict → 'replay'`). `InMemoryLedger` implements both atomically; `ArkivLedger` serialises per key in-process and, across processes, re-reads after create (oldest (createdAt, key) wins, the loser tombstones its own row with `expiresAt = 1`) and stores the version as a `rev` u64 attribute (schema column optional; legacy rows read as 1) **[verify Wed]**. `describeLedger` gains five contract tests both adapters pass. octroi: every `Repo.create` is ifAbsent, every read-modify-write is CAS with ≤ 8 retries; payment payload branches are `z.strictObject` | red team RT-O-03/05/06: "no atomic create" is the root of the double gift redemption, the lost top-up and the multi-instance nonce double-consume. Arkiv has no conditional write, so the cross-process guarantee is best effort and THREAT-MODEL §8 states one API writer process for wave 2. |
| A-33 | decide() persists nothing but the consumed nonce; the replay check is the caller's `existingEntitlement` / `counters.claimed` | protocol: `ENTITY_TYPES += 'claim'`, `claimSchema { v, key: 'claim:…', scope: 'free-live' \| 'free-campaign' \| 'settlement', expiresAt }`, `keys.claim(digest)`, `KEY_PREFIXES.claim`. octroi `ClaimStore`; decide() writes, create-if-absent, (free) the human's **live lock** `claim:HMAC(secret,'live'‖quotaKey‖claimDay)` until the entitlement's expiresAt and the **campaign claim record** `claim:HMAC(secret,'claimed'‖campaignId‖quotaKey)` until the campaign ends (≤ 180 d), and checks the live locks of the last 30 claim days (31 parallel reads) and the record itself; (paid) the **settlement marker** `claim:HMAC(secret,'settle'‖network‖tx)` for RECEIPT_TTL_S | RT-O-03 (two campaigns served concurrently), RT-O-05 (one payment, two serves), RT-O-08 (`counters.claimed` unknowable before verify). Day-keyed live locks keep two campaigns' entities unlinkable (A-9) while still giving one live free bundle per human. A saga failure after serve-free keeps the human's slot until the would-be expiry (fail closed; stated in octroi README). |
| A-34 | `ANN.key = ent:v1:<quotaKey>` / `paid:<payer>:<nonce>` in clear on the public ledger; one global free key across campaigns | **Capability ≠ index.** `EntitlementStore` writes annotation AND payload `key = entitlementIndex(key) = 'hk:' + sha256(utf8(key))` (= receipts' `entitlementKeyHash`); `getByKey(capability)` hashes first and refuses an `hk:` index (the `/me/:key` check); `patch` accepts either (server-internal webhook path). Free key = `ent:v1:HMAC(secret,'entfree'‖campaignId‖nullifier)` (per campaign); paid key = `paid:<payer>:HMAC(secret,'paid'‖network‖payer‖nonce)`. API `MeCache` is keyed by the index. `quotaKey` never leaves the process | RT-O-01 (T-37, T-73, A-9). sha256 (not an HMAC) because every store instance (API, agent, tests) must index identically without the secret, and every capability is ≥ 256 bits of HMAC output. Residuals (octroi README): `giftent:<giftId>` is derivable from the public gift entity; `AgentPolicy.entitlementKey` is still stored in clear (the agent's watch list needs it). |
| A-35 | first registered owner wins a free entitlement's agent policy (T-73 b, open) | `entitlementSchema.holderHash?` = sha256(utf8(key) ‖ sessionPubKey), set by decide() on free entitlements; `agentPolicyPutSchema.sessionPubKey?`; octroi `mayRegisterPolicy()` — paid: the payer; existing policy: its owner; first registration of an entitlement with a holderHash: only with the claiming session's pubkey. Wired in `services/api` PUT /agent/policy (401 `sessionPubKey of the claiming session required`) | coordinator follow-up (c). **PWA follow-up:** keep the claim session's PUBLIC key (never the secret) with the entitlement and send it on the first PUT. |
| A-36 | `RECEIPT_TTL_S = 30 d` | `RECEIPT_TTL_S = GIFT_CLAIM_WINDOW_S + GIFT_RECLAIM_WINDOW_S + 1 d = 38 d` | T-71e: the reclaim window runs to day 37; a day-31 reclaim found no 'gift' receipt (404 unknown-gift). |
| A-37 | nonce entity `expiresIn: CHALLENGE_TTL_S` | `NONCE_TTL_S = 300` (≥ TTL + 5 s skew guard + > 10 % ledger drift); `nonceSchema.issuedAt?` (exp − TTL); `now == exp` is still accepted (the entity outlives it) | RT-O-04: a +5 s issuer, a 6 % fast ledger and the `now == exp` boundary each re-opened a fresh-cache replay. The finding (and its tests) keep `now > exp ⇒ expired`. |
| A-38 | `ReceiptStore` has no patch and no by-day query (the API kept the treasury cap in memory); `EntitlementStore.patch` merges a static object | `ReceiptStore.patch(key, Partial<Receipt>)` (CAS), `byKindAndDay(kind, day)`, `spentUsd6ForDay(kind, day)`; `EntitlementStore.patch` also takes `(current) => Partial<Entitlement>`, computed from each fresh row | coordinator follow-up (d); relative top-ups (`mbTotal + mb`) cannot lose a concurrent one. |
| A-39 | `decideGiftReclaim` refunds `usd6 − min(fee, usd6)` (0 when fee ≥ paid) | fee ≥ paid ⇒ `deny 'nothing-to-refund'` (API: 410 `expired`) | RT-O-09: a 0n transfer still costs treasury gas and writes a receipt. |
| A-40 | decide() validates a parsed copy of the payment and uses the raw one; verify `nonce_already_used` ends the paid lane | decide() uses ONLY the strictly parsed payload after the raw accepted-echo compare; verify `nonce_already_used` continues to settle (the facilitator's front-run recovery), deduped by the A-33 settlement marker | RT-O-02 (decoy `authorization` beside a Hedera `transaction`), T-15 (a front-run human payment answered 402). |
| A-41 | decide()/challenge()/shouldTopUp trust their numbers | decide(): hostile request/payment/proof shapes ⇒ deny `invalid-request` (`request`/`payment`/`proof`); campaign validated with `campaignToPayload` (⇒ `campaign`), counters integers/bigints ≥ 0 (⇒ `counters`), a malformed verifier nullifier ⇒ `invalid-proof 'verifier_nullifier'`; challenge() throws `RechargeError('invalid_request')` (no RangeError); consumeChallenge with a non-integer clock ⇒ `'invalid'`; shouldTopUp: price ≤ 0 / spent < 0 / non-finite now ⇒ no buy | RT-O-07 (ARCHITECTURE §9 rule 2). |
| A-42 | API state that must survive a restart (pending deliveries, T-24 intents, treasury day, "audit key shown") lived in process memory; one-time API events (a gift's LPA delivered, a campaign registered) had no ledger marker | protocol: `claimSchema.scope += 'once'` (an API once-only marker, `claim:` + HMAC, unlinkable). services/api: once-markers for gift delivery, sponsor registration and audit-key display; treasury day = `ReceiptStore.spentUsd6ForDay('gift-reclaim', day)`; pending deliveries and T-24 intents in a sealed local `STATE_FILE` (required in live); env: live requires `CHAIN` (≠ 31337) and `STATE_FILE`, `CORS_ORIGINS`/`AGENT_PAYERS` default to none and refuse localhost / Anvil; paid accepts carry `extra.resource` = the route path | red team wave 2 RT-A-04, RT-A-06, RT-A-08, RT-A-09, RT-A-11. Intents hold capability keys, so they never reach the world-readable ledger; one API writer process per deployment (THREAT-MODEL §8) keeps the file single-writer. |
| A-43 | campaign-funded scratch cards exist only through the MODE=local `X-Seed-Card-Campaign` hook; the API binds every interface; no local ledger dump | services/api: `POST /sponsor/:id/cards` (§7) mints ≤ 200 `kind: 'card'`, `fundedBy: 'campaign'` escrows per call under a fresh EIP-712 `SponsorCards` by the campaign's sponsor (protocol: `SPONSOR_CARDS_TYPES`, `SPONSOR_CARDS_TTL_MS = 600 000`, `SPONSOR_CARDS_MAX = 200`, `sponsorCardsRequestSchema`, `sponsorCardsResponseSchema`); `scripts/print-cards.ts --mint` signs it with the Foundry keystore (live) or the Anvil sponsor role (local). env `HOST` (default `127.0.0.1` in every mode; `MODE=local` refuses a non-loopback value; a live VPS without a reverse proxy sets `0.0.0.0` explicitly). `GET /__local/ledger` (MODE=local only, beside `/__local/clock`) returns every ledger entity for `scripts/dump-ledger.ts` | red team wave 3 RT-P-08 (Thursday's 200 printed cards had no live path), RT-P-01 (the demo stack's `/__local/*` on venue Wi-Fi), RT-P-09 (BUILD-PLAN §4 I-18 dump). Write ≠ read credential, as RT-A-04 set for registration. |

---

## 14. The interfaces workstream (how this file becomes code; 2 agent-hours, lands first in wave 1)

**Create:** `packages/protocol/{package.json,tsconfig.json,tsconfig.build.json,src/index.ts,src/ids.ts,src/units.ts,src/errors.ts,src/events.ts,src/http.ts,src/x402.ts,src/typed-data.ts,src/pin.ts,src/schemas/{index,common,entities,x402,api,webhooks,hcs}.ts,test/*.test.ts}`; `packages/crypto/*` **complete** (§2 is ~150 lines of `@noble` wrappers and octroi needs it on day one; tests: seal/open round trip, wrong key, wrong AAD, flipped byte, 10⁴ distinct nonces, webhook MAC ±299/±301 s, ms timestamp rejected, HMAC vectors); `packages/eip3009/*` skeleton (package.json, tsconfig, `src/index.ts` exporting the §4 signatures as `throw new Error('not implemented')` stubs so dependants compile — the adapters-live workstream implements it); `packages/adapters/src/types.ts` edits (§3.1), `src/index.ts` re-exports, `package.json` subpath exports (`./live`, `./testing`), `src/testing/index.ts` with `fakeClock`, `T0`, `anvilAccounts`/`anvilKeys`/`anvilRoles`, `loadFixture`, `fixtureFetch`, `paymentPayload`, `requirementInput`, `fixtureProof`; `eslint.config.js` zones (§12) and a `no-restricted-syntax` rule banning bare `fetch(` outside `packages/protocol/src/http.ts` and `packages/adapters/src/testing/`; `.env.example` additions (§11); `pnpm-workspace.yaml` catalog entries for `zod`, `viem`, `@noble/*`, `fast-check`, `@playwright/test`, and the vendor pins of A-19…A-25 (`@x402/core|evm|hedera|fetch|hono: 2.29.0`, `@arkiv-network/sdk: 1.0.1`, `@hiero-ledger/sdk: 2.90.1`, `@hashgraph/hedera-agent-kit: 4.2.0`, `@worldcoin/idkit: 4.6.0`, `@worldcoin/idkit-core: 4.6.0`, `@hashgraphonline/standards-sdk: 0.1.192`) and `minimumReleaseAge: 3 days` (T-65); `.jscpd.json` unchanged (1 %).

**Tests (vitest):** every schema accepts its fixture example and rejects one mutation per field class; `units`: `usd6('0.40') === 400000n`, `formatUsd6(400000n) === '$0.40'`, `priceUsd6(300, 100, 400000n) === 1200000n`, `assertMbStep(199, 100, 3000)` throws `invalid_request`, `mbFromBytes(1_073_741_824) === 1073`; `x402`: header round-trips, `decodePaymentPayload` rejects > 16 KiB and a payload whose `accepted.payTo` mismatches its network, `fetchWithPayment` signs at most once and surfaces `PAYMENT-RESPONSE`; `pin`: Verhoeff vectors, 10⁴ generated PINs all valid and distinct; `typed-data.canonicalJson` is stable under key order; `errors`: every code has a status and every `ADAPTER_CODE_MAP` value is a code.

**Definition of done:** `pnpm -r build && pnpm lint && pnpm typecheck && pnpm test && pnpm dupcheck` green; `apps/web` builds importing `@ethglobal/protocol` (no Node built-ins leak); the scaffold's adapter tests still pass with types re-exported from protocol; `docs/INTERFACES.md` §1 code blocks and `packages/protocol/src` agree (a reviewer diffs them).
