# Build brief — `api` (wave 2)

**You are building:** `services/api` (`@ethglobal/api`) — the Hono service that is Recharge's only server: it issues challenges, verifies World ID proofs, releases sponsor USDC through `DataDrop.claim`, answers HTTP 402 with x402 terms, settles payments through a facilitator, orders eSIM profiles, seals activation codes to the buyer's session key, writes every entitlement/receipt/gift to the ledger (Arkiv) and every receipt to HCS, serves the sponsor dashboard from ledger queries, and hosts a self-run x402 facilitator. All business rules live in `@ethglobal/octroi`; this service is **transport, orchestration and persistence**.

**Read first:** this brief; `docs/vendor/API-FACTS.md` §1 (x402 v2), §4 (World ID / IDKit 4), §5.1 (eSIM Access); `docs/INTERFACES.md` §13 A-18…A-30 (what those facts changed); `docs/INTERFACES.md` §1.6–1.9 (your bodies, headers, error codes), §1.12 (typed data you verify), §3 (ports), §5 (octroi — what you call), §6.3 (ABI/addresses), §7 (**your HTTP contract — copied below**), §11 (env), §13; `docs/ARCHITECTURE.md` §2 (the flows step by step), §6, §8, §9, §10; `docs/THREAT-MODEL.md` §5.6 (T-45…T-54), T-24, T-25, T-31, T-50, T-68; the scaffold: `services/api/{README.md,package.json,src/*,test/*}`.

**Toolchain:** Hono 4 on `@hono/node-server`, zod 4, pino, viem 2; vitest with `app.request()` (no supertest); `@hono/zod-openapi` (zod-4-compatible version — pin in the catalog) for `GET /openapi.json`.

---

## 1. Files

```
services/api/src/index.ts                 // boot (exists) + graceful shutdown; prints mode, chain, accepts[]
services/api/src/env.ts                   // extend the zod schema with INTERFACES §11; the live-mode refusals (Anvil keys, debug logs, short secret, non-testnet networks)
services/api/src/chain.ts                 // keep ChainIdResolver; + createDataDropClient(env) (viem): claim(id, claimKey) via a single-sender queue, campaign(id), claimed(id,key), claimsInHour(id,bucket), currentHourBucket(), decodeRevert(error) → DATADROP_ERRORS name
services/api/src/logger.ts                // + redact list (T-50), `event` field discipline (LOG_EVENTS)
services/api/src/deps.ts                  // buildDeps(env) → { adapters, octroiDeps, stores, dataDrop, cache, metrics, secret, sealKey, admission, nonceCache }
services/api/src/app.ts                   // createApp(deps): middleware chain + routes; keep /healthz and the 404/500 handlers
services/api/src/middleware/request-id.ts  logger.ts  security-headers.ts  cors.ts  rate-limit.ts  body-limit.ts  idempotency.ts  validate.ts  x402.ts  octroi.ts  sponsor-auth.ts  errors.ts
services/api/src/flows/entitle.ts         // decideAndFulfil(): the ONE function behind /claim, /esim/provision, /gift/claim, /card/redeem (ARCHITECTURE §8 rule 11)
services/api/src/flows/fulfil.ts          // order/topUp + seal + blobs.put + store writes + receipt + HCS; retry of pending-profile
services/api/src/flows/reclaim.ts         // decideGiftReclaim + pending receipt + treasury.refund + patch + HCS
services/api/src/flows/sponsor.ts         // register, view (chain counters + receipts + expiring)
services/api/src/routes/{plans,challenge,world,claim,esim,gift,card,webhooks,me,sponsor,agent-policy,facilitator,openapi,metrics}.ts   // world.ts = POST /world/rp-context (A-25)
services/api/src/accepts.ts               // builds the AcceptTemplate[] once at boot: EVM extra {name,version} from USDC_EIP712_DOMAIN; Hedera extra.feePayer from the facilitator's /supported, maxTimeoutSeconds 180 (A-20, A-21)
services/api/src/cache.ts                 // 60-s TTL map keyed by entitlement key, read path only (T-51); `degraded` flag source
services/api/src/admission.ts             // per-campaign admission queue sized to remaining hourly cap (T-46); nonce cache pruning
services/api/src/anomaly.ts               // ≥ 80 % of claimsPerHour within 10 min ⇒ DataDrop.pause(id, true) by the attestor + alert log (T-01)
services/api/src/metrics.ts               // timed(name, fn), counters, histograms, /metrics.json
services/api/src/errors.ts                // the one mapper: Decision.deny / RechargeError / AdapterError / chain revert → { error, message, details, requestId }
services/api/openapi.json                 // generated and committed; `pnpm --filter @ethglobal/api openapi` regenerates; `openapi:check` diffs
services/api/test/{env,app,challenge,world,accepts,claim,esim,gift,reclaim,card,webhooks,me,sponsor,agent-policy,facilitator,x402-middleware,errors,admission,anomaly,cache}.test.ts
services/api/test/flow.e2e.test.ts        // the Supertest-style full loop of DECISION §6.5 against createApp with local adapters + a viem stub of DataDrop (Anvil-backed variant runs from scripts/e2e-local.sh)
services/api/README.md                    // routes, env, modes, "Where Hedera lives in the code" (DECISION §4 README section)
```

