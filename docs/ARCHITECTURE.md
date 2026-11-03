# ARCHITECTURE — Recharge `v0`

**Status:** binding for `v0` (orchestrator, Tue 3 Nov → Thu 5 Nov 12:00 IST) and the reference for in-window work. **Owner:** architect. **Inputs, in order of authority:** `research/committee/DECISION.md` §1, §4, §6, §7, §8, §9; `docs/THREAT-MODEL.md` (every T-number below); `docs/INTERFACES.md` (every type below — this document never restates a schema, it points at one); `docs/ENVIRONMENT-CONSTRAINTS.md`; `research/sponsors.md`; `research/committee/round2-sponsor-stacker.md` §4 and `round2-mumbai-native.md` §2; `research/design-foundations.md` and `research/design-references.md`; the scaffold.

**The sentence this architecture serves:** *prove you're human and a sponsor pays for your first 300 MB of Mumbai data; after that you — or your agent — pay per 100 MB over x402, every bundle is an Arkiv entity that expires by itself, and anyone can gift data to an ENS name.*

---

## 1. System context

```
                       World ID (IDKit widget → cloud verifier)        ENS (mainnet read)
                                   ▲  proof / verify                         ▲ resolve name
                                   │                                         │
   ┌──────────────┐   HTTPS/JSON   ┌┴─────────────────────────────────────────┴┐    JSON-RPC    ┌──────────────────────┐
   │  apps/web    │ ─────────────▶ │  services/api  (Hono)                      │ ─────────────▶ │ DataDrop.sol         │
   │  PWA         │ ◀───402/200─── │  octroi() + x402() + flows                 │   attestor key │ Hedera EVM 296       │
   │  (wallet,    │                │  stores → Ledger · Personhood · PaymentRail│                │ (Anvil 31337 local)  │
   │  IDKit, LPA) │                │  Reseller · ConsensusLog · Blobs · Treasury│                └──────────────────────┘
   └──────┬───────┘                └┬───────┬────────────┬───────────┬─────────┘
          │ install                 │       │            │           │
   ┌──────▼───────┐        Arkiv ◀──┘   x402 facilitator  eSIM reseller  HCS topic (+ Swarm blobs)
   │ iOS/Android  │      (Kaolin;         (remote or        (orders out;      (receipts; agent UAID)
   │ eSIM sheet   │       entities        self-run /verify  LPA + usage
   └──────────────┘       expire)         /settle)          webhooks in)
                                   ▲
   ┌──────────────┐   HTTP (x402)  │  load-bearing read #2 (remaining MB, policy, spend)
   │ services/    │ ───────────────┘
   │ agent        │ ──▶ api GET /esim/topup → 402 → sign (Hedera Agent Kit wallet / EVM key) → 200 → HCS receipt with HCS-14 UAID
   └──────────────┘
   sponsor wallet ──▶ DataDrop.createCampaign / pause / refund (its own funds only) ; PWA /sponsor reads api GET /sponsor/:id (Arkiv query + chain)
```

Three partner primitives are load-bearing along one path — **identity (World) → money (Hedera: sponsor pool + x402) → entitlement (Arkiv)** — and ENS is integrated for gifting. The eSIM is the good; everything else is the gate (DECISION §4).

**What runs where.** `MODE=local`: Anvil 31337 + `MockUSDC3009` + `DataDrop` (token mode) + in-memory/fixture adapters + self-run facilitator; zero network; CI, red team and `scripts/e2e-local.sh` live here (`docs/ENVIRONMENT-CONSTRAINTS.md`). `MODE=live`: the same binaries with `createLiveAdapters(env)`; humans run it on the VPS with on-site keys. Live adapters are real code against documented APIs, tested on recorded fixtures; the Wednesday pre-deploy is the first time any of them meets a network.

---

## 2. Request flows

Notation: **R1–R3** are the three load-bearing Arkiv reads (DECISION Table D, Arkiv row; each has an acceptance test). `→ HCS` means `consensus.submit(topic, hcsMessage)`. Every step that persists is listed; nothing else is persisted (T-45: 402 responses write nothing).

### 2.1 Claim — the free welcome bundle (flow F1)

