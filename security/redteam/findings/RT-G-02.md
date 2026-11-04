---
id: RT-G-02
title: state.json read-modify-write is serialised per process only: two agent processes on one AGENT_STATE_DIR lose half of "own spend today"
module: services/agent/src/journal.ts
threat: T-30
severity: Med
likelihood: L
status: open
found_by: redteam-wave2
owner: builder-agent
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/agent/test/redteam/rt-agent.test.ts::two real processes record 40 purchases each ⇒ own spend today counts all 80_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/agent && npx vitest run test/redteam/rt-agent.test.ts -t "record 40"
```

Two OS processes (`rt-proc-worker.ts record`) each call `recordPurchase(key, 400000)` 40 times on one directory ⇒
`spentToday = 16 000 000`, expected 32 000 000. `#locked` chains promises inside one `AgentState`; across processes the
load→add→rename sequence interleaves and the last rename wins.

## Impact

`spent = max(ledger receipts, own state)` is the AG1.3 guard against receipt lag; with two processes the own-state half is
undercounted, so during ledger lag the cap can be re-spent. Requires two processes plus ledger lag ⇒ Med/L.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Use one file per purchase (`spent/<day>/<sha256(key)>/<trigger>.json`, created with O_EXCL like the triggers) and sum them, or
take an advisory lock (`open(lockfile, 'wx')` with stale-lock recovery) around the read-modify-write.

## Builder notes (optional)

## Verification (red team)
