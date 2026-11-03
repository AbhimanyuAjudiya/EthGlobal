# Build brief — `adapters-live` (wave 1)

**You are building:** the ports, mocks and **live adapters** in `packages/adapters` (`@ethglobal/adapters`), the shared `@ethglobal/eip3009` package, the `@ethglobal/adapters/testing` helpers (fixture transport, contract suites), and the initial `fixtures/` tree. Live adapters are **real code written against the documented sponsor APIs**; the sandbox cannot reach any of them (`docs/ENVIRONMENT-CONSTRAINTS.md`), so every live adapter is tested against recorded-exchange fixtures through an injected `fetch`, and the **same contract suite** runs against the mock and the live implementation of each port. Humans record real fixtures at the Wednesday pre-deploy; where this brief's shape disagrees with what they record, the recording wins and the adapter is fixed.

**Read first:** this brief; **`docs/vendor/API-FACTS.md` in full** (verified vendor shapes, packages and versions — code against it, not from memory; INTERFACES §13 A-18…A-30 records where it changed this brief); `docs/INTERFACES.md` §0.1, §1.5, §1.7–1.8, §1.11 (what you consume from protocol), §3 and §4 (your public surface — copied below), §10 (fixture catalogue), §11 (env), §13; `docs/THREAT-MODEL.md` §5.2 (T-13…T-17) and §5.5 (T-35…T-44); `docs/ARCHITECTURE.md` §7 (the wiring table); the scaffold: `packages/adapters/{README.md,package.json,src/**,test/**}`.

---

## 1. Files

### 1.1 `packages/adapters` — modify and add
```
src/types.ts                       // INTERFACES §3.1 (wire types re-exported from @ethglobal/protocol; Reseller, ConsensusLog, BlobStore, Treasury, Ledger.update, Adapters bundle)
src/index.ts                       // + exports below; createAdapters('local', LocalAdapterOptions); `live` → throws pointing to '@ethglobal/adapters/live'
src/hash.ts                        // becomes a re-export of @ethglobal/crypto sha256Hex/isHex (one hashing owner)
src/x402-headers.ts                // becomes a re-export of @ethglobal/protocol/x402 (one codec owner); test moves to protocol
src/mocks/ledger.ts                // + update(); + numeric annotation `expiresAt` honoured in isLive (T-35)
src/mocks/personhood.ts            // + { expectSignal } option: when set, proof.proof must equal fixtureProof's binding of context.signal
src/mocks/payment-rail.ts          // union payload: Hedera payload ⇒ invalidReason 'unsupported_scheme'
src/mocks/reseller.ts              // MockReseller
src/mocks/consensus-log.ts         // MockConsensusLog
src/mocks/blob-store.ts            // MemoryBlobStore
src/mocks/treasury.ts              // MockTreasury
src/live/index.ts                  // createLiveAdapters, liveConfigSchema
src/live/config.ts                 // zod over env (INTERFACES §11), host allow-lists
src/live/arkiv-ledger.ts           // ArkivLedger
src/live/world-personhood.ts       // WorldCloudPersonhood (IDKit 4 → /api/v4/verify/{rp_id})
src/live/world-rp-context.ts       // createRpContextSigner (idkit-core/signing signRequest) — used by the API's POST /world/rp-context
src/live/remote-facilitator.ts     // RemoteFacilitator
src/live/self-run-facilitator.ts   // SelfRunFacilitator
src/live/routing-rail.ts           // RoutingPaymentRail
src/live/esimaccess-reseller.ts    // EsimAccessReseller
src/live/megaesim-reseller.ts      // MegaEsimReseller — fixture-only stub (A-28)
src/live/inventory-reseller.ts     // InventoryReseller
src/live/fallback-reseller.ts      // FallbackReseller
src/live/hcs-log.ts                // HcsLog
src/live/hcs14.ts                  // hcs14Uaid
src/live/ens-resolver.ts           // EnsResolver
src/live/swarm-blobs.ts            // SwarmBlobStore
src/live/evm-treasury.ts  src/live/hedera-treasury.ts  src/live/routing-treasury.ts
src/live/errors.ts                 // one place that maps HTTP/SDK failures to AdapterError codes
src/testing/index.ts               // INTERFACES §3.4
src/testing/clock.ts  src/testing/anvil.ts  src/testing/fixtures.ts  src/testing/fixture-fetch.ts  src/testing/builders.ts
src/testing/contracts/{ledger,reseller,consensus-log,personhood,payment-rail,name-resolver,blob-store,treasury}.ts   // describeX suites
test/mocks/*.test.ts               // each mock runs its describeX suite + mock-specific behaviour
test/live/*.test.ts                // each live adapter runs its describeX suite over fixtureFetch + request-shape assertions
test/testing/fixture-fetch.test.ts
package.json                       // exports: ".", "./live", "./testing"; deps: @ethglobal/protocol, @ethglobal/crypto, @ethglobal/eip3009, viem, zod, @arkiv-network/sdk@1.0.1, @x402/hedera@2.29.0 (brings @hiero-ledger/sdk@2.90.1 — import SDK symbols via its re-exports; never @hashgraph/sdk), @worldcoin/idkit-core@4.6.0 (signing only); dev: @hashgraphonline/standards-sdk@0.1.192 (HCS-14 conformance) — all via catalog:
README.md                          // the port table extended; mock behaviours; how to record a fixture
```
### 1.2 `packages/eip3009` — implement the skeleton the interfaces wave created
```
src/index.ts  src/typed-data.ts  src/digest.ts  src/recover.ts  src/calldata.ts  src/relayer.ts  src/abi.ts  src/domain.ts
test/{vectors,recover,calldata,relayer}.test.ts     // vectors.test reads fixtures/eip3009/vectors.json written by the contracts workstream
```
### 1.3 `fixtures/` — initial versions written from documentation (every file carries `"source": "docs"` until a human re-records it with `"source": "live"`)
Paths exactly as INTERFACES §10: `world/*`, `facilitator/x402org/*`, `facilitator/hedera/*`, `reseller/esimaccess/*`, `reseller/megaesim/README.md` (no public API — A-28; nothing else until the vendor supplies docs), `arkiv/*`, `hcs/*`, `ens/*`, `eip3009/domains.json`, `swarm/*`, `inventory.example.json`.

