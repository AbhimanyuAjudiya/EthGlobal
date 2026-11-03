# Red team — how to run a wave

> **Pass criterion: all attacks fail; every finding has a regression test.**
> A wave is CLEARED when `security/redteam/run-wave.sh <n>` exits 0 and the wave report says so (PLAN §1).

This directory attacks Recharge before the judges do. The model is `docs/THREAT-MODEL.md` (threats `T-01…T-86`; the coverage matrix in §5.12 maps every Critical/High threat to an attack step and a regression file). This README is the operating manual for a red-team agent: how to run a wave end to end in `MODE=local`, how to file and close findings, and what "cleared" means. `PLAN.md` holds the schedule, roles, SLAs and the per-wave attack matrix.

## 1. What is here

| Path                                                       | What it is                                                                                                                               |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `PLAN.md`                                                  | Wave gating, roles, SLAs, the per-wave attack matrix, the human live checks                                                              |
| `attacks/wave1-contracts.md`                               | A1–A19: `DataDrop`, `MockUSDC3009`, `Deploy.s.sol` (Foundry)                                                                             |
| `attacks/wave1-octroi.md`                                  | P1–P6 protocol · O1–O13, G, S octroi · C1–C5 crypto · E1–E6 eip3009 (vitest)                                                             |
| `attacks/wave1-adapters.md`                                | L1–L16: mocks, `live/` adapters over fixtures, Arkiv forgery (vitest)                                                                    |
| `attacks/wave2-api-agent.md`                               | AP1–AP21 `services/api` routes and middleware · AG1–AG8 `services/agent`                                                                 |
| `attacks/wave3-web-ops.md`                                 | W1–W11 PWA (Playwright) · OP1–OP7 scripts, fixtures, docs, CI                                                                            |
| `findings/`                                                | One file per finding (`RT-W<wave>-<seq>-<slug>.md`), format in `findings/README.md`; `INDEX.md` is generated                             |
| `run-wave.sh`                                              | The wave runner: attack suites + static gates + coverage; exit 0 = cleared                                                               |
| `tools/scan.sh` + `tools/forbidden-patterns.txt`           | Forbidden-pattern scan (LPAs, nullifiers, PINs, keys, bearer headers, reseller credentials) over logs, dumps, fixtures, docs, bundles    |
| `tools/semgrep/recharge.yml` + `tools/semgrep/selftest.sh` | 19 offline semgrep rules, each tied to a threat; the self-test proves they parse and fire                                                |
| `tools/slither.config.json`                                | slither gate for `packages/contracts` (fail on medium)                                                                                   |
| `tools/deps-check.sh`                                      | Frozen lockfile, `pnpm audit`, postinstall allow-list, pinned `npx`, banned vendor look-alikes, one `@hiero-ledger/sdk`, secrets hygiene |
| `tools/coverage-check.sh`                                  | Machine check of THREAT-MODEL §5.12 (matrix complete, steps resolve, regression files exist)                                             |
| `tools/findings-index.sh`                                  | Regenerates `findings/INDEX.md` from finding front matter                                                                                |

All tools run in this sandbox with what is installed: bash, GNU grep (`-P`), awk, jq, git, pnpm, forge, slither, semgrep, jscpd. Nothing reaches a testnet or a vendor host.

## 2. Ground rules (PLAN §7, condensed)

1. **`MODE=local` only.** Anvil 31337, `MockUSDC3009`, in-memory / fixture adapters. `run-wave.sh` exports `MODE=local` and unsets live key variables. No testnet RPC, no vendor API, no real key, LPA or nullifier ever enters an agent context.
2. **Attack tests assert the attack fails.** Foundry `test_Attack_<Name>`; vitest `describe('attack: <name>')` in `test/attack/*.attack.test.ts`; Playwright `apps/web/e2e/abuse/<area>.spec.ts`. A test that asserts the attack _succeeds_ is itself a finding.
3. **Red team adds tests, fixtures and findings — never builder source.** Proposed fixes go in the finding file.
4. **Code vs `docs/INTERFACES.md`:** the code is wrong until the architect changes the file. A different name for the same thing is a _rename_ (wave report), a missing property is a _finding_.
5. **Vendor shapes come from `docs/vendor/API-FACTS.md`** as adopted by INTERFACES §13 A-18…A-30 (x402 v2 `accepts[].amount`; `hedera:testnet` + HTS `0.0.429274` + `{ transaction }` + `extra.feePayer`; Base Sepolia USDC EIP-712 name `"USDC"`; Arkiv SDK 1.0.1 on rabdi 7794095 with `expiration: ExpirationTime.*`; IDKit 4.6 backend-signed `rp_context` + `/api/v4/verify/{rp_id}`; eSIM Access `RT-*` HMAC headers, unsigned webhooks). Code that uses an older primitive is a finding; semgrep flags most of them.
6. **File the finding the moment an attack test confirms it** — not at the end of the run.

