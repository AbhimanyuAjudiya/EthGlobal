---
id: RT-P-07
title: Log/artefact hygiene gaps: I-18 scans only api.log and agent.log, dev-chain.sh prints the mnemonic, CI uploads logs even after a failed scan, and the fault run passes on any failure
module: scripts/e2e-local.sh; scripts/dev-chain.sh; .github/workflows/ci.yml
threat: T-50
severity: Low
likelihood: M
status: verified
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: security/redteam/wave3-ops/run.sh::e2e_scan_covers_every_log_RTFINDING; security/redteam/wave3-ops/run.sh::dev_chain_does_not_echo_mnemonic_RTFINDING; security/redteam/wave3-ops/run.sh::ci_uploads_only_scanned_logs_RTFINDING; security/redteam/wave3-ops/run.sh::ci_fault_run_fails_for_the_planted_reason_RTFINDING
regression_test: scripts/test/regression/T-86-repo-hygiene.test.ts::CI and e2e only ship scanned artefacts + security/redteam/wave3-ops/run.sh::e2e-local.sh scans every .e2e log / dev-chain.sh does not echo the mnemonic / uploads run only after a clean scan / fault run asserts the planted failure
fix_commit: (uncommitted, wave-3 ops fix pass on claude/ethglobal-mumbai-build; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
duplicate_of:
sign_off:
---

## Repro

```sh
bash security/redteam/tools/scan.sh .e2e/*.log    # FAIL: .e2e/chain.log line 1 (the mnemonic), never seen by e2e-local's I-18
```

1. `e2e-local.sh` step 6 scans `"$OUT/api.log" "$OUT/agent.log"` only; `chain.log`, the web logs and the seed's stdout are
   never scanned, yet CI uploads `.e2e/*.log`.
2. `dev-chain.sh` sources the root `.env` and echoes `mnemonic '$MNEMONIC'` — the public one by default, but whatever a human
   put in `ANVIL_MNEMONIC`. `run-wave.sh 2` therefore fails its own log scan on every run.
3. `Upload logs` has `if: always()`: when I-18 found an LPA/PIN the leaking logs are uploaded anyway; the Playwright job
   uploads `test-results`/`playwright-report` (traces, screenshots) without any scan (OP7 requires scanned uploads).
4. `! E2E_FAULT=1 bash scripts/e2e-local.sh` is green when the run fails for any reason (port clash, missing build), so it
   does not prove the planted assertion is what failed.

Verified clean (kept as regressions): existing `.e2e/*.log` contain no `PAYMENT-SIGNATURE` value, no real-format LPA, no PIN.

## Impact

MODE=local data only, so Low; but this is the pipeline that is supposed to prove T-50 before the live weekend.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Scan `"$OUT"/*.log` in I-18; drop the mnemonic from the echo; upload only when the scan step succeeded (`if: success()` on
a step that runs after `scan.sh`, or scan inside the upload step); scan Playwright artefacts before upload; replace the fault
step with `out=$(E2E_FAULT=1 bash scripts/e2e-local.sh 2>&1) && exit 1; grep -q 'FAIL I-10' <<< "$out"`.

## Builder notes

1. e2e-local I-18 scans every `*.log` and `ledger-dump.json` of the run dir (chain, api, agent, seed). 2. dev-chain.sh prints `mnemonic: anvil default` / `ANVIL_MNEMONIC (redacted)` (the API fixer's change, verified); e2e-local's stale-listener message prints only the program name, never argv (Anvil's carries `--mnemonic`). 3. CI: a `logscan` step scans every `.e2e/**` log and dump; `Upload logs` runs only `if: !cancelled() && steps.logscan.outcome == 'success'`. Playwright: a `pwscan` step scans the report, test-results and `.e2e/playwright` (traces unzipped first) and only the HTML report is uploaded, only after a clean scan. 4. `e2e-agent.ts` tags the planted failure `[E2E_FAULT planted]`; CI requires a non-zero exit AND `FAIL I-10 agent: … [E2E_FAULT planted]`. Verified locally: E2E_FAULT=1 → rc 1 with the marker.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `T-86-repo-hygiene.test.ts` CI/e2e cases and `wave3-ops/run.sh` pass. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): EVERY `upload-artifact` step (not only the two named) is gated on a scan step's `outcome == 'success'`; plus the RT-A-14 variant (custom / invalid mnemonic never printed).

```sh
cd scripts && npx vitest run test/regression/verify-rt-p-03-05-06-07-static.test.ts -t RT-P-07
```
