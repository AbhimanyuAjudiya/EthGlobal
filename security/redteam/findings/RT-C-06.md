---
id: RT-C-06
title: renounceOwnership is live; 'Low, accepted' in README without sign-off or THREAT-MODEL §8 row
module: packages/contracts/src/DataDrop.sol
threat: T-01
severity: Low
likelihood: L
status: open
found_by: redteam-contracts
owner: builder-contracts
found_at: 2026-11-04T02:45+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: packages/contracts/test/redteam/RT_DataDrop.t.sol::test_RT_RenounceOwnershipDisabled_RTFINDING
regression_test:
fix_commit:
verified_at:
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

## Verification (red team)