1. PWA `/` → "Prove I'm human → 300 MB". PWA generates an X25519 **session keypair** in memory (`crypto.generateSessionKeypair`).
2. `POST /challenge { audience:'recharge', path:'/claim', sessionPubKey }` → `octroi.challenge()` mints `{ nonce, exp = now+120 s, signal = keccak(nonce ‖ 'recharge') }`; the nonce carries an HMAC tag over `(audience, path, exp, sessionPubKey)`. **No ledger write.**
3. PWA opens IDKit (`app_id`, action `recharge-welcome`, `signal`, requested level ≥ document) → proof.
4. `POST /claim { proof, campaignId, challenge, sessionPubKey }`. Middleware: rate limit (5/min/IP), zod, `octroi()`.
5. `decide()` in this order (T-24: nothing burns a verification before the cheap checks pass): campaign exists (`CampaignStore` R0) and on-chain counters (`campaigns(id)`, `claimsInHour`) say not paused / not expired / budget left / hour cap not reached → **admission slot** taken from the per-campaign queue (T-46) → `consumeChallenge` (MAC + session key + exp; in-memory set synchronously; then `NonceStore.consume` writes the nonce entity `expiresIn 120`; `'unavailable'` ⇒ deny) → `personhood.verify(proof, { action, signal })` → `tier = tierFromLevel(result.level)` (verifier's level, never the body's — T-22) → `mb = sizeBundle(campaign, tier)`; `0` (device/none) ⇒ `payment-required` with the human price → `quotaKey`, `campaignClaimKey`, `onchainClaimKey` → replay check: `EntitlementStore.getByKey('ent:v1:'+quotaKey)` exists or `DataDrop.claimed(id, claimKey)` ⇒ `deny: replay` → `serve-free`.
6. API: `DataDrop.claim(id, claimKey)` from the single attestor sender queue; wait for the receipt; map reverts (`AlreadyClaimed→409`, `HourlyCap→429`, `CampaignPaused→423`, `BudgetExhausted→409`). Sponsor USDC moves to `payout` on Hedera (token mode) — "sponsor money moves on Hedera for every human claim".
7. API `fulfil()`: `reseller.order(planId, { idempotencyKey: claimKey })` → `{ iccid, lpa }` (clear LPA exists only inside this function, T-31) → `sealLpa(lpa, sessionPubKey, lpaAad(challenge.nonce, key))` → `blobs.put(sealed)` → `EntitlementStore.create({ key:'ent:v1:…', kind:'free', status:'ready', tier, mbTotal: mb, iccidHash, iccidEnc, sealedRef, expiresAt: now + validityDays })` (`expiresIn = secondsUntil(expiresAt)`) → `ReceiptStore.add(kind:'claim')` → HCS `claim`.
   If `order` fails: try `FallbackReseller` (inventory); else create the entitlement with `status:'pending-profile'`, answer **202**; `/me/:key` retries the order with the same idempotency key (T-25). The human never proves twice.
8. Response `entitledResponseSchema` with `sealedLpa` **exactly once**. PWA `openLpa` → zeroises the session secret → stores the opened LPA in IndexedDB → `/install`.

### 2.2 402 top-up by a human (flow F2)

1. `/plan/[key]` → "Add 100 MB · $0.40" → `fetchWithPayment(GET /esim/topup?key=&mb=100)`.
2. API `x402()` finds no `PAYMENT-SIGNATURE` → `decide()` returns `payment-required` → **402**, body + `PAYMENT-REQUIRED` header, `accepts[] = buildAccepts(deps, 100)` (local: `eip155:31337` MockUSDC; demo: `eip155:84532` USDC, `hedera:testnet` USDC). Nothing persisted.
3. PWA `PaymentSigner.choose()` by the connected wallet's network → `OnchainAction` `idle → signing`: builds `Authorization3009 { from, to: payTo, value: amount, validAfter: 0, validBefore: now+300, nonce: random32 }` (no LPA on a top-up, so no session-nonce binding) → wallet `signTypedData(typedDataTransferWithAuthorization(domain, auth))` → retry with `PAYMENT-SIGNATURE`.
4. `decide()`: `payload.accepted` deep-equals one `accepts[]` entry (incl. exact amount, T-26/T-28) → `payments.verify` → `payments.settle` (self-run: relayer submits `transferWithAuthorization`, waits for the receipt; remote: facilitator) → `serve-paid`. Per-ICCID daily cap checked before verify (`TOPUPS_PER_ICCID_PER_DAY`).
5. API: `reseller.topUp(iccid, 100, { idempotencyKey: nonce })` → `EntitlementStore.patch(key, { mbTotal: +100 }, { expiresAt: max(old, now + validityDays) })` (ledger `update` with a new `expiresIn`) → receipt `topup` → HCS `settle`.
6. **200** + `PAYMENT-RESPONSE` (settlement). PWA `submitted → confirmed` the instant the hash exists; `finalized` after the chain's finality rule (Anvil: 1 block; Base Sepolia: `safe`; Hedera: consensus = immediate).

### 2.3 402 top-up by the agent (flow F4)

Every `AGENT_TICK_MS` (60 s live, 5 s local), per watched key:
1. **R2:** `EntitlementStore.getByKey(key)` straight from the ledger (never the API cache) + `AgentPolicyStore.get(key)` + `ReceiptStore.spentUsd6(hash(key), 'agent-topup', dayBucket(now))`.
2. `shouldTopUp(e, policy, spentToday, now, stepPrice, lastExpiryBought)` — pure code; the LLM never sees it.
3. On `buy`: `fetchWithPayment(GET /esim/topup?key=&mb=step)` with the agent's `Payer`: `choose()` accepts only entries in `AGENT_PAYTO_ALLOWLIST` (network|asset|payTo) and `amount ≤ AGENT_MAX_USD6_PER_STEP` (T-56); local `EvmPayer` (Anvil #4 key, EIP-3009 typed data); live `HederaPayer` (Hedera Agent Kit wallet signs an HTS `TransferTransaction` of USDC `0.0.429274` to `PAYOUT_HEDERA_ACCOUNT`, base64 — the Hedera exact scheme) with `EvmPayer` on Base Sepolia as the labelled fallback.
4. On 200: HCS `agent-topup` with the agent's **HCS-14 UAID**; the agent's own receipt entity is written by the API (kind `agent-topup`, `uaid` from the `X-Agent-Uaid` request header); `AgentPolicyStore.put({ …, lastExpiryBought })` when the reason was `expiry`.
5. `phraseNotification(facts, llm?)` — facts are an allow-listed struct; output is text only (T-55).
Retry rule (T-57): keep the signed payload until `validBefore`; before re-signing, re-read the ledger — if `mbTotal` grew, the purchase landed.