## 2. Public interface (verbatim from `docs/INTERFACES.md` §3–4)

```ts
// ── types.ts additions (§3.1)
export type { Hex, Address } from '@ethglobal/protocol/ids';
export type { PaymentResource, PaymentRequirements, PaymentRequired, PaymentAuthorization, PaymentPayload, VerifyResult, SettleResult } from '@ethglobal/protocol/schemas';
export interface Ledger {
  put(input: LedgerPutInput): Promise<LedgerPutResult>;
  get(key: string): Promise<LedgerEntity | null>;
  query(query?: LedgerQuery): Promise<LedgerEntity[]>;
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
  order(planId: string, opts: { idempotencyKey: string }): Promise<EsimProfile>;
  topUp(iccid: string, mb: number, opts: { idempotencyKey: string }): Promise<{ orderId: string; totalMb: number }>;
  usage(iccid: string): Promise<EsimUsage>;
  verifyWebhook(rawBody: string, headers: Record<string, string | undefined>, now: number): WebhookVerdict;
  parseWebhook(rawBody: string): UsageEvent[];
}
export interface ConsensusLog {
  submit(topic: string, message: string): Promise<{ sequence: number; consensusAt: number; txId: string }>;
  read(topic: string, fromSequence?: number): Promise<Array<{ sequence: number; message: string; consensusAt: number }>>;
}
export interface BlobStore { put(bytes: Uint8Array, contentType: string): Promise<{ ref: string }>; get(ref: string): Promise<Uint8Array | null> }
export interface Treasury { refund(input: { network: string; to: string; usd6: bigint; memo: string }): Promise<{ tx: string }>; balanceUsd6(network: string): Promise<bigint> }
export interface Adapters {
  mode: AdapterMode; ledger: Ledger; personhood: Personhood; payments: PaymentRail; inference: Inference;
  names: NameResolver; reseller: Reseller; consensus: ConsensusLog; blobs: BlobStore; treasury: Treasury;
}

// ── factory (§3.2)
export interface LocalAdapterOptions {
  now?: () => number; names?: readonly NameRecord[]; inference?: MockInferenceOptions;
  reseller?: { usageMbPerMinute?: number; plans?: EsimPlan[]; webhookSecret?: Uint8Array; failNextOrder?: boolean };
  personhood?: { expectSignal?: boolean };
}
export function createAdapters(mode: 'local', options?: LocalAdapterOptions): Adapters;
export interface MockReseller extends Reseller {
  advanceUsage(iccid: string, mb: number): void;
  signedWebhook(events: UsageEvent[], now: number): { body: string; headers: Record<string, string> };
  orders(): ReadonlyArray<{ idempotencyKey: string; profile: EsimProfile }>;
}
export class MockConsensusLog implements ConsensusLog { messages(topic: string): readonly string[] }
export class MemoryBlobStore implements BlobStore {}
export class MockTreasury implements Treasury { refunds(): ReadonlyArray<{ network: string; to: string; usd6: bigint; memo: string; tx: string }> }

// ── live (§3.3)
export const liveConfigSchema: z.ZodType<LiveConfig>;
export function createLiveAdapters(config: LiveConfig, deps?: { fetch?: typeof fetch; now?: () => number; logger?: Pick<Console, 'info' | 'warn'> }): Adapters;
export class ArkivLedger implements Ledger { constructor(opts: { client: ArkivClientLike; blockTimeMs: number; now: () => number }) }
export class WorldCloudPersonhood implements Personhood { constructor(opts: { rpId: string; action: string; environment: 'production' | 'staging'; fetch?: typeof fetch; baseUrl?: string }) }
export function createRpContextSigner(opts: { appId: string; rpId: string; action: string; environment: 'production' | 'staging'; signingKeyHex: Hex; ttlS?: number; now: () => number }): { issue(): Promise<RpContext> };
export class RemoteFacilitator implements PaymentRail { constructor(opts: { url: string; fetch?: typeof fetch; allowedHosts: string[]; networks: string[]; expectFeePayer?: Record<string, string> }) }
export class SelfRunFacilitator implements PaymentRail { constructor(opts: { publicClient; relayer: Relayer; token: Address; chainId: number; network: string; now: () => number; perFromRateLimit?: number }) }
export class RoutingPaymentRail implements PaymentRail { constructor(rails: Record<string, PaymentRail>) }
export class EsimAccessReseller implements Reseller { constructor(opts: { accessCode: string; signingKey?: string; webhookToken: string; webhookIps?: string[]; fetch?: typeof fetch; baseUrl?: string; now: () => number }) }
export class MegaEsimReseller implements Reseller { constructor(opts: { fixtureFetch?: typeof fetch; baseUrl?: string; now: () => number }) }   // fixture-only stub (A-28)
export class InventoryReseller implements Reseller { constructor(opts: { file: string; sealKey: Uint8Array; now: () => number }) }
export class FallbackReseller implements Reseller { constructor(primary: Reseller, fallback: Reseller) }
export class HcsLog implements ConsensusLog { constructor(opts: { client: HederaClientLike; mirrorUrl: string; fetch?: typeof fetch }) }
export function hcs14Uaid(input: { registry: 'hedera'; name: string; version: string; protocol: 'x402'; nativeId: string; skills?: number[] }): string;
export class EnsResolver implements NameResolver { constructor(opts: { mainnetClient; fallbackClient? }) }
export class SwarmBlobStore implements BlobStore { constructor(opts: { beeUrl: string; postageBatchId: string; fetch?: typeof fetch }) }
export class EvmTreasury implements Treasury { constructor(opts: { walletClient; publicClient; token: Address; network: string }) }
export class HederaTreasury implements Treasury { constructor(opts: { client: HederaClientLike; tokenId: string; network: string }) }
export class RoutingTreasury implements Treasury { constructor(byNetwork: Record<string, Treasury>) }

// ── testing (§3.4)
export const T0: number;
export function fakeClock(start?: number): { now: () => number; advance(ms: number): void; set(ms: number): void };
export const anvilAccounts: readonly Address[]; export const anvilKeys: readonly Hex[];
export const anvilRoles: { deployer: 0; payout: 1; attestor: 2; sponsor: 3; agent: 4; human: 5; relayer: 6; stranger: 7; treasury: 8 };
export function loadFixture<T = unknown>(relPath: string): T;
export function fixtureFetch(relPath: string, opts?: { strictBody?: boolean }): typeof fetch;
export function fixtureProof(level: VerificationLevel, signal?: Hex, seed?: string): PersonhoodProof;
export function paymentPayload(req: PaymentRequirements, overrides?: Partial<PaymentAuthorization>, signature?: Hex): PaymentPayload;
export function requirementInput(overrides?: Partial<PaymentRequirementInput>): PaymentRequirementInput;
export function describeLedger(name: string, make: () => Promise<{ ledger: Ledger; clock: ReturnType<typeof fakeClock> }>): void;
export function describeReseller(name: string, make: () => Promise<Reseller>): void;
export function describeConsensusLog(name: string, make: () => Promise<ConsensusLog>): void;
export function describePersonhood(name: string, make: () => Promise<Personhood>): void;
export function describePaymentRail(name: string, make: () => Promise<{ rail: PaymentRail; signer?: (auth: PaymentAuthorization) => Promise<Hex> }>): void;
export function describeNameResolver(name: string, make: () => Promise<NameResolver>): void;
export function describeBlobStore(name: string, make: () => Promise<BlobStore>): void;

// ── @ethglobal/eip3009 (§4)
export interface Authorization3009 { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex }
export const TRANSFER_WITH_AUTHORIZATION_TYPES, RECEIVE_WITH_AUTHORIZATION_TYPES, CANCEL_AUTHORIZATION_TYPES;
export function domain(token: Address, chainId: number, name: string, version: string): TypedDataDomain;
export function domainFromRequirements(req: { network: string; asset: string; extra?: Record<string, unknown> }): TypedDataDomain;   // A-21
export async function readDomain(publicClient: PublicClient, token: Address): Promise<{ name: string; version: string; chainId: number }>;
export function typedDataTransferWithAuthorization(d: TypedDataDomain, a: Authorization3009): TypedDataDefinition;
export function typedDataReceiveWithAuthorization(d: TypedDataDomain, a: Authorization3009): TypedDataDefinition;
export function digestTransferWithAuthorization(d: TypedDataDomain, a: Authorization3009): Hex;
export function digestReceiveWithAuthorization(d: TypedDataDomain, a: Authorization3009): Hex;
export async function recoverSigner(digest: Hex, signature: Hex): Promise<Address>;
export function encodeTransferWithAuthorization(a: Authorization3009, signature: Hex): Hex;
export function encodeReceiveWithAuthorization(a: Authorization3009, signature: Hex): Hex;
export function fromPaymentAuthorization(p: PaymentAuthorization): Authorization3009;
export function toPaymentAuthorization(a: Authorization3009): PaymentAuthorization;
export const EIP3009_ABI: Abi;
export interface Relayer { submit(token: Address, data: Hex): Promise<{ hash: Hex; status: 'success' | 'reverted' }> }
export function createViemRelayer(opts: { walletClient: WalletClient; publicClient: PublicClient; simulate?: boolean }): Relayer;
```

