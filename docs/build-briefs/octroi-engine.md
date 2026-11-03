# Build brief — `octroi-engine` (wave 1)

**You are building:** `packages/octroi` (`@ethglobal/octroi`) — the proof-or-pay quota engine inside Recharge: credential tiers, bundle sizing, pseudonymous keys, challenges, the `decide()` function that turns a request into *serve free / serve paid / 402 / deny*, the agent's `shouldTopUp`, the gift-reclaim rule, and the ledger stores that every service uses to read and write Arkiv entities. Pure TypeScript: no network, no clock, no randomness except through injected ports and functions. **100 % line and branch coverage is the bar**, plus property tests.

**Read first:** this brief; `docs/INTERFACES.md` §0.1, §1.1–1.4 (ids, units, entity schemas), §3.1 (the ports you receive), §5 (your public surface — copied below verbatim) and §13; `docs/THREAT-MODEL.md` §5.3 (T-18…T-30) and T-32, T-35, T-36, T-37; `docs/ARCHITECTURE.md` §2 (the flows that call you) and §5.1.

**Toolchain:** TypeScript 5.9 strict (`tsconfig.base.json`: `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`), ESM with `.js` import suffixes, vitest 5.1 (`catalog:`), `fast-check` for properties, build to `dist/` like `@ethglobal/adapters`. Lint: root eslint flat config (import ordering, type-aware rules), prettier, jscpd 1 %.

---

## 1. Where octroi sits

```
services/api ─┐                       ┌── Ledger (InMemoryLedger | ArkivLedger)
services/agent┼──▶ @ethglobal/octroi ─┼── Personhood (MockPersonhood | WorldCloudPersonhood)
scripts/      ─┘   rules + stores     └── PaymentRail (MockPaymentRail | SelfRunFacilitator | RemoteFacilitator)
```
You never know whether you are talking to a mock or to Kaolin. You import **types** and the **mocks for tests** from `@ethglobal/adapters` (root export only — never `@ethglobal/adapters/live`), schemas and constants from `@ethglobal/protocol`, HMAC/keccak/random from `@ethglobal/crypto`. Nothing imports you except the API, the agent and scripts.

## 2. Files

```
packages/octroi/package.json              // name @ethglobal/octroi; exports ".", "./store"; deps: @ethglobal/protocol, @ethglobal/crypto, @ethglobal/adapters; dev: fast-check, vitest, typescript
packages/octroi/tsconfig.json             // extends ../../tsconfig.base.json; include src, test
packages/octroi/tsconfig.build.json
packages/octroi/vitest.config.ts          // coverage: provider v8, thresholds { lines: 100, branches: 100, functions: 100, statements: 100 }
packages/octroi/src/index.ts              // barrel for §3
packages/octroi/src/tier.ts               // tierFromLevel
packages/octroi/src/campaign.ts           // Campaign, CampaignCounters, campaignFromPayload/ToPayload
packages/octroi/src/keys.ts               // quotaKey, auditKey, campaignClaimKey, onchainClaimKey
packages/octroi/src/size.ts               // sizeBundle
packages/octroi/src/challenge.ts          // challenge, signalFor, verify, consumeChallenge
packages/octroi/src/decide.ts             // decide, buildAccepts
packages/octroi/src/topup.ts              // TopUpPolicy, shouldTopUp, policyFromWire/ToWire
packages/octroi/src/gift.ts               // decideGiftReclaim
packages/octroi/src/store/index.ts
packages/octroi/src/store/common.ts       // annotation builders, expiry semantics (isLive), parse helpers
packages/octroi/src/store/entitlement.ts  // EntitlementStore
packages/octroi/src/store/nonce.ts        // NonceStore
packages/octroi/src/store/gift.ts         // GiftStore
packages/octroi/src/store/campaign.ts     // CampaignStore
packages/octroi/src/store/receipt.ts      // ReceiptStore
packages/octroi/src/store/agent-policy.ts // AgentPolicyStore
packages/octroi/test/{tier,keys,size,challenge,decide,topup,gift}.test.ts
packages/octroi/test/store/{entitlement,nonce,gift,campaign,receipt,agent-policy}.test.ts
packages/octroi/test/property/{size.prop,budget.prop,topup.prop,challenge.prop}.test.ts
packages/octroi/test/helpers.ts           // builds OctroiDeps from createAdapters('local', { now, personhood: { expectSignal: true } }) + fixtureProof; NO duplicate of @ethglobal/adapters/testing
packages/octroi/README.md                 // the decision table (§4.5 below) rendered for humans
```