## 2. HTTP contract (verbatim from `docs/INTERFACES.md` §7)

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
| `PUT /agent/policy` | `agentPolicyPutSchema` | 200 `agentPolicyViewSchema` | EIP-712 `AgentPolicy`; owner must equal the entitlement's `payer` (paid) or be the first owner registered for a free entitlement |
| `GET /agent/policy/:key` | — | `agentPolicyViewSchema` | public read |
| `GET /facilitator/supported` · `POST /facilitator/verify` · `POST /facilitator/settle` | `{ x402Version, paymentPayload, paymentRequirements }` | `{ kinds, extensions: [], signers }` · `verifyResultSchema` · `settleResultSchema` | the self-run facilitator (EVM exact) |
| `GET /openapi.json` | — | OpenAPI 3.1 | generated; `pnpm openapi:check` |

**Middleware order (fixed):** `requestId → logger → securityHeaders (no-store, nosniff, no-referrer) → cors(allow-list) → rateLimit(ip; X-Forwarded-For only when TRUST_PROXY=1) → bodyLimit(64 KiB) → idempotency(Idempotency-Key, 24 h, POST only) → validate(zod) → x402() → octroi() → handler → errorMapper`.

**Decision → HTTP:** `payment-required → 402`; `deny: replay → 409 replay`; `paused → 423 campaign_paused`; `cap → 429 hourly_cap`; `budget → 409 budget_exhausted`; `invalid-proof → 401`; `invalid-payment → 402 invalid_payment`; `expired → 410`; `no-campaign → 404 not_found`; `ledger-unavailable → 503`; `invalid-request → 400`.

## 3. Middleware behaviour

