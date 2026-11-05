---
id: RT-G-03
title: state.json keeps only the day of the last purchase: a clock step forward and back erases today's own spend
module: services/agent/src/journal.ts
threat: T-30
severity: Low
likelihood: L
status: verified
found_by: redteam-wave2
owner: builder-agent
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/agent/test/redteam/rt-agent.test.ts::purchase on day D, one at a skewed D+1, back to D ⇒ own spend for D is still remembered_RTFINDING
regression_test: services/agent/test/redteam/rt-agent.test.ts::purchase on day D, one at a skewed D+1, back to D ⇒ own spend for D is still remembered; services/agent/test/lock.test.ts::RT-G-03 monotonic guard — a purchase on file from the future ⇒ the tick buys nothing (clock-behind)
fix_commit: (uncommitted, wave-2 agent fix pass; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/agent && npx vitest run test/redteam/rt-agent.test.ts -t "skewed D+1"
```

`recordPurchase(D, 9.6 USDC)`, then `recordPurchase(D+1, 0.4)` (clock stepped forward), then `spentToday(D)` ⇒ `0`.
`recordPurchase` replaces `state.spent` with `{ [day]: today }`.

## Impact

An NTP step, VM resume or a wrong host clock wipes the own-state half of the cap; combined with ledger lag the day's cap can
be spent again. Needs host clock control; Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Keep the last two UTC days (or all days younger than 48 h) instead of only the current one, and never let a purchase dated in
the future evict the present day.

## Builder notes (optional)

Fixed by the same journal (RT-G-02): every purchase is filed under its own UTC day and nothing is ever evicted, so a
purchase dated D+1 cannot erase D. `tick` still uses `max(ledger-derived, journal-derived)` spend. Monotonic guard:
if the newest purchase on file is more than `CLOCK_SKEW_MS` (60 s) ahead of `now`, the clock stepped back and the tick
skips `clock-behind` (no purchase) until the clock passes it again — fail closed rather than trust "today". The
`_RTFINDING` test was renamed in place and passes.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `rt-agent.test.ts` skewed-day case and `lock.test.ts` monotonic guard pass. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): clock steps +2 d, −1 d and back: each day keeps exactly its own spend; 23:59:59.999 and 00:00:00.000 UTC are filed under different days.

```sh
cd services/agent && npx vitest run test/redteam/verify-rt-g-02-03-04.test.ts -t RT-G-03
```
