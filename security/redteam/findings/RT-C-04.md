---
id: RT-C-04
title: Deploy.s.sol bakes a live usdc into an immutable without checking code or decimals() == 6
module: packages/contracts/script/Deploy.s.sol
threat: T-08
severity: Low
likelihood: L
status: fixed
found_by: redteam-contracts
owner: builder-contracts
found_at: 2026-11-04T02:45+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: packages/contracts/test/redteam/RT_Deploy.t.sol::test_RT_DeployRejectsUsdcWithoutCode_RTFINDING; packages/contracts/test/redteam/RT_Deploy.t.sol::test_RT_DeployRejectsEighteenDecimalUsdc_RTFINDING
regression_test: packages/contracts/test/regression/T08_Decimals.t.sol::test_Regression_RTC04_DeployRejectsUsdcWithoutCode; packages/contracts/test/regression/T08_Decimals.t.sol::test_Regression_RTC04_DeployRejectsEighteenDecimalUsdc
fix_commit: (uncommitted, wave-1 fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/contracts && forge test --match-path test/redteam/RT_Deploy.t.sol --match-test DeployRejects -vvv
```

1. `vm.chainId(84532)`; take the chains.json record and replace `usdc` with an EOA (a typo) → `deploy()` succeeds.
2. Same with an 18-decimal ERC-20 → `deploy()` succeeds; `DataDrop.usdc()` is that token, immutably.
   (The builder's own `test_BaseSepoliaDeploysDataDropOnly` also deploys against a codeless address without complaint.)

## Impact

`usdc` is immutable, so a wrong entry means a redeploy and new addresses for every package — discovered only at the first
`createCampaign` (no code → SafeERC20 reverts) or, worse, never (an 18-dec token → every price off by 1e12, T-08). The contract
constructor has no decimals guard either.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

In `Deploy.deploy` for live token mode: `require(usdc.code.length > 0)` and
`require(IERC20Metadata(usdc).decimals() == 6)` (on Hedera the HTS facade answers `decimals()`). Optionally the same check in the
`DataDrop` constructor when `usdc_ != address(0)`. Builder: `test_BaseSepoliaDeploysDataDropOnly` will then need
`vm.etch`/a fork for the Base Sepolia USDC address.

Regression test to add (builder): `packages/contracts/test/regression/T08_Decimals.t.sol (case: deploy reverts on usdc without code / decimals != 6)`. The red-team attack test above is marked `// RT-FINDING` and suffixed
`_RTFINDING` (CI filter: `forge test --no-match-test RTFINDING`); it must turn green with the fix.

## Builder notes (optional)

`Deploy.deploy` now checks a live token-mode `usdc`: it must have code and `decimals() == 6`, otherwise it reverts with a message. On Hedera (295/296) a codeless HTS long-zero alias is tolerated, because `extcodesize` of HTS tokens is [verify Wed] and the runbook checks decimals on the mirror node; any contract that answers `decimals()` must answer 6 (`test_HederaRejectsEighteenDecimalContractAtTheUsdcAlias`). The builder's Base Sepolia deploy test now installs a 6-decimal token at 0x036C… first. The red-team `_RTFINDING` test was moved from `test/redteam/` to the regression above, adapted to assert the fixed behaviour; a comment marks its old place.

## Verification (red team)
