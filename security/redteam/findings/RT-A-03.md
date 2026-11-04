---
id: RT-A-03
title: Admission is sized to the hourly cap only: a burst against the remaining sponsor BUDGET verifies every human and burns the losers' one-time World proofs
module: services/api/src/middleware/octroi.ts
threat: T-24
severity: High
likelihood: M
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-04T19:05+05:30
attack_test: services/api/test/redteam/rt-races.test.ts::budget for 3 claims, 10 concurrent humans ⇒ verify ≤ 3 and the rest refused before verify_RTFINDING; services/api/test/redteam/rt-anvil.test.ts::on-chain budget for 3 claims, 8 concurrent humans ⇒ verify ≤ 3_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-races.test.ts -t "budget for 3"
cd services/api && npx vitest run test/redteam/rt-anvil.test.ts -t "on-chain budget"   # real DataDrop on Anvil
```

Campaign budget = 3 × price, `claimsPerHour` = 100 (in-memory) / 100 (Anvil). 10 (8 on Anvil) distinct humans claim at once:
exactly 3 × `201`, and `personhood.verify` is called 10 (8) times. The losers get `409 budget_exhausted` from the
`BudgetExhausted` revert; `BudgetExhausted` is not in `RETRYABLE_REVERTS`, so no T-24 intent is kept (`deps.intents.size === 0`)
and their retry is a replay of a consumed one-time proof.

## Impact

T-24 / AP5.1 rubric: verifications burned on a claim that could not be served ⇒ High. A campaign running out of budget is the
normal end of every campaign, and the demo's final minutes are exactly the burst case: every human who hits "claim" in the
last seconds loses their one-time IDKit 4 uniqueness proof for the action (API-FACTS §4.5) and can never claim from any
campaign using that action, with no recovery path.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Make the admission slot budget-aware: `slots = min(claimsPerHour − claimsThisHour, floor((budget − spent) / price)) − inFlight`
(both read from `campaignState`, already fetched), and refuse with `409 budget_exhausted` before `decide()` when no slot is
left. As defence in depth, treat `BudgetExhausted` after verify like `HourlyCap` (keep the intent so the human can be served
by a top-up of the budget or offered the paid lane without re-proving). Regression:
`services/api/test/regression/T-24-verified-claim-retry.test.ts` (case: budget burst ⇒ verify ≤ remaining claims).

## Builder notes (optional)

## Verification (red team)
