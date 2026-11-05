---
id: RT-G-02
title: state.json read-modify-write is serialised per process only: two agent processes on one AGENT_STATE_DIR lose half of "own spend today"
module: services/agent/src/journal.ts
threat: T-30
severity: Med
likelihood: L
status: verified
found_by: redteam-wave2
owner: builder-agent
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/agent/test/redteam/rt-agent.test.ts::two real processes record 40 purchases each ⇒ own spend today counts all 80_RTFINDING
regression_test: services/agent/test/redteam/rt-agent.test.ts::two real processes record 40 purchases each ⇒ own spend today counts all 80; services/agent/test/lock.test.ts::own spend — concurrent appends are all counted; a torn line is skipped; a legacy state.json still counts
fix_commit: (uncommitted, wave-2 agent fix pass; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
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

Fixed with write-through to an append-only journal and a reducer (`services/agent/src/journal.ts`): `recordPurchase`
appends one line `{v, day, ent, usd6, at, expiryFor?}` to `spent.jsonl` with a single O_APPEND `write` + `fsync`
(atomic against other appenders on a local filesystem; each record starts with a newline so a line torn by a crash
never swallows the next). `own(key, now)` reduces the file (Σ usd6 for the key in the UTC day of `now`, max
`expiryFor`, newest `at`); a pre-journal `state.json` is still folded in read-only. No read-modify-write remains, so
there is nothing to lose between processes. The `_RTFINDING` test was renamed in place and passes (80 × 400 000).

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `rt-agent.test.ts` 80-purchase case and `lock.test.ts` own-spend cases pass. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): FOUR real processes append 30 purchases each around a crash-torn line (no trailing newline) planted mid-journal: own spend counts all 121 (the torn line swallows nothing).

```sh
cd services/agent && npx vitest run test/redteam/verify-rt-g-02-03-04.test.ts -t RT-G-02
```