## 3. Running a wave end to end (`MODE=local`)

### 3.1 Before you start (5 min)

```sh
cd /home/user/EthGlobal
bash scripts/check-tools.sh                         # forge, anvil, node 22, pnpm 10, playwright browsers
command -v semgrep slither jq >/dev/null || pip3 install semgrep        # slither 0.11.6 and jq are preinstalled
security/redteam/tools/semgrep/selftest.sh          # rules parse and fire (offline; replaces `semgrep --validate`)
security/redteam/tools/coverage-check.sh            # the matrix is consistent before you rely on it
git log --oneline -5 && git status --short          # you attack what is merged on main, nothing else
```

Entry condition (PLAN §3): the wave's PR is merged, CI is green, and the builder's **attack-surface note** (≤ 15 lines: what landed, entry points, env flags, what is mocked, known gaps, how to run) is pasted at the top of `reports/wave-<n>.md`. No note ⇒ ask for it; do not guess the surface.

### 3.2 Bring up the local stack (only what the wave needs)

| Wave | Needs                                                                                 | Command                                                                                   |
| ---- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 1    | nothing running; Foundry + vitest only                                                | `cd packages/contracts && pnpm deps && forge build`                                       |
| 2    | Anvil + deployed contracts for ⛓ steps; everything else is in-process `app.request()` | `pnpm dev:chain` (Anvil 31337, `deploy/addresses.anvil.json`)                             |
| 3    | Anvil + API + agent + `next build && next start`                                      | `scripts/e2e-local.sh --web --keep` (or start each by hand and set `PLAYWRIGHT_BASE_URL`) |

Never point any of it at a testnet; `env.ts` refusing live configs is itself attacked (AP16).

### 3.3 Execute the attack script

1. Open the wave's script(s) in `attacks/` and work top to bottom. Each step (`A4`, `O3`, `L16`, `AP7`, `AG2`, `W5`, `OP1`, …) says what to build, what to send and what must happen.
2. Write the attack test at the path the script names (shared fixture first — §0 of each script). Keep it deterministic: `fakeClock`, seeded fuzz (`FOUNDRY_FUZZ_SEED`), fixtures, no network.
3. Run it. **Green = the attack failed as expected. Red = a finding.** Re-run red ones once with `-vvv` / `--reporter=verbose` to make sure it is the product, not your test.
4. On red: file the finding immediately (§4), then keep going — one finding never stops the run.
5. Run the scans the step asks for, e.g. after the e2e loop:
   ```sh
   security/redteam/tools/scan.sh .e2e/*.log .e2e/ledger-dump.json .agent        # exit 1 on any hit, 2 if the scan could not run
   ```
   Red-team scratch output goes to `${RT_OUT:-/tmp/recharge-redteam}`, never into the repo.

### 3.4 Run the wave gate

```sh
security/redteam/run-wave.sh 1        # or 2, 3, all; `static` runs only the static gates
```

