---
id: RT-C-06
title: renounceOwnership is live; 'Low, accepted' in README without sign-off or THREAT-MODEL §8 row
module: packages/contracts/src/DataDrop.sol
threat: T-01
severity: Low
likelihood: L
status: verified
found_by: redteam-contracts
owner: builder-contracts
found_at: 2026-11-04T02:45+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: packages/contracts/test/redteam/RT_DataDrop.t.sol::test_RT_RenounceOwnershipDisabled_RTFINDING
regression_test: packages/contracts/test/regression/T01_AttestorDrainBound.t.sol::test_Regression_RTC06_RenounceOwnershipRevertsAndRotationStillWorks
fix_commit: (uncommitted, wave-1 fix pass; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/contracts && forge test --match-test test_RT_RenounceOwnershipDisabled_RTFINDING -vvv
```

`owner` calls `renounceOwnership()` → succeeds; `setAttestor` is dead forever.

## Impact

One mis-click (or a compromised owner key) removes the only T-01 recovery: attestor rotation. A later attestor-key leak then
cannot be fixed on-chain; every _new_ campaign is drainable at the hourly cap until sponsors pause. The README marks it
"Low, accepted", but README §4 / findings README rule 4 require Founder/Chair `sign_off` and a THREAT-MODEL §8 row for
`accepted-risk` — neither exists.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Override `renounceOwnership()` to `revert` (one line; the ABI test list then drops it or keeps it as a reverting
function), or obtain the sign-off and add the §8 row and mark this finding `accepted-risk`.

Regression test to add (builder): `packages/contracts/test/regression/T01_AttestorDrainBound.t.sol (case: renounceOwnership reverts; rotation still possible)`. The red-team attack test above is marked `// RT-FINDING` and suffixed
`_RTFINDING` (CI filter: `forge test --no-match-test RTFINDING`); it must turn green with the fix.

## Builder notes (optional)

`renounceOwnership()` is overridden as `pure` and always reverts `RenounceDisabled()`, so attestor rotation, the T-01 recovery, can never be thrown away. This is no longer an accepted risk, so no THREAT-MODEL §8 row is needed. The README's key table explains why and references §8. The red-team `_RTFINDING` test was moved from `test/redteam/` to the regression above, adapted to assert the fixed behaviour; a comment marks its old place.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `T01_AttestorDrainBound.t.sol::test_Regression_RTC06_*` passes. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): the 2-step path is no renounce: nominating `address(0)` or `0xdEaD` leaves the owner in control and `setAttestor` working; only the nominee can accept; a raw `renounceOwnership()` call reverts.

```sh
cd packages/contracts && forge test --match-path test/regression/verify-RTC06_NoRenounce.t.sol
```
