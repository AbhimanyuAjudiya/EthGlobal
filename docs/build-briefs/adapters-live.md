# Build brief — `adapters-live` (wave 1)

**You are building:** the ports, mocks and **live adapters** in `packages/adapters` (`@ethglobal/adapters`), the shared `@ethglobal/eip3009` package, the `@ethglobal/adapters/testing` helpers (fixture transport, contract suites), and the initial `fixtures/` tree. Live adapters are **real code written against the documented sponsor APIs**; the sandbox cannot reach any of them (`docs/ENVIRONMENT-CONSTRAINTS.md`), so every live adapter is tested against recorded-exchange fixtures through an injected `fetch`, and the **same contract suite** runs against the mock and the live implementation of each port. Humans record real fixtures at the Wednesday pre-deploy; where this brief's shape disagrees with what they record, the recording wins and the adapter is fixed.

**Read first:** this brief; `docs/INTERFACES.md` §0.1, §1.5, §1.7–1.8, §1.11 (what you consume from protocol), §3 and §4 (your public surface — copied below), §10 (fixture catalogue), §11 (env), §13; `docs/THREAT-MODEL.md` §5.2 (T-13…T-17) and §5.5 (T-35…T-44); `docs/ARCHITECTURE.md` §7 (the wiring table); the scaffold: `packages/adapters/{README.md,package.json,src/**,test/**}`.

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
src/live/world-personhood.ts       // WorldCloudPersonhood
src/live/remote-facilitator.ts     // RemoteFacilitator
src/live/self-run-facilitator.ts   // SelfRunFacilitator
src/live/routing-rail.ts           // RoutingPaymentRail
src/live/esimaccess-reseller.ts    // EsimAccessReseller
src/live/megaesim-reseller.ts      // MegaEsimReseller
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
package.json                       // exports: ".", "./live", "./testing"; deps: @ethglobal/protocol, @ethglobal/crypto, @ethglobal/eip3009, viem, @arkiv-network/sdk, @hashgraph/sdk, zod
README.md                          // the port table extended; mock behaviours; how to record a fixture
```
### 1.2 `packages/eip3009` — implement the skeleton the interfaces wave created
```
src/index.ts  src/typed-data.ts  src/digest.ts  src/recover.ts  src/calldata.ts  src/relayer.ts  src/abi.ts  src/domain.ts
test/{vectors,recover,calldata,relayer}.test.ts     // vectors.test reads fixtures/eip3009/vectors.json written by the contracts workstream
```
### 1.3 `fixtures/` — initial versions written from documentation (every file carries `"source": "docs"` until a human re-records it with `"source": "live"`)
Paths exactly as INTERFACES §10: `world/*`, `facilitator/x402org/*`, `facilitator/hedera/*`, `reseller/esimaccess/*`, `reseller/megaesim/*` (placeholder until the sandbox is recorded Tue), `arkiv/*`, `hcs/*`, `ens/*`, `eip3009/domains.json`, `swarm/*`, `inventory.example.json`.

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
export class WorldCloudPersonhood implements Personhood { constructor(opts: { appId: string; fetch?: typeof fetch; baseUrl?: string }) }
export class RemoteFacilitator implements PaymentRail { constructor(opts: { url: string; fetch?: typeof fetch; allowedHosts: string[]; networks: string[] }) }
export class SelfRunFacilitator implements PaymentRail { constructor(opts: { publicClient; relayer: Relayer; token: Address; chainId: number; network: string; now: () => number; perFromRateLimit?: number }) }
export class RoutingPaymentRail implements PaymentRail { constructor(rails: Record<string, PaymentRail>) }
export class EsimAccessReseller implements Reseller { constructor(opts: { accessCode: string; secret: string; webhookSecret: string; fetch?: typeof fetch; baseUrl?: string; now: () => number }) }
export class MegaEsimReseller implements Reseller { constructor(opts: { apiKey: string; webhookSecret: string; fetch?: typeof fetch; baseUrl?: string; now: () => number }) }
export class InventoryReseller implements Reseller { constructor(opts: { file: string; sealKey: Uint8Array; now: () => number }) }
export class FallbackReseller implements Reseller { constructor(primary: Reseller, fallback: Reseller) }
export class HcsLog implements ConsensusLog { constructor(opts: { client: HederaClientLike; mirrorUrl: string; fetch?: typeof fetch }) }
export function hcs14Uaid(input: { registry: 'hedera'; name: string; version: string; protocol: 'x402'; nativeId: string; skills?: string[] }): string;
export class EnsResolver implements NameResolver { constructor(opts: { mainnetClient; fallbackClient? }) }
export class SwarmBlobStore implements BlobStore { constructor(opts: { beeUrl: string; postageBatchId: string; fetch?: typeof fetch }) }
export class EvmTreasury implements Treasury { constructor(opts: { walletClient; publicClient; token: Address; network: string }) }
export class HederaTreasury implements Treasury { constructor(opts: { client: HederaClientLike; tokenId: string; network: string }) }
export class RoutingTreasury implements Treasury { constructor(byNetwork: Record<string, Treasury>) }

// ── testing (§3.4)
export const T0: number;
export function fakeClock(start?: number): { now: () => number; advance(ms: number): void; set(ms: number): void };
export const anvilAccounts: readonly Address[]; export const anvilKeys: readonly Hex[];
export const anvilRoles: { deployer: 0; payout: 1; attestor: 2; sponsor: 3; agent: 4; human: 5; relayer: 6; stranger: 7 };
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

Rule for every live adapter: build requests with `httpJson` from `@ethglobal/protocol/http` (injected `fetch`); validate **every** response with a zod schema in `src/live/<adapter>.ts` (never trust shape, T-38/T-39/T-42); map failures through `src/live/errors.ts` to `AdapterError(adapter, code)` with codes from this closed list: `invalid_proof`, `already_verified`, `invalid_response`, `unavailable`, `rate_limited`, `unauthorized`, `nonce_already_used`, `requirements_mismatch`, `insufficient_amount`, `expired`, `not_yet_valid`, `unsupported_scheme`, `fixture_miss`.

### 3.1 World ID cloud verifier — `WorldCloudPersonhood` `[verify Wed]`
`POST {baseUrl}/api/v2/verify/{app_id}` · `Content-Type: application/json`
```json
{ "nullifier_hash": "0x…", "merkle_root": "0x…", "proof": "0x…", "verification_level": "orb", "action": "recharge-welcome", "signal_hash": "0x…" }
```
`signal_hash = hashToField(signal)` = `keccak256(bytes) >> 8` as 0x-hex (IDKit's `hashToField`; vectors in `fixtures/world/hash-to-field-vectors.json`; when `context.signal` is a 0x-hex string, hash its **bytes**; when plain text, its UTF-8). 200 → `{ "success": true, "action": "…", "nullifier_hash": "0x…", "created_at": "…", "max_uses": 0, "uses": 1 }` ⇒ `{ nullifierHash, level }` where `level` comes from the **request we sent only if the response echoes none** — document this: the v2 API verifies the level claimed in the body against the proof, so a mismatch is a 400, never an upgrade (T-22). 400 → `{ "code": "invalid_proof" | "invalid_merkle_root" | "max_verifications_reached" | "verification_level_mismatch" | "action_inactive" | …, "detail": "…", "attribute": null }` ⇒ `max_verifications_reached → already_verified`, everything else `→ invalid_proof`; 429 → `rate_limited`; 5xx/timeout → `unavailable`. Non-JSON or unknown shape → `invalid_response` (never success).

### 3.2 x402 facilitator — `RemoteFacilitator` (EVM exact: x402.org; Hedera exact: hedera-dev `[verify Wed]`)
`GET {url}/supported` → `{ "kinds": [ { "x402Version": 2, "scheme": "exact", "network": "eip155:84532" }, … ] }` — the adapter refuses to be constructed for a network not listed (log + `unavailable` at first use). `POST {url}/verify` and `POST {url}/settle` with `{ "x402Version": 2, "paymentPayload": <PaymentPayload>, "paymentRequirements": <PaymentRequirements> }` → `verifyResultSchema` / `settleResultSchema` from protocol; a settle `success: true` without a plausible `transaction` (EVM: 32-byte hex; Hedera: `0.0.x@seconds.nanos` or a 48-byte hex hash) or with `network ≠ requested` ⇒ `AdapterError('payments','invalid_response')` (T-42). `allowedHosts` is checked on the URL at construction (`x402.org`, `*.hedera.com`, `localhost`).

### 3.3 Self-run facilitator — `SelfRunFacilitator` (EVM exact only)
`verify`: payload must be `isEvmExact`; `accepted` equals `requirements`; `typedDataTransferWithAuthorization(domain, auth)` with the domain from `readDomain()` cached per token; `recoverSigner(digest, signature) == from`; `to == payTo`; `value == amount` (exact); `validAfter < now/1000 < validBefore`; `authorizationState(from, nonce) == false`; `balanceOf(from) ≥ value`; per-`from` rate limit (default 5/min, T-16). `settle`: verify again, `relayer.submit(token, encodeTransferWithAuthorization(auth, sig))` (simulated first), wait for the receipt; `status 'reverted'` with `authorizationState == true` afterwards ⇒ look for `Transfer(from, payTo, value)` in the last 20 blocks and, if found, return `success: true` with that tx (settlement front-run, T-15); else `{ success:false, errorReason }`. Prefer `receiveWithAuthorization` **only** when `payTo` equals the relayer's address (then only we can submit).

### 3.4 Arkiv — `ArkivLedger` over `@arkiv-network/sdk` `[verify Wed]`
Wrap the SDK behind `ArkivClientLike { createEntity({ payload: Uint8Array, contentType, attributes, expiresIn }): Promise<{ entityKey }>; getEntity(key): Promise<{ payload, attributes, expiresAtBlock } | null>; query(expr: string, limit): Promise<Entity[]>; updateEntity({ entityKey, payload, attributes, expiresIn }): Promise<{ entityKey }>; blockNumber(): Promise<number> }` — an interface you define so the SDK surface is isolated in one file and fixtures mock **this** interface, not HTTP. Chain id 60138453025 (Kaolin), RPC/WS from env, key from `ARKIV_PRIVATE_KEY`. `expiresIn` (seconds) → BTL blocks = `ceil(seconds × 1000 / blockTimeMs)` (round **up**; log the implied drift once per hour, T-35). Annotations → attributes (strings and numbers; the SDK indexes equality); `query({ annotations })` → `AND` of `eq` terms, e.g. `type = "entitlement" && key = "ent:v1:0x…"`; `limit` passed through. `LedgerEntity.expiresAt` = `(expiresAtBlock − currentBlock) × blockTimeMs + now` (the ledger's view). Any SDK/transport error → `AdapterError('ledger','unavailable')` — never `null` (a `null` means "not found", which fails open in the challenge path).

### 3.5 eSIM Access — `EsimAccessReseller` `[verify Wed]` (docs: esimaccess.com/docs-category/api/)
Base `https://api.esimaccess.com/api/v1/open`. Headers on every call: `RT-AccessCode`, `RT-RequestID` (uuid), `RT-Timestamp` (ms), `RT-Signature` = lower-case hex HMAC-SHA256(secret, `${timestamp}${requestId}${accessCode}${body}`), `Content-Type: application/json`.
- `POST /package/list` `{ "locationCode": "IN", "type": "BASE" }` → `{ "success": true, "obj": { "packageList": [ { "packageCode", "slug", "name", "price": 11400, "currencyCode": "USD", "volume": 1073741824, "duration": 7, "durationUnit": "DAY", "location": "IN" } ] } }` — `price` is in **1/10 000 USD** ⇒ `wholesaleUsd6 = price × 100`; `volume` is **bytes** ⇒ `dataMb = mbFromBytes(volume)`.
- `POST /esim/order` `{ "transactionId": <idempotencyKey>, "amount": <price>, "packageInfoList": [ { "packageCode", "count": 1, "price" } ] }` → `{ "obj": { "orderNo" } }`; then `POST /esim/query` `{ "orderNo", "pager": { "pageNum": 1, "pageSize": 20 } }` → `{ "obj": { "esimList": [ { "esimTranNo", "iccid", "ac": "LPA:1$…$…", "qrCodeUrl", "smdpStatus", "esimStatus", "totalVolume", "orderUsage", "expiredTime" } ] } }` (poll ≤ 10× with 1 s backoff until `ac` is present). A repeated `transactionId` must return the **same** order (the API rejects duplicates — treat "duplicate transactionId" as "re-query by transactionId").
- `POST /esim/topup` `{ "iccid", "packageCode", "transactionId", "amount" }` → `{ "obj": { "orderNo" } }`; `usage(iccid)` = `POST /esim/query { "iccid" }` → `usedMb = mbFromBytes(orderUsage)`, `totalMb = mbFromBytes(totalVolume)`, `asOf = now`.
- Webhook: `POST` to our URL, body `{ "notifyType": "DATA_USAGE" | "ESIM_STATUS" | "ORDER_STATUS" | "VALIDITY_USAGE", "content": { "iccid", "esimTranNo", "orderNo", "transactionId", "esimStatus", "smdpStatus", "totalVolume", "orderUsage", "remain" } }`, signed with the same `RT-*` headers ⇒ `verifyWebhook` recomputes the HMAC over the **raw body string**, checks `|now − RT-Timestamp| ≤ 300 s`, dedupes on `RT-RequestID` (5-minute cache); `parseWebhook` maps `DATA_USAGE`/`VALIDITY_USAGE` to `UsageEvent` (`eventId = RT-RequestID`), ignores other types. The LPA must match `LPA_PATTERN` before it leaves the adapter (T-39).

### 3.6 MegaeSIM — `MegaEsimReseller` (record the instant sandbox **first**, then implement)
Implement the same five methods against the recorded sandbox; until the fixture exists the adapter is a thin shell whose tests are `describe.skipIf(!fixtureExists)`. Document the sandbox base URL, auth header and price/volume units in `fixtures/reseller/megaesim/README.md` when recorded.

### 3.7 Inventory — `InventoryReseller` (T-41)
`fixtures/inventory.enc` = `sealToServer(key, JSON.stringify([{ iccid, lpa, planId, dataMb, validityDays }]))` (git-ignored; `inventory.example.json` holds `LPA:1$local.test$…` only). `order` opens the file, takes the first unconsumed profile for `planId`, rewrites the file atomically (`write tmp → rename`) with the profile marked `consumedBy: idempotencyKey` **before** returning; a repeated key returns the same profile; `usage` returns `{ usedMb: 0, usageSource }` — the API labels inventory usage "simulated". `topUp` → `AdapterError('reseller','unavailable')` (inventory cannot top up). `plans` lists the file's plans.

### 3.8 Hedera — `HcsLog`, `hcs14Uaid` `[verify Wed]`
`submit`: `new TopicMessageSubmitTransaction().setTopicId(topic).setMessage(message).execute(client)` → `getReceipt` → `{ sequence: receipt.topicSequenceNumber, consensusAt: record consensus timestamp (ms), txId: response.transactionId.toString() }`; messages > 1024 bytes are rejected by the adapter **before** submission (T-44; the SDK would chunk silently). `read`: mirror REST `GET {mirrorUrl}/api/v1/topics/{topic}/messages?sequencenumber=gte:{from}&limit=100&order=asc` → `{ "messages": [ { "consensus_timestamp": "1762171200.123456789", "message": "<base64>", "sequence_number": 1, "topic_id": "0.0.x" } ], "links": { "next": "…" } }` → decode base64, consensus seconds×1000. `hcs14Uaid`: canonical JSON of `{ registry, name, version, protocol, nativeId, skills: sorted }` → `sha256` → base58 → `uaid:aid:<base58>;registry=hedera;nativeId=<nativeId>;proto=x402` — **verify every detail against the HCS-14 spec vector** recorded in `fixtures/hcs/hcs14-vector.json` on Wednesday; the test is `describe.skipIf(vector.source !== 'live')`.

### 3.9 ENS — `EnsResolver`
viem: `normalize(name)` (ENSIP-15; throws on disallowed characters — map to `null` + `AdapterError('names','invalid_name')`… no: `resolve` returns `null` for unresolvable and **throws** `invalid_name` for un-normalisable input, so the API answers 400 vs 404 correctly, T-43), `getEnsAddress({ name })`, `getEnsText({ name, key })` on a mainnet `publicClient`; on transport error fall back to `fallbackClient` (Sepolia) and mark the result `source: 'fallback'` in a debug log. Fixtures are the JSON-RPC exchanges (`eth_call` to the Universal Resolver) replayed through viem's `http` transport with the injected `fetch`.

### 3.10 Swarm — `SwarmBlobStore` `[verify Wed]`
Bee API: `POST {beeUrl}/bzz` with headers `swarm-postage-batch-id`, `content-type` → `{ "reference": "<64 hex>" }`; `GET {beeUrl}/bzz/{reference}/` → bytes. `ref = 'bzz://' + reference`.

### 3.11 Treasuries
`EvmTreasury.refund`: `walletClient.writeContract({ address: token, abi: erc20, functionName: 'transfer', args: [to, usd6] })` → wait for receipt → `{ tx: hash }`; `balanceUsd6` = `balanceOf(payout)`. `HederaTreasury.refund`: `TransferTransaction().addTokenTransfer(tokenId, payer, -usd6).addTokenTransfer(tokenId, to, usd6).setTransactionMemo(memo)`. Both reject `usd6 ≤ 0n`.

## 4. Mocks — behaviour the API, agent and e2e depend on

- `MockReseller`: plans `[ { id:'in-1gb-7d', dataMb: 1000, validityDays: 7, wholesaleUsd6: 1_140_000n }, { id:'in-300mb-7d', dataMb: 300, … 342_000n } ]`; `order` → `iccid = '8991' + 15 deterministic digits`, `lpa = 'LPA:1$local.test$' + idempotencyKey.slice(2, 18)`; repeated key → same profile; `failNextOrder` throws `unavailable` once (T-25 test); `usage` advances `usageMbPerMinute` per minute of the injected clock (the "simulated usage" source); `signedWebhook` produces the mock envelope + `x-recharge-*` headers (INTERFACES §1.7) with HMAC over `${timestamp}.${rawBody}`; `verifyWebhook` enforces the 300-s window and dedupes `x-recharge-event-id`.
- `InMemoryLedger.update`: replaces fields, keeps `createdAt`, recomputes `expiresAt` when `expiresIn` is given; unknown key → `AdapterError('ledger','not_found')`. Queries filter on numeric annotation equality too.
- `MockPersonhood({ expectSignal })`: `fixtureProof(level, signal, seed)` encodes `signal` into `proof.proof` bytes (`0x` + sha256(seed) + signal-bytes); with `expectSignal`, `verify` rejects a proof whose embedded signal ≠ `context.signal` (`invalid_proof`, T-19). Keeps the one-per-(action, nullifier) rule (`already_verified`).
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
- `test/live/arkiv-ledger.test.ts`: `describeLedger` over a fake `ArkivClientLike`; `BTL rounds up (expiresIn 604800 @ 2000 ms ⇒ 302400 blocks)`; `transport error ⇒ AdapterError unavailable, never null`; `annotations become string/number attributes and back`.
- `test/live/world-personhood.test.ts`: `request shape (path, body, signal_hash) asserted by fixture`; `200 ⇒ result with the verifier's level`; `max_verifications_reached ⇒ already_verified`; `400 invalid_proof ⇒ invalid_proof`; `malformed 200 ⇒ invalid_response (L6)`; `hashToField vectors`.
- `test/live/remote-facilitator.test.ts`: `supported gate`, `verify/settle request bodies match the spec`, `success without tx ⇒ invalid_response`, `foreign network ⇒ invalid_response (L10)`, `host outside allow-list ⇒ constructor throws`.
- `test/live/self-run-facilitator.test.ts` (viem stubs): `recovers signer from a real viem signature`, `rejects wrong signer / expired / not yet valid / used nonce / insufficient balance / value ≠ amount`, `settle returns success after a front-run that burned the nonce (A15)`, `per-from rate limit (A16)`.
- `test/live/esimaccess-reseller.test.ts`: `describeReseller` over fixtures; `RT-Signature computed over timestamp+requestId+accessCode+body`; `price ×100 ⇒ Usd6, volume bytes ⇒ MB (L7)`; `LPA not matching the pattern ⇒ invalid_response`; `duplicate transactionId ⇒ same profile (L8)`; `webhook: valid / replay / skew / tampered body`.
- `test/live/inventory-reseller.test.ts`: `two concurrent orders ⇒ two distinct profiles (L9)`, `file never contains "LPA:" in clear`, `repeat key ⇒ same profile`, `topUp ⇒ unavailable`.
- `test/live/hcs-log.test.ts`: `describeConsensusLog` over a fake Hedera client + mirror fixture; `> 1024 bytes rejected before submit (L12)`; `hcs14Uaid matches the recorded vector (skipped until live)`.
- `test/live/ens-resolver.test.ts`: `Cyrillic а in rаhul.eth ⇒ invalid_name (L11)`, `Alice.ETH ⇒ alice.eth`, `unresolvable ⇒ null`, `mainnet failure ⇒ fallback used`.
- `test/live/swarm-blobs.test.ts`, `test/live/treasury.test.ts`, `test/live/routing-*.test.ts` (dispatch by network; unknown network ⇒ `unsupported_scheme`).
- `packages/eip3009/test`: `vectors.test.ts` (every fixture digest reproduced; every recorded signature recovers to Anvil #5); `recover.test.ts` (`high-s rejected (A17)`, `v = 0/1 normalised`, `EIP-2098 64-byte accepted`); `calldata.test.ts` (decodes back with viem `decodeFunctionData`; selector of the bytes-signature overload); `domain.test.ts` (`chainId 31337 vs 84532 ⇒ different digests (A14)`; `readDomain` uses `eip712Domain()` then falls back to `name()/version()`); `relayer.test.ts` (`simulate=true` sends nothing when `eth_call` reverts).
- `test/testing/fixture-fetch.test.ts`: `FixtureMiss lists the nearest URLs`, `query order does not matter`, `strictBody compares canonical JSON`.

## 8. Definition of done

- `pnpm --filter @ethglobal/adapters --filter @ethglobal/eip3009 build typecheck lint test` green; coverage ≥ 95 % lines in both (the fixture-driven live tests count); the scaffold's existing tests still pass (ledger/payment-rail/personhood/name-resolver/inference/factory).
- `createAdapters('live')` no longer throws: `import { createLiveAdapters, liveConfigSchema } from '@ethglobal/adapters/live'` builds a full bundle from a valid env (unit test with a fake env; no network).
- `apps/web` can import `@ethglobal/adapters` root export without pulling `@hashgraph/sdk` or `@arkiv-network/sdk` (a build-size test: `node -e "import('@ethglobal/adapters')"` in a browser-like condition, or simply: the root barrel never imports `./live`).
- Every `[verify Wed]` item is listed in `packages/adapters/README.md` under "Record on Wednesday" with the fixture file to overwrite and the command to run.
- `fixtures/**` exist with `"source": "docs"`; `fixtures/inventory.example.json` only; `.gitignore` has `fixtures/inventory.enc`.

## 9. The three most likely bugs — avoid them

1. **Treating "not found" and "unreachable" alike.** `ArkivLedger.get/query` must throw `unavailable` on any transport/SDK error and return `null`/`[]` only for a genuine miss; the challenge replay check fails **open** otherwise (T-20). Likewise `WorldCloudPersonhood` must never turn a non-200 or a malformed body into a success (T-38).
2. **Units and encodings at the reseller boundary.** eSIM Access prices are 1/10 000 USD and volumes are bytes; `wholesaleUsd6 = price × 100`, `dataMb = floor(bytes / 1e6)`; webhook signatures are over the **raw body string** (read it before any JSON parse) and timestamps are **ms** on eSIM Access but **seconds** in the mock and in `verifyWebhookSignature` — convert explicitly, assert in the fixture test.
3. **EIP-712 domain assumptions.** Never hard-code `("USD Coin","2")` in a live path: `readDomain()` (ERC-5267 `eip712Domain()`, fallback `name()/version()`) per token, cached, recorded in `fixtures/eip3009/domains.json`; the MockUSDC3009 digest test passing does not prove Base Sepolia's faucet USDC will verify. And `recoverSigner` must normalise `v ∈ {0,1}` to `{27,28}` before rejecting.