## 3. Exact API shapes to code against (each is also the fixture you write first)

Source of truth for every shape below: `docs/vendor/API-FACTS.md` (section numbers in brackets). Only what that file marks **[unverified]** keeps a `[verify Wed]` tag here.

Rule for every live adapter: build requests with `httpJson` from `@ethglobal/protocol/http` (injected `fetch`); validate **every** response with a zod schema in `src/live/<adapter>.ts` (never trust shape, T-38/T-39/T-42); map failures through `src/live/errors.ts` to `AdapterError(adapter, code)` with codes from this closed list: `invalid_proof`, `already_verified`, `invalid_response`, `unavailable`, `rate_limited`, `unauthorized`, `nonce_already_used`, `requirements_mismatch`, `insufficient_amount`, `expired`, `not_yet_valid`, `unsupported_scheme`, `fixture_miss`.

### 3.1 World ID — `WorldCloudPersonhood` and `createRpContextSigner` (IDKit 4.6.0; API-FACTS §4; INTERFACES A-25/A-26)
**Verify:** `POST {baseUrl = https://developer.world.org}/api/v4/verify/{rp_id}` · `Content-Type: application/json` · body = the IDKit result **unchanged** (`personhoodProofSchema`, `.loose()` so unknown fields survive) — never rebuild it. 200 → `{ "success": true, "action", "nullifier", "created_at", "environment": "production"|"staging"|"sandbox", "session_id"?, "results": [ { "identifier", "success", … } ] }`. Accept only when `success === true` **and** `action === opts.action` **and** `environment === opts.environment` **and** no `session_id` **and** every `proof.responses[i].signal_hash === hashToField(context.signal)` (`keccak256(bytes) >> 8` as 0x-hex; vectors `hash_to_field("")=0x00c5d246…85a4`, `"test_signal"`, `"hello"` from API-FACTS §4.2 in `fixtures/world/hash-to-field-vectors.json`; when `context.signal` is 0x-hex, hash its **bytes** `[verify Wed]` against a live proof). `level` from the verifier's identifier (the response's `results[].identifier`, else the proof's — the verifier has checked it): `verificationLevelFromIdentifier` from `@ethglobal/protocol/schemas` (`proof_of_human|orb → orb`, `passport|mnc → secure_document`, `document → document`, `device|selfie|face → device`; unknown ⇒ `invalid_proof`) (T-22). `nullifierHash`: V4 decimal `nullifier` → `0x` + 64-hex of `BigInt(nullifier)`; V3 hex → lower-cased, left-padded to 32 bytes. 400 `{ success:false, code, detail, results? }`: `nullifier_replayed|max_verifications_reached|already_verified → already_verified`, `app_not_migrated|unknown_rp|inactive_rp|invalid_rp_signature|rp_signature_expired → unavailable` (our configuration, logged loudly), everything else `→ invalid_proof`; 404 → `unavailable`; 429 → `rate_limited`; 5xx/timeout → `unavailable`. Non-JSON or unknown shape → `invalid_response` (never success).
**rp_context:** `createRpContextSigner().issue()` = `signRequest({ signingKeyHex, action, ttl: 300 })` from `@worldcoin/idkit-core/signing` → `{ rp_id, nonce, created_at, expires_at, signature, app_id, action, environment }` (snake_case, `rpContextSchema`). The algorithm (API-FACTS §4.2: `0x01 ‖ nonce ‖ created_at u64 BE ‖ expires_at u64 BE ‖ hash_to_field(action)`, EIP-191) is reproduced in a test against `fixtures/world/rp-context-vector.json` so a library change is caught. The key is a `Hex` from env, never logged, never returned. The legacy `/api/v2/verify/{app_id}` and the v2 proof shape are **not** implemented (they pair only with the v2 widget).