- `request-id`: use the client's `X-Request-Id` if it is 8–64 URL-safe chars, else mint one; echo it on every response; put it on `c.var.log`.
- `security-headers`: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`; API responses are JSON only.
- `cors`: exact-origin allow-list from `CORS_ORIGINS`; expose `PAYMENT-REQUIRED`, `PAYMENT-RESPONSE`, `X-Request-Id`; allow `PAYMENT-SIGNATURE`, `X-Session-Pubkey`, `Idempotency-Key`, `Authorization`, `Content-Type`. No credentials (T-54).
- `rate-limit`: token buckets in memory per key; keys `ip`, and per route `ip:/challenge` (10/min), `ip:/world/rp-context` (10/min), `ip:/claim` (5/min), `ip:/card/redeem` (10/min), `ip:/gift/reclaim` (5/min), `iccid:/me/refresh` (1/min); 429 with `Retry-After`; **runs before any ledger access** (T-45).
- `body-limit`: 64 KiB JSON; webhooks 256 KiB raw.
- `idempotency`: `Idempotency-Key` header on `POST /gift`, `/gift/claim`, `/gift/reclaim`, `/card/redeem`, `/sponsor`: same key within 24 h ⇒ replay the stored response (status + body + `PAYMENT-RESPONSE`); in-flight duplicate ⇒ 409 `replay`. Money paths are additionally idempotent by their natural keys (payment nonce, nullifier, giftId) so a missing header is not a hole.
- `validate`: zod on body/query/params with the schema named in §2; 400 `invalid_request` with the issue path in `details`.
- `x402()`: x402 **v2** only (A-18): bodies carry `accepts[].amount` (never `maxAmountRequired`), headers are `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE` (never v1 `X-PAYMENT`). If `PAYMENT-SIGNATURE` is present → `decodePaymentPayload` (16 KiB cap; malformed ⇒ 400) → `c.set('payment', payload)`; reads `X-Session-Pubkey` → `c.set('sessionPubKey')`. After the handler: if the decision was `payment-required`, respond `402` with the body **and** `PAYMENT-REQUIRED: encodePaymentRequired(body)`; if `serve-paid`, add `PAYMENT-RESPONSE: encodePaymentResponse(settlement)`.
- `octroi()`: assembles `DecideRequest` from the route's declared lane (`free | paid | none`), the body/query, `c.var.payment`, `c.var.sessionPubKey`, the campaign (`CampaignStore.get` + `dataDrop.campaign/claimsInHour/currentHourBucket` → `CampaignCounters`), takes the **admission slot** for the free lane, runs `decide()`, stores the `Decision` on `c.var.decision`, releases the slot on any outcome other than `serve-free` (released after the chain receipt otherwise).
- `sponsor-auth`: parses `Authorization: Recharge-Sponsor <base64 JSON {sponsor, issuedAt, signature}>`, verifies EIP-712 `SponsorLogin{campaignId, sponsor, issuedAt}` with viem `verifyTypedData` over `rechargeDomain(CHAIN)`, `|now − issuedAt| ≤ 1 h`, `sponsor == campaign.sponsor` (ledger) `== dataDrop.campaign(id).sponsor` (chain); 401 otherwise.
- `errors`: the only place that builds an error response (ARCHITECTURE §9): `RechargeError`, `AdapterError` (via `ADAPTER_CODE_MAP`), chain reverts (`decodeRevert` → `already_claimed | hourly_cap | campaign_paused | campaign_expired | budget_exhausted | campaign_exists`), `ZodError → invalid_request`, anything else → 500 `internal_error` with `requestId` only. 5xx retryable codes carry `Retry-After: 5`.

## 4. Flows

### 4.1 `decideAndFulfil(c, lane)` — `flows/entitle.ts`
```
decision = c.var.decision
switch decision.kind:
  'payment-required' → return 402 (x402() adds the header)
  'deny'             → throw mapped RechargeError (table above)
  'serve-free'       → tx = await dataDrop.claim(campaignId, decision.claimKey)       // single-sender queue; revert → mapped error; admission slot released after
                        receiptKind 'claim'; fundedBy campaign; HCS 'claim'
  'serve-paid'       → receiptKind 'provision' (or 'topup' on /esim/topup; 'gift' on /gift); HCS 'settle'