What it runs, in order: the wave's attack suites (`forge test --match-path 'test/attack/*'`, invariants at 256×64, `forge snapshot --check`; `pnpm --filter <pkg> test`; for wave 2 the e2e loop with `--redteam`, a fault-injected e2e that must fail, and scans of `.e2e/` logs, the ledger dump and `.agent/`; for wave 3 the Playwright abuse specs, a `NEXT_PUBLIC_MODE=live` build grepped for keys/secrets/demo wallet, design bans, ops attack tests), then `coverage-check.sh --require <the wave's packages>`, then the static gates (semgrep self-test, semgrep over the product, slither, forbidden-pattern scan of committed files, `.gitignore` hygiene, the Arkiv `$creator` check, jscpd, `deps-check.sh`, matrix consistency), then two finding gates: **no open Critical/High finding**, and **no finding marked fixed without `regression_test`**. Every failure prints `✗ FAILED: …`; the last line is `CLEARED` or `NOT CLEARED`, and the exit status is non-zero on any failure. A missing attack-test directory is a failure, not a skip — a wave cannot be cleared by not attacking it.

### 3.5 Write the report

`security/redteam/reports/wave-<n>.md`: the attack-surface note; per step `test path · result (failed as expected / FINDING RT-…) · renames`; findings by severity and status (`tools/findings-index.sh` first); tool summaries (slither, semgrep, scan, deps, coverage); residual risks added to THREAT-MODEL §8; **CLEARED / NOT CLEARED** with the blocking ids. Each script's _Reporting_ section says which steps to lead with.

## 4. Filing and closing findings

**File:** `security/redteam/findings/RT-W<wave>-<NNN>-<slug>.md` with the front matter in `findings/README.md` (`id, title, module, threat, severity, likelihood, status: open, found_by, owner, found_at, due, attack_test`). Severity follows THREAT-MODEL §0 and is the lead's call; `due` follows the SLA (Critical: ack 30 min / fix 2 h; High: 1 h / 4 h; Med: before `v0-prekickoff`; PLAN §6.3). If no `T-` row fits, set `threat: new` and add a row to THREAT-MODEL (and a §5.12 row if Critical/High). Never paste a real key, LPA, nullifier or PIN — use Anvil fixtures and `LPA:1$local.test$…`. Run `tools/findings-index.sh`.

**Fix (builder):** the PR title carries the id (`fix(api): RT-W2-004 strip client x-recharge-url-token`); it contains the code change **and a regression test** at the path THREAT-MODEL §5.12 names for that threat — `<package>/test/regression/T-xx-<slug>.test.ts` (Foundry `test/regression/Txx_<Name>.t.sol`, Playwright `apps/web/e2e/regression/T-xx-<slug>.spec.ts`) — with a case reproducing the finding. The builder sets `status: fixed`, `regression_test: <path>::<case>`, `fix_commit: <sha>`. A fix without a regression test is not fixed; an interface change also updates `docs/INTERFACES.md`.

**Verify (red team, within 1 h):** re-run the attack test (it must now be green = attack fails) and the regression test (green), then `run-wave.sh <n>`; set `status: verified`, `verified_at`. At wave clearance verified findings become `closed`.

**Other exits:** `accepted-risk` needs `sign_off` (Founder or Chair), a README/`docs/DISCLOSURE.md` line and a THREAT-MODEL §8 row — Med/Low only; a Critical/High is never accepted for the tag. `disputed` counts as open until the lead rules (≤ 1 h; the Chair breaks ties). Duplicates: `status: closed`, `duplicate_of:`.

**What the runner enforces:** any `RT-*.md` with `severity: Critical|High` whose status is not `verified`/`closed` fails the wave; any finding with `status: fixed|verified|closed` and an empty `regression_test:` fails the wave; every Critical/High threat in the layer must have its regression file (`coverage-check.sh --require`).

## 5. The pass criterion, precisely

A wave is **CLEARED** when all hold:

1. Every attack step listed for the wave exists as an automated test that asserts the attack fails, and it is green under `MODE=local`.
2. Every Critical/High finding is `verified` (fix merged, regression test recorded and green, attack re-run).
3. Every Med finding has an owner and a due date before `v0-prekickoff`, or is `accepted-risk` with sign-off.
4. `coverage-check.sh --require <wave packages>` passes: each Critical/High threat of the layer has its regression file.
5. Static gates are green: semgrep self-test and scan, slither (no medium+), forbidden-pattern scan, `.gitignore` hygiene, jscpd ≤ 1 %, `deps-check.sh`.
6. `run-wave.sh <n>` exits 0, and the report says CLEARED.

DECISION §6.5's red-team row is satisfied when wave 3 is cleared and `run-wave.sh all` exits 0.

## 6. Tool exit codes and known sandbox quirks

| Tool                        | 0                      | 1                                                                 | 2                                                        |
| --------------------------- | ---------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| `run-wave.sh`               | cleared                | not cleared                                                       | usage                                                    |
| `tools/scan.sh`             | clean                  | forbidden pattern found                                           | could not run (bad pattern, grep error, unreadable file) |
| `tools/semgrep/selftest.sh` | rules parse and behave | a rule missed a positive / fired on a negative / has no test case | semgrep/jq missing or the rule file does not parse       |
| `tools/coverage-check.sh`   | covered                | gaps listed                                                       | markers or rows unparsable                               |
| `tools/deps-check.sh`       | OK                     | a hygiene check failed                                            | —                                                        |

- `semgrep --validate` needs semgrep.dev (blocked): use `tools/semgrep/selftest.sh`. Always pass `--metrics=off --disable-version-check`.
- `slither` runs **without** `--foundry-compile-all` (that flag runs `forge clean`, which deletes builders' `out/` mid-run, and crashed crytic-compile on forge 1.5 here).
- GNU `grep -P` accepts a single pattern only; `scan.sh` compiles the pattern file into one alternation and self-checks it on a canary. Add patterns to `forbidden-patterns.txt` one per line; tag synthetic-value rules `# [relaxed-skip]` (skipped in mocks/tests/fixtures) and public-test-key rules `[docs-ok]` (also skipped in `docs/`, `research/`). Never write a real-format LPA literally in this directory — build it at run time (`'LPA:1$smdp' + '.carrier.com$…'`) or use `LPA:1$local.test$…` / an RFC 2606 `example` host.
- The repo-wide `pnpm lint` runs `prettier --check .`, which also covers `security/`; if it complains about these Markdown files, format them or add `security/` to `.prettierignore` (orchestrator's call).