### 3.2 x402 facilitator — `RemoteFacilitator` (x402 v2, API-FACTS §1.5–1.7; INTERFACES A-18, A-20, A-30)
Default URL for both `eip155:84532` and `hedera:testnet`: `https://x402.org/facilitator`; Hedera fallback `https://api.testnet.blocky402.com` (fee payer `0.0.7162784`), then `https://testnet.facilitator.launa.dev`. `GET {url}/supported` → `{ "kinds": [ { "x402Version": 2, "scheme": "exact", "network": "eip155:84532" }, { "x402Version": 2, "scheme": "exact", "network": "hedera:testnet", "extra": { "feePayer": "0.0.9185802" } } ], "extensions": [], "signers": { … } }` — the adapter refuses a network not listed (log + `unavailable` at first use), exposes `feePayer(network)` so the API's Hedera `AcceptTemplate.extra.feePayer` comes from the facilitator (and must equal `expectFeePayer[network]` = `X402_HEDERA_FEE_PAYER` when set). Request and response bodies use **`amount`** (never `maxAmountRequired`). Hedera settle: the shipped facilitator returns the tx id `0.0.x@seconds.nanos` in `transaction`; if a facilitator returns only `transactionId`, normalise it into `transaction` before `settleResultSchema` parses. `errorReason: "settlement_pending"` is non-terminal: poll the chain (EVM receipt / Hedera mirror `GET /api/v1/transactions/{id}`) for ≤ 30 s, then `success: true` with that tx or `unavailable`. `POST {url}/verify` and `POST {url}/settle` with `{ "x402Version": 2, "paymentPayload": <PaymentPayload>, "paymentRequirements": <PaymentRequirements> }` → `verifyResultSchema` / `settleResultSchema` from protocol; a settle `success: true` without a plausible `transaction` (EVM: 32-byte hex; Hedera: `0.0.x@seconds.nanos` or a 48-byte hex hash) or with `network ≠ requested` ⇒ `AdapterError('payments','invalid_response')` (T-42). `allowedHosts` is checked on the URL at construction (`x402.org`, `api.testnet.blocky402.com`, `testnet.facilitator.launa.dev`, `localhost`). A conformance test decodes every `fixtures/facilitator/**` body with `@x402/core@2.29.0`'s schemas as well as ours (A-19).

### 3.3 Self-run facilitator — `SelfRunFacilitator` (EVM exact only)
`verify`: payload must be `isEvmExact`; `accepted` equals `requirements`; `typedDataTransferWithAuthorization(domain, auth)` with the domain from `domainFromRequirements(requirements)` (the `extra.{name,version}` the API advertised — `"USDC"`/`"2"` on Base Sepolia, A-21), which must equal `readDomain()` (cached per token) or verification fails with `requirements_mismatch`; `recoverSigner(digest, signature) == from`; `to == payTo`; `value == amount` (exact); `validAfter < now/1000 < validBefore`; `authorizationState(from, nonce) == false`; `balanceOf(from) ≥ value`; per-`from` rate limit (default 5/min, T-16). `settle`: verify again, `relayer.submit(token, encodeTransferWithAuthorization(auth, sig))` (simulated first), wait for the receipt; `status 'reverted'` with `authorizationState == true` afterwards ⇒ look for `Transfer(from, payTo, value)` in the last 20 blocks and, if found, return `success: true` with that tx (settlement front-run, T-15); else `{ success:false, errorReason }`. Prefer `receiveWithAuthorization` **only** when `payTo` equals the relayer's address (then only we can submit).

### 3.4 Arkiv — `ArkivLedger` over `@arkiv-network/sdk@1.0.1` (API-FACTS §3; INTERFACES A-23, A-24)
Network: **rabdi**, chain **7794095** — `import { rabdi } from '@arkiv-network/sdk/chains'`; `rabdi({ accessKey: ARKIV_ACCESS_KEY })` appends the access key as the last RPC path segment; gas token tGLM. **Kaolin is retired; nothing in this package mentions it.** If `ARKIV_CHAIN_ID=7738577` (tiramisu) is configured, `defineChain` it from env. Wrap the SDK behind `ArkivClientLike { createEntity(schema, values, { expiration }): Promise<{ entityKey, txHash }>; getEntity(key, schema): Promise<{ values, $expiresAt: bigint } | null>; select(schema, where, { limit, afterKey? }): Promise<{ entities, skipped }>; patchEntity(schema, key, { set }): Promise<{ txHash }>; extendEntity(key, expiration): Promise<{ txHash }>; blockNumber(): Promise<bigint> }` — an interface you define so the SDK surface is isolated in one file and fixtures mock **this** interface, not HTTP. Schemas: one `defineSchema('recharge.<type>.v1', { payload: bytes(), type: str().indexed(), key: str().indexed(), …every ANN string: str().indexed(), expiresAt: u64().indexed() })` per `ENTITY_TYPES` entry (`bytes` is never indexed, ≤ 128 KiB). Expiry: the port's `expiresIn` (seconds) → `expiration: ExpirationTime.fromSeconds(2 × ceil(expiresIn / 2))` (whole 2-s blocks, round **up**; with `ARKIV_BLOCK_TIME_MS ≠ 2000` use `ceil(s × 1000 / blockTimeMs)` blocks via `ExpirationTime.atBlock(current + n, { atLeast: true })`); `expiresIn > 15_768_000` (7,884,000 blocks) → `AdapterError('ledger','invalid_request')` before the chain reverts `ExpiryBeyondMaxLifetime`; log the implied drift once per hour (T-35). `update(key, patch, expiresIn?)` = `patchEntity` (+ `extendEntity` when `expiresIn` is given). `query({ annotations })` → `select().from(schema).where(and(eq('type', …), eq('key', …)))`, pages of ≤ 100 rows paginated by `gt('$key', lastKey)`, `limit` honoured. `LedgerEntity.expiresAt` = `Number($expiresAt − currentBlock) × blockTimeMs + now` (the ledger's view). Any SDK/transport error → `AdapterError('ledger','unavailable')` — never `null` (a `null` means "not found", which fails open in the challenge path).

