---
id: RT-P-02
title: A killed e2e-local.sh leaves the MODE=local API (0.0.0.0) and Anvil running as orphans; concurrent runs share and truncate .e2e/
module: scripts/e2e-local.sh
threat: T-85
severity: Low
likelihood: H
status: open
found_by: redteam-wave3-ops
owner: builder-ops-demo
found_at: 2026-11-04T16:10+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: security/redteam/wave3-ops/run.sh::e2e_local_reaps_stack_on_kill_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
security/redteam/wave3-ops/run.sh   # "process hygiene": isolated root, seed stubbed, SIGKILL after "PASS setup: api"
```

After `kill -9 <e2e-local.sh>`: the API (`ppid=1`) still listens on `0.0.0.0:8799` and answers `/__local/clock`; Anvil
still listens on `127.0.0.1:8586`. The same happened for real in this sandbox: an e2e run from 09:50 left
`dev-chain.sh` + Anvil on :8546 and the API on `0.0.0.0:8788`, both reparented to init, still serving at 16:00.

`cleanup()` is an EXIT/INT/TERM trap: it never runs on SIGKILL, on an OOM kill, or when a CI step / tool timeout kills the
shell. The API is started as `( cd …; exec tsx … ) &` and `dev-chain.sh` as a plain background job — no process group of
their own, no watchdog (`lib/harness.ts` has `stopWithParent()`; the bash harness has nothing equivalent). Also `OUT` is
always `$ROOT/.e2e` and the script truncates `chain.log`/`api.log`/`agent.log` and `demo-seed --reset` deletes the seed
files on start, so two concurrent runs (web + ops, or two terminals) corrupt each other.

## Impact

Orphaned MODE=local APIs on the LAN (RT-P-01) long after the operator thinks the demo is down; stale processes hold the
ports so the next run fails or (worse) the next `curl $API_URL` talks to yesterday's stack. Low on its own.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Start the stack under `setsid` and kill the process group (`kill -- -$PGID`) in cleanup; add a parent-death watchdog
(e.g. a background `while kill -0 $$; do sleep 1; done; kill -- -$PGID`), or drive the stack from `lib/harness.ts`
(`stopWithParent`). Per-run `OUT` (`E2E_OUT`, default `.e2e/run-<pid>`), or a lock file that refuses a second run.
