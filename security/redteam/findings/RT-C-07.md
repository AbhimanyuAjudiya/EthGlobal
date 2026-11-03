---
id: RT-C-07
title: claim reverts Panic(0x11) instead of BudgetExhausted when spent + price exceeds uint128
module: packages/contracts/src/DataDrop.sol
threat: T-07
severity: Low
likelihood: L
status: fixed
found_by: redteam-contracts
owner: builder-contracts
found_at: 2026-11-04T02:45+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: packages/contracts/test/redteam/RT_DataDrop.t.sol::test_RT_MaxBudgetAndPriceNoOverflow_RTFINDING
regression_test: packages/contracts/test/regression/T07_BudgetAccounting.t.sol::test_Regression_RTC07_MaxBudgetAndPriceReportsBudgetExhausted
fix_commit: (uncommitted, wave-1 fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/contracts && forge test --match-test test_RT_MaxBudgetAndPriceNoOverflow_RTFINDING -vvv
```

1. LEDGER_ONLY campaign with `budget = 2^128−1`, `price = 2^96−1` (allowed: budget ≥ price).
2. Advance `spent` to `budget − price` (vm.store stands in for ~2^32 claims), claim once → `spent == budget`.
3. Next claim: `c.spent + price` overflows uint128 → `Panic(0x11)`, not `BudgetExhausted()`.

## Impact

The binding check order (DataDrop natspec: "the API decodes reverts by name") is violated at the top of the range; the
API would map the panic to an unknown error. Only reachable with an unbacked near-`uint128` budget (LEDGER_ONLY, RT-C-01) and
billions of claims, so practically unreachable — Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Compare without the overflowing add: `if (price > c.budget - c.spent) revert BudgetExhausted(); c.spent += price;`
(`budget ≥ spent` is an invariant, so the subtraction cannot underflow).

Regression test to add (builder): `packages/contracts/test/regression/T07_BudgetAccounting.t.sol (case: budget near 2^128 reports BudgetExhausted)`. The red-team attack test above is marked `// RT-FINDING` and suffixed
`_RTFINDING` (CI filter: `forge test --no-match-test RTFINDING`); it must turn green with the fix.

## Builder notes (optional)

`claim` now compares against the remainder, `if (price > budget - spent) revert BudgetExhausted()`, before the add (`budget ≥ spent` is invariant), so the top of the range reports `BudgetExhausted()` and never `Panic(0x11)`. Fuzzed in `testFuzz_NoPanicAtTheTopOfTheRange`. The red-team `_RTFINDING` test was moved from `test/redteam/` to the regression above, adapted to assert the fixed behaviour; a comment marks its old place.

## Verification (red team)
