# Recharge

**Recharge: prove you're human and a sponsor pays for your first Mumbai data (up to 1 GB); after that you — or your
agent — buy 1 GB at a time ($4.00) over x402, every bundle is an Arkiv entity that expires by itself, and anyone can
gift data to an ENS name.**

_Glassbox402 priced humans and agents differently; Recharge is the gate that proves which is which, and sells them a
good people want on day one._

Built for ETHGlobal Mumbai 2026 (Continuity track; see [the disclosure](#continuity-disclosure)). Partner programs:
**Hedera**, **World** and **Arkiv** (+ Swarm). **ENS** is integrated but not claimed. Video: **TBD by human
(Design/Producer, Fri 6 Nov 23:30 IST)**; submissions close **Sat 7 Nov 2026 09:00 IST** (no late submissions) · Live: **https://app.recharge.ajudiya.com** (API `https://api.recharge.ajudiya.com`, testnet rails; since Fri 6 Nov 2026 02:50 IST).

## How it works

1. **Proof → money.** World IDKit 4 proves one human. The nullifier becomes an HMAC'd quota key, and `DataDrop.claim`
   on Hedera EVM pays the sponsor's USDC for that one human, once (a campaign pays at least $1.20 a claim, the cost of
   the eSIM it provisions). Orb/Document credentials get the free bundle (up to 1 GB); Device gets the paid lane at the
   human price.
2. **Entitlement that dies by protocol.** The bundle is an Arkiv entity with `expiresIn` = the plan's validity. The
   eSIM activation code is sealed to the buyer's session key and stored on Swarm. Arkiv holds only the reference.
3. **Pay per 1 GB.** The product unit is the smallest eSIM the reseller sells: a new plan (`GET /esim/provision`) is
   1 GB for $4.00 ($0.40 per 100 MB) and a top-up (`GET /esim/topup`) adds 1 GB for $4.00, older 300 MB plans too.
   The API answers HTTP 402 with x402 v2 `accepts[]` (Hedera testnet USDC, Base Sepolia USDC). A human or the agent
   signs, the facilitator settles, and the entity is extended. Every step writes an HCS receipt.
4. **Your agent pays while you sleep.** At 20 % left or at expiry, a Hedera Agent Kit wallet with an HCS-14 UAID buys
   one 1 GB step ($4.00) under a cap the owner signed (`maxUsd6PerDay`). The policy is enforced in code, never by a
   model.
5. **Gift to a name.** `POST /gift { name: 'rahul.eth' }` resolves ENS before any 402 and escrows the bundle as an
   entity keyed by namehash. The recipient claims it with an EIP-712 signature (or a 16-digit scratch-card PIN). If
   nobody claims it, the sender reclaims the USDC.

```
            World App (IDKit 4)                    judge / traveller (PWA, apps/web)                   agent (services/agent)
                   │ proof                                  │ challenge · claim · 402 · pay                     │ --once / loop
                   ▼                                        ▼                                                   ▼
   ┌──────────────────────────────────────────── services/api (Hono, MODE=local | live) ────────────────────────────────────────┐
   │ requestId → logger → securityHeaders → cors → rateLimit → bodyLimit → idempotency → validate → x402 → octroi → handler    │
   │                    packages/octroi: decide() · tiers · sizing · keys · challenge · shouldTopUp · reclaim                   │
   └───────┬───────────────┬────────────────────┬────────────────────┬─────────────────┬──────────────────┬───────────────────┘
           │ Personhood    │ PaymentRail        │ Ledger             │ BlobStore       │ ConsensusLog     │ NameResolver
           ▼               ▼                    ▼                    ▼                 ▼                  ▼
   World cloud verify   x402 facilitator     Arkiv rabdi          Swarm Bee         HCS topic          ENS (viem)
   /api/v4/verify       (remote | self-run)  entities+expiresIn   sealed LPA blob   receipts + UAID    rahul.eth → 0x…
           │               │ settle
           ▼               ▼
   DataDrop.sol on Hedera EVM 296 (sponsor pool: Claimed per verified human)  ·  HTS USDC 0.0.429274  ·  Base Sepolia USDC
   ─────────── packages/adapters: one port per sponsor; deterministic mocks (MODE=local) and live adapters (MODE=live) ───────────
```

## Run it (`MODE=local`, no network beyond your machine)

You need Node 22, pnpm 10, and Foundry 1.5.1 (`bash scripts/check-tools.sh`). Then three commands:

```sh
pnpm install --frozen-lockfile && pnpm --filter @ethglobal/contracts run deps   # see "Dependencies" below
pnpm -r run build
pnpm demo -- --web     # Anvil + Deploy.s.sol + the API on :8787 + the demo seed + the web app on :3000 (Ctrl-C stops all)
```

`pnpm demo` prints three `/plan/<key>` URLs (an Orb free bundle at 60 % used, a paid plan at 18 % left, and a Document
bundle that expires in 90 s), a 1 GB gift to `rahul.eth`, and ten scratch cards. Add `--agent` to run the top-up agent
on the paid plan.

To prove the whole flow headless, run `pnpm e2e` (`scripts/e2e-local.sh`). It brings up Anvil, deploys, starts the API,
runs the seed, the agent's `--once` pass (I-10) and the BUILD-PLAN §4 flow (I-0…I-18: claim with a real `Claimed`
log, 402 → EIP-3009 settlement, webhook, gift, card, sponsor dashboard, expiry, reclaim), then scans every log for
secrets. Measured on the build machine: **all steps passed in 23.4 s**.

