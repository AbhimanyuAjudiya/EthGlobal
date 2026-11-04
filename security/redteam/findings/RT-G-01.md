---
id: RT-G-01
title: Trigger claim TOCTOU: a second process that sees the claim file before its record is written treats it as dead and signs for the same trigger
module: services/agent/src/journal.ts
threat: T-30
severity: High
likelihood: L
status: open
found_by: redteam-wave2
owner: builder-agent
found_at: 2026-11-04T15:05+05:30
due: 2026-11-04T19:05+05:30
attack_test: services/agent/test/redteam/rt-agent.test.ts::a claim file that exists but is not yet written is never treated as dead_RTFINDING; services/agent/test/redteam/rt-agent.test.ts::two real processes racing 300 triggers ⇒ no trigger won by both_RTFINDING; services/agent/test/redteam/rt-agent.test.ts::200 races of claimTrigger between two state instances ⇒ never two winners_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/agent && npx vitest run test/redteam/rt-agent.test.ts -t "two processes share"
```

`claimTrigger` does `open(path, 'wx')` and only then `handle.writeFile(record)`. A second process that hits `EEXIST` in
between reads an empty file, `readJson` maps the `SyntaxError` to `undefined`, `dead = existing === undefined` is true, and it
overwrites the record and returns `{ ok: true }` — both processes go on to sign. Deterministic case: an empty trigger file ⇒
the second `claimTrigger` returns ok. Stress case: 200 races between two `AgentState` instances on one directory produced a
double winner (1/200 observed). Two real OS processes (`rt-proc-worker.ts claim`, 300 triggers each): a trigger won by
both was observed once under full-suite load; isolated runs were 0/300 — the window is narrow, not absent.

## Impact

AG1.2 / T-30: two purchases for one trigger ⇒ High (breaks the "agent caps" claim): both processes computed the same
`spent` before either bought, so a step at $9.60 of a $10 cap is bought twice ($10.40). Needs two agent processes on one
`AGENT_STATE_DIR` (the case the README says the trigger files exist for) ticking the same key in the same instant; likelihood
L. Bounded to one extra step per collision.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Make the claim atomic: write the record to a temp file and `link()` (or `rename` with `RENAME_NOREPLACE` semantics via
`link`+`unlink`) it into place, so the trigger path never exists without content; and treat an unparsable existing record as
"in flight" (not dead) until it is older than `STALE_CLAIM_MS` by mtime. Regression in
`services/agent/test/regression/T-30-agent-cap.test.ts` (case: empty trigger file ⇒ not ok).

## Builder notes (optional)

## Verification (red team)
