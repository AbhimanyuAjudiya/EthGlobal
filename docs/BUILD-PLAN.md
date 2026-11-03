# BUILD-PLAN — waves, gates, the integration test and the human hand-off

**Status:** binding for the orchestrator and every builder agent from Tue 3 Nov 2026 to the `v0-prekickoff` tag (Thu 5 Nov 20:59 IST, a human action). **Owner:** architect. **Inputs:** `docs/ARCHITECTURE.md` (why), `docs/INTERFACES.md` (the one source of truth for types; §13 amendments A-1…A-31), `docs/vendor/API-FACTS.md` (verified vendor shapes; A-18…A-30 apply it), `docs/build-briefs/*.md` (one brief per workstream), `docs/THREAT-MODEL.md` + `security/redteam/PLAN.md` (what the red team proves), `research/committee/DECISION.md` §6–7 (scope, checklist, pre-deploy rules).

Precedence when documents disagree: INTERFACES > this file (for commands, order and gates) > a brief > the scaffold. The briefs write their done-commands in shorthand (`pnpm --filter X build typecheck lint test`); §2.0 below gives the real invocation.

---

## 1. The wave plan

### 1.1 Dependency graph

```
             ┌──────────────────────────── wave 1 ────────────────────────────┐
  W1a (≈2 h, 1 agent)                         W1b (3 agents in parallel, ≈6–8 h)
  interfaces: @ethglobal/protocol  ──┬──▶  contracts      (packages/contracts)            ──┐
              @ethglobal/crypto      ├──▶  octroi         (packages/octroi)                 ├──▶ R1 (red team, ≤ 3 h)
              eip3009 skeleton,      └──▶  eip3009 + adapters-live (packages/eip3009,       │
              adapters types/testing             packages/adapters, fixtures/)            ──┘
             └──────────────────────────────────────────────────────────────────┘
                                                   │  (no open Critical/High in the layer below)
             ┌──────────── wave 2 (2 agents, ≈6 h) ─▼──────────┐
             │  api (services/api)   ∥   agent (services/agent) │──▶ R2 (≤ 3 h)
             └──────────────────────────────────────────────────┘
                                                   │
             ┌──────────── wave 3 (2 agents, ≈6 h) ─▼──────────┐
             │  web (apps/web, packages/ui) ∥ ops-demo (scripts, │──▶ R3 (≤ 3 h) ──▶ full audit ──▶ tag v0-prekickoff (human)
             │  fixtures/demo, docs, CI)                         │
             └──────────────────────────────────────────────────┘
```

### 1.2 Workstreams

| Wave | Workstream | Brief | Hard dependencies (must be merged first) | Soft dependencies (stub until it lands, delete the stub before done) | Produces for later waves |
|---|---|---|---|---|---|
| 1a | interfaces | INTERFACES §14 | — | — | `@ethglobal/protocol` (all of §1, incl. `USDC_EIP712_DOMAIN`, `HEDERA_MAX_TIMEOUT_S`, the IDKit 4 `personhoodProofSchema`, `rpContextSchema`, `IDENTIFIER_LEVEL`), `@ethglobal/crypto` complete, `@ethglobal/eip3009` signatures as throwing stubs, `@ethglobal/adapters` §3.1 types + `./testing` helpers, eslint zones, `.env.example`, catalog pins (A-19…A-25) |
| 1b | contracts | `contracts.md` | — (Solidity only) | — | `abi/*.json`, `deploy/addresses.anvil.json` (git-ignored, regenerated), `fixtures/eip3009/vectors.json` (domains `("USD Coin","2")` @31337 and `("USDC","2")` @84532, A-21), `Deploy.s.sol` for 296 |
| 1b | octroi | `octroi-engine.md` | W1a | `@ethglobal/adapters/testing` mocks from W1a; nothing from contracts | `decide`, `buildAccepts`, `shouldTopUp`, `decideGiftReclaim` (A-17), stores |
| 1b | eip3009 + adapters-live | `adapters-live.md` | W1a | `vectors.json` (test `skipIf(!exists)` until contracts lands) | `domainFromRequirements`, relayer, all mocks, all live adapters over fixtures (eSIM Access primary, MegaeSIM stub, inventory; Arkiv rabdi; IDKit 4 verifier + `createRpContextSigner`; x402.org/Blocky402 facilitator; HCS via `@hiero-ledger/sdk`), `fixtures/**` with `"source": "docs"` |
| 2 | api | `api.md` | all of wave 1 + R1 cleared for protocol/crypto/octroi/adapters | `X-Agent-Uaid` from the agent (optional header) | every route of INTERFACES §7 incl. `POST /world/rp-context`, `openapi.json`, the three `MODE=local`-only seed hooks ops-demo needs (`X-Seed-Validity-S`, `X-Seed-Claim-Window-S`, `X-Seed-Card-Campaign`) — **in wave 2's done list, because ops-demo is wave 3** |
| 2 | agent | `agent.md` | all of wave 1 + R1 | `test/fake-api.ts` until the api merges | `recharge-agent --once`, HCS `agent-topup` with UAID |
| 3 | web | `web.md` | wave 2 + R2 | `e2e/mock-api.ts` must be deleted before done; ops scripts may be run by hand | every route of web.md §2, Playwright suite, visual baselines |
| 3 | ops-demo | `ops-demo.md` | wave 2 + R2 | web routes for `--web` and `print-cards.ts` | `scripts/e2e-local.sh` (§4 below), seed, recorder, documents, CI jobs |

