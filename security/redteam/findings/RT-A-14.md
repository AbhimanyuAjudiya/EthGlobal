---
id: RT-A-14
title: scripts/dev-chain.sh writes the Anvil mnemonic into .e2e/chain.log, so the wave-2 log scan (.e2e/*.log) can never be clean
module: scripts/dev-chain.sh
threat: T-50
severity: Low
likelihood: H
status: verified
found_by: redteam-wave2
owner: builder-ops
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/tools/scan.sh .e2e/*.log (chain.log:1)
regression_test: scripts/e2e-local.sh (I-18 scan) + security/redteam/tools/scan.sh .e2e/chain.log .e2e/api.log .e2e/agent.log ⇒ clean
fix_commit: (uncommitted, wave-2 API fix pass; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
duplicate_of:
sign_off:
---

## Repro

```sh
security/redteam/tools/scan.sh .e2e/*.log
# FORBIDDEN PATTERN in .e2e/chain.log: 1: dev-chain: anvil on http://127.0.0.1:8546 (chain 31337, mnemonic 'test test … junk')
```

`scripts/dev-chain.sh:43` echoes `$MNEMONIC`. `.e2e/api.log` and `.e2e/agent.log` are clean.

## Impact

The mnemonic is the public Anvil one, so nothing leaks, but `run-wave.sh 2` scans `.e2e/*.log` and fails on it every run,
which trains people to ignore the scan. Hygiene.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Print `mnemonic: anvil default` (or the derived account #0 address) instead of the phrase.

## Builder notes (optional)

`scripts/dev-chain.sh` prints `mnemonic: anvil default` (or `ANVIL_MNEMONIC (redacted)` when one is supplied), never the phrase. A fresh `bash scripts/e2e-local.sh` leaves `.e2e/chain.log` clean. A stale `.e2e/web-chain.log` written by an earlier `--web` run still holds the old line until that run is repeated.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `scripts/e2e-local.sh` I-18 scan + `scan.sh` over a default `dev-chain.sh` log: clean. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): `dev-chain.sh` run with a CUSTOM `ANVIL_MNEMONIC` (the .env case) prints `ANVIL_MNEMONIC (redacted)` and never the phrase; with an INVALID phrase Anvil's error names one bad word, never the phrase; `scan.sh` clean on both logs.

```sh
cd scripts && npx vitest run test/regression/verify-rt-a-14-dev-chain-mnemonic.test.ts
```