### 2.4 Gift to an ENS name (flow F3) and reclaim

1. `/gift` → `POST /gift { name:'rahul.eth', mb: 1000 }`. API: `names.resolve(normalize(name))` **before** any 402 (T-43) → `null` ⇒ 404 `name_unresolved`; then the x402 dance of §2.2 steps 2–4 with `amount = priceUsd6(mb)`.
2. On `serve-paid`: `giftId = keccak(payer ‖ nonce)`, `pin = generatePin()`, `pinKey = hmacKey(secret, 'pin', pin)`, `serial = giftId.slice(2,10)` → `GiftStore.create({ kind:'gift', state:'open', name, namehash, to, mb, pinKey, serial, fundedBy:'payment', paidTx, payer, usd6, network, claimBy: now + 7 d })` with **`expiresIn = secondsUntil(claimBy)`** → receipt `gift` → HCS `gift`. Response: `giftResponseSchema` (the PIN appears once; the `BoardingPass` renders it).
3. Claim by signature: recipient's PWA `POST /challenge (path '/gift/claim')` → signs EIP-712 `GiftClaim { giftId, namehash, recipient, audience, nonce }` → `POST /gift/claim`. API: `consumeChallenge` → **R3:** `GiftStore.openByNamehash(namehash)` (or `byPinKey` for the PIN path) → `names.resolve(name)` **again**; signer must equal the *currently* resolved address → `fulfil()` as in §2.1 step 7 with `key = giftent:<giftId>` → `GiftStore.markClaimed` → receipt `gift-claim` → HCS `gift-claim` → `entitledResponseSchema`.
4. Claim by PIN (scratch card or gift stub): `POST /card/redeem { pin, challenge, sessionPubKey }` → `byPinKey(hmacKey(secret,'pin',pin))`; campaign-funded cards additionally call `DataDrop.claim(campaignId, keccak(campaignId ‖ hmacKey(secret,'card',pin)))`. `GET /card/:serial` only previews (T-47).
5. **Expiry = the mechanism.** At `claimBy` the escrow entity vanishes by protocol; a claim after that finds nothing (410). **Reclaim (D-7):** the sender `POST /gift/reclaim { giftId, payer, signature(GiftReclaim), challenge }`; API reads the escrow (expects `null`), the receipts for `giftId`, and passes `ledgerOk` → `decideGiftReclaim()` → `'refund'` ⇒ write a **pending** `gift-reclaim` receipt, `treasury.refund({ network, to: payer, usd6 − fee })`, patch the receipt with the tx, HCS `gift-reclaim`. A ledger error is **503**, never a refund (absence must be proven, not assumed). The `/gift` copy states the rule before payment: "If unclaimed by Sun 15 Nov, you can reclaim the USDC (minus network fee) here until Mon 15 Dec."

### 2.5 Sponsor campaign funding (flow TB-8)

1. `/sponsor` → connect wallet → form (name, budget, pricePerClaim, claimsPerHour, expiresAt, bundleMb per tier, wholesale, validityDays). `OnchainAction` ×2: `USDC.approve(DataDrop, budget)` → `DataDrop.createCampaign(id = keccak(sponsor ‖ name ‖ salt), …)` from the **sponsor's** wallet (token mode pulls the USDC; `CampaignExists` protects the id, T-04).
2. `POST /sponsor { campaign, auth: EIP-712 SponsorLogin }` → API verifies signer == `campaign.sponsor` == on-chain `campaigns(id).sponsor` → `CampaignStore.put` (entity `expiresIn = secondsUntil(expiresAt)`) → returns the **audit key** `HMAC(secret, 'audit' ‖ id)` once.
3. Dashboard `GET /sponsor/:id` (header `Authorization: Recharge-Sponsor …`): chain counters + `ReceiptStore.forCampaign(id)` (published `campaignClaimKey`s, never nullifiers) + `EntitlementStore.expiringWithin(24 h)` — the dashboard **is** an Arkiv query, not our database.
4. `pause(id, true/false)` and `refund(id)` are sponsor-wallet transactions from the same page; the attestor may `pause(id, true)` only (T-05); the API's anomaly rule pauses at ≥ 80 % of `claimsPerHour` within 10 min (T-01).

### 2.6 Expiry (the Arkiv clock)