### 3.5 eSIM Access — `EsimAccessReseller`, the **primary** reseller (API-FACTS §5.1, `esimaccess-api@b9421b3`; INTERFACES A-27)
Base `https://api.esimaccess.com/api/v1/open`; every endpoint is `POST` with a JSON body. Headers on every call: `Content-Type: application/json`, `RT-AccessCode: <accessCode>`, `RT-Timestamp: <ms epoch>`, `RT-RequestID: <uuid v4>`, `RT-Signature` = **lower-case hex HMAC-SHA256(key = `signingKey ?? accessCode`, message = `timestamp + requestId + accessCode + rawBody`)** — the official reference keys the HMAC with the access code; `ESIMACCESS_SIGNING_KEY` exists only in case the Wednesday recording shows the console's secret key is required (`101003` = signature mismatch). Sign the **exact string you send** (serialise once). Client-side limiter: ≤ 8 req/s. Response envelope `{ success, errorCode, errorMsg, obj }`; `errorCode` map: `101003|401001 → unauthorized`, `200007` (insufficient balance) `→ unavailable` (logged as an ops alarm), `310402` (duplicate transactionId) → re-query, `200002 → invalid_response`, `400001|000105 → invalid_response` (our request is wrong: a bug, logged with the request id).
- `plans('IN')`: `/package/list { "locationCode": "IN", "type": "", "slug": "", "packageCode": "", "iccid": "" }` → `obj.packageList[]: { packageCode, slug, name, price, retailPrice, currencyCode, volume, duration, durationUnit: "DAY", location, speed, supportTopUpType, … }` — `price` is **USD × 10 000** ⇒ `wholesaleUsd6 = price × 100`; `volume` is **bytes** ⇒ `dataMb = mbFromBytes(volume)`; `validityDays = duration` when `durationUnit === "DAY"` (others skipped).
- `order(planId, { idempotencyKey })`: `/esim/order { "transactionId": <idempotencyKey ≤ 50 chars, e.g. sha256Hex(key).slice(2, 34)>, "packageInfoList": [ { "packageCode": planId, "count": 1 } ] }` → `obj { orderNo, transactionId }`; then poll `/esim/query { "orderNo", "iccid": "", "pager": { "pageNum": 1, "pageSize": 20 } }` **every 3 s for ≤ 30 s** (ICCID typically 3–10 s) → `obj.esimList[]: { esimTranNo, orderNo, transactionId, iccid, ac, qrCodeUrl, smdpStatus, esimStatus, totalVolume, orderUsage, expiredTime, … }`. `ac` is the LPA activation code; the reference example shows `ac: ""` right after order **[unverified when it fills]** — if it is still empty at 30 s throw `AdapterError('reseller','unavailable')` (the API keeps `pending-profile` and retries with the same key). `310402` duplicate `transactionId` ⇒ query by the same `transactionId`/`orderNo` and return the **same** profile. The LPA must match `LPA_PATTERN` before it leaves the adapter (T-39); `qrCodeUrl` is never returned.
- `topUp(iccid, mb, { idempotencyKey })`: `/esim/query { iccid }` → `esimTranNo`; `/package/list { iccid }` → the top-up package (`supportTopUpType === 2`) whose `volume` matches `mb`; `/esim/topup { esimTranNo, iccid: "", packageCode, transactionId }` → success only (no webhook for top-ups); return `{ orderId: transactionId, totalMb }` from a fresh `/esim/query`.
- `usage(iccid)`: `/esim/query { iccid, pager }` → `usedMb = mbFromBytes(orderUsage)`, `totalMb = mbFromBytes(totalVolume)`, `asOf = now`, `status` from `smdpStatus/esimStatus` (`RELEASED|GOT_RESOURCE → ready`, `ENABLED → installed`, `IN_USE → active`, `USED_UP|DELETED → expired`). (`/esim/usage/query` needs `esimTranNoList`; not needed.)
- **Webhooks** (types `ORDER_STATUS`, `ESIM_STATUS`, `SMDP_EVENT`, `DATA_USAGE` (1–3 h delay), `VALIDITY_USAGE`, `CHECK_HEALTH`): the docs show **no signature** and no exact JSON schema **[unverified]**. So `verifyWebhook(raw, headers, now)` requires (1) the URL token — the API passes `?token=` as the pseudo-header `x-recharge-url-token`, compared constant-time with `ESIMACCESS_WEBHOOK_TOKEN` (`bad_signature` on mismatch); (2) the sender IP — the API passes the socket address (or `X-Forwarded-For` only when `TRUST_PROXY=1`) as `x-recharge-remote-ip`, which must be in `ESIMACCESS_WEBHOOK_IPS` (`bad_signature`); (3) replay cache on `sha256(raw)` for 5 min (`replay`); if `RT-Signature`/`RT-Timestamp` are present, they are also checked (skew ≤ 300 s, ms → s explicitly). `parseWebhook` maps `DATA_USAGE`/`ESIM_STATUS`/`VALIDITY_USAGE` bodies that carry an `iccid` to `UsageEvent` (`eventId = sha256(raw)`), tolerating unknown fields with a loose zod schema; `ORDER_STATUS` (no ICCID) and `CHECK_HEALTH` yield `[]`. The API treats these events as **hints** and re-reads `usage(iccid)` before patching (api.md §4.6).