## 3. Public interface (verbatim from `docs/INTERFACES.md` §5)

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
export function decide(req: DecideRequest, deps: OctroiDeps): Promise<Decision>;
export function buildAccepts(deps: Pick<OctroiDeps, 'accepts' | 'priceUsd6PerStep' | 'stepMb'>, mb: number): PaymentRequirements[];

export interface TopUpPolicy { maxUsd6PerDay: bigint; thresholdMb: number; stepMb: number; paused: boolean; topUpOnExpiry: boolean; expiryLeadS: number }
export type TopUpVerdict =
  | { buy: false; reason: 'ok' | 'paused' | 'cap' | 'expired' | 'already-bought-for-expiry' }
  | { buy: true; mb: number; reason: 'threshold' | 'expiry'; costUsd6: bigint };
export function shouldTopUp(e: Entitlement, p: TopUpPolicy, spentTodayUsd6: bigint, now: number, stepPriceUsd6: bigint, lastExpiryBought?: number): TopUpVerdict;
export function policyFromWire(w: TopUpPolicyWire): TopUpPolicy; export function policyToWire(p: TopUpPolicy): TopUpPolicyWire;

export type GiftReclaimVerdict =
  | { kind: 'refund'; to: string; network: string; usd6: bigint; feeUsd6: bigint }
  | { kind: 'deny'; reason: 'too-early' | 'claimed' | 'already-reclaimed' | 'not-payer' | 'unknown-gift' | 'window-closed' | 'ledger-unavailable' };
export function decideGiftReclaim(input: {
  giftId: Hex; payer: string; now: number; escrow: Gift | null; receipts: Receipt[]; ledgerOk: boolean; feeUsd6: bigint;
}): GiftReclaimVerdict;