- Every entity carries `expiresIn` at write and `annotations.expiresAt` (ms); reads treat an entity as dead if the ledger no longer returns it **or** `annotations.expiresAt < now` (T-35). `ArkivLedger` converts seconds → blocks with `ARKIV_BLOCK_TIME_MS`, rounding up and logging the implied drift; Kaolin's measured block time goes into `docs/ARKIV_FEEDBACK.md` on Wednesday.
- `/me/:key` after expiry → 410 `expired`; the PWA shows "0 MB · expired Sun 09:12 · Add 100 MB · $0.40". The agent's `expiry` trigger fires **before** expiry (`expiresAt − now ≤ expiryLeadS`) because a vanished entity cannot be extended; a top-up resets `expiresIn` (`ledger.update`).
- Nonces die after 120 s; gifts at `claimBy`; receipts after 30 d; agent policies after 30 d; campaigns at `expiresAt`. `scripts/demo-seed.ts` writes one entitlement with `expiresIn: 90` so an entity is **seen** dying during the demo and in `e2e-local.sh`.
- Division of truth (stated in `ARKIV_FEEDBACK.md`): the reseller is the source of truth for **usage**, Arkiv for **entitlement**; the webhook (flow F5) reconciles: `verifyWebhook` → replay cache → `usedMb` monotonic → `EntitlementStore.patch({ mbUsed, usageAsOf, usageSource:'webhook' })`.

---

## 3. Module boundaries

| Package / service | Responsibility | Must not |
|---|---|---|
| `@ethglobal/protocol` | wire & ledger schemas, x402 codec + client loop, units, errors, names, typed-data definitions, PIN format, `httpJson` | import any `@ethglobal/*`; touch the network except inside `httpJson` |
| `@ethglobal/crypto` | X25519/HKDF/XChaCha sealing, HMAC, hashing, webhook MAC, CSPRNG | know what an LPA or a PIN is beyond bytes |
| `@ethglobal/eip3009` | EIP-712 typed data, digests, recovery, calldata, viem relayer | hard-code a token domain |
| `@ethglobal/adapters` | ports (`Ledger`, `Personhood`, `PaymentRail`, `Reseller`, `ConsensusLog`, `NameResolver`, `BlobStore`, `Treasury`, `Inference`), deterministic mocks, `live/` implementations, `testing/` helpers and contract suites | contain business rules; import octroi/services/apps |
| `@ethglobal/octroi` | the rules: tiers, `sizeBundle`, keys, challenges, `decide()`, `shouldTopUp`, `decideGiftReclaim`; the ledger **stores** (only code that builds annotations) | call the network directly; know HTTP |
| `@ethglobal/contracts` | `DataDrop.sol`, `MockUSDC3009.sol`, deploy script, ABI + address artefacts | — |
| `@ethglobal/ui` | tokens, type pairings, components (`Coupon`, `ScratchCard`, `MbMeter`, `BoardingPass`, `UsageAsOf`, `OnchainAction`, primitives), `print.css` | import adapters/octroi/crypto; fetch anything |
| `services/api` | HTTP contract (INTERFACES §7), middleware, `flows/` (entitle, fulfil, reclaim), chain client (attestor), cache, metrics, OpenAPI | hold business rules outside octroi; import agent/web |
| `services/agent` | the loop (`tick`), payers, HCS-14 identity, receipts, notification phrasing | import api; let an LLM decide anything |
| `apps/web` | PWA routes, wallet + IDKit + session keys, `pay402`, install hand-off, print route, i18n, e2e | import adapters/octroi; call sponsor APIs directly (IDKit widget and the wallet are the only exceptions) |
| `scripts/` | `demo-seed`, `e2e-local.sh`, `print-cards`, `gen-arkiv-schema`, `check-design-bans.sh`, `redteam/` | duplicate harness code (shared `scripts/lib/harness.ts`) |

---

## 4. Dependency graph (acyclic; enforced)

```
          protocol ◀────────────── crypto           eip3009            (three leaves; no @ethglobal imports)
             ▲  ▲                     ▲                ▲
             │  └──────────┬──────────┴────────┬───────┘
             │             │                   │
            ui          adapters ◀──────── octroi            contracts (Solidity; abi/*.json, deploy/addresses.*.json)
             ▲         ▲   ▲ (./live)    ▲   ▲                    ▲
             │         │   │             │   │                    │
          apps/web ────┼───┼─────────────┼───┼────────────────────┤   (protocol, ui, crypto, eip3009, contracts/abi)
                       │   │             │   │                    │
          services/api ┴───┴─────────────┴───┼────────────────────┤   (protocol, crypto, eip3009, adapters+live, octroi, contracts/abi)
                                             │                    │
          services/agent ────────────────────┴────────────────────┘   (protocol, crypto, eip3009, adapters+live, octroi)

          apps/web ──HTTP──▶ services/api ◀──HTTP (x402)── services/agent      (never a code import between them)
```

Rules (INTERFACES §12), enforced by `no-restricted-imports` zones in `eslint.config.js` and reviewed in every wave: adapters never import services or octroi; ui never imports adapters; octroi never imports `@ethglobal/adapters/live`; services never import each other; `apps/web` never imports adapters or octroi; nothing imports another package's `src/` or `dist/`; `@ethglobal/adapters/live` is imported only by `services/*` and `scripts/`.

---

## 5. Data model

