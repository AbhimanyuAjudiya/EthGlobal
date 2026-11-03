---
id: RT-C-03
title: refund() can only pay msg.sender and there is no rescue path: a blacklisted sponsor's budget is locked forever
module: packages/contracts/src/DataDrop.sol
threat: T-10
severity: Low
likelihood: L
status: fixed
found_by: redteam-contracts
owner: builder-contracts
found_at: 2026-11-04T02:45+05:30
due: next report (Low: opportunistic, PLAN §6.3)
attack_test: packages/contracts/test/redteam/RT_DataDrop.t.sol::test_RT_BlacklistedSponsorCanStillRecoverFunds_RTFINDING
regression_test: packages/contracts/test/regression/T10_RefundRecipient.t.sol::test_Regression_RTC03_BlacklistedSponsorRefundsToAlternateAddress
fix_commit: (uncommitted, wave-1 fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/contracts && forge test --match-test test_RT_BlacklistedSponsorCanStillRecoverFunds_RTFINDING -vvv
```

1. Token mode with a Circle-style blacklist token (`test/redteam/mocks/RT_Tokens.sol::RT_BlacklistToken`).
2. Sponsor funds $500; the issuer blacklists the sponsor; campaign expires.
3. `refund(id)` reverts forever ("Blacklistable: account is blacklisted"); there is no `refund(id, to)` and no sweep.

## Impact

Real USDC (Base Sepolia, Hedera HTS freeze/KYC flags) can blacklist/freeze accounts. The unspent budget becomes
permanently unrecoverable — no actor (sponsor, owner) can move it. Same root: a blacklisted / un-associated `payout` (immutable)
bricks every claim (`test_RT_BlacklistedPayoutBricksClaimsButRefundWorks` documents that the campaign stays refundable).
Testnet only for this build, hence Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Add `refund(bytes32 id, address to)` (sponsor-only, `to != 0`) or keep `refund(id)` and add `refundTo`. Keep "no sweep"
(T-10) — the recipient is chosen by the sponsor, never the owner. On Hedera, also check in the deploy runbook that `payout` is
associated with HTS USDC before the first claim.

Regression test to add (builder): `packages/contracts/test/regression/T10_RefundRecipient.t.sol (new; case: blacklisted sponsor refunds to an alternate address)`. The red-team attack test above is marked `// RT-FINDING` and suffixed
`_RTFINDING` (CI filter: `forge test --no-match-test RTFINDING`); it must turn green with the fix.

## Builder notes (optional)

Added `refund(bytes32 id, address to)`: sponsor-only, `to != 0`, same eligibility rules, and it shares one internal `_refund` with `refund(id)`. The recipient is the sponsor's choice, never an owner power; there is still no sweep (T-10). The README runbook now checks that `payout` is HTS-associated before the first claim. The red-team `_RTFINDING` test was moved from `test/redteam/` to the regression above, adapted to assert the fixed behaviour; a comment marks its old place.

## Verification (red team)
