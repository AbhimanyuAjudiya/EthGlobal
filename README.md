# Recharge

**Recharge: prove you're human and a sponsor pays for your first 300 MB of Mumbai data; after that you — or your
agent — pay per 100 MB over x402, every bundle is an Arkiv entity that expires by itself, and anyone can gift data to
an ENS name.**

_Glassbox402 priced humans and agents differently; Recharge is the gate that proves which is which, and sells them a
good people want on day one._

Built for ETHGlobal Mumbai 2026 (Continuity track; see [the disclosure](#continuity-disclosure)). Partner programs:
**Hedera**, **World** and **Arkiv** (+ Swarm). **ENS** is integrated but not claimed. Video: **TBD by human
(Design/Producer, Fri 6 Nov 23:30 IST)**; submissions close **Sat 7 Nov 2026 09:00 IST** (no late submissions) · Live: **https://app.recharge.ajudiya.com** (API `https://api.recharge.ajudiya.com`, testnet rails; since Fri 6 Nov 2026 02:50 IST).

## How it works

1. **Proof → money.** World IDKit 4 proves one human. The nullifier becomes an HMAC'd quota key, and `DataDrop.claim`
   on Hedera EVM pays the sponsor's USDC for that one human, once. Orb/Document credentials get the free bundle; Device
   gets the paid lane at the human price.
2. **Entitlement that dies by protocol.** The bundle is an Arkiv entity with `expiresIn` = the plan's validity. The
   eSIM activation code is sealed to the buyer's session key and stored on Swarm. Arkiv holds only the reference.
3. **Pay per 100 MB.** `GET /esim/topup` answers HTTP 402 with x402 v2 `accepts[]` (Hedera testnet USDC, Base Sepolia
   USDC). A human or the agent signs, the facilitator settles, and the entity is extended. Every step writes an HCS
   receipt.
4. **Your agent pays while you sleep.** At 20 % left or at expiry, a Hedera Agent Kit wallet with an HCS-14 UAID buys
   one step under a cap the owner signed (`maxUsd6PerDay`). The policy is enforced in code, never by a model.
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

| Artefact                                      | Value                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------ |
| Live x402 endpoint                            | `https://<vps>/esim/topup`: TBD by human (Integrations, Fri 06:00)                   |
| `DataDrop` (296)                              | TBD by human (Integrations, Wed 14:00) · HashScan link                               |
| `Claimed` event (in-window)                   | TBD by human (Integrations, Fri 06:00) · HashScan link                               |
| Human x402 settlement · agent x402 settlement | TBD by human (Integrations, Fri 06:00) · HashScan links                              |
| HCS topic                                     | TBD by human (Integrations, Wed 14:00) · `https://hashscan.io/testnet/topic/<0.0.x>` |
| Agent UAID                                    | TBD by human (Provisioning/Agent, Fri 14:00)                                         |
| Video timestamp                               | TBD by human (Design/Producer, Fri 23:30)                                            |

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
| Tier table                                        | Orb 300 MB free · Document 150 MB free · Device: paid at $0.40 / 100 MB (demo campaign; sizes come from `/plans`) |
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
| Entity keys (pre-kickoff · in-window)                                  | TBD by human (Integrations, Wed 14:00) · TBD by human (Integrations, Fri 06:00)                                                                                                                                     |
| Queries (attribute filters, built with the SDK's `eq(...)`/`and(...)`) | `type = "entitlement" && logicalKey = "hk:…" && $creator = <writer>`; `type = "gift" && namehash = <namehash(name)> && state = "open"`; `type = "receipt" && entitlementKeyHash = <sha256(key)> && day = <utc day>` |
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

## AI use

An AI orchestrator wrote most of the pre-kickoff code under human direction and review, with a red-team pass. In-window
commits are authored by the named team members with AI assistance for tests, fixtures and documentation. Keys were
generated on-site and never entered an AI context.

## Revenue

**TBD by human (Founder, Thu 18:00).** The wording is decided by the E1 verdict (DECISION §5.4).

## Dependencies: the 3-day release-age gate

`pnpm-workspace.yaml` sets `minimumReleaseAge: 4320` (THREAT-MODEL T-65: never resolve a version published less than
3 days ago). Several catalog pins were younger than that when they were chosen, for example `@arkiv-network/sdk@1.0.1`
and `@vitest/coverage-v8@5.1.0`. Packages added in waves 1–3 (`octroi`, `protocol`, `crypto`, `eip3009`, `agent`,
`scripts`) also have no `pnpm-lock.yaml` entry yet. So **`pnpm install --frozen-lockfile` (and CI) fails until the
pinned versions age past the gate and the lockfile is regenerated.** Nobody has loosened the gate, and it must not be
loosened to unblock a build.

**The lockfile refresh (RT-P-04), Thu 5 Nov afternoon IST (after ≈ 08:30 UTC, when the youngest pin clears the
gate).** On a machine with registry access, a human runs `bash scripts/refresh-lockfile.sh`. It runs `pnpm install`, then
`pnpm install --frozen-lockfile`, then `security/redteam/tools/deps-check.sh`, and stages `pnpm-lock.yaml`. Review the
diff and commit it. Every direct dependency is now an exact `catalog:` pin (RT-P-05), so the refresh resolves the
versions the tests ran on, and only transitive versions are new. Until then CI's install step fails with a message
pointing here and at `docs/ONSITE-RUNBOOK.md` §0. The blocking `fixture-scan` job needs no install and still runs.
After the refresh, always install with `pnpm install --frozen-lockfile`.

How the build machine bridged it: each workstream installed gate-compliant copies with
`npm install --before=2026-10-31 --prefix <scratchpad>/<name> <pkg>@<version>`, then symlinked them into the package's
`node_modules` with a per-package link script (`link-api.sh`, `link-agent.sh`, `link-scripts.sh`, …, kept outside the
repo). `package.json` files declare only `workspace:*` and `catalog:` versions, so a real `pnpm install` replaces every
link. The one new third-party dependency in wave 3 is the QR encoder **`uqr@0.1.3`** (MIT, zero dependencies, published
2026-04-03), pinned in the catalog and used only by `scripts/print-cards.ts`.

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