// store/ — the only code that builds annotations
export interface Found<T> { entityKey: string; payload: T; expiresAt: number | null }
export class EntitlementStore {
  constructor(ledger: Ledger, now: () => number);
  getByKey(key: string): Promise<Found<Entitlement> | null>;   // query {type:'entitlement', key}; expired if gone OR annotations.expiresAt < now (T-35)
  getByIccidHash(iccidHash: Hex): Promise<Found<Entitlement> | null>;
  create(e: Entitlement): Promise<LedgerPutResult>;
  patch(key: string, patch: Partial<Entitlement>, opts?: { expiresAt?: number }): Promise<Found<Entitlement>>;
  expiringWithin(ms: number, limit?: number): Promise<Found<Entitlement>[]>;
}
export class NonceStore { constructor(ledger: Ledger, now: () => number); consumed(nonce: Hex): Promise<boolean>; consume(c: Challenge, now: number): Promise<void> }
export class GiftStore { constructor(ledger: Ledger, now: () => number); create(g: Gift): Promise<LedgerPutResult>; openByNamehash(namehash: Hex): Promise<Found<Gift>[]>; byPinKey(pinKey: Hex): Promise<Found<Gift> | null>; bySerial(serial: string): Promise<Found<Gift> | null>; markClaimed(giftId: Hex, entitlementKey: string): Promise<void> }
export class CampaignStore { constructor(ledger: Ledger, now: () => number); get(id: Hex): Promise<Found<Campaign> | null>; put(c: Campaign): Promise<LedgerPutResult>; list(): Promise<Found<Campaign>[]> }
export class ReceiptStore { constructor(ledger: Ledger, now: () => number); add(r: Receipt): Promise<LedgerPutResult>; forEntitlement(entitlementKeyHash: Hex): Promise<Receipt[]>; forCampaign(campaignId: Hex): Promise<Receipt[]>; spentUsd6(entitlementKeyHash: Hex, kind: Receipt['kind'], day: number): Promise<bigint> }
export class AgentPolicyStore { constructor(ledger: Ledger, now: () => number); get(entitlementKey: string): Promise<Found<AgentPolicyWire> | null>; put(p: AgentPolicyWire): Promise<LedgerPutResult>; all(): Promise<Found<AgentPolicyWire>[]> }
```

## 4. Algorithms (normative)

### 4.1 `sizeBundle` — integer only
```
if tier ∈ {device, none} or bundleMb[tier] == 0 → 0
cap = MAX_BUNDLE_MB (300)
if wholesaleUsd6PerGb ≤ 0n → min(bundleMb[tier], cap)
// 0.8 × idResale / (wholesale / 1000) = (8 × idResale × 1000) / (10 × wholesale)
evMb = Number((8n * idResaleUsd6 * 1000n) / (10n * wholesaleUsd6PerGb))     // bigint floor division
return min(bundleMb[tier], evMb, cap)
```
Checks: `$1.14/GB, $0.50 ⇒ evMb = 350 ⇒ min(300, 350, 300) = 300`; `$2.50/GB ⇒ 160`; `$5/GB ⇒ 80`. Property: for orb/document, `mb × wholesale / 1000 ≤ 0.8 × idResale` (in Usd6 integer arithmetic) and `0 ≤ mb ≤ 300`.

### 4.2 Keys
`quotaKey = hmacKey(secret, 'quota', hexToBytes(nullifier))`; `auditKey = hmacSha256(secret, 'audit', hexToBytes(campaignId))`; `campaignClaimKey = hmacKey(audit, hexToBytes(nullifier))`; `onchainClaimKey = keccak256(concat(hexToBytes(campaignId), hexToBytes(cck)))` — exactly `keccak256(abi.encodePacked(bytes32 id, bytes32 cck))`, so `DataDrop.claimed(id, onchainClaimKey)` is the chain-side replay check. All inputs are lower-cased before hashing. The nullifier substring must never appear in any output (test).

### 4.3 Challenge
```
random16 = randomBytes(16); tag = hmacSha256(secret, random16, audience, path, uint64be(exp), hexToBytes(sessionPubKey)).slice(0, 16)
nonce = bytesToHex(concat(random16, tag)); signal = keccak256(concat(hexToBytes(nonce), utf8(audience)))
consumeChallenge:
  1. recompute tag from c.nonce[0..16], c.audience, c.path, c.exp, sessionPubKey → mismatch ⇒ 'invalid' (covers a swapped session key, T-32; covers audience/path confusion, T-21)
  2. now > c.exp ⇒ 'expired'; c.exp − now > CHALLENGE_TTL_S×1000 + 5_000 ⇒ 'invalid' (clock-skew guard)
  3. SYNCHRONOUSLY: if cache.has(nonce) ⇒ 'replayed'; cache.add(nonce)   — before any await (T-20 concurrent double-consume)
  4. await NonceStore.consumed(nonce) → true ⇒ 'replayed'; throws ⇒ cache.delete(nonce)?? NO — keep it in the cache and return 'unavailable' (fail closed; the caller denies)
  5. await NonceStore.consume(c, now) (entity expiresIn CHALLENGE_TTL_S); throws ⇒ 'unavailable'
  6. 'ok'
```
The cache is per process and bounded by the caller (the API prunes entries older than TTL); octroi only reads/adds.

### 4.4 `decide()` — the order is the specification
```
0. validate: mb is an integer; if payment or no proof: assertMbStep(mb, stepMb, maxMbPerPurchase) else 'invalid-request'
   both proof and payment present ⇒ 'invalid-request'
1. FREE LANE (proof present):
   a. !campaign ⇒ deny 'no-campaign'; !challenge || !sessionPubKey ⇒ deny 'invalid-request'; challenge.path must be '/claim' ⇒ else 'invalid-proof'
   b. counters (T-24, before any verification is burned): paused ⇒ 'paused'; now ≥ campaign.expiresAt ⇒ 'expired';
      claimsThisHour ≥ claimsPerHour ⇒ 'cap'; spent + pricePerClaim > budget ⇒ 'budget'
   c. consumeChallenge → 'replayed' ⇒ deny 'replay'; 'expired'|'invalid' ⇒ 'invalid-proof'; 'unavailable' ⇒ 'ledger-unavailable'
   d. personhood.verify(proof, { action, signal: challenge.signal }) → throws AdapterError already_verified ⇒ 'replay'; any other throw ⇒ 'invalid-proof'
   e. tier = tierFromLevel(result.level); mb = sizeBundle(campaign, tier); mb === 0 ⇒ return payment-required (human price; §4.6)
   f. qk = quotaKey; cck = campaignClaimKey(auditKey(secret, id), nullifier); claimKey = onchainClaimKey(id, cck)
   g. existingEntitlement (caller passed the lookup result for keys.entitlementFree(qk)) non-null, or counters.claimed === true ⇒ deny 'replay'
   h. campaign.actionCheck && !(await actionCheck(claimKey)) ⇒ deny 'invalid-proof' (detail 'action')
   i. entitlement = { v:1, key: keys.entitlementFree(qk), kind:'free', status:'pending-profile', tier, campaignId, planId: campaign.planId,
        mbTotal: mb, mbUsed: 0, usageAsOf: now, usageSource:'none', createdAt: now, expiresAt: now + campaign.validityDays×86_400_000 }
      return serve-free { entitlement, claimKey, campaignClaimKey: cck, tier, mb }
