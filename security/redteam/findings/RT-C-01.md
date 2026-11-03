---
id: RT-C-01
title: LEDGER_ONLY: any address can declare an unbacked budget; events are indistinguishable from a funded campaign
module: packages/contracts/src/DataDrop.sol
threat: T-09
severity: Med
likelihood: M
status: open
found_by: redteam-contracts
owner: builder-contracts
found_at: 2026-11-04T02:45+05:30
due: 2026-11-05T20:59+05:30
attack_test: packages/contracts/test/redteam/RT_DataDrop.t.sol::test_RT_LedgerOnlyStrangerCannotDeclareUnbackedBudget_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/contracts && forge test --match-test test_RT_LedgerOnlyStrangerCannotDeclareUnbackedBudget_RTFINDING -vvv
```

1. Deploy `DataDrop(address(0), payout, attestor, owner)` (LEDGER_ONLY — the documented Hedera fallback).
2. Stranger with **zero** USDC: `createCampaign(id, type(uint128).max, 500_000, type(uint32).max, now + 7 days)` → succeeds.
3. `CampaignCreated(id, stranger, 340282366920938463463374607431768211455, …)` is emitted, byte-identical to a funded token-mode
   campaign (`RT_ModelInvariant.t.sol::invariant_RT_LedgerOnlyParity` proves the two modes emit identical events for the same
   inputs — so nothing in the log stream says "unfunded").

## Impact

In LEDGER_ONLY the contract is the *only* public record of sponsor commitments, but it records whatever any caller
declares. Nothing ties a campaign to the native HTS transfer that is supposed to fund it. Consequences:

- An indexer / dashboard / judge reading `CampaignCreated` + `Claimed` sees "$3.4e32 budget, N claims paid" for a campaign
  that never moved a cent — exactly T-09's "sponsor money never moved".
- If `services/api` claims against any live on-chain campaign id (not only an operator config list), a stranger can make the
  service serve real eSIM data (real cost) against a fabricated budget. Escalates to **High** if wave 2 does that.
- Enables RT-C-07 (near-`uint128` budgets are only reachable here).

No token loss on-chain (no tokens exist in this mode), hence Med.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Pick one (the attack test passes with either):

1. In LEDGER_ONLY, gate `createCampaign` to `owner()` (or an owner-managed `sponsorAllowed[address]`), so a declared budget is at
   least attested by the operator who saw the HTS transfer; keep token mode permissionless.
2. Or require the declared funding reference on-chain: `createCampaign(..., bytes32 htsTxRef)` emitted in `CampaignCreated`, and
   make the API/indexer verify it against the mirror node before treating the campaign as funded.

Document the choice in INTERFACES §6.1 and README "Modes".

Regression test to add (builder): `packages/contracts/test/regression/T09_HtsAssociation.t.sol (case: ledger-only create by non-allow-listed sponsor reverts)`. The red-team attack test above is marked `// RT-FINDING` and suffixed
`_RTFINDING` (CI filter: `forge test --no-match-test RTFINDING`); it must turn green with the fix.

## Builder notes (optional)

## Verification (red team)