### 5.1 Arkiv entities (schemas: INTERFACES §1.4; generated JSON Schema: `docs/arkiv.schema.json`)

| type | logical key (`ANN.key`) | payload (public!) | annotations (indexed) | `expiresIn` | load-bearing reads |
|---|---|---|---|---|---|
| `entitlement` | `ent:v1:<quotaKey>` · `paid:<payer>:<nonce>` · `giftent:<giftId>` | `entitlementSchema` — `kind, status, tier, campaignId, planId, mbTotal, mbUsed, usageAsOf, usageSource, iccidHash, iccidEnc, sealedRef, payer, network, createdAt, expiresAt` | `type, key, kind, status, tier, campaignId, iccidHash, expiresAt` | `validityDays × 86400`, reset on top-up | **R1** every `/esim/*` and `/me/:key`; **R2** agent tick; sponsor "expiring" table |
| `campaign` | `camp:<id>` | `campaignSchema` (off-chain fields only; `paused/budget/spent` are on-chain) | `type, key, sponsor, expiresAt` | until `expiresAt` | `/plans`, `/claim` (R0) |
| `gift` | `gift:<giftId>` | `giftSchema` — `state, name, namehash, to, mb, pinKey, serial, fundedBy, payer, usd6, claimBy, …` | `type, key, kind, state, namehash, pinKey, serial, campaignId, expiresAt=claimBy` | `claimBy − now` | **R3** gift claim / card redeem; reclaim expects *absence* |
| `nonce` | `nonce:<nonce>` | `nonceSchema` | `type, key, nonce` | 120 | `consumeChallenge` (replay) |
| `receipt` | `rcpt:<network>:<tx>` (or `rcpt:ledger:<uuid>`) | `receiptSchema` — `kind, entitlementKeyHash, campaignId, mb, usd6, network, tx, payer, uaid, hcs, at` | `type, key, receiptKind, entitlementKeyHash, campaignId, day` | 30 d | `/me/:key/receipts`, sponsor claims, agent `spentToday`, gift reclaim |
| `agentpolicy` | `policy:<entitlementKey>` | `agentPolicySchema` | `type, key, owner` | 30 d | agent tick, `/agent/policy/:key` |

Never in any payload or annotation: a raw nullifier, an LPA (clear **or** sealed — only a blob **reference**), a clear ICCID, a PIN, a private key, PII (T-37). `scripts/redteam` greps the dumped ledger for `security/redteam/tools/forbidden-patterns.txt` after every `e2e-local.sh`.

### 5.2 HCS messages (schema: INTERFACES §1.7)