2. PAID LANE (payment present):
   a. accepts = buildAccepts(deps, mb); the entry E with deep-equality to payment.accepted (scheme, network, asset lower-cased, amount, payTo lower-cased for EVM, maxTimeoutSeconds; `extra` ignored) must exist ⇒ else deny 'invalid-payment' (detail 'requirements_mismatch') (T-28)
   b. requireSessionKey: !sessionPubKey ⇒ 'invalid-request'; EVM payload: authorization.nonce !== sessionNonce(sessionPubKey, keccak256) ⇒ 'invalid-payment' (detail 'session_binding') (T-32); Hedera payload: the memo must equal sessionPubKey [verify Wed]
   c. EVM payload: authorization.value !== E.amount (exact, T-26) ⇒ 'invalid-payment'; authorization.to !== E.payTo ⇒ 'invalid-payment'
   d. payments.verify(payment, E) → !isValid ⇒ 'invalid-payment' (detail invalidReason)
   e. payments.settle(payment, E) → !success ⇒ 'invalid-payment' (detail errorReason); transaction missing/short ⇒ 'invalid-payment' (T-27)
   f. entitlement = { key: keys.entitlementPaid(settlement.payer, nonceOf(payment)), kind:'paid', status:'pending-profile', tier:'none', planId: deps.planId?, mbTotal: mb, mbUsed:0, usageAsOf: now, usageSource:'none', payer, network: E.network, createdAt: now, expiresAt: now + validityDays×86_400_000 }
      return serve-paid { entitlement, settlement, requirements: E }