Ordering rules. (1) A wave starts only when its hard dependencies are merged to `main` with CI green and the red team has not got an open **Critical/High** finding in a package it builds on (PLAN §3). Med/Low findings do not block. (2) Each agent works only inside its owned paths (§5.2); a change to another workstream's path is a request to that owner (or to the architect for INTERFACES), never a drive-by edit. (3) An interface change goes INTERFACES first (new §13 row), then `packages/protocol`, then the briefs, then code. (4) Builders already in flight when an amendment lands (A-18…A-31 landed 3 Nov) rebase onto it; the red team tests the amended names.

### 1.3 Interlocks that are easy to miss

| From → to | Artefact | Check |
|---|---|---|
| contracts → eip3009 | `fixtures/eip3009/vectors.json` | eip3009 `vectors.test.ts` reproduces every digest; the 84532 domain name is `"USDC"` and equals `USDC_EIP712_DOMAIN['eip155:84532']` |
| contracts → api, ops | `abi/DataDrop.json`, `deploy/addresses.anvil.json` | `pnpm --filter @ethglobal/contracts run abi:check`; the API reads the address file, never a literal |
| protocol → web | browser-safe build | `pnpm --filter @ethglobal/web run build` after W1a (no Node built-in leaks) |
| adapters → web | root barrel never imports `./live` | web build contains no `@hiero-ledger/sdk`, `@x402/hedera`, `@arkiv-network/sdk` |
| api ↔ ops-demo | seed hooks | `env.ts` refuses all three in `MODE=live` (test in `env.test.ts`) |
| api → agent | `/plans` price + accepts, `/esim/topup` 402 | agent computes the amount from `/plans`, never copies the 402 (T-56) |
| adapters → api | `RemoteFacilitator.feePayer('hedera:testnet')` | the Hedera accept template's `extra.feePayer` comes from `/supported` (A-20) |

---

## 2. Definition of done per wave (exact commands)

### 2.0 Real invocations of the scaffold's tooling

Root scripts (`package.json`): `pnpm build` = `pnpm -r run build`; `pnpm lint` = `eslint . --max-warnings 0 && prettier --check .` (lint is **root-level only**; packages have no `lint` script); `pnpm typecheck` = `pnpm -r --if-present run typecheck`; `pnpm test` = every package except contracts; `pnpm test:contracts` = `forge test`; `pnpm dupcheck` = `jscpd apps packages services scripts`. A brief's `pnpm --filter <pkg> build typecheck lint test` means:

```bash
pnpm --filter <pkg> run build && pnpm --filter <pkg> run typecheck && pnpm --filter <pkg> run test && pnpm lint
```

