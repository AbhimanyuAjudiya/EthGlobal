# Red Team — operating plan for Recharge `v0`

**Owner:** Red Team lead. **Applies to:** every builder wave between now (Tue 3 Nov 2026) and the `v0-prekickoff` tag (Thu 5 Nov 20:59 IST), then to the in-window human team as a checklist. **Model:** `docs/THREAT-MODEL.md` (threat ids `T-xx`). **Scripts:** `security/redteam/attacks/`. **Findings:** `security/redteam/findings/` (format in its README). **Tools:** `security/redteam/tools/`.

## 1. Pass criterion

> **All attacks fail; every finding has a regression test.**

A wave is **CLEARED** when all of the following hold, and the lead writes `security/redteam/reports/wave-<n>.md` saying so:

1. Every attack listed for the wave in §4 exists as an automated test that **asserts the attack fails** (a revert, a `deny`, a `401/409/410/429`, an unchanged balance) and is green in CI under `MODE=local`.
2. Every **Critical** and **High** finding is `verified` (fix merged, regression test path recorded, red team re-ran the attack).
3. Every **Med** finding has an owner and a due date no later than `v0-prekickoff`, or is `accepted-risk` with Founder/Chair sign-off and a line in `README.md` / `docs/DISCLOSURE.md`.
4. Tool gates are green: slither (no high/medium), semgrep (`recharge.yml`, zero findings or `nosemgrep` with a justification), forbidden-pattern scan (zero hits on logs, ledger dump, HCS messages, fixtures), `deps-check.sh`, `pnpm lint`, `pnpm typecheck`, `pnpm dupcheck`.
5. `docs/THREAT-MODEL.md` has a `T-` row for every finding that revealed a threat it missed.

The acceptance-test row "Red team" in `DECISION.md` §6.5 is satisfied when wave 3 is cleared and `security/redteam/run-wave.sh all` exits 0.

## 2. Roles and hand-offs