entitled = await fulfil(decision.entitlement, { nonce, sessionPubKey, claimTx?, settlement?, receiptKind })
respond 201 (or 200 for topup, 202 when status === 'pending-profile') with entitledResponseSchema / topUpResponseSchema
```
Variants: `/esim/topup` passes the **existing** entitlement (looked up by `key`, must be live; 410 otherwise) and on `serve-paid` calls `fulfilTopUp(existing, mb, settlement)` instead; `/gift/claim` and `/card/redeem` run `consumeChallenge` + signature/PIN checks **before** building the entitlement (`kind: 'gift' | 'card'`, `key: keys.entitlementGift(giftId)`), then `fulfil`; campaign-funded cards go through `dataDrop.claim(campaignId, keccak(campaignId ‖ hmacKey(secret,'card',pin)))` first.

### 4.2 `fulfil(entitlement, ctx)` — `flows/fulfil.ts`
1. `EntitlementStore.create(entitlement)` with `status: 'pending-profile'` **first** (durable intent; T-25).
2. `profile = await reseller.order(planId, { idempotencyKey: entitlement.key })` — on `AdapterError` → leave `pending-profile`, write the receipt, HCS, respond **202** (`sealedLpa` absent). `/me/:key` retries `order` with the same key when it sees `pending-profile` (≤ 1/min).
3. `assert LPA_PATTERN.test(profile.lpa)`; `sealed = sealLpa(profile.lpa, hexToBytes(ctx.sessionPubKey), lpaAad(ctx.nonce, entitlement.key))`; drop `profile.lpa` (do not keep it on any object that is logged or returned); `ref = await blobs.put(utf8(JSON.stringify(sealed)), 'application/json')`.
4. `EntitlementStore.patch(key, { status: 'ready', iccidHash: sha256Hex(iccid), iccidEnc: sealToServer(sealKey, iccid, utf8(key)), sealedRef: ref })`.
5. `ReceiptStore.add({ kind, entitlementKeyHash: sha256Hex(key), campaignId?, mb, usd6?, network?, tx: claimTx | settlement.transaction, payer?, at: now })` → `consensus.submit(topic, encodeHcs({...}))` (failure is logged, not fatal: HCS is a receipt, not a gate) → patch the receipt with `{ hcs: { topic, sequence } }`.
6. Return `{ …entitledResponse, sealedLpa: sealed }` — the only time the sealed box leaves the server (T-31). The response object is built from a fresh literal; never spread `profile`.
`fulfilTopUp`: `reseller.topUp(openFromServer(iccidEnc), mb, { idempotencyKey: nonce })` → `EntitlementStore.patch(key, { mbTotal: +mb }, { expiresAt: max(existing.expiresAt, now + validityDays) })` → receipt `topup` (or `agent-topup` with `uaid` when the request carries `X-Agent-Uaid`) → HCS `settle`.

### 4.3 `reclaim(c)` — `flows/reclaim.ts`
`consumeChallenge` (path `/gift/reclaim`) → verify EIP-712 `GiftReclaim{giftId, payer, nonce: challenge.nonce}` signer == `payer` → `escrow = GiftStore.bySerial(serialFromGiftId)` (expect `null`), `receipts = ReceiptStore.forGift(giftId)` (receipts carry `campaignId`-free gift linkage via `entitlementKeyHash = sha256(keys.gift(giftId))` — write gift receipts with that hash) → `ledgerOk` = both calls succeeded → `verdict = decideGiftReclaim(...)` → deny ⇒ 409/404/410 by reason; refund ⇒ `mutex(giftId)`: `TREASURY_MAX_USD6_PER_DAY` check (sum today's `gift-reclaim` receipts) → `ReceiptStore.add({ kind:'gift-reclaim', tx: undefined, usd6 })` → `treasury.refund({ network, to, usd6, memo: giftId })` → patch receipt `{ tx }` → HCS `gift-reclaim` → `giftReclaimResponseSchema`. If `refund` throws after the pending receipt exists, the receipt keeps `tx: undefined` and the route answers 503 `facilitator_unavailable`-class (`treasury_unavailable` is mapped to `chain_unavailable`); a retry sees the pending receipt and **does not** refund again (operator reconciles).

### 4.4 Chain client — `chain.ts`
viem `walletClient` with `ATTESTOR_PRIVATE_KEY` on `RPC_URL`/`CHAIN`; ABI from `@ethglobal/contracts/abi/DataDrop.json`; address from `DATADROP_ADDRESS` or `deploy/addresses.<slug>.json`. `claim()` goes through a **single async queue** (one in-flight tx per attestor key; nonces managed by viem with `nonceManager`); wait for 1 confirmation (Anvil) / the chain's rule (`CHAIN_CONFIRMATIONS` env, default 1); decode reverts via `decodeErrorResult` to a `DATADROP_ERRORS` name. Hedera relay quirks: set `gas` explicitly (`CLAIM_GAS_LIMIT`, default 150 000), accept legacy tx type when `CHAIN == 296` (`[verify Wed]`). Reads (`campaign`, `claimsInHour`, `claimed`, `currentHourBucket`) are plain `readContract`.

### 4.5 Admission, anomaly, cache
- `admission.ts`: per campaign, `slots = claimsPerHour − claimsInHour(bucket) − inFlight`; `take()` resolves when a slot exists, else the route answers `deny: cap` immediately (**before** `personhood.verify`, T-24/T-46); `release()` after the chain receipt or on failure. Also prunes `nonceCache` entries older than `CHALLENGE_TTL_S + 10 s` every minute.
- `anomaly.ts`: sliding 10-minute window of `Claimed` per campaign; at ≥ 80 % of `claimsPerHour` → `dataDrop.pause(id, true)` from the attestor + `event: 'anomaly'` log; the sponsor unpauses from the dashboard.
- `cache.ts`: `Map<key, { me: MeResponse; at }>` with 60-s TTL, used **only** by `GET /me/:key`; write-through invalidation from `fulfil`, `fulfilTopUp`, webhooks; `degraded = ledger threw within the last 60 s` ⇒ serve cached reads with `degraded: true`, fail every write path with 503 (T-51).

### 4.6 Webhooks — `routes/webhooks.ts`
Read the **raw** body (`await c.req.raw.text()`) before anything parses it; build `headers` from the request headers plus two pseudo-headers the route alone sets (and strips if a client sent them): `x-recharge-url-token` = the `?token=` query value, `x-recharge-remote-ip` = the socket address (`X-Forwarded-For` only when `TRUST_PROXY=1`); `reseller.verifyWebhook(raw, headers, now)` → `ok:false` ⇒ 401 (`replay` ⇒ 409); `events = reseller.parseWebhook(raw)` (`[]` ⇒ 204: eSIM Access `CHECK_HEALTH`/`ORDER_STATUS`); per event: `EntitlementStore.getByIccidHash(sha256Hex(iccid))` → skip unknown; **for `esimaccess` the event is a hint** — eSIM Access documents no webhook signature (A-27), so the route calls `reseller.usage(iccid)` (≤ 1/min/ICCID, shared with `?refresh=1`) and uses **its** `usedMb/totalMb/status`, never the body's numbers; `usedMb` must be ≥ current (`monotonic`; a decrease is logged and ignored, T-34) → `patch({ mbUsed, usageAsOf: asOf, usageSource: 'webhook', status? })` → invalidate cache. Always 204 on success, never 500 for bad input (catch → 400 `invalid_request`).

### 4.6a World ID: `rp_context` and the claim check — `routes/world.ts` (A-25, API-FACTS §4)
- `POST /world/rp-context { audience, path }`: rate-limited, no ledger write; `rpSigner.issue()` (`createRpContextSigner` from `@ethglobal/adapters/live`, wrapping `signRequest({ signingKeyHex: WORLD_RP_SIGNING_KEY, action: WORLD_ACTION, ttl: 300 })` from `@worldcoin/idkit-core/signing`) → `rpContextSchema` `{ rp_id, nonce, created_at, expires_at, signature, app_id, action, environment }`. The signing key never appears in a response, a log or an error (`logs.test.ts` greps for it). Local mode: a fixed test key from `@ethglobal/adapters/testing` and `MockPersonhood` (which ignores the context) — the route exists in both modes so the PWA flow is identical.
- `POST /claim`: `proof` is the IDKit 4 result forwarded unchanged (`personhoodProofSchema`); `octroi()` passes it to `personhood.verify(proof, { action: WORLD_ACTION, signal: challenge.signal })`; `WorldCloudPersonhood` posts it to `https://developer.world.org/api/v4/verify/{WORLD_RP_ID}` and enforces action, environment and `signal_hash`. Nothing in this service reads a tier or nullifier from the request body.
- Not in v0: World **AgentKit** (the x402 `agentkit` extension, beta; "Agent Pass" has no public docs) — `/plans` and the 402 bodies carry no `agentkit` extension; the honest label "IDKit humans only" stays.

