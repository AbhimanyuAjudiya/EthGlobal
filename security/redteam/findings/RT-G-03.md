---
id: RT-G-03
title: state.json keeps only the day of the last purchase: a clock step forward and back erases today's own spend
module: services/agent/src/journal.ts
threat: T-30
severity: Low
likelihood: L
status: open
found_by: redteam-wave2
owner: builder-agent
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/agent/test/redteam/rt-agent.test.ts::purchase on day D, one at a skewed D+1, back to D ⇒ own spend for D is still remembered_RTFINDING
regression_test:
fix_commit:
verified_at:
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

## Verification (red team)