One topic (`HCS_TOPIC_ID`), JSON ≤ 1024 bytes, allow-listed fields, `ent = sha256(entitlementKey)`; types `claim`, `settle`, `gift`, `gift-claim`, `gift-reclaim`, `card-redeem`, `agent-topup` (the last carries the agent's HCS-14 `uaid`). The topic is the neutral, timestamped receipt log; `HcsLog.read` pages the mirror node for the dashboard's "Hedera receipts" column.

### 5.3 Swarm blobs

`sealedRef` → `bzz://<ref>` holding the sealed LPA (ciphertext to the buyer's session key). `docs/SWARM.md` states: Arkiv stores entitlement metadata and the reference; Swarm stores the sealed blob; the entity key ↔ Swarm reference pair is printed in the README. Local: `MemoryBlobStore`.

### 5.4 `DataDrop` storage layout (INTERFACES §6.1)

```
mapping(bytes32 id => Campaign)                        campaigns     (3 slots: sponsor+pricePerClaim | budget+spent | claimsPerHour+expiresAt+pausedSince+paused)
mapping(bytes32 id => mapping(bytes32 claimKey => bool)) claimed
mapping(bytes32 id => mapping(uint64 hourBucket => uint32)) claimsInHour
address attestor; immutable IERC20 usdc; immutable address payout; (Ownable2Step owner)
```
Invariants: `spent ≤ budget`; `spent = pricePerClaim × #claims(id)`; token mode `usdc.balanceOf(this) = Σ(budget − spent) − Σ refunded`; one `claimKey` per campaign; `claimsInHour[id][b] ≤ claimsPerHour`; after refund `budget == spent`; `LEDGER_ONLY` moves zero tokens.

---

## 6. Trust and key model

| Key / secret | Holder | Can | Cannot | Blast radius · control |
|---|---|---|---|---|
| **Attestor** (`ATTESTOR_PRIVATE_KEY`) | `services/api` on the VPS; on-site generated Thu 21:00 | `DataDrop.claim`, `pause(id, true)` | unpause, refund, create, move x402 funds | ≤ Σ live campaigns `min(remaining, pricePerClaim × claimsPerHour)` per hour (2× at a bucket edge); `setAttestor` rotation drill < 5 min (T-01) |
| **DataDrop owner** | founder, cold/on-site | `setAttestor`, `associateHts` | sweep (no such function; `payout`/`usdc` immutable, T-10) | — |
| **Sponsor wallet** | each sponsor | create/fund/pause/refund **its** campaign; dashboard login (EIP-712) | touch other campaigns | its own budget |
| **Payout / treasury** (`PAYOUT_ADDRESS`, `TREASURY_PRIVATE_KEY`) | service; receives claim payments and x402 settlements; sends **gift reclaims only** | `treasury.refund` ≤ `TREASURY_MAX_USD6_PER_DAY`, bounded per gift by its receipt | — | the daily cap; pending-receipt-before-transfer + per-giftId mutex |
| **Relayer** (`RELAYER_PRIVATE_KEY`) | self-run facilitator | submit `transferWithAuthorization` (gas only) | redirect funds (`to` is in the signed authorization) | gas float; simulation before send (T-16) |
| **Octroi secret** (`OCTROI_SECRET`, ≥ 32 B) | api only | derive quota keys, audit keys, pin keys, challenge MACs | be rotated mid-campaign (new campaigns only; `ent:v1:` versioning, T-29) | disclosure ⇒ linkability of pseudonyms, never funds |
| **Server seal key** (`SERVER_SEAL_KEY`) | api | open `iccidEnc` | — | ICCIDs |
| **Session keypair** (X25519) | the buyer's PWA, memory only (T-60) | open one sealed LPA | — | one LPA |
| **Agent wallets** | `services/agent` (Hedera Agent Kit account; Base Sepolia key) | pay x402 within `TopUpPolicy` + `AGENT_PAYTO_ALLOWLIST` + `AGENT_MAX_USD6_PER_STEP` | exceed the daily cap (code), pay an unlisted `payTo` | funded with ≈ one day's cap |
| **Reseller API key, webhook secrets** | api | order profiles, verify webhooks | — | prepaid balance; idempotency keys |
| **Arkiv key** | api (writes); agent reads need no key | create/update entities (gas on Kaolin) | — | faucet ETH |
| **HCS submit keys** | api and agent (separate accounts) | submit receipts | forge another's receipts (topic has no submit key restriction; the UAID and account id identify the submitter) | — |
| **World `app_id` / action** | public | — | — | the action is configured **unlimited**; one-per-human is ours (T-24) |

**Sealed LPA delivery.** The reseller returns the LPA in clear to the API (TB-4). Inside `fulfil()` it is sealed to the buyer's session public key with AAD `nonce|entitlementKey` and the clear string is dropped; logs redact `lpa`, `sealedLpa`, `PAYMENT-SIGNATURE`, `proof`, `nullifier_hash`, `pin`; the sealed box is returned exactly once and stored only as a blob reference. Binding: paid LPA routes require `authorization.nonce == keccak256(sessionPubKey)`; the free lane binds the session key into the challenge MAC (T-32).

**What the server can do:** see the LPA at order time, see `nullifier_hash` at verify time (stores `HMAC` only, logs `sha256(logKey ‖ nullifier)`), mint claims within the on-chain caps, see usage, pause campaigns, refund lapsed gifts within the treasury cap. **What it cannot do:** link a pseudonym back to a nullifier without the proof, open a sealed LPA after the response, unpause a sponsor's campaign, move x402 funds (payer → `payout` directly via the facilitator), exceed the hourly cap, or extend an expired entity.

**Legal posture as config (T-52, T-69):** `X402_NETWORKS ⊂ TESTNET_NETWORKS` unless `SALES_ENABLED && LEGAL_MEMO_OK`; the paid lane's copy carries "TESTNET · test USDC · not a sale"; no PII anywhere.

---

## 7. `MODE=local` vs `MODE=live` wiring

| Port | `MODE=local` (CI, red team, orchestrator) | `MODE=live` (humans, VPS) | Selector |
|---|---|---|---|
| `ledger` | `InMemoryLedger` (+`update`, expiry clock) | `ArkivLedger` (Kaolin 60138453025, `@arkiv-network/sdk`) | `MODE` |
| `personhood` | `MockPersonhood { expectSignal: true }` + `fixtureProof()`; UI labels "simulated World ID" | `WorldCloudPersonhood` (`POST developer.worldcoin.org/api/v2/verify/{app_id}`) | `MODE` |
| `payments` | `X402_FACILITATOR=self` → `SelfRunFacilitator` on Anvil (real EIP-3009 verify + relayed `transferWithAuthorization`; default for e2e); `=mock` → `MockPaymentRail` (unit tests) | `RoutingPaymentRail { eip155:84532 → RemoteFacilitator(x402.org) ∥ SelfRunFacilitator; hedera:testnet → RemoteFacilitator(hedera-dev) }` | `MODE`, `X402_FACILITATOR`, `X402_NETWORKS` |
| `reseller` | `MockReseller` (deterministic `LPA:1$local.test$<id>`, usage clock, signed webhook simulator) | `EsimAccessReseller` / `MegaEsimReseller`, wrapped in `FallbackReseller(primary, InventoryReseller)` | `RESELLER`, `RESELLER_FALLBACK` |
| `consensus` | `MockConsensusLog` | `HcsLog` (`@hashgraph/sdk` submit; mirror REST read) | `MODE` |
| `names` | `MockNameResolver` (`alice.eth`, `bob.eth` → Anvil #0/#1) | `EnsResolver` (viem mainnet; Sepolia fallback) | `MODE` |
| `blobs` | `MemoryBlobStore` | `SwarmBlobStore` (Bee `POST /bzz`) | `MODE` |
| `treasury` | `MockTreasury` | `RoutingTreasury { eip155 → EvmTreasury; hedera → HederaTreasury }` | `MODE` |
| `inference` | `MockInference` | unused by the product; mock in both modes | — |
| Chain (`DataDrop`) | Anvil 31337, `addresses.anvil.json`, token mode with `MockUSDC3009` | Hedera testnet 296 (token or `LEDGER_ONLY`), `addresses.hedera_testnet.json`; Base Sepolia as the degradation | `CHAIN`, `RPC_URL`, `DATADROP_ADDRESS` |
| Attestor / relayer / treasury keys | Anvil #2 / #6 / #1 (`anvilRoles`) | on-site keys; Anvil keys **refused** by `env.ts` | `MODE` |
| Agent payer | `EvmPayer` (Anvil #4) | `HederaPayer` (Agent Kit) + `EvmPayer` (Base Sepolia) | `MODE` |
| PWA wallet | dev panel "demo wallet · Anvil #5" (compiled only when `NEXT_PUBLIC_MODE=local`, T-63) | injected EIP-1193 wallet (Base Sepolia); Hedera wallet for the human Hedera payment (in-window) | `NEXT_PUBLIC_MODE` |
| Clock | injectable `now()`; unit tests use `fakeClock`; e2e uses real time with short validities | real | — |
| Degradation | — | facilitator down → self-run; Hedera RPC down → Base-only + ENS swap; Arkiv down → **reads only** from the 60-s cache with a "ledger degraded" banner, writes fail closed; reseller down → inventory; World down → team phones + labelled simulator (DECISION §6.6) | runtime health checks, `degraded` flag on `/me` |

---

## 8. No-duplicated-code rules (jscpd 1 % is enforced in CI over `apps packages services scripts`, tests included)

| # | Concern | Owner (the only place it may exist) | Everyone else |
|---|---|---|---|
| 1 | Validation schemas (wire, ledger, env fragments) | `@ethglobal/protocol/schemas` | imports; types via `z.infer`; no hand-written twins |
| 2 | HTTP client (timeout, JSON, zod response, injected `fetch`) | `@ethglobal/protocol/http` `httpJson` | no bare `fetch` (eslint `no-restricted-syntax`) except `fixtureFetch` |
| 3 | Money and data units (`Usd6`, MB, formatting, `priceUsd6`, `secondsUntil`) | `@ethglobal/protocol/units` | no `1e6`, `/1024`, `toFixed` on money anywhere else (semgrep `usdc-18-decimals`, review grep) |
| 4 | x402 header codec + 402 client loop | `@ethglobal/protocol/x402` | web and agent inject a `PaymentSigner` only |
| 5 | Hashing / HMAC / AEAD / CSPRNG | `@ethglobal/crypto` | `packages/adapters/src/hash.ts` is replaced by a re-export in the interfaces wave |
| 6 | EIP-712 / EIP-3009 typed data, digests, recovery, calldata | `@ethglobal/eip3009` | web payer, agent payer, `SelfRunFacilitator`, forge vectors all consume it |
| 7 | Business rules (tiers, sizing, keys, challenges, `decide`, `shouldTopUp`, gift reclaim) | `@ethglobal/octroi` | the API and the agent call; never re-implement a check |
| 8 | Ledger access (annotations, logical keys, expiry semantics) | `@ethglobal/octroi/store` | nobody else calls `ledger.put/query` with hand-built annotations |
| 9 | Error codes and HTTP mapping | `@ethglobal/protocol/errors` (codes) + `services/api/src/errors.ts` (the one mapper) | routes throw `RechargeError`/`AdapterError`; no inline `c.json({error…}, 4xx)` |
| 10 | Test helpers (fake clock, Anvil roles, fixtures, payload builders, port contract suites) | `@ethglobal/adapters/testing` | test files import; no local copies |
| 11 | Entitle/fulfil flow (verify → chain → order → seal → persist → receipt → HCS) | `services/api/src/flows/entitle.ts` + `fulfil.ts` | `/claim`, `/esim/provision`, `/gift/claim`, `/card/redeem` are thin routes over one function |
| 12 | UI components (`Coupon` renders plan, gift stub and printed card; `OnchainAction` renders every transaction) | `@ethglobal/ui/components` | pages compose; no per-page re-implementations |
| 13 | Process harness (anvil up, deploy, wait-for-port, seed) | `scripts/lib/harness.ts` | `demo-seed`, `e2e-local`, `print-cards`, `redteam/*` import it |
| 14 | Typed-data message definitions (`GiftClaim`, `GiftReclaim`, `SponsorLogin`, `AgentPolicy`) and `canonicalJson` | `@ethglobal/protocol/typed-data` | web signs, api verifies, same objects |
| 15 | Contract ABIs and addresses | `@ethglobal/contracts/abi/*.json`, `deploy/addresses.*.json` (generated; `pnpm abi:check`) | import the JSON; no hand-typed ABI fragments |

Review rule: a PR that adds a second implementation of any row is rejected even when jscpd passes.

---

## 9. Error taxonomy

Codes and statuses: INTERFACES §1.9. Three layers, one mapping:

1. **Adapters** throw `AdapterError(adapter, code, message)` with codes from a fixed list per port (`invalid_proof`, `already_verified`, `invalid_response`, `nonce_already_used`, `requirements_mismatch`, `insufficient_amount`, `expired`, `not_yet_valid`, `unavailable`, `rate_limited`, `invalid_expiry`, `fixture_miss`, …). `ADAPTER_CODE_MAP` turns them into protocol codes.
2. **Octroi** never throws for business outcomes; it returns `Decision.deny` / `TopUpVerdict` / `GiftReclaimVerdict`. It throws `RechargeError('invalid_request')` only for malformed input the API should have validated.
3. **API** `errors.ts` maps `Decision.deny` (INTERFACES §7 table), `RechargeError` and `AdapterError` to `{ error, message, details?, requestId }`; chain reverts are decoded by name (`DATADROP_ERRORS`) into `already_claimed`, `hourly_cap`, `campaign_paused`, `campaign_expired`, `budget_exhausted`; unknown errors are `internal_error` with the `requestId` and never the stack. Retryable 5xx carry `Retry-After`.

User-facing copy per code lives in `apps/web/i18n` (en/hi/mr); never "Something went wrong" (design-foundations §7).

---

## 10. Observability

- **Logs:** pino JSON, `service: api|agent`, one `event` from `LOG_EVENTS` per line, always `requestId`; `redact` list (T-50); `LOG_LEVEL=debug|trace` refused in live. The `decision` event carries `{ kind, reason, tier, mb, campaignId, ms }`; `ledger.op` carries `{ op, type, ms, ok }` — these are the numbers for `ARKIV_FEEDBACK.md`.
- **Metrics:** in-process counters and histograms via one `timed(name, fn)` helper (`services/api/src/metrics.ts`), exposed at `GET /metrics.json` (local and live; no Prometheus dependency): `claims_total{tier}`, `settlements_total{network}`, `payment_required_total`, `deny_total{reason}`, `ledger_ms{op}` p50/p95, `reseller_ms{op}`, `facilitator_ms`, `chain_claim_ms`, `webhook_total{verdict}`, `cache_hit_ratio`, `degraded`.
- **Health:** `GET /healthz` (exists) gains `ledger`, `reseller`, `facilitator`, `chain` sub-checks with last-success timestamps; `degraded: true` flips the PWA banner.
- **Tracing:** none in v0; `X-Request-Id` is propagated from the PWA (generated client-side) through the API to adapter logs and into HCS messages' `memo` where the SDK allows.
- **Agent:** same log shape; `agent.tick`, `agent.buy`, `agent.skip{reason}`; a local JSON journal `.agent/journal.jsonl` mirrors every verdict for the demo screen.

---

## 11. Decisions record (D-numbers referenced elsewhere)

| # | Decision | Alternatives rejected |
|---|---|---|
| D-1 | New leaf package `@ethglobal/protocol` owns schemas, codec, units, errors, names; adapters depends on it and re-exports wire types | keeping the codec in adapters (would force the PWA to import adapters); a schemas folder inside the API (agent and web would duplicate) |
| D-2 | Logical keys are the `key` annotation; stores in octroi own all ledger access | caller-chosen entity keys (Arkiv assigns keys; two code paths) |
| D-3 | Challenges are MAC-bearing nonces written only on consumption | issue-time nonce entities (write amplification, T-45) |
| D-4 | Per-campaign audit key derives the published claim key; the global `ent:v1:` pseudonym stays server-side | one HMAC for both (sponsor lists would be linkable across campaigns) |
| D-5 | Money is `bigint` micro-USD; 1 GB = 1000 MB | floats; binary GB (contradicts the acceptance test) |
| D-6 | Settlement before fulfilment, with a durable `pending-profile` state and idempotent retries | fulfil-then-settle (data given away on settle failure) |
| D-7 | Lapsed gifts are reclaimable by the payer for 30 days, decided from receipts plus the escrow's absence, paid from the treasury under a daily cap | no refund (coordinator's design finding: the copy must state a rule and "lapses" reads as theft); escrow with longer TTL (then "expires by itself" would not end the claim) |
| D-8 | `GET /card/:serial` previews, `POST /card/redeem` redeems | `GET /card/:pin` (link-preview bots would redeem, T-47) |
| D-9 | Self-run facilitator is the local default and the live fallback; it also serves `/facilitator/*` publicly | mock rail in e2e (would not exercise EIP-3009 or MockUSDC3009) |
| D-10 | The agent's policy is a ledger entity written through the API with an EIP-712 signature; the agent reads it each tick | a control API on the agent (second HTTP surface, auth) |
| D-11 | Android install path is honest: copy the activation code, exact Settings steps, an `intent:` link labelled unverified | promising a one-tap Android install (EuiccManager forbids it from the web) |
| D-12 | No wagmi/RainbowKit; viem + EIP-1193 + a local-only demo wallet panel | wallet kits (bundle, slop, T-63) |