### 4.6b Accept terms — `accepts.ts` (A-20, A-21)
At boot, for each network in `X402_NETWORKS`: EVM → `{ scheme:'exact', network, asset: USDC_ASSET[network] ?? addresses.anvil.usdc, payTo: PAYOUT_ADDRESS, maxTimeoutSeconds: PAYMENT_VALIDITY_S, extra: USDC_EIP712_DOMAIN[network] }` (Base Sepolia ⇒ `{ name: "USDC", version: "2" }`; Anvil ⇒ `"USD Coin"`; a network without a domain entry refuses to boot); `hedera:testnet` → `{ asset: '0.0.429274', payTo: PAYOUT_HEDERA_ACCOUNT, maxTimeoutSeconds: 180, extra: { feePayer } }` where `feePayer` comes from the Hedera facilitator's `/supported` (must equal `X402_HEDERA_FEE_PAYER` when set; boot fails otherwise) and `PAYOUT_HEDERA_ACCOUNT` must be associated with `0.0.429274` (checked via the mirror node at boot in live). Every template is validated with `paymentRequirementsSchema` (amount filled with the step price) before the server listens.

### 4.7 Sponsor, agent policy, facilitator, OpenAPI, metrics
- `POST /sponsor`: verify `SponsorLogin`; check on-chain sponsor; `CampaignStore.put(campaignFromPayload)`; respond `{ id, auditKey: bytesToHex(auditKey(secret, id)) }`. `GET /sponsor/:id`: chain counters + `ReceiptStore.forCampaign(id)` mapped to the `claims` rows (`campaignClaimKey` is stored on claim receipts in `details`? — no: store it as the receipt's `payer` field for `kind:'claim'`; document) + `EntitlementStore.expiringWithin(24 h)` for `expiring`; `auditKey` included only on the first authenticated read after registration (`shownAuditKey` flag in the campaign payload).
- `PUT /agent/policy`: verify `AgentPolicy{entitlementKey, owner, policyHash: keccak(canonicalJson(policy)), issuedAt}`; `owner` must equal the entitlement's `payer` for paid entitlements, or be the first registered owner for free ones; `AgentPolicyStore.put`. `GET /agent/policy/:key`: policy + `spentTodayUsd6` (`ReceiptStore.spentUsd6(hash, 'agent-topup', dayBucket(now))`).
- `/facilitator/*`: thin routes over `SelfRunFacilitator` (`supported` returns the v2 shape `{ kinds: X402_NETWORKS ∩ EVM with extra {name,version}, extensions: [], signers: { "eip155:*": [relayer] } }`, A-30); public; rate-limited 30/min/IP.
- `/openapi.json`: `OpenAPIHono` with every route's schemas from `@ethglobal/protocol/schemas` (no re-declaration); `pnpm openapi` writes the file; a test asserts the committed file equals the generated document.
- `/metrics.json` and `/healthz` as ARCHITECTURE §10.

## 5. Dependencies on other workstreams

| Needs | From | Until it lands |
|---|---|---|
| `@ethglobal/protocol`, `@ethglobal/crypto` | interfaces (done before wave 2) | — |
| `@ethglobal/octroi` (`decide`, stores, `decideGiftReclaim`, `challenge`) | octroi (wave 1) | compile against INTERFACES §5; if late, a `src/stubs/octroi.ts` that returns fixed `Decision`s for the route tests — delete before DoD |
| `@ethglobal/adapters` mocks (+ `MockReseller`, `MockConsensusLog`, `MemoryBlobStore`, `MockTreasury`), `@ethglobal/adapters/testing`, `@ethglobal/adapters/live` (`SelfRunFacilitator`, `createLiveAdapters`) | adapters-live (wave 1) | scaffold mocks exist; wrap missing ports with local test doubles in `test/doubles.ts` — delete before DoD |
| `@ethglobal/eip3009` (typed data for the facilitator tests; signing test payments with Anvil keys) | adapters-live | viem `signTypedData` directly in tests |
| `@ethglobal/contracts/abi/DataDrop.json`, `deploy/addresses.anvil.json` | contracts (wave 1) | `DATADROP_ADDRESS` env + a viem stub `test/doubles/datadrop.ts` that models `claim/claimed/claimsInHour/pause` |
| `services/agent` sends `X-Agent-Uaid` on top-ups | agent (parallel wave 2) | header is optional |
| `createRpContextSigner`, `WorldCloudPersonhood` (v4), `EsimAccessReseller` (token/IP webhooks), `RemoteFacilitator.feePayer()` | adapters-live (wave 1) | fixtures in `fixtures/world/*`, `fixtures/facilitator/hedera/supported.json` |

## 6. Acceptance tests (vitest; binding names)

- `env.test.ts`: `defaults to local on 8787 (exists)`; `rejects RESELLER=megaesim in live (A-28)`; `rejects missing WORLD_RP_ID/WORLD_RP_SIGNING_KEY in live (A-25)`; `rejects ARKIV_CHAIN_ID=60138453025 (Kaolin retired, A-23)`; `rejects Anvil attestor key in live (T-52)`; `rejects debug logs in live`; `rejects OCTROI_SECRET < 32 bytes`; `rejects X402_NETWORKS outside testnets unless both sales flags`; `X402_FACILITATOR defaults to self when ANVIL_RPC_URL answers, else mock`.
- `challenge.test.ts`: `returns a MAC-valid challenge bound to sessionPubKey`; `writes nothing to the ledger`; `11th request in a minute → 429 before any work (T-45)`.
- `world.test.ts`: `POST /world/rp-context returns rpContextSchema with expires_at − created_at = 300`; `signature verifies against the RP signer address (fixture vector)`; `the signing key appears in no response or log line`; `11th request in a minute → 429`; `claim with a proof whose signal_hash ≠ hashToField(challenge.signal) → 401`; `claim with a staging-environment result in production → 401`.
- `accepts.test.ts`: `eip155:84532 template carries extra { name: "USDC", version: "2" }`; `anvil template carries "USD Coin"`; `hedera:testnet template carries extra.feePayer from /supported and maxTimeoutSeconds 180`; `fee-payer pin mismatch → boot fails`; `no 402 body ever contains "maxAmountRequired"`.
- `claim.test.ts` (proofs are IDKit-4-shaped `fixtureProof` results): `Orb fixture proof → 201 with sealedLpa, claimTx, receipt.hcs.sequence = 1 and the entitlement entity expiresAt = now + validity`; `same proof twice → 409 replay and exactly one DataDrop.claim`; `paused campaign → 423 and personhood.verify never called (O7)`; `20 concurrent claims with cap 5 → exactly 5 Claimed, 5 orders, 15 × 429 (T-46)`; `device-level proof → 402 with both accepts`; `reseller fails once → 202 pending-profile, then /me retries and becomes ready; Claimed count = 1 (O8)`; `swapped sessionPubKey between /challenge and /claim → 401`.
- `esim.test.ts`: `GET /esim/topup without payment → 402, PAYMENT-REQUIRED decodes to the body, nothing written`; `signed Anvil payment → 200, PAYMENT-RESPONSE, mbTotal +100, expiresAt extended, HCS +1`; `payment nonce reused → 402 invalid_payment`; `mb=199 → 400`; `provision without X-Session-Pubkey → 400`; `provision with nonce ≠ keccak(sessionPubKey) → 402 (C4)`; `21st top-up for one ICCID today → 429 daily_cap`.
- `gift.test.ts`: `unresolvable name → 404 before any 402`; `rahul… → 402 → pay → 201 with pin, serial, claimBy = now + 7 d; gift entity expiresIn = 7 d`; `claim by signature of the resolved address → 201 entitlement giftent:<id>, gift state claimed, HCS gift-claim`; `claim by wrong signer → 401`; `claim by PIN → 201`; `claim after claimBy → 410`.
- `reclaim.test.ts`: `before claimBy → 409 too-early`; `after claimBy with escrow gone → 200, MockTreasury refund usd6 − fee, receipt gift-reclaim with tx, HCS`; `claimed gift → 409`; `second reclaim → 409 already-reclaimed`; `wrong payer → 401`; `ledger throws → 503 and no refund`; `treasury throws → 503, pending receipt kept, retry does not refund twice`; `daily treasury cap → 503`.
- `card.test.ts`: `GET /card/:serial never changes state (bot UA included) (T-47)`; `POST /card/redeem valid pin → 201 and DataDrop.claim for campaign-funded cards`; `11 wrong pins/min → 429`; `redeemed card → 410`.
- `webhooks.test.ts`: `esimaccess: wrong ?token → 401; foreign remote IP → 401; client-sent x-recharge-url-token header is stripped; valid hint → reseller.usage called and its numbers (not the body's) patched; CHECK_HEALTH → 204`; `valid HMAC updates mbUsed/usageAsOf and invalidates the cache`; `invalid → 401`; `replay → 409`; `skew 301 s → 401`; `usedMb decrease ignored`; `garbage body → 400, never 500`.
- `me.test.ts`: `reads the entity (R1), second read within 60 s is cached: true`; `after expiry → 410`; `unknown → 404 with constant-time-ish behaviour`; `?refresh=1 polls reseller once per minute`; `never includes sealedLpa`; `receipts endpoint lists the claim and topup receipts without entitlementKeyHash`.
- `sponsor.test.ts`: `register with a valid SponsorLogin → 201 + auditKey once`; `view lists campaignClaimKeys, chain counters, expiring quotas`; `wrong signer / stale issuedAt → 401`.
- `agent-policy.test.ts`: `PUT with valid AgentPolicy signature by payer → 200`; `wrong owner → 401`; `GET returns spentTodayUsd6 from receipts`.
- `facilitator.test.ts`: `supported lists local network`; `verify/settle round trip with a real viem signature against the Anvil-backed stub`.
- `x402-middleware.test.ts`: `malformed header → 400`; `> 16 KiB → 400`; `402 carries the header`; `success carries PAYMENT-RESPONSE`.
- `errors.test.ts`: every `DenyReason` maps to the documented status; chain revert names map; unknown error hides the stack.
- `anomaly.test.ts`: `80 % of cap in 10 min → pause(true) once`.
- `flow.e2e.test.ts` (the DECISION §6.5 loop in one test, local adapters, `fakeClock`; the step list is BUILD-PLAN §4): challenge → rp-context → claim → entity exists with `expiresAt = now + validity` → `/me` (then cached) → topup 402 → signed payment → 200 + HCS +1 → webhook updates `mbUsed` → invalid HMAC 401 → replay 409 → gift 402 → pay → PIN → gift/claim by signature → entitlement → `/sponsor/:id` lists HMAC'd claims only → advance clock past expiry → `/me` 410 → `/gift/reclaim` refunds. Runs in < 5 s.
- Log scan: `test/logs.test.ts` captures pino output during `flow.e2e` and asserts no `LPA:`, no nullifier value (V4 decimal or hex), no PIN, no `PAYMENT-SIGNATURE` value, no `WORLD_RP_SIGNING_KEY`, no `RT-Signature` value (T-50, T-31).

## 7. Definition of done

- `pnpm --filter @ethglobal/api build typecheck lint test` green; coverage ≥ 90 % lines; `openapi:check` and `pnpm dupcheck` pass; `flow.e2e.test.ts` < 5 s.
- `MODE=local X402_FACILITATOR=self` against a running Anvil + deployed contracts (`scripts/e2e-local.sh`, ops-demo) completes the loop with a **real** `MockUSDC3009` transfer hash in `PAYMENT-RESPONSE` and a real `Claimed` event.
- `MODE=live` boots with `createLiveAdapters` from a fake env in a test (no network) and refuses Anvil keys.
- `README.md` has the route table, env, degradation behaviour, and the "Where Hedera lives in the code" section (`src/routes/esim.ts`, `src/chain.ts`, `src/flows/fulfil.ts` HCS, `services/agent`).
- No route handler contains a business rule (reviewer greps for `sizeBundle|HMAC|tier` in `routes/` — none) and no inline error responses (`c.json({ error` appears only in `errors.ts`).

## 8. The three most likely bugs — avoid them

1. **Reading the body twice or re-serialising it.** Webhook HMACs are over the raw bytes: `await c.req.raw.text()` once, verify, then `JSON.parse` the same string; a zod-validated-then-re-stringified body changes key order and breaks every signature (T-34). Similarly, decode `PAYMENT-SIGNATURE` **once** in `x402()` and hand the object down.
2. **Burning verifications and slots.** Anything that runs before `personhood.verify` must be cheap and must not consume the proof; anything after must release the admission slot on every path (`try/finally`). A thrown chain revert after `verify` must still map to a retryable message for the human ("Try at 15:00 or pay $1.20") — the World action is unlimited, our `ent:v1:` key and `claimed()` are the one-per-human rule (T-24).
3. **The cache and the clear LPA.** `GET /me/:key` is the only cached read; `decide()` paths always hit the ledger. The clear LPA must not survive `fulfil()` — do not attach `profile` to the response object, to `c.var`, or to a log line; the `logs.test.ts` scan is the tripwire, and pino `redact` is a safety net, not the control.