Coverage: `pnpm --filter <pkg> exec vitest run --coverage` (thresholds live in each package's `vitest.config.ts`; add `@vitest/coverage-v8` to the catalog in W1a). Every wave also runs the **wave gate**:

```bash
pnpm install --frozen-lockfile
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm dupcheck
bash scripts/check-forbidden.sh        # §5.3 greps (ops-demo writes it; until then run the greps inline)
```

### 2.1 Wave 1a — interfaces (done before any W1b agent starts)

```bash
pnpm install --frozen-lockfile
for p in protocol crypto eip3009 adapters; do pnpm --filter @ethglobal/$p run build && pnpm --filter @ethglobal/$p run typecheck && pnpm --filter @ethglobal/$p run test || exit 1; done
pnpm lint && pnpm dupcheck
pnpm --filter @ethglobal/web run build                     # protocol + crypto are browser-safe
pnpm --filter @ethglobal/adapters run test                 # the scaffold's existing adapter tests still pass on re-exported types
pnpm --filter @ethglobal/protocol exec vitest run test/conformance   # A-19: our x402 codec ⇄ @x402/core@2.29.0, both directions, every fixture
pnpm why @hiero-ledger/sdk                                 # empty or exactly 2.90.1 (A-22)
```
Plus: a reviewer diffs INTERFACES §1 code blocks against `packages/protocol/src` (names, fields, comments on units) and signs the PR.

### 2.2 Wave 1b — contracts ∥ octroi ∥ eip3009 + adapters-live

```bash
# contracts
pnpm --filter @ethglobal/contracts run deps
pnpm --filter @ethglobal/contracts run build && pnpm test:contracts
forge fmt --check --root packages/contracts
(cd packages/contracts && forge snapshot --check --tolerance 5 && forge coverage --report summary)   # src/ 100 % lines
pnpm --filter @ethglobal/contracts run abi:check
pnpm --filter @ethglobal/contracts run vectors && git diff --exit-code fixtures/eip3009/vectors.json
(cd packages/contracts && slither . --foundry-compile-all --config-file ../../security/redteam/tools/slither.config.json)
bash scripts/dev-chain.sh &   # prints the deployed addresses; kill after deploy/addresses.anvil.json appears

# octroi (100 % lines/branches/functions/statements, property tests ≥ 200 runs)
pnpm --filter @ethglobal/octroi run build && pnpm --filter @ethglobal/octroi run typecheck
pnpm --filter @ethglobal/octroi exec vitest run --coverage
! grep -rnE 'Date\.now|Math\.random|\bfetch\(|console\.' packages/octroi/src

# eip3009 + adapters-live (≥ 95 % lines)
for p in eip3009 adapters; do pnpm --filter @ethglobal/$p run build && pnpm --filter @ethglobal/$p run typecheck && pnpm --filter @ethglobal/$p exec vitest run --coverage || exit 1; done
pnpm why @hiero-ledger/sdk          # one version, 2.90.1; `pnpm why @hashgraph/sdk` and `pnpm why hedera-agent-kit` empty
node -e "import('@ethglobal/adapters').then(m => { if (Object.keys(m).some(k => /Arkiv|Hcs|Hedera|EsimAccess/.test(k))) process.exit(1) })"

# wave gate
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm dupcheck
```
Done also means: every `[verify Wed]` item is listed under "Record on Wednesday" in `packages/adapters/README.md` with its fixture path and `record-fixture` command; `fixtures/**` carry `"source": "docs"`; `.gitignore` has `fixtures/inventory.enc`.

### 2.3 Wave 2 — api ∥ agent

```bash
pnpm --filter @ethglobal/api run build && pnpm --filter @ethglobal/api run typecheck && pnpm --filter @ethglobal/api exec vitest run --coverage   # ≥ 90 %
pnpm --filter @ethglobal/api run openapi:check
pnpm --filter @ethglobal/api exec vitest run test/flow.e2e.test.ts      # < 5 s; the §4 loop in-process
pnpm --filter @ethglobal/agent run build && pnpm --filter @ethglobal/agent run typecheck && pnpm --filter @ethglobal/agent exec vitest run --coverage  # ≥ 90 %
! grep -rn "c.json({ error" services/api/src --include=*.ts | grep -v src/errors.ts
! grep -rnE "sizeBundle|hmacKey|tierFrom" services/api/src/routes
# Anvil-backed loop (until ops-demo lands e2e-local.sh, by hand):
bash scripts/dev-chain.sh &  MODE=local X402_FACILITATOR=self RESELLER=mock pnpm --filter @ethglobal/api run dev &
MODE=local AGENT_ONCE=1 AGENT_WATCH_KEYS=<paid key> pnpm --filter @ethglobal/agent exec tsx src/index.ts --once
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm dupcheck
```
Done also means: the three seed hooks exist and are refused in live; `MODE=live` boots from a fake env in a test with `createLiveAdapters` and refuses Anvil keys, `RESELLER=megaesim`, missing `WORLD_RP_*`, and `ARKIV_CHAIN_ID=60138453025`.

### 2.4 Wave 3 — web ∥ ops-demo

```bash
pnpm --filter @ethglobal/web run build && pnpm --filter @ethglobal/web run typecheck && pnpm --filter @ethglobal/web run test
pnpm --filter @ethglobal/ui run test
bash scripts/check-design-bans.sh
pnpm e2e:local            # = bash scripts/e2e-local.sh — §4, < 60 s for steps 1–18
pnpm e2e:web              # = bash scripts/e2e-local.sh --web — Playwright against the real local stack
pnpm schema:check && pnpm --filter @ethglobal/contracts run abi:check && pnpm --filter @ethglobal/api run openapi:check
NEXT_PUBLIC_MODE=live pnpm --filter @ethglobal/web run build && ! grep -R -q ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 apps/web/.next
E2E_FAULT=step7 bash scripts/e2e-local.sh; test $? -ne 0     # the test of the test
pnpm build && pnpm lint && pnpm typecheck && pnpm test && pnpm dupcheck
```
Done also means: `apps/web/e2e/mock-api.ts` is deleted; every document in ops-demo §5 exists; CI has the jobs of ops-demo §8 and they are green on `main`.

---

## 3. What the red team runs after each wave

The red team works from `security/redteam/PLAN.md` (pass criterion §1, matrix §4, tooling §5, finding workflow §6) and the pre-written scripts in `security/redteam/attacks/`. A wave is **CLEARED** when `security/redteam/run-wave.sh <n>` exits 0, every Critical/High is `verified`, and `security/redteam/reports/wave-<n>.md` says so. Builders post the ≤ 15-line attack-surface note (PLAN §2) when they merge; the clock starts then.

| After | Scripts | Executable form | Command |
|---|---|---|---|
| W1 (R1) | `attacks/wave1-contracts.md` A1–A18; `attacks/wave1-octroi.md` P1–P6 (protocol), O1–O13 (octroi), C1–C6 (crypto), E1–E6 (eip3009); `attacks/wave1-adapters.md` L1–L12 | `packages/contracts/test/attack/*.t.sol`, `packages/{protocol,octroi,crypto,eip3009,adapters}/test/attack/*.attack.test.ts` | `security/redteam/run-wave.sh 1` (forge attack + invariant runs 256×64, vitest suites, slither, semgrep, forbidden patterns, `deps-check.sh`) |
| W2 (R2) | `attacks/wave2-api.md`, `attacks/wave2-agent.md` (written by the red team during R1) — PLAN §4 wave-2 table | `services/{api,agent}/test/attack/*.attack.test.ts`, `scripts/e2e-local.sh` with log capture | `security/redteam/run-wave.sh 2` |
| W3 (R3) | `attacks/wave3-web.md` (written during R2) — PLAN §4 wave-3 table | `apps/web/e2e/abuse/*.spec.ts` (`pnpm --filter @ethglobal/web e2e:abuse`), live-bundle key grep | `security/redteam/run-wave.sh 3` |
| Full audit | slither, semgrep, lint/typecheck/dupcheck, deps, independent read of the six files in PLAN §4 | — | `security/redteam/run-wave.sh all` → `reports/final.md` |

The vendor facts (A-18…A-31) add attack surface the red team should fold into its scripts (owned by the red team; listed here so nothing is missed): a 402 whose Hedera `extra.feePayer` or EVM `extra.name` was swapped (agent/PWA must refuse; octroi's `extra` equality must deny); a payload using `maxAmountRequired` or v1 `X-PAYMENT`; an eSIM Access webhook with a wrong URL token, a foreign source IP, a forged `X-Forwarded-For` without `TRUST_PROXY`, a client-supplied `x-recharge-url-token` header, or a body whose usage numbers disagree with `/esim/query`; an IDKit result with a staging `environment`, a different `action`, a `signal_hash` for another challenge, or a session proof; a scan of logs/responses for `WORLD_RP_SIGNING_KEY` and `RT-Signature`; a treasury refund attempted from the payout key (A-31). The red-team files still say "Kaolin" in places (THREAT-MODEL A-07/TB-5, PLAN §9, wave1-adapters L1); read rabdi (A-23) — the property under test is unchanged.

---

## 4. The `MODE=local` integration test that proves the whole flow

Two executable forms of one assertion list: **in-process** `services/api/test/flow.e2e.test.ts` (wave 2; `createApp` + local adapters + a viem stub of `DataDrop`, `fakeClock`, < 5 s) and **real-stack** `scripts/e2e-local.sh` → `scripts/e2e-flow.ts` (wave 3, ops-demo; Anvil 31337 with 1-s blocks, `Deploy.s.sol`, the API on 8787 with `MODE=local X402_FACILITATOR=self RESELLER=mock`, the agent `--once`, `MockConsensusLog`, `MemoryBlobStore`, `MockTreasury`). Command: `pnpm e2e:local`. It exits non-zero on the first failed assertion, prints one PASS/FAIL line per step and the elapsed time, and must finish steps I-1…I-18 in < 60 s (the 90-s expiry wait runs in parallel from seed time). ops-demo §3 steps 6–19 implement this list one-to-one.

### 4.1 Setup (ops-demo §3 steps 1–5)
`scripts/check-tools.sh` → `pnpm -r build` (unless `--no-build`) → `startAnvil()` → `deployContracts()` (`addresses.anvil.json` exists; `abi:check` passes) → `startApi(...)` (`GET /healthz` = `{ ok: true, mode: 'local', chainId: 31337 }`) → `demo-seed.ts --reset` (campaign `createCampaign` budget 1 000 USDC, 500 000 per claim, 120/h; `POST /sponsor`; three entitlements; one gift; ten cards; the 90-s entitlement; the 5-s-claim-window gift).

### 4.2 Assertions

| # | Step | Assert (all must hold) |
|---|---|---|
| I-1 | **Challenge** `POST /challenge {audience, path:'/claim', sessionPubKey}` | 200 `challengeSchema`; nonce MAC-valid; `exp = now + 120 s`; ledger dump has **no** nonce entity |
| I-2 | **RP context** `POST /world/rp-context` | 200 `rpContextSchema`; `expires_at − created_at = 300`; signing key absent from body and logs (A-25) |
| I-3 | **Claim** `POST /claim` with an IDKit-4-shaped Orb `fixtureProof(orb, challenge.signal)` | 201; `sealedLpa` present; `openLpa(sealedLpa, sessionSecret, lpaAad(challenge.nonce, key))` = `LPA:1$local.test$…`; `claimTx` is an Anvil receipt with one `Claimed(id, claimKey, 500000, hour)` log; `MockUSDC3009.balanceOf(payout)` += 500 000; `receipt.hcs.sequence` = previous + 1 |
| I-4 | **Entitlement** (ledger) | an `entitlement` entity with `key = ent:v1:<quotaKey>`, `annotations.expiresAt ≈ now + 7 d` (± 5 s) and lifetime `secondsUntil(expiresAt)`; payload has `iccidHash`/`iccidEnc`/`sealedRef`, never an ICCID, LPA or nullifier; a nonce entity now exists |
| I-5 | **Replay** same proof + fresh challenge | 409 `replay`; `Claimed` count unchanged; `reseller.orders()` unchanged |
| I-6 | **/me** `GET /me/:key` twice | first `cached: false`, second `cached: true`; `remainingMb = mbTotal − mbUsed`; `usageAsOf` present; body never contains `sealedLpa`; `GET /me/:key/receipts` lists `claim` without `entitlementKeyHash` |
| I-7 | **402** `GET /esim/topup?key&mb=100` (no payment) | 402; `PAYMENT-REQUIRED` decodes with `decodePaymentRequired` to the body; `x402Version 2`; `accepts[0]` = `{ scheme:'exact', network:'eip155:31337', amount:'400000', asset: <MockUSDC3009>, payTo: <payout>, extra: { name:'USD Coin', version:'2', … } }`; the raw header and body contain no `maxAmountRequired`; no ledger write |
| I-8 | **Pay** sign EIP-3009 with `anvilRoles.human` using `domainFromRequirements(accepts[0])`; retry with `PAYMENT-SIGNATURE` | 200 `topUpResponseSchema`; `PAYMENT-RESPONSE` decodes to `success: true` with a tx hash that exists on Anvil and moved 400 000 to `payout` (`Transfer` + `AuthorizationUsed`); resending the same signature → 402 `invalid_payment` |
| I-9 | **Top-up** effect | `/me` (refresh) shows `mbTotal` += 100 and `expiresAt` = max(old, now + 7 d); a `topup` receipt; HCS `settle` message; `MockReseller` saw one `topUp` with the payment nonce as idempotency key |
| I-10 | **Agent** `recharge-agent --once` on the seeded paid key (18 % left) | exactly one purchase: `mbTotal` += 100; HCS `agent-topup` with a `uaid:aid:` string; `.agent/journal.jsonl` has one `buy`; a second `--once` buys nothing |
| I-11 | **Webhook** `MockReseller.signedWebhook([{ iccid, usedMb ↑ }])` → `POST /webhooks/reseller/mock` | 204; `/me` shows the new `mbUsed`, `usageSource: 'webhook'` (cache invalidated); same body again → 409; tampered body → 401; timestamp skewed 301 s → 401; `usedMb` decrease → 204 and ignored |
| I-12 | **Gift** `POST /gift { name: 'bob.eth', mb: 1000 }` | unresolvable `nobody.eth` → 404 `name_unresolved` **before** any 402; `bob.eth` → 402 → paid by `anvilRoles.human` → 201 with a 16-digit Verhoeff-valid `pin`, `serial = giftId.slice(2,10)`, `claimBy = now + 7 d`; a `gift` entity (state `open`) whose lifetime = claim window; HCS `gift` |
| I-13 | **Gift claim** `POST /challenge (path /gift/claim)` → `POST /gift/claim` signed `GiftClaim` by bob's key | 201 `giftent:<giftId>` entitlement with `sealedLpa`; gift state `claimed`; HCS `gift-claim`; a second claim → 409; a signature by another key → 401 |
| I-14 | **Card** `GET /card/:serial` ×2 then `POST /card/redeem` with a seeded PIN | the two GETs are identical and change nothing; redeem → 201 and a second `Claimed` on the campaign; a typo PIN → 400 locally-invalid / 401; redeemed again → 410 |
| I-15 | **Sponsor** `GET /sponsor/:id` with `Recharge-Sponsor` auth | claims list holds HMAC'd `campaignClaimKey`s only (no value equals the fixture nullifier); chain counters equal `DataDrop.campaigns(id)`; `expiring` lists the 90-s entitlement |
| I-16 | **Expiry** wait until the 90-s entitlement's `expiresAt` | `GET /me/<key>` → 410 `expired`; the ledger dump no longer lists it (expiry is load-bearing, T-35) |
| I-17 | **Reclaim** the seeded gift with a 5-s claim window, after 6 s: `POST /challenge (path /gift/reclaim)` → `POST /gift/reclaim` signed `GiftReclaim` by the payer | 200 `giftReclaimResponseSchema`; `refundedUsd6 = usd6 − GIFT_RECLAIM_FEE_USD6`; `MockTreasury.refunds()` has exactly one entry to the payer; a `gift-reclaim` receipt with the tx; HCS `gift-reclaim`; a second reclaim → 409 `already-reclaimed`; reclaiming the **claimed** gift of I-13 → 409 `claimed` (A-17) |
| I-18 | **Secrets scan** `scripts/dump-ledger.ts` → `.e2e/ledger-dump.json`; API + agent logs → `.e2e/*.log` | `security/redteam/tools/scan.sh` (with `tools/forbidden-patterns.txt`) finds zero `LPA:`, fixture nullifiers, 16-digit PINs, `PAYMENT-SIGNATURE` values, Anvil private keys, `WORLD_RP_SIGNING_KEY`; every dumped payload validates against `docs/arkiv.schema.json` |
| I-19 | `--web` | Playwright `apps/web/e2e` against the same stack (web.md §10) |
| I-20 | `--redteam` | `scripts/redteam/run.ts`: every attack in `security/redteam/attacks` fails |

The live counterpart of this loop is run by humans on Thu 14:00 (pipes only) and after kickoff; it is the same `e2e-flow.ts` with `MODE=live` and the live env, minus the seed hooks.

---

## 5. No-duplication gates

### 5.1 Mechanical gates (CI, every PR)

| Gate | Command | Threshold |
|---|---|---|
| Copy-paste | `pnpm dupcheck` (`jscpd apps packages services scripts`, `.jscpd.json`: `threshold: 1`, `minLines: 5`, `minTokens: 50`) | **≤ 1 %** duplicated lines repo-wide; the config is not loosened — a duplicate is fixed by moving the code to its owner (§5.2) |
| Import boundaries | `pnpm lint` (eslint `no-restricted-imports` zones from INTERFACES §12; `no-restricted-syntax` bans bare `fetch(` outside `packages/protocol/src/http.ts` and `packages/adapters/src/testing/`) | zero warnings |
| Generated artefacts | `abi:check`, `openapi:check`, `schema:check` | committed files equal the generated ones (one source each: Solidity, protocol schemas) |
| Forbidden strings | §5.3 greps (and `security/redteam/tools/scan.sh` for secrets) | zero hits |

### 5.2 Ownership table (one owner per concern; everyone else imports)

| Concern | The only owner | Never re-implemented in |
|---|---|---|
| zod wire/ledger schemas, `keys.*`, `ANN`, TTL constants, `USDC_EIP712_DOMAIN`, `IDENTIFIER_LEVEL`, error codes, log events | `packages/protocol` | any brief's package (types are `z.infer<>` re-exports) |
| x402 header codec, `fetchWithPayment`, `sessionNonce` | `packages/protocol/src/x402.ts` | adapters (`x402-headers.ts` becomes a re-export), api middleware, agent, web; `@x402/*` is used only for conformance tests and the Hedera client payload (A-19) |
| `httpJson` (timeouts, zod responses) | `packages/protocol/src/http.ts` | any `fetch(` call |
| `canonicalJson` | `packages/protocol/src/typed-data.ts` | fixtures, api policy hash, octroi `extra` equality |
| PIN generate/validate/format | `packages/protocol/src/pin.ts` | web (calls `isValidPin`), api |
| Money/MB/time formatting | `packages/protocol/src/units.ts` | web `lib/format.ts` (thin tz wrapper only), ui |
| sha256, keccak, HMAC, AEAD seal/open, webhook MAC, `hashToField` | `packages/crypto` | adapters (`hash.ts` becomes a re-export), api, web |
| EIP-712/3009 typed data, domain (`domainFromRequirements`), digest, recover, calldata, relayer | `packages/eip3009` | SelfRunFacilitator, PWA signer, agent payer, test builders |
| Business rules (`decide`, tiers, sizing, keys, challenge, top-up, reclaim) | `packages/octroi` | api routes, agent, web |
| Ledger annotations and queries | `packages/octroi/src/store/*` | api, agent, scripts (seed goes through the API) |
| Vendor I/O (Arkiv, World, facilitators, eSIM Access, inventory, HCS, ENS, Swarm, treasuries) | `packages/adapters/src/live/*` | api, agent, scripts (`record-fixture.ts` wraps an adapter's `fetch`, it does not call vendors itself) |
| Test helpers (clock, Anvil roles, fixtures, payload builders, contract suites) | `packages/adapters/src/testing` | every package's tests (octroi `test/helpers.ts` composes, never copies) |
| Error → HTTP mapping | `services/api/src/errors.ts` | route handlers |
| Process harness (start/stop Anvil, API, agent, web) | `scripts/lib/harness.ts` | every script |
| Design tokens, components, the 8-state onchain machine | `packages/ui` | `apps/web` |
| On-chain rules (caps, pause, refund) | `packages/contracts/src/DataDrop.sol` | api (it reads counters, it does not re-enforce them except as an early, cheap deny) |

Paths by workstream: contracts → `packages/contracts/**`, `fixtures/eip3009/vectors.json`; interfaces → `packages/{protocol,crypto}/**`, `packages/eip3009` skeleton, `packages/adapters/src/{types.ts,index.ts,testing/**}`, `eslint.config.js`, `.env.example`, `pnpm-workspace.yaml`; octroi → `packages/octroi/**`; adapters-live → `packages/eip3009/**` (after the skeleton), `packages/adapters/**` (rest), `fixtures/**` except `demo/` and `eip3009/vectors.json`; api → `services/api/**`; agent → `services/agent/**`; web → `apps/web/**`, `packages/ui/**`; ops-demo → `scripts/**`, `fixtures/demo/**`, `docs/{DISCLOSURE,DEMO-SCRIPT,ARKIV_FEEDBACK,SWARM,CHANGELOG}.md`, `docs/arkiv.schema.json`, `README.md`, `.github/workflows/ci.yml`, root `package.json` scripts; architect → `docs/{ARCHITECTURE,INTERFACES,BUILD-PLAN}.md`, `docs/build-briefs/**`; red team → `docs/THREAT-MODEL.md`, `security/**`, every `test/attack/**`.

### 5.3 Forbidden-string greps (`scripts/check-forbidden.sh`; exit 1 on any hit outside `docs/`, `research/`, `security/`)

```bash
! grep -rnE "maxAmountRequired|X-PAYMENT\b|X-PAYMENT-RESPONSE" apps packages services scripts --include=*.ts --include=*.tsx   # A-18 (v1 names)
! grep -rnE "@hashgraph/sdk|from 'hedera-agent-kit'|\"hedera-agent-kit\"" apps packages services scripts --include=*.ts --include=package.json  # A-22
! grep -rniE "kaolin|60138453025" apps packages services scripts fixtures | grep -v -e services/api/src/env.ts -e packages/adapters/src/live/config.ts   # A-23 (only the refusals may name it)
! grep -rnE "idkit-standalone|/api/v2/verify|developer\.worldcoin\.org/api/v2" apps packages services scripts   # A-25
! grep -rnE "'USD Coin'|\"USD Coin\"" apps/web/app apps/web/lib apps/web/components services/*/src packages/adapters/src/live packages/eip3009/src   # A-21: the name comes from accepts[].extra (protocol USDC_EIP712_DOMAIN and the Solidity mock are the only literals)
```

---

## 6. Human on-site hand-off

The orchestrator cannot reach any vendor or testnet (`docs/ENVIRONMENT-CONSTRAINTS.md`). Everything below is done by the human team with keys generated on their own machines; **no key, seed phrase, access code or signing key ever enters an AI context, a chat, a commit or a log**. The roles are DECISION §6.7's five (Integrations · Provisioning/Agent · Product/PWA · Design/Producer · Sponsor/Sales = Founder). The day-by-day list is ops-demo §7 (amended for A-23/A-25/A-27/A-28); this section is the key/testnet/pre-deploy core of it.

### 6.1 Accounts, keys and testnets (Tue 3 Nov, Integrations)

| Rail | What to create | Where the secret goes | Notes (API-FACTS §) |
|---|---|---|---|
| Hedera testnet | 3 **ECDSA** accounts on portal.hedera.com (API/HCS, agent, treasury) + the payout account; HBAR from the portal; **associate each with USDC `0.0.429274`**; test USDC from faucet.circle.com ("Hedera Testnet", takes `0.0.x`) | `HEDERA_*`, `AGENT_HEDERA_*`, `TREASURY_HEDERA_*` in the VPS env / password manager | keys via `PrivateKey.fromStringECDSA`; a key-type mismatch is `INVALID_SIGNATURE` (§2.4–2.5) |
| Hedera EVM (296) | a deployer key (`cast wallet import deployer --interactive`) with HBAR | Foundry keystore, never `--private-key` on the command line | RPC `https://testnet.hashio.io/api` as `HEDERA_TESTNET_RPC_URL` (§2.1) |
| Base Sepolia | deployer/relayer/agent EVM keys; Base Sepolia ETH; Circle USDC `0x036C…CF7e` | env / keystore | confirm `cast call 0x036CbD53842c5426634e7929541eC2318f3dCF7e "name()(string)" --rpc-url $BASE_SEPOLIA_RPC_URL` = `USDC` (A-21) |
| Arkiv | access key at hub.arkiv.network/access-keys; an Arkiv wallet funded with **tGLM** from hub.arkiv.network/faucet on **rabdi 7794095** (Kaolin is retired) | `ARKIV_ACCESS_KEY`, `ARKIV_PRIVATE_KEY` | ask Arkiv devrel which testnet they judge on (rabdi vs tiramisu 7738577) and whether the Swarm bonus needs a specific Bee gateway/batch (§3.2, §3.4) |
| World | Developer Portal app (`app_mode: external`), its **RP** (`rp_id`; the signing key is shown **once**) and a **production** action `recharge-welcome` with **unlimited** verifications (T-24) | `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY` (server secret store only; never `NEXT_PUBLIC_`) | rotating the key invalidates the old signer; ask World what "Agent Pass" means (AgentKit beta) and which legacy preset/levels they accept (§4.2–4.6) |
| eSIM Access | console account (console.esimaccess.com/developer), `accessCode`, prepaid balance; webhook URL `https://<vps>/webhooks/reseller/esimaccess?token=<ESIMACCESS_WEBHOOK_TOKEN>` saved via `/webhook/save`; allow the five sender IPs | `ESIMACCESS_ACCESS_CODE`, `ESIMACCESS_WEBHOOK_TOKEN` | orders cost real balance; `/esim/cancel` refunds unused profiles (§5.1) |
| MegaeSIM | request API docs from the vendor | — | no public API; if nothing by Wed 12:00 it stays a stub (A-28) |
| Inventory | 30 India profiles bought for the fallback, sealed with `INVENTORY_SEAL_KEY` into `fixtures/inventory.enc` (git-ignored) | the sealed file + key in the password manager | the example file holds `LPA:1$local.test$…` only |

### 6.2 The Wednesday pre-deploy (Wed 4 Nov 14:00; DECISION §7.2)

DECISION §7.2's constraints are binding: (1) exactly **one real round-trip per partner**, nothing more; (2) ≥ 70 % of each integration's final code and 100 % of the product mechanism tied to it ship in-window; (3) `docs/DISCLOSURE.md` lists every pre-kickoff tx hash and entity key, and the repo is tagged `v0-prekickoff` at Thu 20:59; (4) each partner's eligibility question is asked at kickoff and answered in the README. Where §7.2 says "Kaolin", read rabdi (A-23).

1. **Facilitators** — `curl -s https://x402.org/facilitator/supported`, `curl -s https://api.testnet.blocky402.com/supported`: confirm `hedera:testnet` + `eip155:84532` and the Hedera fee payer → `X402_HEDERA_FEE_PAYER`; `pnpm record:fixture facilitator/x402org/supported` (and `hedera/supported`).
2. **Hedera EVM** — `cd packages/contracts && CHAIN=296 forge script script/Deploy.s.sol:Deploy --rpc-url hedera_testnet --broadcast --account deployer` (`associateHts(usdc)` runs in the same broadcast) → fund a hello campaign from the sponsor account → one `claim` by the attestor → `Claimed` on HashScan with `paid == 500000`. Commit `deploy/addresses.hedera_testnet.json`.
3. **x402 on Hedera** — one `GET /esim/topup` 402 → pay from a team Hedera account → 200 via the remote facilitator; record `fixtures/facilitator/hedera/{verify-ok,settle-ok}.json` (confirm payload `{ transaction }` and whether `PAYMENT-RESPONSE` carries `transaction` or `transactionId`).
4. **Arkiv** — one entitlement entity written and read back on rabdi through `ArkivLedger`; record `fixtures/arkiv/*.json`; note the explorer URL, block time and write/read latency for `ARKIV_FEEDBACK.md`.
5. **World** — one IDKit 4 verification for `recharge-welcome` from a real World App (`/world/rp-context` → IDKit → `POST /api/v4/verify/{rp_id}`); record `fixtures/world/verify-ok-v4.json` (redacted) and the `hash_to_field` signal convention.
6. **eSIM Access** — one real order with signed `RT-*` headers (`locationCode: "IN"`), the real `ac` → install on a team phone (attach test at 10:00 is separate); capture one full webhook body + headers; `/esim/cancel` if unused; confirm whether the HMAC key is the access code (else set `ESIMACCESS_SIGNING_KEY`).
7. **Write down** every hash/key into `docs/DISCLOSURE.md` (`TBD by human (Wed 14:00)` slots), the HCS-14 vector into `fixtures/hcs/`, and re-run `pnpm test` so every recorded fixture (`"source": "live"`) passes; a contradiction between a recording and API-FACTS is filed as a finding, the recording wins, the adapter is fixed.

### 6.3 Thursday and kickoff

Thu 09:00 print cards (`pnpm print:cards`, real campaign-funded cards); 14:00 dry run of `e2e-flow.ts` in `MODE=live` on the VPS (pipes only, no product features); 20:59 **tag `v0-prekickoff`** (`git tag -s v0-prekickoff && git push origin v0-prekickoff`) and snapshot `DISCLOSURE.md`; 21:00 kickoff questions (DECISION §7.4); **new in-window keys generated on-site** for the attestor, relayer, treasury (a **separate** refund wallet funded ≤ `TREASURY_MAX_USD6_PER_DAY`, A-31), Arkiv and the World RP if rotated — `DataDrop.setAttestor(new)` from the owner, old keys retired; then the handshake sprint (each rail one in-window round-trip). Fri 06:00 the per-sponsor swap gate; Fri the attestor-compromise drill (< 5 min, T-01) by the Security owner.

### 6.4 What the human team receives from the build

`pnpm e2e:local` green at `v0-prekickoff`; `packages/adapters/README.md` → "Record on Wednesday" (one `record-fixture` command per adapter); `.env.example` with every live variable (INTERFACES §11); `docs/DISCLOSURE.md`, `docs/DEMO-SCRIPT.md` and the README skeleton with `TBD by human` slots that each name an owner and a time; the red team's `reports/final.md` and its §9 hand-off checklist; and API-FACTS' "Known unknowns to verify on-site" (11 items) as the Wednesday checklist.
