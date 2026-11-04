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

| Method & path                                                                          | Success                                                                                   | Errors (all `errorBodySchema` + `X-Request-Id`)                                            |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /healthz`                                                                         | 200 `{ ok, mode, chainId, attestor, degraded }`                                           | 503 `chain_unreachable`                                                                    |
| `GET /plans`                                                                           | 200 `plansResponseSchema` (cached 60 s)                                                   | 503                                                                                        |
| `POST /challenge`                                                                      | 200 `challengeSchema` (no ledger write)                                                   | 400, 429 (10/min/IP)                                                                       |
| `POST /world/rp-context`                                                               | 200 `rpContextSchema` (ttl 300 s, server clock)                                           | 400, 429 (10/min/IP, checked before signing)                                               |
| `POST /claim`                                                                          | 201 `entitledResponseSchema`; 202 `pending-profile`                                       | 400, 401, 402 (device tier), 404, 409, 410, 423, 429 (5/min/IP or hourly cap), 503         |
| `GET /esim/provision?mb=&planId=`                                                      | 201 + `PAYMENT-RESPONSE`; 202 pending                                                     | 400 (no/invalid `X-Session-Pubkey`, bad mb), 402 + `PAYMENT-REQUIRED`                      |
| `GET /esim/topup?key=&mb=`                                                             | 200 `topUpResponseSchema` + `PAYMENT-RESPONSE`                                            | 400, 402, 404, 410 (expired; never settled), 429 `daily_cap`                               |
| `POST /gift`                                                                           | 201 `giftResponseSchema` + `PAYMENT-RESPONSE`                                             | 400, 402, 404 `name_unresolved` (before any 402)                                           |
| `POST /gift/claim`                                                                     | 201 `entitledResponseSchema`                                                              | 400, 401, 409, 410                                                                         |
| `POST /gift/reclaim`                                                                   | 200 `giftReclaimResponseSchema`                                                           | 400, 401, 404 `unknown-gift`, 409 (too-early, claimed, already-reclaimed), 410, 429, 503   |
| `GET /card/:serial`                                                                    | 200 `cardPreviewSchema` (read-only)                                                       | 404                                                                                        |
| `POST /card/redeem`                                                                    | 201 `entitledResponseSchema`                                                              | 400 (Verhoeff), 401 (unknown card or wrong PIN, one body), 410 (redeemed), 429 (10/min/IP) |
| `POST /webhooks/reseller/:provider`                                                    | 204                                                                                       | 400, 401, 404 (other provider), 409 (replay), 413 (256 KiB), 503; never 500                |
| `GET /me/:key` (`?refresh=1`)                                                          | 200 `meResponseSchema`                                                                    | 404 unknown, 410 expired, 503                                                              |
| `GET /me/:key/receipts`                                                                | 200 `receiptsResponseSchema`                                                              | 404                                                                                        |
| `POST /sponsor`                                                                        | 201 `{ id, auditKey }`                                                                    | 400, 401 (signer, on-chain sponsor), 404 (no on-chain campaign)                            |
| `GET /sponsor/:id`                                                                     | 200 `sponsorViewSchema` (`auditKey` on the first read only)                               | 401                                                                                        |
| `PUT /agent/policy` · `GET /agent/policy/:key`                                         | 200 `agentPolicyViewSchema`                                                               | 400, 401, 404, 409 (older `issuedAt`)                                                      |
| `GET /facilitator/supported` · `POST /facilitator/verify` · `POST /facilitator/settle` | 200 v2 `{ kinds, extensions: [], signers }` · `verifyResultSchema` · `settleResultSchema` | 400 (not our network/asset/payTo), 404 (no self-run facilitator), 429 (30/min/IP)          |
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
  signing key, `WORLD_ENVIRONMENT=staging`, or any `SEED_*` variable.

**Degradation (T-51).** The service is "degraded" for 60 s after the ledger throws. During that window `/me` serves
its 60-s cache with `degraded: true`, and every write path fails closed with 503. `decide()` never reads the cache.

**Local seed hooks (T-85).** `X-Seed-Validity-S` (on `/claim`), `X-Seed-Claim-Window-S` (on `/gift`) and
`X-Seed-Card-Campaign` (on `/gift`; it mints a campaign-funded card without payment) are read only inside
`MODE === 'local'` guards (`src/seed.ts`). Each use is logged with `event: 'seed-hook'`. In live mode they are
ignored.

## Where Hedera lives in the code

- `src/routes/claim.ts`: the x402 top-ups the agent pays from its Hedera wallet. `src/accepts.ts` builds the
  `hedera:testnet` accept template (HTS USDC `0.0.429274`, `extra.feePayer` from the facilitator, 180 s).
- `src/chain.ts`: `DataDrop.claim` from the attestor on Hedera EVM 296 in live (Anvil locally).
- `src/flows/record.ts`, called from `fulfil.ts`, `gift.ts` and `reclaim.ts`: every receipt is also an HCS message
  (`claim`, `settle`, `gift`, `gift-claim`, `gift-reclaim`, `card-redeem`).
- `services/agent` submits `agent-topup` HCS messages under its own HCS-14 UAID.

## Development

```sh
pnpm --filter @ethglobal/api test        # vitest: 54 files (routes, attack/ AP1–AP21, regression/ T-xx, Anvil-backed chain test)
pnpm --filter @ethglobal/api coverage    # v8; thresholds lines 85 %
pnpm --filter @ethglobal/api typecheck && pnpm --filter @ethglobal/api build
pnpm --filter @ethglobal/api openapi     # regenerate openapi.json (openapi:check verifies it)
bash scripts/e2e-local.sh                # Anvil + Deploy.s.sol (scripts/dev-chain.sh) + the API + scripts/e2e-flow.ts
```

`test/support/harness.ts` is the in-process harness: `buildDeps` plus the `MemoryDataDrop` double plus `fakeClock`,
driven through `app.request()`. `test/chain.anvil.test.ts` spawns Anvil (and is skipped without Foundry).
`test/attack/*.attack.test.ts` encodes `security/redteam/attacks/wave2-api-agent.md`. `test/regression/T-xx-*.test.ts`
are the THREAT-MODEL §5.12 regression files.

## Decisions and open findings

1. **OpenAPI uses zod 4's `z.toJSONSchema`** (draft 2020-12, which is OpenAPI 3.1's dialect) over the protocol
   schemas, not `@hono/zod-openapi`. It produces the same single source of truth without a new dependency (the
   `minimumReleaseAge` gate).
2. **Receipts have no patch.** `ReceiptStore` only adds. So HCS is submitted first and the receipt is written with
   its `hcs` reference. A reclaim writes a pending `gift-reclaim` receipt keyed `rcpt:ledger:gift-reclaim:<giftId>`
   (the logical key makes it a cross-process lock), then a settled twin keyed by the refund tx.
   - **Gap (octroi):** `ReceiptStore.patch`, and a by-kind-and-day query for the treasury cap. Today the cap is an
     in-process day counter.
3. **Claim keys on receipts.** `campaignClaimKey` is stored as the claim receipt's `payer`, written as 64 hex
   characters without `0x` because the schema allows at most 64. The sponsor view re-prefixes it, and `/me/:key/receipts`
   drops `payer` on claims.
4. **The `/gift/reclaim` challenge** is requested with `sessionPubKey = payer address left-padded to 32 bytes`,
   because the reclaim body has no session key.
5. **Gift claims write their `gift-claim`/`card-redeem` receipt before delivery (T-71 a).** If that write fails, the
   claim answers 503 and no LPA leaves the server. A later reclaim then refunds legitimately, since nothing was
   delivered.
6. **T-24 recovery.** When a human's chain step fails after verification, the serve-free decision is kept for 65 min
   under the session key that the challenge MAC binds. A retry with a fresh challenge from that session completes
   without a second World proof. Another session cannot use it.
7. **Expired versus unknown.** The stores hide dead entities. The API remembers the expiry of every entitlement it
   has seen, so a vanished entity answers 410 rather than 404 (in-process memory).
8. **No 403 code exists in `ERROR_CODES`.** Sponsor and owner mismatches therefore answer 401 `unauthorized`.
   - **Finding (T-15, octroi):** `decide()` stops at `verify → nonce_already_used` before the self-run
     facilitator's front-run recovery in `settle()`. A front-run human payment therefore answers 402: no double
     charge and no service. `test/attack/x402.attack.test.ts` pins this.
   - **Finding (T-71 e, protocol):** `RECEIPT_TTL_S` (30 d) is shorter than `claimBy + GIFT_RECLAIM_WINDOW_S`
     (37 d), so a day-31 reclaim answers `unknown-gift`. This is pinned by a test.
   - **Finding (AP6.3):** a pending-profile LPA retried by `/me` is sealed to the original session key and stored
     as a blob reference, but no route delivers it yet.
   - **Finding (T-73 b, Med):** the first owner of a free entitlement's agent policy wins. Fixing it needs an
     `/agent/policy` challenge path in protocol.
   - **Recorded:** a payment is not bound to `?key=` on top-ups (AP7.8, Low). There is one free entitlement per
     human across campaigns while it lives (`ent:v1:` is global; AP1.5). AP7.15 (Hedera payloads) is covered by
     the adapters' facilitator tests, because local mode advertises no Hedera kind.
