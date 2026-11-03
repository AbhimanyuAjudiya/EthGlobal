---
id: RT-C-05
title: Hedera addresses file records the cold owner while the deployer hot key still owns DataDrop
module: packages/contracts/script/Deploy.s.sol
threat: T-10
severity: Low
likelihood: M
status: fixed
found_by: redteam-contracts
owner: builder-contracts
found_at: 2026-11-04T02:45+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: packages/contracts/test/redteam/RT_Deploy.t.sol::test_RT_HederaAddressesFileOwnerMatchesChain_RTFINDING
regression_test: packages/contracts/test/regression/T10_DeployOwnerRecord.t.sol::test_Regression_RTC05_HederaAddressesFileOwnerMatchesChain
fix_commit: (uncommitted, wave-1 fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/contracts && forge test --match-test test_RT_HederaAddressesFileOwnerMatchesChain_RTFINDING -vvv
```

1. `vm.chainId(296)`, HTS mock etched, token mode, `OWNER_ADDRESS = cold ≠ deployer`.
2. On-chain `owner() == deployer`, `pendingOwner() == cold` (2-step, needed for `associateHts`).
3. `deploy/addresses.hedera_testnet.json` says `"owner": "<cold>"`.

## Impact

Every consumer of the committed addresses file (API `/healthz`, the §6.7 rotation drill, the judges' disclosure) is told
the cold key controls `setAttestor` while the broadcasting hot key actually does until someone sends `acceptOwnership()`. If the
accept is forgotten, a deployer-key compromise can rotate the attestor (bounded by the T-01 drain bound) and the drill's
"owner rotates" step fails with the documented key.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Write `"owner": owner()` (the actual owner) and add `"pendingOwner"` to the file (INTERFACES §6.3 change), or make the
script print a loud post-deploy TODO and have `fill-deploy-txs.mjs` refuse to finalise while `pendingOwner() != 0`.

Regression test to add (builder): `packages/contracts/test/regression/T10_DeployOwnerRecord.t.sol (new; case: file owner == owner(), pendingOwner recorded)`. The red-team attack test above is marked `// RT-FINDING` and suffixed
`_RTFINDING` (CI filter: `forge test --no-match-test RTFINDING`); it must turn green with the fix.

## Builder notes (optional)

The addresses file now records `owner` as the on-chain `owner()` right after the broadcast, plus a new `pendingOwner` field (zero address when none) that INTERFACES §6.3 now documents. The script prints a TODO while a pending owner exists. `CHAIN=<id> RPC_URL=… pnpm deploy:txs` re-reads `owner()`/`pendingOwner()` from the chain after `acceptOwnership()` and warns while it is still pending. The red-team `_RTFINDING` test was moved from `test/redteam/` to the regression above, adapted to assert the fixed behaviour; a comment marks its old place.

## Verification (red team)