### 3.6 MegaeSIM — `MegaEsimReseller`, a fixture-only stub (INTERFACES A-28)
MegaeSIM has **no public API documentation** (API-FACTS §5.2). Ship a class that implements `Reseller` with every network method throwing `AdapterError('reseller','unavailable')` and `verifyWebhook` returning `{ ok:false, reason:'bad_signature' }`; its contract-suite run is `describe.skipIf(!existsSync('fixtures/reseller/megaesim/order.json'))`. `liveConfigSchema` rejects `RESELLER=megaesim`. `fixtures/reseller/megaesim/README.md` says: "No public API. Implement only if the vendor supplies docs on-site; record with `scripts/record-fixture.ts`, then lift the env refusal." The reseller chain is `FallbackReseller(EsimAccessReseller, InventoryReseller)`.

### 3.7 Inventory — `InventoryReseller` (T-41)
`fixtures/inventory.enc` = `sealToServer(key, JSON.stringify([{ iccid, lpa, planId, dataMb, validityDays }]))` (git-ignored; `inventory.example.json` holds `LPA:1$local.test$…` only). `order` opens the file, takes the first unconsumed profile for `planId`, rewrites the file atomically (`write tmp → rename`) with the profile marked `consumedBy: idempotencyKey` **before** returning; a repeated key returns the same profile; `usage` returns `{ usedMb: 0, usageSource }` — the API labels inventory usage "simulated". `topUp` → `AdapterError('reseller','unavailable')` (inventory cannot top up). `plans` lists the file's plans.

### 3.8 Hedera — `HcsLog`, `hcs14Uaid` (API-FACTS §2.5, §2.7; INTERFACES A-22, A-29)
SDK: `@hiero-ledger/sdk@2.90.1` symbols imported **through `@x402/hedera`'s re-exports** (`Client`, `PrivateKey`, `TopicMessageSubmitTransaction`, `TransferTransaction`, …) so one SDK copy exists; keys via `PrivateKey.fromStringECDSA()` (`fromString`/`generate` are deprecated). `submit`: `new TopicMessageSubmitTransaction().setTopicId(topic).setMessage(message).execute(client)` → `getReceipt` → `{ sequence: receipt.topicSequenceNumber, consensusAt: record consensus timestamp (ms), txId: response.transactionId.toString() }`; messages > 1024 bytes are rejected by the adapter **before** submission (T-44; the SDK would chunk silently). `read`: mirror REST `GET {mirrorUrl}/api/v1/topics/{topic}/messages?sequencenumber=gte:{from}&limit=100&order=asc` → `{ "messages": [ { "consensus_timestamp": "1762171200.123456789", "message": "<base64>", "sequence_number": 1, "topic_id": "0.0.x" } ], "links": { "next": "…" } }` → decode base64, consensus seconds×1000. `hcs14Uaid`: `id = base58(sha384(utf8(JSON.stringify({ skills, name, nativeId, protocol, registry, version }))))` with **exactly that key order**, strings trimmed, `protocol`/`registry` lower-cased, `skills` sorted integers → `uaid:aid:<id>;uid=0;registry=hedera;nativeId=<nativeId>;proto=x402`, `nativeId` CAIP-10 `hedera:testnet:0.0.x`. `fixtures/hcs/hcs14-vector.json` is computed with `@hashgraphonline/standards-sdk@0.1.192` `createUaid` (devDependency) in a test that runs now, not on Wednesday.

### 3.9 ENS — `EnsResolver`
viem: `normalize(name)` (ENSIP-15; throws on disallowed characters — map to `null` + `AdapterError('names','invalid_name')`… no: `resolve` returns `null` for unresolvable and **throws** `invalid_name` for un-normalisable input, so the API answers 400 vs 404 correctly, T-43), `getEnsAddress({ name })`, `getEnsText({ name, key })` on a mainnet `publicClient`; on transport error fall back to `fallbackClient` (Sepolia) and mark the result `source: 'fallback'` in a debug log. Fixtures are the JSON-RPC exchanges (`eth_call` to the Universal Resolver) replayed through viem's `http` transport with the injected `fetch`.

### 3.10 Swarm — `SwarmBlobStore` `[verify Wed]`
Bee API: `POST {beeUrl}/bzz` with headers `swarm-postage-batch-id`, `content-type` → `{ "reference": "<64 hex>" }`; `GET {beeUrl}/bzz/{reference}/` → bytes. `ref = 'bzz://' + reference`.

### 3.11 Treasuries
`EvmTreasury.refund`: `walletClient.writeContract({ address: token, abi: erc20, functionName: 'transfer', args: [to, usd6] })` → wait for receipt → `{ tx: hash }`; `balanceUsd6` = `balanceOf(payout)`. `HederaTreasury.refund`: `TransferTransaction().addTokenTransfer(tokenId, payer, -usd6).addTokenTransfer(tokenId, to, usd6).setTransactionMemo(memo)` (`@hiero-ledger/sdk` via `@x402/hedera`; `tokenId` `0.0.429274`, 6 dp; the recipient must be associated — `TOKEN_NOT_ASSOCIATED_TO_ACCOUNT` ⇒ `AdapterError('treasury','unavailable')` with the reason). Both reject `usd6 ≤ 0n`.

## 4. Mocks — behaviour the API, agent and e2e depend on