3. NEITHER: return payment-required
```
`decide()` persists nothing and never calls `reseller`, the chain or HCS — the API does that after (ARCHITECTURE §2.1 steps 6–7). For top-ups the API passes the existing entitlement's `mb` request and ignores the returned entitlement's key (it patches the existing one); document this in the README.

### 4.5 `payment-required` body (§4.6 of INTERFACES is `paymentRequired()`)
`accepts = buildAccepts(deps, mb)` = each `AcceptTemplate` with `amount = usd6ToWire(priceUsd6(mb, stepMb, priceUsd6PerStep))`; `resource` from the request; `error` = `'payment required'` or the deny detail when falling through from the free lane (`'device tier: paid lane at the human price'`). Nothing in `extra` except `{ mb, stepMb, sessionKeyRequired: !!requireSessionKey }`.

### 4.6 `shouldTopUp` truth table (evaluate top to bottom)
| Condition | Verdict |
|---|---|
| `p.paused` | `{ buy:false, reason:'paused' }` |
| `now ≥ e.expiresAt` | `{ buy:false, reason:'expired' }` |
| `p.topUpOnExpiry && e.expiresAt − now ≤ p.expiryLeadS×1000 && lastExpiryBought === e.expiresAt` | `{ buy:false, reason:'already-bought-for-expiry' }` |
| `p.topUpOnExpiry && e.expiresAt − now ≤ p.expiryLeadS×1000` | candidate reason `'expiry'` |
| else `e.mbTotal − e.mbUsed ≤ p.thresholdMb` | candidate reason `'threshold'` |
| else | `{ buy:false, reason:'ok' }` |
| candidate and `spentTodayUsd6 + stepPriceUsd6 > p.maxUsd6PerDay` | `{ buy:false, reason:'cap' }` |
| candidate | `{ buy:true, mb: p.stepMb, reason, costUsd6: stepPriceUsd6 }` |
`stepPriceUsd6` is the price for `p.stepMb` (the agent computes it with `priceUsd6(p.stepMb, STEP_MB, priceUsd6PerStep)` from `/plans`).

### 4.7 `decideGiftReclaim` (evaluate top to bottom)
`!ledgerOk ⇒ ledger-unavailable`; `giftReceipt = receipts.find(kind==='gift')` missing ⇒ `unknown-gift`; `giftReceipt.payer?.toLowerCase() !== payer.toLowerCase()` ⇒ `not-payer`; any `gift-claim` ⇒ `claimed`; any `gift-reclaim` ⇒ `already-reclaimed`; `escrow !== null` (still claimable) ⇒ `too-early`; `now < claimBy` where `claimBy = giftReceipt.at + GIFT_CLAIM_WINDOW_S×1000` ⇒ `too-early` (defensive: the escrow should have vanished); `now ≥ claimBy + GIFT_RECLAIM_WINDOW_S×1000` ⇒ `window-closed`; else `refund { to: payer, network: giftReceipt.network, usd6: max(0, usd6 − fee), feeUsd6: min(fee, usd6) }`.

### 4.8 Stores
- Annotations exactly as INTERFACES §1.4 comments; `expiresAt` annotation is numeric ms. `isLive(entity, now) = entity.expiresAt === null || entity.expiresAt > now` **and** `(annotations.expiresAt === undefined || annotations.expiresAt > now)` (T-35).
- Lookups are `ledger.query({ annotations: { type, key }, limit: 2 })`; two live results for one key is a corruption ⇒ throw `RechargeError('internal_error')`.
- `create` computes `expiresIn = secondsUntil(payload.expiresAt | claimBy | …, now)`; `patch` re-serialises the merged payload, re-derives annotations, and passes `expiresIn` only when `opts.expiresAt` is given; it returns the fresh `Found` (the entity key may change on Arkiv).
- Payloads are validated with the protocol schema on **both** write and read (a malformed entity on a public ledger is an attack, T-39-class) — read failures return `null` and are counted by the caller.
- `ReceiptStore.spentUsd6` sums `usd6` of receipts with `{ receiptKind: kind, entitlementKeyHash, day }`.

## 5. Dependencies on other workstreams

| Needs | From | Until it lands |
|---|---|---|
| `@ethglobal/protocol` (schemas, ids, units, errors, x402 `sessionNonce`) and `@ethglobal/crypto` (hmac, keccak, randomBytes) | interfaces wave (lands first, ≈2 h) | code against INTERFACES §1–2 with local `declare module` stubs; delete them when the packages publish |
| `Ledger`, `Personhood`, `PaymentRail` types; `InMemoryLedger` (+`update`), `MockPersonhood({ expectSignal })`, `MockPaymentRail` (union payload); `fixtureProof`, `fakeClock`, `anvilAccounts` | adapters-live wave (parallel) | the scaffold's mocks exist today; until `update`/`expectSignal` land, `test/helpers.ts` wraps `InMemoryLedger` with an `update` shim and a `Personhood` double that checks `context.signal` — delete the shims when adapters publishes them |
| `DataDrop.claimed` / counters | contracts (parallel) | you never call the chain; `counters` arrive in the request |

## 6. Acceptance tests (vitest; names are binding)

`size.test.ts`: `caps at 300 MB`, `shrinks with wholesale ($2.50/GB → 160)`, `device and none → 0`, `zero or negative wholesale uses the cap only`, `never a float (result is an integer for 10⁴ random inputs)`.
`keys.test.ts`: `quotaKey deterministic`, `distinct secrets ⇒ distinct keys`, `nullifier substring absent from every output (O12)`, `onchainClaimKey equals keccak256(abi.encodePacked) vector from fixtures/eip3009/… or a viem encodePacked check`, `auditKey differs per campaign`.
`challenge.test.ts`: `issues 32-byte nonce with valid MAC`, `signalFor matches keccak(nonce‖audience)`, `second consume → replayed (O3)`, `now = exp + 1 s → expired`, `swapped sessionPubKey → invalid (C4)`, `other path/audience → invalid (O4)`, `ledger put throws → unavailable and the nonce stays in the cache`, `Promise.all([consume, consume]) yields exactly one ok (T-20)`.
`decide.test.ts`: `valid orb proof + budget → serve-free with 300 MB (O1)`, `same nullifier twice → deny replay`, `counters.claimed → deny replay`, `paused campaign → deny paused and verify never called (spy) (O7)`, `expired campaign → deny expired`, `hourly cap at N+1 → deny cap`, `budget exhausted → deny budget`, `device level → payment-required with both accepts (O5)`, `body says orb, verifier says device → 0 MB (O5)`, `proof for another signal → invalid-proof (O2)`, `no proof no payment → payment-required with amount = steps × price`, `mb = 199 → invalid-request (O9)`, `payment for one step with mb = 200 → invalid-payment`, `over-payment → invalid-payment`, `tampered accepts field (each of network/asset/payTo/amount) → invalid-payment (O11)`, `nonce ≠ keccak(sessionPubKey) on an LPA route → invalid-payment (C4)`, `settle fails → invalid-payment (O10)`, `valid payment → serve-paid with key paid:<payer>:<nonce> and expiresAt = now + validity`, `ledger unavailable during consume → ledger-unavailable`, `both proof and payment → invalid-request`, `actionCheck false → invalid-proof`.
`topup.test.ts`: `buys at 20 % remaining`, `buys at expiry lead once per expiresAt (O13)`, `never exceeds maxUsd6PerDay`, `paused stops it`, `expired entity → expired`, `threshold off-by-one: remaining == threshold buys, remaining == threshold+1 does not`.
`gift.test.ts`: one case per verdict in §4.7, including `ledgerOk false → ledger-unavailable` and `escrow still present → too-early`.
`store/*.test.ts`: `getByKey ignores entities whose annotations.expiresAt < now even if the ledger still returns them (L1–L3)`, `patch keeps the logical key and re-derives annotations`, `create sets expiresIn = secondsUntil`, `two live entities for one key → internal_error`, `malformed payload → null`, `spentUsd6 sums only the matching kind/day`, `openByNamehash returns only open gifts`.
`property/*.prop.test.ts` (fast-check): `size.prop` — bounds and EV inequality over tiers × wholesale ∈ [10⁵, 5×10⁷] Usd6/GB × idResale ∈ [10⁵, 10⁷]; `budget.prop` — for any sequence of ≤ 200 free-lane requests with random proofs/replays/pauses against counters updated by a model of DataDrop, Σ served MB × pricePerClaim ≤ budget and no nullifier is served twice; `topup.prop` — a 24 h simulated loop with random usage never spends more than the cap and buys at most once per `expiresAt`; `challenge.prop` — 10⁴ challenges have distinct nonces; any single-bit flip in nonce/audience/path/exp/sessionPubKey makes `consumeChallenge` return `invalid`.

## 7. Definition of done

- `pnpm --filter @ethglobal/octroi build typecheck lint test` green with **100 %** coverage thresholds enforced in `vitest.config.ts`; property tests run ≥ 200 cases each in CI (`numRuns`).
- No `Date.now`, `Math.random`, `fetch`, `console` in `src/` (grep in CI via the design-bans script or a unit test that scans the source).
- `README.md` renders the §4.4 order and the §4.6/§4.7 tables; a `decide()` sequence diagram for the free and paid lanes.
- The API and agent workstreams can replace their stubs with your package without changing a call site (the signatures in §3 are frozen).

## 8. The three most likely bugs — avoid them

1. **Floats on money paths.** `0.4 / 0.0025` is `159.99999999999997` in IEEE 754; the acceptance test expects 160. Every division in `sizeBundle`, `priceUsd6`, `shouldTopUp` is `bigint`; `Number()` is applied only to a final MB count that is known to fit.
2. **Awaiting before the cache check.** `consumeChallenge` must `cache.has/add` synchronously before the first `await`; otherwise two concurrent requests with the same challenge both pass (T-20). And on a ledger failure the nonce **stays** in the cache: fail closed is the rule, even though it blocks a legitimate retry for 120 s.
3. **Comparing the wrong things.** `payment.accepted` must be compared field by field with addresses lower-cased and `amount` as a string of digits (not `BigInt ≥` — exact); `tier` must come from `PersonhoodResult.level`, never from `proof.verification_level`; `existingEntitlement` must be looked up by `keys.entitlementFree(quotaKey)` (the global pseudonym), not by the campaign claim key.
