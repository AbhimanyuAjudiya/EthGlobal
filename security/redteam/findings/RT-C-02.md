---
id: RT-C-02
title: Campaign id squatting: a predictable or mempool-visible id can be taken forever on attacker terms
module: packages/contracts/src/DataDrop.sol
threat: T-04
severity: Med
likelihood: M
status: verified
found_by: redteam-contracts
owner: builder-contracts
found_at: 2026-11-04T02:45+05:30
due: 2026-11-05T20:59+05:30
attack_test: packages/contracts/test/redteam/RT_DataDrop.t.sol::test_RT_IdSquatBlocksIntendedSponsor_RTFINDING
regression_test: packages/contracts/test/regression/T04_CampaignIdHijack.t.sol::test_Regression_RTC02_SquatterCannotPreemptScopedId
fix_commit: (uncommitted, wave-1 fix pass; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/contracts && forge test --match-test test_RT_IdSquatBlocksIntendedSponsor_RTFINDING -vvv
```

1. Stranger (1 base unit of USDC): `createCampaign(keccak256("demo-welcome-2"), 1, 1, type(uint32).max, type(uint64).max)`.
2. Sponsor: `createCampaign(keccak256("demo-welcome-2"), 500_000_000, 500_000, 5, now + 7 days)` → `CampaignExists()`.
3. `campaigns(id)` now describes the squatter's campaign forever (ids are never reusable, the squat never expires).

## Impact

T-04's fix (no overwrite) holds — `test_RT_SameIdTwoSponsorsFirstKeepsControl` is green. But "first come, first
served, never reusable" turns any **predictable** id (`keccak256("demo-welcome")`, the shipped demo id) or any id seen in a
pending `createCampaign` (public mempools on Base Sepolia / Hedera relay) into a permanent DoS for the intended sponsor for
the cost of 1 base unit + gas. Worse, any off-chain component that is configured with an id and trusts `campaigns(id)`
(price, cap, budget) without checking `sponsor` will use the squatter's terms (e.g. `pricePerClaim = 1` → the service serves a
verified human for $0.000001).

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Namespace ids by sponsor on-chain: store under `keccak256(abi.encode(msg.sender, id))` (and expose that derivation),
or require `address(bytes20(id)) == msg.sender` (sponsor-prefixed ids). Off-chain mitigation regardless: the API/seed must pin
`(id, sponsor)` pairs and reject a campaign whose `sponsor` differs. Update INTERFACES §6.1 if the id derivation changes.

Regression test to add (builder): `packages/contracts/test/regression/T04_CampaignIdHijack.t.sol (case: squatter cannot pre-empt another sponsor's id)`. The red-team attack test above is marked `// RT-FINDING` and suffixed
`_RTFINDING` (CI filter: `forge test --no-match-test RTFINDING`); it must turn green with the fix.

## Builder notes (optional)

Sponsor-scoped ids: `scopedCampaignId(sponsor, uint64 salt) = sponsor(20 bytes) ‖ 0x00000000 ‖ salt(8)`. A scoped id can be created only by its sponsor (anyone else gets `NotSponsor()`), so it cannot be squatted or front-run. Unscoped ids (e.g. keccak) keep the old rule (first come, never reusable, never overwritten), which keeps the red-team suite's raw-id fixtures valid. Production campaigns and the demo seed must use scoped ids, and the API pins `(id, sponsor)` and rejects a campaign whose `sponsor` differs (INTERFACES §6.1 note). The attack test is adapted to the fix (the squat itself now reverts). More cases: `T04_CampaignIdHijack.t.sol` (layout, fuzz only-own-sponsor, unscoped first-come, LEDGER_ONLY). The red-team `_RTFINDING` test was moved from `test/redteam/` to the regression above, adapted to assert the fixed behaviour; a comment marks its old place.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `T04_CampaignIdHijack.t.sol::test_Regression_RTC02_SquatterCannotPreemptScopedId` + fuzz cases pass. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): crafted-salt collisions: fuzzed `(a, saltA) ≠ (b, saltB)` never collide across sponsors (512 runs); salt calldata with dirty high bits reverts (no truncation onto another sponsor's id); a look-alike id (victim prefix + salt, non-zero marker) is a different, unscoped id and never blocks the victim's scoped one; ids scoped to address(0) are uncreatable.

```sh
cd packages/contracts && forge test --match-path test/regression/verify-RTC02_ScopedIdCollision.t.sol
```