- `MockReseller`: plans `[ { id:'in-1gb-7d', dataMb: 1000, validityDays: 7, wholesaleUsd6: 1_140_000n }, { id:'in-300mb-7d', dataMb: 300, … 342_000n } ]`; `order` → `iccid = '8991' + 15 deterministic digits`, `lpa = 'LPA:1$local.test$' + idempotencyKey.slice(2, 18)`; repeated key → same profile; `failNextOrder` throws `unavailable` once (T-25 test); `usage` advances `usageMbPerMinute` per minute of the injected clock (the "simulated usage" source); `signedWebhook` produces the mock envelope + `x-recharge-*` headers (INTERFACES §1.7) with HMAC over `${timestamp}.${rawBody}`; `verifyWebhook` enforces the 300-s window and dedupes `x-recharge-event-id`.
- `InMemoryLedger.update`: replaces fields, keeps `createdAt`, recomputes `expiresAt` when `expiresIn` is given; unknown key → `AdapterError('ledger','not_found')`. Queries filter on numeric annotation equality too.
- `MockPersonhood({ expectSignal })`: `fixtureProof(level, signal, seed)` returns an IDKit-4-shaped result (`protocol_version: '4.0'`, `identifier: 'proof_of_human'` for orb / `'passport'` for document; a V3 `'device'` response for device) with `nullifier` = decimal of `sha256(seed)` and `signal_hash = hashToField(signal)`; with `expectSignal`, `verify` rejects any response whose `signal_hash ≠ hashToField(context.signal)` (`invalid_proof`, T-19) — the same check `WorldCloudPersonhood` makes. Keeps the one-per-(action, nullifier) rule (`already_verified`); the level is derived from the identifier exactly as the live adapter does (one mapping: protocol's `verificationLevelFromIdentifier`).
- `MockPaymentRail`: unchanged behaviour for EVM payloads; Hedera payload → `invalidReason: 'unsupported_scheme'`.
- `MockConsensusLog`: sequence per topic from 1; `consensusAt = now`; `txId = 'mock@<seq>'`; rejects > 1024 bytes like the live one.
- `MockTreasury`: deterministic `tx = sha256Hex('refund:…')`; `failNext`.

## 5. Fixture transport and contract suites

- `fixtureFetch(path)` returns a `fetch` that matches `method` + URL (origin + path + **sorted** query) and, with `strictBody`, the canonical JSON of the body; on a miss it throws `FixtureMiss` whose message prints the unmatched request **and** the three nearest recorded URLs — this is how request shapes are asserted (a wrong path or header fails the test). Each exchange may carry `"expectHeaders": { "RT-AccessCode": "…" }` to assert headers.
- Recording: `httpJson` accepts `fetch`; `scripts/record-fixture.ts` (ops-demo workstream) wraps the real `fetch`, appends exchanges to the named file with `"source": "live"`, and redacts `Authorization`, `RT-Signature` values and any `LPA:` string (replaced by `LPA:1$redacted$…`) before writing. Your job here: make every live adapter take `fetch` from its options so the recorder can wrap it.
- `describeX` suites assert the port semantics, e.g. `describeLedger`: put/get/query/update round trip, expiry by clock, `update` resets lifetime, numeric annotation filter, invalid `expiresIn`, `get` of unknown → `null`, copies not references; `describeReseller`: plan fields are integers/bigints, `order` idempotency, LPA matches `LPA_PATTERN`, `usage` monotonic across two calls, `verifyWebhook` accepts a freshly signed body and rejects a replay / a skewed timestamp / a tampered body, `parseWebhook` yields `UsageEvent`s; `describePaymentRail`: the scaffold's `payment-rail.test.ts` cases generalised (requirements mismatch, window, nonce burn, deterministic/real tx hash); `describePersonhood`: shape validation, one-per-nullifier, signal binding; `describeConsensusLog`: sequence monotonic, read from sequence, 1024-byte limit; `describeNameResolver`: lower-casing/normalisation, unknown → `null`; `describeBlobStore`: round trip, unknown ref → `null`; `describeTreasury`: refund returns a tx, rejects ≤ 0.

## 6. Dependencies on other workstreams

| Needs | From | Until it lands |
|---|---|---|
| `@ethglobal/protocol` (schemas, http, x402 codec, units, errors) and `@ethglobal/crypto` | interfaces wave (first ≈2 h) | code against INTERFACES §1–2; local `declare module` stubs |
| `fixtures/eip3009/vectors.json` | contracts wave | `vectors.test.ts` is `describe.skipIf(!exists)`; everything else in eip3009 is testable with viem alone |
| `deploy/addresses.anvil.json` for a real `SelfRunFacilitator` integration test | contracts wave | unit-test the facilitator against a viem `publicClient` stub; the Anvil integration test lives in `scripts/e2e-local.sh` (ops-demo) |
| An `Inference` for the agent | exists (`MockInference`) | — |

## 7. Acceptance tests (vitest; binding names)

- `test/mocks/*.test.ts`: every mock passes its `describeX` suite; `MockReseller` `simulated usage advances with the clock`, `failNextOrder throws exactly once`, `signedWebhook verifies and a replay is rejected`; `InMemoryLedger` `update resets expiresIn`, `expired by annotation even if ledger still has it (L1–L3)`; `MockPersonhood` `rejects proof bound to another signal (O2)`.
- `test/live/arkiv-ledger.test.ts`: `describeLedger` over a fake `ArkivClientLike`; `expiration rounds up (expiresIn 604800 ⇒ ExpirationTime.fromSeconds(604800) = 302400 blocks; 601 ⇒ 602 s)`; `expiresIn > 15768000 ⇒ invalid_request before any call`; `rabdi chain id 7794095 and access key in the RPC path`; `query paginates past 100 rows by $key`; `transport error ⇒ AdapterError unavailable, never null`; `annotations become string/number attributes and back`.
- `test/live/world-personhood.test.ts`: `POST /api/v4/verify/{rp_id} with the IDKit result byte-for-byte (fixture strictBody)`; `200 ⇒ result with the verifier's level (proof_of_human→orb, passport→document)`; `decimal nullifier ⇒ hex32`; `environment or action mismatch ⇒ invalid_proof`; `signal_hash ≠ hashToField(signal) ⇒ invalid_proof`; `session result rejected`; `nullifier_replayed ⇒ already_verified`; `all_verifications_failed ⇒ invalid_proof`; `malformed 200 ⇒ invalid_response (L6)`; `hashToField vectors`; `world-rp-context.test.ts`: `signRequest output matches rp-context-vector`, `key never appears in the result or logs`.
- `test/live/remote-facilitator.test.ts`: `supported gate`, `Hedera feePayer read from supported and pinned by expectFeePayer`, `bodies carry amount, never maxAmountRequired`, `Hedera transactionId normalised into transaction`, `settlement_pending polled then resolved`, `@x402/core decodes every fixture body`, `verify/settle request bodies match the spec`, `success without tx ⇒ invalid_response`, `foreign network ⇒ invalid_response (L10)`, `host outside allow-list ⇒ constructor throws`.
- `test/live/self-run-facilitator.test.ts` (viem stubs): `recovers signer from a real viem signature`, `rejects wrong signer / expired / not yet valid / used nonce / insufficient balance / value ≠ amount`, `settle returns success after a front-run that burned the nonce (A15)`, `per-from rate limit (A16)`.
- `test/live/esimaccess-reseller.test.ts`: `describeReseller` over fixtures; `RT-Signature = HMAC(accessCode, timestamp+requestId+accessCode+rawBody), lower-case hex`; `price ×100 ⇒ Usd6, volume bytes ⇒ MB (L7)`; `empty ac for 30 s ⇒ unavailable (pending-profile)`; `LPA not matching the pattern ⇒ invalid_response`; `duplicate transactionId (310402) ⇒ same profile (L8)`; `topUp resolves esimTranNo and a top-up packageCode`; `webhook: wrong token / foreign IP / replayed body ⇒ rejected; CHECK_HEALTH ⇒ []`; `8 req/s limiter`. `test/live/megaesim-reseller.test.ts`: `every method throws unavailable`; `liveConfigSchema rejects RESELLER=megaesim`.
- `test/live/inventory-reseller.test.ts`: `two concurrent orders ⇒ two distinct profiles (L9)`, `file never contains "LPA:" in clear`, `repeat key ⇒ same profile`, `topUp ⇒ unavailable`.
- `test/live/hcs-log.test.ts`: `describeConsensusLog` over a fake Hedera client + mirror fixture; `> 1024 bytes rejected before submit (L12)`; `hcs14Uaid matches the recorded vector (skipped until live)`.
- `test/live/ens-resolver.test.ts`: `Cyrillic а in rаhul.eth ⇒ invalid_name (L11)`, `Alice.ETH ⇒ alice.eth`, `unresolvable ⇒ null`, `mainnet failure ⇒ fallback used`.
- `test/live/swarm-blobs.test.ts`, `test/live/treasury.test.ts`, `test/live/routing-*.test.ts` (dispatch by network; unknown network ⇒ `unsupported_scheme`).
- `packages/eip3009/test`: `vectors.test.ts` (every fixture digest reproduced; every recorded signature recovers to Anvil #5); `recover.test.ts` (`high-s rejected (A17)`, `v = 0/1 normalised`, `EIP-2098 64-byte accepted`); `calldata.test.ts` (decodes back with viem `decodeFunctionData`; selector of the bytes-signature overload); `domain.test.ts` (`chainId 31337 vs 84532 ⇒ different digests (A14)`; `readDomain` uses `eip712Domain()` then falls back to `name()/version()`); `relayer.test.ts` (`simulate=true` sends nothing when `eth_call` reverts).
- `test/testing/fixture-fetch.test.ts`: `FixtureMiss lists the nearest URLs`, `query order does not matter`, `strictBody compares canonical JSON`.

## 8. Definition of done

- `pnpm --filter @ethglobal/adapters --filter @ethglobal/eip3009 build typecheck lint test` green; coverage ≥ 95 % lines in both (the fixture-driven live tests count); the scaffold's existing tests still pass (ledger/payment-rail/personhood/name-resolver/inference/factory).
- `createAdapters('live')` no longer throws: `import { createLiveAdapters, liveConfigSchema } from '@ethglobal/adapters/live'` builds a full bundle from a valid env (unit test with a fake env; no network).
- `pnpm why @hiero-ledger/sdk` resolves to one version (2.90.1) and nothing depends on `@hashgraph/sdk` or unscoped `hedera-agent-kit`.
- `apps/web` can import `@ethglobal/adapters` root export without pulling `@hiero-ledger/sdk`, `@x402/hedera` or `@arkiv-network/sdk` (a build-size test: `node -e "import('@ethglobal/adapters')"` in a browser-like condition, or simply: the root barrel never imports `./live`).
- Every `[verify Wed]` item is listed in `packages/adapters/README.md` under "Record on Wednesday" with the fixture file to overwrite and the command to run.
- `fixtures/**` exist with `"source": "docs"`; `fixtures/inventory.example.json` only; `.gitignore` has `fixtures/inventory.enc`.

## 9. The three most likely bugs — avoid them

1. **Treating "not found" and "unreachable" alike.** `ArkivLedger.get/query` must throw `unavailable` on any transport/SDK error and return `null`/`[]` only for a genuine miss; the challenge replay check fails **open** otherwise (T-20). Likewise `WorldCloudPersonhood` must never turn a non-200 or a malformed body into a success (T-38).
2. **Units and encodings at the reseller boundary.** eSIM Access prices are 1/10 000 USD and volumes are bytes; `wholesaleUsd6 = price × 100`, `dataMb = floor(bytes / 1e6)`; webhook signatures are over the **raw body string** (read it before any JSON parse) and timestamps are **ms** on eSIM Access but **seconds** in the mock and in `verifyWebhookSignature` — convert explicitly, assert in the fixture test.
3. **EIP-712 domain assumptions.** Never hard-code `("USD Coin","2")`: Base Sepolia's Circle USDC signs as **`("USDC","2")`**, mainnets as `("USD Coin","2")` (API-FACTS §7). The name travels in `accepts[].extra` (from protocol `USDC_EIP712_DOMAIN`), `domainFromRequirements()` builds the domain, and `readDomain()` (ERC-5267 `eip712Domain()`, fallback `name()/version()`) cross-checks it per token, cached, recorded in `fixtures/eip3009/domains.json`; the MockUSDC3009 digest test passing does not prove Base Sepolia's faucet USDC will verify. And `recoverSigner` must normalise `v ∈ {0,1}` to `{27,28}` before rejecting.