| Role | Who | Owns |
|---|---|---|
| Red Team lead | orchestrator agent (this plan's author) | threat model, severity calls, clearance, the final report, escalation to the Chair |
| Red-team agents | one agent per attack script per wave (3 in wave 1) | executing the script, filing findings as they go (not batched), writing the attack tests, re-verifying fixes |
| Builders | the wave's builder agents | the fix **and** its regression test in their own package; the "attack-surface note" (below) |
| Architect | owner of `docs/INTERFACES.md` | answering `THREAT-MODEL.md` §7 before wave 1 is attacked; name alignment |
| Security owner (human) | Integrations lead | the live checks the sandbox cannot run (§9): Wed pre-deploy decimals/HTS, Fri attestor drill |

**Attack-surface note (builder → red team, required to start a run; ≤ 15 lines):** what landed, entry points (exported functions / routes / contracts), config flags and env vars, what is mocked, known gaps vs `DECISION.md` §6.2, and how to run it locally. It goes at the top of the wave's report.

## 3. Wave gating

```
wave 1  contracts · octroi · eip3009 + crypto · adapters (mocks + live/ with fixtures)   ──▶ R1 (≤ 3 h)
wave 2  services/api · services/agent                                                      ──▶ R2 (≤ 3 h)
wave 3  apps/web PWA · ops/demo (scripts, seeds, docs, DISCLOSURE)                        ──▶ R3 (≤ 3 h)
full audit (slither · semgrep · eslint · jscpd 1 % · deps · independent review)           ──▶ final report
tag v0-prekickoff — Thu 5 Nov 20:59 IST (human action)
```

**Entry condition for R<n>:** the wave's PR is merged to `main`, CI is green (`pnpm lint typecheck test`, `forge build/test`, `pnpm build`), the attack-surface note is posted. **Exit:** clearance per §1. A later wave may start while an earlier wave's Med findings are being fixed; it may **not** start while a Critical or High is open in the layer it builds on (an API built on a replayable `consumeChallenge` is wasted work).

Red-team agents start **the moment the wave lands** from the pre-written scripts in `attacks/`; they do not re-derive the model. Each script says what to do when a name differs from the one it expected (test the property; file a `naming` note, not a finding).

## 4. Per-wave attack matrix

### Wave 1

| Attack script | Threats | Executable form (where the tests land) | Command |
|---|---|---|---|
| `attacks/wave1-contracts.md` A1–A18 | T-01…T-12 (`DataDrop`), T-13…T-17 (`MockUSDC3009`, eip3009 calldata) | Foundry: `packages/contracts/test/attack/DataDropAttack.t.sol`, `packages/contracts/test/attack/MockUSDC3009Attack.t.sol`, `packages/contracts/test/invariant/DataDropInvariants.t.sol`; gas: `forge snapshot` | `cd packages/contracts && forge test --match-path 'test/attack/*' -vvv && FOUNDRY_INVARIANT_RUNS=256 FOUNDRY_INVARIANT_DEPTH=64 forge test --match-path 'test/invariant/*' && forge snapshot --check` |
| `attacks/wave1-octroi.md` O1–O13 (octroi), C1–C6 (crypto), E1–E6 (eip3009) | T-18…T-30, T-31…T-34, T-13/T-14/T-17 | vitest: `packages/octroi/test/attack/*.attack.test.ts`, `packages/crypto/test/attack/*.attack.test.ts`, `packages/eip3009/test/attack/*.attack.test.ts` (fast-check for the property tests) | `pnpm --filter @ethglobal/octroi --filter @ethglobal/crypto --filter @ethglobal/eip3009 test -- --reporter=verbose` |
| `attacks/wave1-adapters.md` L1–L12 | T-35…T-44, T-36 (mock key space), T-19/T-24 (mock personhood gaps) | vitest: `packages/adapters/test/attack/*.attack.test.ts` (mocks), `packages/adapters/test/live/*.contract.test.ts` (fixtures: request shape, error mapping, malicious responses) | `pnpm --filter @ethglobal/adapters test` |
| Static | T-08, T-11, T-65, T-66, secrets | slither, semgrep, forbidden-pattern scan over `fixtures/` and `packages/`, `deps-check.sh` | `security/redteam/run-wave.sh 1` |

### Wave 2 (scripts `attacks/wave2-api.md`, `attacks/wave2-agent.md` are written by the red team during R1 so they are ready when wave 2 lands)

| Attack | Threats | Executable form | Notes |
|---|---|---|---|
| Nullifier replay over HTTP (`/challenge` → `/claim` twice; concurrent pair) | T-18, T-46 | `services/api/test/attack/claim-replay.attack.test.ts` via `app.request()` on a real Anvil (`scripts/dev-chain.sh`) | exactly one `Claimed`, one `reseller.order` |
| Challenge replay / expiry / audience; ledger outage ⇒ fail-closed | T-20, T-21 | `challenge.attack.test.ts` with `InMemoryLedger` wrapped to throw | `deny` with reason `unavailable` |
| Webhook replay / spoof / skew / ms timestamp / re-serialised body | T-34, T-40 | `webhook.attack.test.ts` | `401`/`409`/`400`, never `500`; `mbUsed` monotonic |
| LPA second fetch; LPA in logs/ledger/HCS | T-31, T-50 | `lpa-secrecy.attack.test.ts` + `tools/scan.sh` over captured pino output and `scripts/dump-ledger.ts` | zero hits |
| Hourly-cap race (20 concurrent claims, cap 5) | T-46, T-24 | `cap-race.attack.test.ts` with a `MockPersonhood` spy | 15 denials **before** `verify`; 5 `Claimed` |
| Paused / expired / exhausted campaign claim | T-24, T-25 | `campaign-state.attack.test.ts` | `verify` never called; nullifier not burned |
| Payment tampering: `accepts[]` substitution, amount/step mismatch, pubkey swap, serve-before-settle | T-26…T-28, T-32 | `payment.attack.test.ts` | `deny: invalid-payment` on each |
| Agent cap bypass; tampered 402; retry double-pay; expiry loop | T-30, T-56, T-57 | `services/agent/test/attack/*.attack.test.ts` with a fake API returning hostile 402 bodies | zero signatures produced |
| Prompt-injection canary | T-55, T-70 | `services/agent/test/attack/injection.attack.test.ts` | purchases identical to control; `MockInference` prompt never contains the planted string |
| Rate limits / write amplification | T-45 | `tools/flood.ts` (plain `fetch` loop, 1 000 req / 10 s) | ≤ N ledger writes; 429s |
| Env guards: Anvil keys in `MODE=live`; mainnet `accepts[]` without flags | T-52 | `services/api/test/attack/env.attack.test.ts` | boot refused |
| Key-rotation drill, local | T-01, §6.7 of the model | `scripts/e2e-local.sh --drill` | pause → `setAttestor` → restart → claim with old key reverts `NotAttestor` |
| GET side effects (`/card/:pin`, prefetch) | T-47 | `card.attack.test.ts` with a link-preview UA | card unredeemed |
| Log redaction | T-50, T-68 | capture pino to a buffer; scan | zero hits |

### Wave 3 (script `attacks/wave3-web.md`, written during R2)

| Attack | Threats | Executable form |
|---|---|---|
| XSS payloads in every rendered field (ENS name, gift message, campaign name, plan name, 402 `error`) | T-58, T-70 | Playwright `apps/web/e2e/abuse/xss.spec.ts` (asserts no dialog, no script execution, text rendered literally) |
| Security headers (CSP, XFO, Referrer-Policy, nosniff, no-store) on every route | T-58, T-59, T-61 | `headers.spec.ts` |
| Clickjacking: load `/pay` and `/agent` in an iframe | T-59 | `frame.spec.ts` (frame blocked) |
| Storage after purchase: no X25519 secret, no LPA in localStorage/IndexedDB/SW cache | T-60, T-61 | `storage.spec.ts` |
| `/install` with a hostile `lpa`/`url` param; QR only after tap; auto-hide | T-61, T-62 | `install.spec.ts` |
| Demo wallet absent from the live bundle | T-63 | `pnpm --filter @ethglobal/web build` with `NEXT_PUBLIC_MODE=live`, then grep the bundle for the Anvil key |
| `/print/cards` without the operator token | T-64 | `print.spec.ts` ⇒ 401 |
| Link-preview bot fetches `/card/<pin>` | T-47 | `card-preview.spec.ts` |
| Demo seed and ops scripts contain no secrets; `DISCLOSURE.md` lists what the model requires | T-69, A-14 | `tools/scan.sh scripts/ docs/` |
| Full-loop forbidden-pattern scan after `scripts/e2e-local.sh` | T-31, T-37, T-44 | `run-wave.sh 3` |

### Full audit (after R3)

slither + semgrep + `pnpm lint typecheck dupcheck` + `deps-check.sh` + an independent read of `DataDrop.sol`, `packages/octroi/src/decide.ts`, `packages/crypto/src/sealed-lpa.ts`, `services/api/src/routes/esim.ts`, `services/api/src/routes/webhooks.ts`, `services/agent/src/loop.ts` by an agent that did not write them, with the threat table as the checklist. Output: `security/redteam/reports/final.md` and the "Security" section of `README.md` (what we defend, the drain bound, the drill time, accepted risks).

## 5. Tooling (all local; verified on this sandbox on 3 Nov)

| Tool | Version | Invocation | Gate |
|---|---|---|---|
| Foundry | 1.5.1, solc 0.8.30 offline | see §4; `[fuzz] runs = 512`, `[invariant] runs = 64 depth = 32` in `foundry.toml`; red-team runs raise them via env | all attack tests green; `forge snapshot --check` within 5 % |
| slither | 0.11.6 | `cd packages/contracts && slither . --foundry-compile-all --config-file ../../security/redteam/tools/slither.config.json` | no high/medium (`fail_on: medium`); each suppression justified inline (`// slither-disable-next-line <detector> -- reason`) |
| semgrep | 1.183.0 (`pip install semgrep` if absent — PyPI is reachable) | `semgrep --config security/redteam/tools/semgrep/recharge.yml --error --metrics=off apps packages services scripts` | zero findings; `// nosemgrep: <rule-id> -- reason` only with a reason |
| forbidden patterns | grep | `security/redteam/tools/scan.sh <paths…>` using `tools/forbidden-patterns.txt` | zero hits on logs, ledger dumps, HCS messages, fixtures, `docs/`, `scripts/` |
| dependency check | pnpm 10 | `security/redteam/tools/deps-check.sh` | frozen lockfile installs; `pnpm audit --prod --audit-level=high` clean; `onlyBuiltDependencies` unchanged; no unpinned `npx`; no Anvil key outside the allow-list; `.env` untracked |
| vitest | 5.1 (catalog) | `pnpm test` (attack suites use the `.attack.test.ts` suffix and run with the normal suite) | green |
| Playwright | 1.63 + Chromium 1243 (`/opt/pw-browsers`) | `pnpm --filter @ethglobal/web e2e:abuse` (wave 3 adds the script) | green |
| wave runner | bash | `security/redteam/run-wave.sh 1|2|3|all` | exit 0 |

Attack tests are **deterministic**: fake clocks (`fakeClock` from `packages/adapters/test/fixtures.ts`), seeded fuzz (`FOUNDRY_FUZZ_SEED` recorded in the finding when a counter-example is found), fixtures instead of network. They never touch a testnet or a sponsor API — the sandbox cannot anyway (`docs/ENVIRONMENT-CONSTRAINTS.md`), and that is a feature: every attack is reproducible by a judge with `pnpm test`.

## 6. Finding workflow

### 6.1 Template (one file per finding; full format in `findings/README.md`)

```
id: RT-W1-003
title: DataDrop.createCampaign overwrites an existing campaign (id hijack)
module: packages/contracts/src/DataDrop.sol
threat: T-04
severity: High          # Critical | High | Med | Low  (docs/THREAT-MODEL.md §0)
likelihood: M           # H | M | L
status: open            # open | acknowledged | fixing | fixed | verified | closed | accepted-risk | disputed
found_by: redteam-contracts
owner: builder-contracts
found_at: 2026-11-03T18:40+05:30
due: 2026-11-03T22:40+05:30
repro: |
  forge test --match-test test_Attack_CampaignIdHijack -vvv   (test/attack/DataDropAttack.t.sol)
  1. sponsor A: createCampaign(id, 500e6, 0.5e6, 100, now+7d)
  2. stranger B: createCampaign(id, 1, 1, 1, now+1) → succeeds; campaigns(id).sponsor == B
impact: B becomes sponsor of A's campaign: can pause, refund A's remaining budget to B (if refund pays msg.sender) …
fix: |
  revert CampaignExists() when campaigns[id].sponsor != address(0); add the error to IDataDrop.
regression_test: packages/contracts/test/attack/DataDropAttack.t.sol::test_Attack_CampaignIdHijack
fix_commit: <sha>
verified_at: <ts>
```

### 6.2 Lifecycle

`open` → `acknowledged` (builder has read it) → `fixing` → `fixed` (fix merged **with** `regression_test` filled) → `verified` (red team re-ran the attack script and the regression test) → `closed` at wave clearance. Side exits: `accepted-risk` (needs Founder/Chair sign-off recorded in the file **and** a README/DISCLOSURE line; the model's §8 gains a row), `disputed` (builder writes a rebuttal in the file; the lead rules within 1 h; the Chair breaks ties; while disputed the finding counts as open for clearance).

### 6.3 Triage SLA for builders (clock starts when the finding file is committed)

| Severity | Acknowledge | Fix merged with regression test | Blocks |
|---|---|---|---|
| **Critical** | 30 min | 2 h | wave clearance, the next wave in the same layer, the `v0-prekickoff` tag |
| **High** | 1 h | 4 h | wave clearance, the tag |
| **Med** | 4 h | before `v0-prekickoff` (Thu 20:59 IST) or `accepted-risk` | the tag (unless accepted) |
| **Low** | next report | opportunistic; may ship | nothing; listed in the report |

Red team re-verifies within **1 h** of `fixed`. A fix without a regression test path is not `fixed`. A regression test that asserts the attack **succeeds** is itself a finding. Severity is the lead's call; a builder may argue likelihood, not severity.

### 6.4 What a fix PR must contain

The finding id in the title (`fix(contracts): RT-W1-003 reject duplicate campaign ids`), the code change, the regression test under the paths in §4, and — if the fix changes an interface — the matching line in `docs/INTERFACES.md`.

## 7. Rules of engagement

1. `MODE=local` only; no testnet RPC, no sponsor API, no real keys, ever, in an agent's context (DECISION §7.3).
2. Attack PRs add tests, fixtures and findings; they do not edit builder source. Proposed fixes go in the finding.
3. Attack tests are named so intent is obvious: Foundry `test_Attack_<Name>` / `invariant_<Property>`; vitest `describe('attack: <name>')`; Playwright `abuse/<area>.spec.ts`. Each asserts the attack **fails**.
4. A red-team agent that finds a name differs from the script (`Decision.deny.reason`, an error selector, a route path) tests the property, records the rename in the wave report, and does not stop.
5. A finding is filed the moment it is confirmed by a failing attack test — not at the end of the run.
6. Nothing is "fixed in the demo script": a control that exists only in `DEMO-SCRIPT.md` is an open finding.

## 8. Reports

`security/redteam/reports/wave-<n>.md`: attack-surface note; attacks run (count) / failed-as-expected / succeeded (= findings); findings by severity and status; tool outputs (slither/semgrep/scan/deps summaries); renames observed; residual risks added to `THREAT-MODEL.md` §8; **CLEARED / NOT CLEARED** with the blocking ids. `reports/final.md` adds the DECISION §6.5 red-team row verdict and the README security section text.

## 9. Hand-offs to the human team (the red team cannot run these; it writes the checklists)

| When | Who | Check | Record |
|---|---|---|---|
| Wed 4 Nov 14:00 pre-deploy | Integrations | `associateHts` then one `Claimed` on HashScan with `paid == 500000` (6-dec); Kaolin block time and write/read latency; one real reseller webhook captured with its exact headers → `fixtures/reseller/webhook-*.json`; facilitator `hedera` scheme payload captured → `fixtures/facilitator/` | `docs/DISCLOSURE.md`, `docs/ARKIV_FEEDBACK.md`, fixtures committed |
| Wed evening | Integrations | World developer portal: action `recharge-welcome` set to **unlimited** verifications (T-24) | README World section |
| Fri 6 Nov (after the 06:00 gate) | Security owner | Attestor compromise drill (`THREAT-MODEL.md` §6.7), timed; sponsor pause/unpause; rotate; `healthz.attestor` | `findings/DRILL-attestor-rotation.md` with the measured time |
| Sat 7 Nov rehearsal | Product/PWA | QR-behind-tap and screenshot warning on three devices; `/install` opens the universal link with no referrer; live build has no demo wallet | rehearsal notes |
| Sun 8 Nov 06:00 README freeze | Producer | README "Security" section matches the final report; accepted risks listed; drain bound and drill time stated | README |