| Command                                     | What it runs                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm demo` · `pnpm demo:seed [-- --reset]` | the local stack plus the seed · the seed alone against a running stack                       |
| `pnpm e2e` · `pnpm e2e:web`                 | the integration test above · plus Playwright (`apps/web/e2e`, when the web suite lands)      |
| `pnpm print:cards [-- --count 10]`          | the scratch-card PDF (N coupons + 1 keyline, real QR codes; `out/` is git-ignored)           |
| `pnpm redteam [1\|2\|3\|all]`               | `security/redteam/run-wave.sh`: slither, semgrep, attack suites, forbidden patterns          |
| `pnpm audit`                                | build, lint, typecheck, tests, forge, jscpd, generated artefacts, e2e, the full red-team run |
| `pnpm dev:chain` · `pnpm dev`               | Anvil + deploy on :8545 · the web and API dev servers                                        |
| `pnpm schema:gen` · `pnpm schema:check`     | `docs/arkiv.schema.json` from the protocol schemas                                           |

`pnpm lint` runs type-aware ESLint over every workspace project; with Node's default heap it aborts out of memory, so
run it as `NODE_OPTIONS=--max-old-space-size=8192 pnpm lint` (security/AUDIT.md, AUD-01).

`MODE=live` is configuration, not code. Copy `.env.example` to `.env` and fill in the live block: `MODE=live`,
`CHAIN=296`, `RPC_URL`, `OCTROI_SECRET`, `SERVER_SEAL_KEY`, `ATTESTOR_PRIVATE_KEY`, `RELAYER_PRIVATE_KEY`,
`PAYOUT_ADDRESS`, `PAYOUT_HEDERA_ACCOUNT`, `TREASURY_*`, `X402_FACILITATOR=remote`, `X402_FACILITATOR_URL_*`,
`X402_NETWORKS`, `RESELLER=esimaccess`, `ESIMACCESS_*`, `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`,
`ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY`, `HEDERA_ACCOUNT_ID`, `HEDERA_PRIVATE_KEY`, `HCS_TOPIC_ID`, `ENS_RPC_URL`,
`SWARM_BEE_URL`, `SWARM_POSTAGE_BATCH`, and `AGENT_*` for the agent. `services/api/src/env.ts` refuses to boot on any
Anvil key, a Kaolin chain id, debug logging or any seed variable. The on-site procedure is in
[`docs/ONSITE-RUNBOOK.md`](docs/ONSITE-RUNBOOK.md).

## Hedera

**Load-bearing:** money. The sponsor pool pays per verified human on Hedera EVM, a human pays for top-ups over x402 on
Hedera testnet, the agent pays from a Hedera Agent Kit wallet with an HCS-14 identity, and every claim, settlement and
gift is an HCS message.

| Primitive                                                                                                                                                                              | Where Hedera lives in the code                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| x402 v2 `exact` on `hedera:testnet`, HTS USDC `0.0.429274`, `extra.feePayer` from the facilitator's `/supported`, ≤ 180 s validity                                                     | `services/api/src/routes/claim.ts` (`/esim/provision`, `/esim/topup`), `services/api/src/accepts.ts`, `services/api/src/middleware/x402.ts`, `packages/adapters/src/live/remote-facilitator.ts` |
| `DataDrop.sol` on Hedera EVM (chain 296): sponsor-scoped campaigns, `claim` by the attestor, `Claimed(id, claimKey, paid, hour)`, `associateHts`                                       | `packages/contracts/src/DataDrop.sol`, `packages/contracts/script/Deploy.s.sol`, `services/api/src/chain.ts`                                                                                    |
| HCS receipts (`TopicMessageSubmitTransaction`, `@hiero-ledger/sdk@2.90.1`; mirror-node reads)                                                                                          | `services/api/src/flows/record.ts`, `packages/adapters/src/live/hcs-log.ts`, `packages/adapters/src/live/hedera-sdk.ts`                                                                         |
| Hedera Agent Kit 4.2.0 (`AgentMode.AUTONOMOUS`, `ASSOCIATE_TOKEN_TOOL`, `SUBMIT_TOPIC_MESSAGE_TOOL`, driven by code, no LLM tools) and the x402 Hedera client payload (`@x402/hedera`) | `services/agent/src/payers/hedera.ts`, `services/agent/src/receipts.ts`                                                                                                                         |
| HCS-14 UAID (`uaid:aid:…`, conformance-tested against vectors recorded from `@hashgraphonline/standards-sdk@0.1.192`)                                                                  | `services/agent/src/identity.ts`, `packages/adapters/src/live/hcs14.ts`                                                                                                                         |

Payment flow (x402 v2 `exact` on `hedera:testnet`, one paid request):

1. **Setup.** `MODE=live` with `X402_NETWORKS` including `hedera:testnet`, `X402_FACILITATOR=remote` (x402.org) and
   `PAYOUT_HEDERA_ACCOUNT`; at boot the API reads the facilitator's `/supported` and takes `extra.feePayer` from it.
2. **402.** `POST /gift` (or `GET /esim/topup`) without payment answers 402 with `PAYMENT-REQUIRED`: `hedera:testnet`,
   asset `0.0.429274`, `4000000` (4.00 USDC for 1 GB), payTo `0.0.11322453`, feePayer `0.0.9185802` (`accepts.ts`, `middleware/x402.ts`).
3. **Pay.** The payer (the agent's Agent Kit wallet, `services/agent/src/payers/hedera.ts`, or HashPack in the PWA)
   signs an HTS transfer with the fee payer as transaction payer and retries with `PAYMENT-SIGNATURE`.
4. **Settle.** The API calls the facilitator's `/verify` and `/settle`; the facilitator co-signs and submits; the
   paid request succeeds (201 on `/gift`) with `PAYMENT-RESPONSE` carrying the Hedera `transaction` id.
5. **HCS receipt.** The API writes the receipt to topic `0.0.11322448` (`flows/record.ts`); the agent adds `agent-topup`.

| Artefact                                    | Value                                                                                                                                                                                                                                                       |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live x402 endpoints                         | `https://api.recharge.ajudiya.com/gift` · `https://api.recharge.ajudiya.com/esim/topup` (`GET /healthz` → `mode: live`, `chainId: 296`)                                                                                                                     |
| `DataDrop` (Hedera EVM 296)                 | [`0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6`](https://hashscan.io/testnet/contract/0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6) · deploy tx [`0x234ec50e…1304b`](https://hashscan.io/testnet/transaction/0x234ec50e7187d149fdd4d26b508c579273672f0a9c81553b45c862e61781304b) |
| `Claimed` event (pre-kickoff)               | [`0xec5f963f…86c53`](https://hashscan.io/testnet/transaction/0xec5f963f2bacf55c8c408d4d699650197f19077dbfa209b723039ad75f886c53) (paid 500000, hello campaign)                                                                                              |
| Settlement asset                            | HTS USDC [`0.0.429274`](https://hashscan.io/testnet/token/0.0.429274)                                                                                                                                                                                       |
| Facilitator · fee payer                     | x402.org (`https://x402.org/facilitator`) · [`0.0.9185802`](https://hashscan.io/testnet/account/0.0.9185802)                                                                                                                                                |
| Settled x402 payment                        | [`0.0.9185802@1793882124.642565779`](https://hashscan.io/testnet/transaction/0.0.9185802@1793882124.642565779): `POST /gift` to `re-charge.eth`, 0.40 USDC from `0.0.11320978` to `0.0.11322453`, Thu 5 Nov 18:05 IST. This is the **pre-kickoff** pay-flow proof (`docs/DISCLOSURE.md` §2), not an in-window payment |
| HCS receipts topic                          | [`0.0.11322448`](https://hashscan.io/testnet/topic/0.0.11322448); the receipt for the payment above is seq 3 (`t: gift`, gift `0xd8462ad9…`)                                                                                                               |
| Agent UAID (HCS-14, self-issued, not registered) | `uaid:aid:q4YxqiHBaGpeMoD1gvzCVQ6k6WtBLutszq5Ked4Y23g5HvFeFU83agQ7UovrE8RWd;uid=0;registry=hedera;proto=x402;nativeId=hedera:testnet:0.0.11320978`                                                                                                     |
| Autonomous agent top-up (in-window)         | [`0.0.9185802@1793925870.465901542`](https://hashscan.io/testnet/transaction/0.0.9185802@1793925870.465901542) — Fri 6 Nov 06:14 IST: `recharge-agent` (Agent Kit payer `0.0.11320978`, HCS-14 UAID) hit its policy threshold, paid 0.40 USDC (HTS `0.0.429274`) for 100 MB on `GET /esim/topup` with no human approval; facilitator fee payer `0.0.9185802`; API 200, plan 300 → 400 MB; HCS receipts seq 7 (settle) and seq 8 (`agent-topup`) on [`0.0.11322448`](https://hashscan.io/testnet/topic/0.0.11322448) |
| Video timestamp                             | TBD by human (Design/Producer, Fri 23:30)                                                                                                                                                                                                                   |

## World

**Load-bearing:** credential level is _pricing_. Orb/Document → the sponsor-funded free bundle (sized by rule); Device →
the paid lane at the human price. The nullifier is what releases sponsor USDC (`DataDrop.claim` keyed by an HMAC of it),
once per human per campaign.

| Primitive                                                                                                                             | Where                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| IDKit 4 with a backend-signed `rp_context` (`POST /world/rp-context`, 300 s, never signed in the browser)                             | `services/api/src/routes/public.ts`, `packages/adapters/src/live/world-rp-context.ts`         |
| Cloud verification `POST /api/v4/verify/{rp_id}`, action `recharge-welcome` (production), `signal_hash` bound to the server challenge | `packages/adapters/src/live/world-personhood.ts`, `services/api/src/middleware/octroi.ts`     |
| Tier → price/bundle, the one-human-one-claim decision                                                                                 | `packages/octroi/src/decide.ts`, `packages/octroi/src/tier.ts`, `packages/octroi/src/size.ts` |
| The verify screen (IDKit in the PWA)                                                                                                  | `apps/web/app/verify` (web workstream, in progress)                                           |

| Artefact                                          | Value                                                                                                             |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `app_id` · action                                 | TBD by human (Integrations, Wed 14:00) · `recharge-welcome`                                                       |
| Verification logs (hashed nullifiers, timestamps) | TBD by human (Integrations, Fri 06:00)                                                                            |
| Tier table                                        | Orb/Document: free, up to 1 GB (demo campaign: 300/150 MB) · Device: paid, 1 GB for $4.00 (sizes are in `/plans`) |
| Video timestamp                                   | TBD by human (Design/Producer, Fri 23:30)                                                                         |

## Arkiv (+ Swarm)

**Load-bearing:** entitlement. Entitlements, receipts, gifts, challenge nonces and agent policies are entities with
`expiresIn` = their validity. Three reads depend on them: every `/esim/*` request (R1), the agent's remaining-MB read
(R2), and the gift claim by namehash (R3). The sponsor dashboard is a query, not our database.

| Primitive                                                                                                                                                                                | Where                                                                                                                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@arkiv-network/sdk@1.0.1` on **rabdi (7794095)**: `createEntity` with `ExpirationTime.fromSeconds`, `select` with `eq('$creator', writer)` on every read, `patchEntity`, `extendEntity` | `packages/adapters/src/live/arkiv-ledger.ts`, `packages/adapters/src/live/arkiv-sdk.ts`                                                                |
| Annotations and queries (one owner)                                                                                                                                                      | `packages/octroi/src/store/*`                                                                                                                          |
| Schema file · feedback file · Swarm file                                                                                                                                                 | [`docs/arkiv.schema.json`](docs/arkiv.schema.json) (generated) · [`docs/ARKIV_FEEDBACK.md`](docs/ARKIV_FEEDBACK.md) · [`docs/SWARM.md`](docs/SWARM.md) |
| Swarm: the sealed LPA blob, `POST /bzz` with a postage batch; `sealedRef` on the entity                                                                                                  | `packages/adapters/src/live/swarm-blobs.ts`, `services/api/src/flows/fulfil.ts`                                                                        |

| Artefact                                                               | Value                                                                                                                                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Writer (`$creator`) · judge folder                                     | `0xC3358be9F35fDF5C8e1922be7376980C93734d3c` · [`arkiv/`](arkiv/README.md) (schema, friction, before/after, one paste-able `arkiv_query`) |
| Entity keys (pre-kickoff · in-window)                                  | `0xb9429fbd706f46a55d16788d9446f147f9d65b9ef005b7f463bae9caadb2abb1`, live entitlement `0xcfca33d17cc05a5d6697e92cb0bad014dad41747049a05cf7c52d6bb520c55e7` · none yet (see [`arkiv/before-after.md`](arkiv/before-after.md)) |
| Queries (attribute filters, built with the SDK's `eq(...)`/`and(...)`) | `$creator = addr(<writer>) AND type = str('entitlement') AND logicalKey = str('hk:…')`; `… AND type = str('gift') AND namehash = str(<namehash(name)>) AND state = str('open')`; `… AND type = str('receipt') AND entitlementKeyHash = str(<sha256(key)>) AND day = u64(<utc day>)` |
| Entity key ↔ Swarm reference                                           | TBD by human (Integrations, Fri 06:00), see `docs/SWARM.md`                                                                                                                                                         |
| Video timestamp                                                        | TBD by human (Design/Producer, Fri 23:30)                                                                                                                                                                           |

## ENS (integrated, unclaimed)

| Primitive                                                                                                                             | Where                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| ENSIP-15 normalisation (one implementation shared by mock and live), forward resolution `getEnsAddress`, `getEnsText`, before any 402 | `packages/adapters/src/live/ens-resolver.ts`, `packages/adapters/src/ens-name.ts` |
| Gift escrow keyed by namehash; `GiftClaim` EIP-712 signed by the resolved address (re-resolved at claim, T-43)                        | `services/api/src/routes/gift.ts`, `services/api/src/flows/gift.ts`               |

## Prior art

- **Silent.link / Bitrefill** (crypto eSIMs since 2021): no human lane, no on-ledger entitlement, no agent metering, no
  gifting by name.
- **GSpot** (ETHGlobal Lisbon 2023, eSIM + ZK-KYC): gating only. No metering, no agent, no sponsor-funded free tier.
- **Glassbox402**: priced humans and agents differently. Recharge is the gate that proves which is which (the mechanism
  sentence above).

## Measured

| What                                                                        | Value                                                                |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `MODE=local` end-to-end (`pnpm e2e`, Anvil + API + seed + agent + 18 steps) | 23.4 s on the build machine (target < 60 s)                          |
| eSIM attach latency, 3 attempts × iPhone / Android                          | TBD by human (Provisioning, Wed 10:00)                               |
| Arkiv write/read latency on rabdi (p50 / p95)                               | TBD by human (Integrations, Wed 14:00), see `docs/ARKIV_FEEDBACK.md` |

## Tests

Counts at the last pre-kickoff snapshot `e39897a` (clean tree, Wed 4 Nov 14:46 IST):

| Package                        | Tests                                                                                          |
| ------------------------------ | ---------------------------------------------------------------------------------------------- |
| `@ethglobal/protocol`          | 321                                                                                            |
| `@ethglobal/crypto`            | 30                                                                                             |
| `@ethglobal/eip3009`           | 68                                                                                             |
| `@ethglobal/octroi`            | 320 + 27 open red-team findings (`_RTFINDING`, excluded from the blocking CI gate until fixed) |
| `@ethglobal/adapters`          | 310 (+ 14 skipped without live credentials)                                                    |
| `@ethglobal/contracts` (forge) | 185                                                                                            |
| `@ethglobal/ui`                | 172                                                                                            |
| `@ethglobal/api`               | 248                                                                                            |
| `@ethglobal/agent`             | 137                                                                                            |
| **Total**                      | **1 791 passing**, plus the real-stack loop `pnpm e2e` (I-0…I-18 + I-10)                       |

## Honestly mocked in the demo

(DECISION §6.6, verbatim; each is labelled on screen.)

- usage telemetry when the reseller usage API lags ("simulated usage");
- fulfilment from pre-bought inventory if a live order fails ("inventory profile");
- HCS-14 registration minimal;
- AgentKit discount mode absent unless beta lands ("IDKit humans only");
- the demo sponsor is "Recharge (demo sponsor)" unless a real sponsor funds a testnet campaign on Thursday;
- the Hedera human payment is made by a judge or a non-team attendee with a Hedera testnet wallet, else by a team wallet
  operated by the judge's tap, said aloud.

In `MODE=local` everything external is a deterministic mock: the World verifier, the reseller (and its usage clock),
HCS, Arkiv (an in-memory ledger with the same expiry rules), Swarm, ENS (`alice.eth`, `bob.eth`, `rahul.eth`) and the
treasury. The chain is Anvil, with real `DataDrop.claim` calls and real EIP-3009 settlement on `MockUSDC3009`. Three
`MODE=local`-only seed hooks (`X-Seed-Validity-S`, `X-Seed-Claim-Window-S`, `X-Seed-Card-Campaign`) exist for the demo
seed. Live mode ignores them, and `env.ts` refuses `SEED_*` variables.

## Continuity disclosure

Recharge is entered in the Continuity track. The full text, the pre-kickoff inventory (`v0-prekickoff` = commit `380ff32`,
committed Thu 5 Nov 20:20:57 IST; the tag object was created at 21:16 IST, after kickoff, with no commit in between), every pre-deployed tx hash and entity key, and the kickoff eligibility answers are in
[`docs/DISCLOSURE.md`](docs/DISCLOSURE.md). The dated in-window work is in [`docs/CHANGELOG.md`](docs/CHANGELOG.md).
In plain terms: the product (gateway, quota engine, sponsor pools, the top-up agent with HCS-14 identity and HCS receipts,
gifts to ENS names, Arkiv expiry, the first testnet payments) was built and exercised **before** kickoff; **in the window**
it went live on AWS at app.recharge.ajudiya.com and gained the EVM wallet layer (RainbowKit/wagmi, WalletConnect), human
Hedera payments with HashPack, the one-tap mobile verify flow, the landing hub and the submission material. The per-sponsor
table at the end of `CHANGELOG.md` (`git diff --stat v0-prekickoff..HEAD`) shows 0 % in-window change on the Hedera, World,
Arkiv and ENS integration paths themselves.

## AI use

An AI orchestrator (Claude) and its builder/red-team agents wrote most of the code, before kickoff and in the window,
under the founder's direction and review; every in-window commit carries a `Co-Authored-By: Claude` line. Keys were
generated on-site and never entered an AI context.

## Revenue

**TBD by human (Founder, Thu 18:00).** The wording is decided by the E1 verdict (DECISION §5.4).

## Dependencies: the 3-day release-age gate

`pnpm-workspace.yaml` sets `minimumReleaseAge: 4320` (THREAT-MODEL T-65: never resolve a version published less than
3 days ago). The gate has never been loosened. The lockfile was regenerated on 6 Nov 2026 once the youngest pins had aged
past it, so `pnpm install --frozen-lockfile` and CI pass. Two high advisories in wagmi's transitive tree are accepted with
written reasons in `auditConfig.ignoreGhsas` (finding RT-P-14): the vulnerable code is not reachable and the patched
versions are cross-major.

## Repository layout

```
apps/web             Next.js 16 PWA (wave 3, in progress) · /ui gallery · /ui/print tooling sheet
apps/video           Remotion: judge cut + social shorts (renders in marketing/videos/renders)
services/api         Hono API: every route of INTERFACES §7, self-run facilitator, MODE=local seed hooks
services/agent       the top-up agent (recharge-agent --once)
packages/protocol    zod schemas, x402 codec, units, ids, errors, EIP-712 types, PIN format (leaf)
packages/crypto      hashes, HMAC, sealing (leaf)
packages/eip3009     EIP-3009 typed data, digest, relayer (leaf)
packages/octroi      the quota engine and the ledger stores
packages/adapters    ports, mocks, live adapters (./live), test helpers (./testing)
packages/contracts   Foundry: DataDrop, EIP3009Token/MockUSDC3009, Deploy.s.sol, deploy/chains.json
packages/ui          design tokens and components
scripts/             dev-chain, e2e-local (+ e2e-agent), demo, demo-seed, print-cards, gen-arkiv-schema, prekickoff-inventory
security/redteam     threat-model tooling, attack scripts, findings, run-wave.sh
docs/                ARCHITECTURE, INTERFACES, BUILD-PLAN, briefs, DISCLOSURE, DEMO-SCRIPT, ONSITE-RUNBOOK, CHANGELOG, Arkiv/Swarm
```

## License

MIT, copyright 2026 Abhimanyu Ajudiya. See [`LICENSE`](LICENSE).
