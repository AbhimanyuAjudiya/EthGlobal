# @ethglobal/api

The one Recharge server. It runs on Hono on Node (`@hono/node-server`) with pino JSON logs and a zod-validated
environment. It issues challenges, verifies World ID proofs, claims sponsor USDC through `DataDrop.claim`, answers
HTTP 402 with x402 v2 terms and settles payments. It also orders and seals eSIM profiles, writes the ledger through
`@ethglobal/octroi/store`, writes receipts to HCS, serves the sponsor dashboard and hosts a self-run facilitator.
The business rules live in `@ethglobal/octroi`. This service only does transport, orchestration and persistence.

The binding specs are `docs/build-briefs/api.md` and `docs/INTERFACES.md` §7 (the HTTP contract), §11 (the
environment) and §13. The machine-readable contract is `openapi.json` (OpenAPI 3.1). It is generated from the
`@ethglobal/protocol/schemas` objects that the routes validate with (`pnpm openapi` writes it, and
`pnpm openapi:check` and a test fail on drift).

## Routes

`POST /sponsor/validate` accepts `{campaign}` before funding and checks metadata, deployment, lifetime, price and provider capacity without writing state. A successful response is `{valid: true}`.

| Method & path                                                                          | Success                                                                                   | Errors (all `errorBodySchema` + `X-Request-Id`)                                            |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /healthz`                                                                         | 200 `{ ok, mode, chainId, attestor, degraded }`                                           | 503 `chain_unreachable`                                                                    |
| `GET /plans`                                                                           | 200 `plansResponseSchema` (cached 60 s)                                                   | 503                                                                                        |
| `POST /challenge`                                                                      | 200 `challengeSchema` (no ledger write)                                                   | 400, 429 (10/min/IP)                                                                       |
| `POST /world/rp-context`                                                               | 200 `rpContextSchema` (ttl 300 s, server clock)                                           | 400, 429 (10/min/IP, checked before signing)                                               |
| `POST /claim`                                                                          | 201 `entitledResponseSchema`; 202 `pending-profile`                                       | 400, 401, 402 (device tier), 404, 409, 410, 423, 429 (5/min/IP or hourly cap), 503         |
| `GET /esim/provision?mb=&planId=`                                                      | 201 + `PAYMENT-RESPONSE`; 202 pending                                                     | 400 (mb ≠ 1000 first, no/invalid `X-Session-Pubkey`), 402 + `PAYMENT-REQUIRED`             |
| `GET /esim/topup?key=&mb=`                                                             | 200 `topUpResponseSchema` + `PAYMENT-RESPONSE`                                            | 400 (mb ≠ 1000, before any read), 402, 404, 410 (never settled), 429 `daily_cap`           |
| `POST /gift`                                                                           | 201 `giftResponseSchema` + `PAYMENT-RESPONSE`                                             | 400 (mb ≠ 1000), 402, 404 `name_unresolved` (both before any 402)                          |
| `POST /gift/claim`                                                                     | 201 `entitledResponseSchema`                                                              | 400, 401, 409, 410                                                                         |
| `POST /gift/reclaim`                                                                   | 200 `giftReclaimResponseSchema`                                                           | 400, 401, 404 `unknown-gift`, 409 (too-early, claimed, already-reclaimed), 410, 429, 503   |
| `GET /card/:serial`                                                                    | 200 `cardPreviewSchema` (read-only)                                                       | 404                                                                                        |
| `POST /card/redeem`                                                                    | 201 `entitledResponseSchema`                                                              | 400 (Verhoeff), 401 (unknown card or wrong PIN, one body), 410 (redeemed), 429 (10/min/IP) |
| `POST /webhooks/reseller/:provider`                                                    | 204                                                                                       | 400, 401, 404 (other provider), 409 (replay), 413 (256 KiB), 503; never 500                |
| `GET /me/:key` (`?refresh=1`)                                                          | 200 `meResponseSchema`                                                                    | 404 unknown, 410 expired, 503                                                              |
| `POST /me/:key/delivery`                                                               | 200 `{status: "ready", nonce, sealedLpa}`; 202 `{status: "pending-profile"}`              | 400, 401, 404, 503                                                                         |
| `GET /me/:key/receipts`                                                                | 200 `receiptsResponseSchema`                                                              | 404                                                                                        |
| `POST /sponsor`                                                                        | 201 `{ id, auditKey }` (first registration only)                                          | 400 (incl. price < $1.20/claim), 401, 404 (no on-chain campaign), 409 `campaign_exists`    |
| `GET /sponsor/:id`                                                                     | 200 `sponsorViewSchema` (`auditKey` on the first read only)                               | 401                                                                                        |
| `PUT /agent/policy` · `GET /agent/policy/:key`                                         | 200 `agentPolicyViewSchema`                                                               | 400, 401, 404, 409 (older `issuedAt`)                                                      |
| `GET /facilitator/supported` · `POST /facilitator/verify` · `POST /facilitator/settle` | 200 v2 `{ kinds, extensions: [], signers }` · `verifyResultSchema` · `settleResultSchema` | 400 (not our terms, amount < one step), 404 (none), 429 (30/min/IP, 10/min/payer)          |
| `GET /openapi.json` · `GET /metrics.json`                                              | 200                                                                                       |                                                                                            |
| `POST /__local/clock` (MODE=local only, e2e)                                           | 200 `{ now }`                                                                             | 400; the route does not exist in live                                                      |

The middleware runs in a fixed order (INTERFACES §7): `requestId → logger → securityHeaders → cors → rateLimit →
bodyLimit → idempotency → validate → x402 → octroi → handler`. `src/errors.ts` is the one mapper. It maps
`Decision.deny`, `RechargeError`, `AdapterError` (through `ADAPTER_CODE_MAP`), DataDrop reverts, zod errors and
Hono exceptions to responses. It builds the message from the code and never echoes a vendor string. Retryable 5xx
responses and 429s carry `Retry-After`.

## Modes

- **`MODE=local`** runs on `createAdapters('local')`: the mock ledger, World verifier, reseller, HCS, blobs,
  treasury and names. The chain is Anvil: DataDrop and MockUSDC3009 from `deploy/addresses.anvil.json` or
  `DATADROP_ADDRESS`/`USDC_ADDRESS`. `X402_FACILITATOR=self` gives real EIP-3009 settlement through the self-run
  facilitator, and it is the default when Anvil answers. `=mock` gives the mock rail. Nothing touches the network
  beyond the local node. The keys default to the public Anvil roles (derived from the mnemonic, never written down)
  and fixed local test secrets.
- **`MODE=live`** runs on `createLiveAdapters(liveConfigSchema.parse(env))`. `env.ts` refuses to boot on any Anvil
  or local key, `LOG_LEVEL=debug|trace`, a short `OCTROI_SECRET`, non-testnet networks without both sales flags, an
  Arkiv chain other than rabdi or tiramisu, `RESELLER=megaesim`, `X402_FACILITATOR=mock`, a missing World RP id or
  signing key, `WORLD_ENVIRONMENT=staging`, or any `SEED_*` variable. Nothing local is inherited (RT-A-09): `CHAIN`
  is required and never 31337, `CORS_ORIGINS` defaults to none and refuses localhost, `AGENT_PAYERS` defaults to none
  and refuses Anvil accounts, and `STATE_FILE` (the sealed durable state, below) is required.

**Degradation (T-51).** The service is "degraded" for 60 s after the ledger throws. During that window `/me` serves
its 60-s cache with `degraded: true`, and every write path fails closed with 503. `decide()` never reads the cache.
A lost create-if-absent / compare-and-swap (`AdapterError('ledger','conflict')`, A-32) is the ledger answering — a
replay, a CAS retry — and is **not** counted (`src/cache.ts`; `test/regression/T-51-ledger-conflict.test.ts`).

**Durable state (RT-A-11).** What must survive a restart lives in two places. On the ledger: the treasury day total
(Σ today's `gift-reclaim` receipts, `ReceiptStore.spentUsd6ForDay`), and the once-only markers (`claim:` HMAC keys,
scope `'once'`, A-42) for "gift LPA delivered", "campaign registered" and "audit key shown". In `STATE_FILE` (a JSON
file sealed to `SERVER_SEAL_KEY`, fsynced and replaced atomically, mode 0600; `src/state.ts`): verified claim reservations, paid operation responses, delivery bindings, receipt outbox entries and signed refund transactions. Failed checkpoints roll back memory too. Capability keys, PINs and signed refund bytes never go on the public ledger. Boot retries pending deliveries and refund confirmations. Without `STATE_FILE` (local mode only), this recovery state is memory only.

**Local seed hooks (T-85).** `X-Seed-Validity-S` (on `/claim`), `X-Seed-Claim-Window-S` (on `/gift`) and
`X-Seed-Card-Campaign` (on `/gift`; it mints a campaign-funded card without payment) are read only inside
`MODE === 'local'` guards (`src/seed.ts`). Each use is logged with `event: 'seed-hook'`. In live mode they are
ignored.

## Where Hedera lives in the code

- `src/routes/claim.ts`: the x402 top-ups the agent pays from its Hedera wallet. `src/accepts.ts` builds the
  `hedera:*` accept template (the network's HTS USDC: `0.0.429274` testnet, `0.0.456858` mainnet; `extra.feePayer` from the facilitator, 180 s).
- `src/chain.ts`: `DataDrop.claim` from the attestor on Hedera EVM 296 in live (Anvil locally).
- `src/flows/record.ts`, called from `fulfil.ts`, `gift.ts` and `reclaim.ts`: every receipt is also an HCS message
  (`claim`, `settle`, `gift`, `gift-claim`, `gift-reclaim`, `card-redeem`).
- `services/agent` submits `agent-topup` HCS messages under its own HCS-14 UAID.

## Development

```sh
pnpm --filter @ethglobal/api test        # vitest: 65 files (routes, attack/ AP1–AP21, redteam/ RT-A, regression/ T-xx, Anvil)
pnpm --filter @ethglobal/api coverage    # v8; thresholds lines 85 %
pnpm --filter @ethglobal/api typecheck && pnpm --filter @ethglobal/api build
pnpm --filter @ethglobal/api openapi     # regenerate openapi.json (openapi:check verifies it)
bash scripts/e2e-local.sh                # Anvil + Deploy.s.sol (scripts/dev-chain.sh) + the API + scripts/e2e-flow.ts
```

`test/support/harness.ts` is the in-process harness: `buildDeps` plus the `MemoryDataDrop` double plus `fakeClock`,
driven through `app.request()`; `h.restart()` builds a new process over the same ledger, reseller, chain and
`STATE_FILE`. `test/support/anvil.ts` spawns a throwaway Anvil with DataDrop + MockUSDC3009 (`chain.anvil.test.ts`,
`redteam/rt-anvil.test.ts`; skipped without Foundry). `test/redteam/` holds the wave-2 red-team tests; RT-A-01…13
are passing regressions named `… [RT-A-NN]`.
`test/attack/*.attack.test.ts` encodes `security/redteam/attacks/wave2-api-agent.md`. `test/regression/T-xx-*.test.ts`
are the THREAT-MODEL §5.12 regression files.

## Decisions and open findings

1. **OpenAPI uses zod 4's `z.toJSONSchema`** (draft 2020-12, which is OpenAPI 3.1's dialect) over the protocol
   schemas, not `@hono/zod-openapi`. It produces the same single source of truth without a new dependency (the
   `minimumReleaseAge` gate).
2. **Receipts.** A durable outbox entry preserves the original accounting timestamp before HCS or receipt writes. Failed writes are repaired before caps, cancellation and policy balances are evaluated. HCS remains optional; financial receipts remain queued until persisted. A reclaim writes a pending
   `gift-reclaim` receipt keyed `rcpt:ledger:gift-reclaim:<giftId>` (the logical key makes it a cross-process lock)
   BEFORE the refund, then patches that same receipt with the refund tx and HCS reference (`ReceiptStore.patch`,
   A-38). The treasury daily cap is summed from the ledger under one in-process lock (`spentUsd6ForDay`).
3. **Claim keys on receipts.** `campaignClaimKey` is stored as the claim receipt's `payer`, written as 64 hex
   characters without `0x` because the schema allows at most 64. The sponsor view re-prefixes it, and `/me/:key/receipts`
   drops `payer` on claims.
4. **The `/gift/reclaim` challenge** is requested with `sessionPubKey = payer address left-padded to 32 bytes`,
   because the reclaim body has no session key.
5. **Gift claims write their `gift-claim`/`card-redeem` receipt before delivery (T-71 a).** If that write fails, the
   claim answers 503 and no LPA leaves the server. A fresh authenticated claim resumes the same claimed escrow; a delayed activation is recovered through the delivery route.
6. **T-24 recovery.** When a human's chain step fails after verification (RPC down, or a `HourlyCap` /
   `CampaignPaused` / `BudgetExhausted` revert), the serve-free decision is kept through the original plan/campaign lifetime (durable state) under the
   session key that the challenge MAC binds, tagged with `HMAC(secret, 'intent' ‖ nullifier)`. A retry with a fresh
   challenge from that session completes without spending a second World proof — but only with a proof of the SAME
   human that the verifier accepts (fresh, or `already_verified`), bound to the new challenge or the first one
   (RT-A-05). Another session never matches; another human's proof on that session is judged as its own claim.
   Admission sizes the slot to `min(hour left, ⌊budget left / price⌋)` minus in-flight and recently mined claims, so
   a budget burst is refused (409 `budget_exhausted`) before any proof is verified (RT-A-03).
7. **Expired versus unknown.** The stores hide dead entities. The API remembers the expiry of every entitlement it
   has seen, so a vanished entity answers 410 rather than 404 (in-process memory).
8. **No 403 code exists in `ERROR_CODES`.** Sponsor and owner mismatches therefore answer 401 `unauthorized`.
   - **Fixed upstream (octroi A-35…A-40):** T-15 (a front-run payment is served exactly once,
     `test/attack/x402.attack.test.ts`), T-71 e (`RECEIPT_TTL_S` = 38 d: a day-31 reclaim refunds), T-73 b (the
     first PUT of a free entitlement's agent policy needs the claiming session's `sessionPubKey`).
   - **Delayed activation recovery:** `POST /me/:key/delivery` accepts `{sessionPubKey}` matching the original persisted delivery target. It returns only the sealed box and its original nonce; the browser needs the original private X25519 key to decrypt it. Bindings survive successful provisioning and restarts. `hk:` ledger indexes are rejected.
9. **Payments are bound to their route (RT-A-08).** Each paid route's accepts carry `extra.resource` = its path
   (`/esim/provision`, `/esim/topup`, `/gift`); the payer echoes `accepted`, and `decide()` compares the echo, so a
   header signed against one route's 402 is refused on another. EIP-3009 signs only the authorization, so this
   stops the replay of an unmodified captured header, not a thief who edits the JSON (Low residual, as AP7.8).
10. **Sponsor scopes (RT-A-04).** The campaign-scoped `SponsorLogin` session authorizes dashboard reads and initial registration. Registration is one-time: an id that
    is already registered is 409 `campaign_exists`, whoever signs, so a captured bearer neither rewrites a campaign
    nor mints its audit key again. The audit key is shown once in the registration's 201 and once on the first
    dashboard read, each a ledger once-marker. This session does not authorize card minting, which requires the separately signed `SponsorCards` operation. The login does not bind initial metadata; a holder of that session can exercise its intended first-registration permission. A metadata-bound `SponsorRegister` signature would be additional scope hardening, rather than the current authentication contract.
11. **Concurrency controls.** Top-ups and cancellation share the entitlement mutex. Each top-up journals a stable physical target, records its applied operation id under CAS, and uses the latest volume. A profile that cannot be topped up is refused before quoting or settlement. Policy changes, Agent Pass start/poll, and paid top-up checks share a policy mutex; approvals also bind the exact policy contents, so a stale approval cannot authorize new limits even if a revoke checkpoint fails.
12. **Gift payment and recovery.** New gifts offer only EVM payment rails with signed reclaim support. Paid requests require a stable random `Idempotency-Key` (at least 32 URL-safe characters; UUIDv4 is supported), persisted by the buyer before sending. Exact signed retries with that private token resume the original escrow/PIN after authorization expiry, without charging again. A public transaction or signature alone never recovers a gift PIN. Historical native Hedera gifts still need operator-assisted reclaim; new native gift purchases are blocked before settlement.

    Free claims and gift/card redemption also accept a private random `Idempotency-Key`. Save it together with the original session key before claiming. A fresh challenge and valid World proof, PIN or recipient signature, the same session public key, and that original private token recover plan metadata after a lost response. `/delivery` then returns the original nonce and ciphertext. The public session key alone never recovers a capability. Legacy completed claims without a token cannot add this recovery binding afterward.

13. **Refund recovery.** A recoverable treasury prepares signed transaction bytes without broadcasting. The API saves them before submission and retries only those exact bytes, with one pending nonce per network. Boot, a 30-second worker and `/me` reads reconcile confirmed transactions and repair their receipts. Pending jobs have no expiry. A confirmed `refund.tx` means refunded; otherwise `refund.recovery` is `automatic` or `manual`. Legacy unknown outcomes require explicit operator reconciliation and are never blindly resent.
14. **Package capacity.** Paid allocations and cards cannot exceed the configured provider package. Free campaigns validate their own package and effective tier sizes. `/plans.sponsor` publishes the minimum per-claim price and maximum campaign lifetime for pre-funding validation.
