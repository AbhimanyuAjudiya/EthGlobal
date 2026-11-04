---
id: RT-A-03
title: Admission is sized to the hourly cap only: a burst against the remaining sponsor BUDGET verifies every human and burns the losers' one-time World proofs
module: services/api/src/middleware/octroi.ts
threat: T-24
severity: High
likelihood: M
status: verified
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-04T19:05+05:30
attack_test: services/api/test/redteam/rt-races.test.ts::budget for 3 claims, 10 concurrent humans ⇒ verify ≤ 3 and the rest refused before verify_RTFINDING; services/api/test/redteam/rt-anvil.test.ts::on-chain budget for 3 claims, 8 concurrent humans ⇒ verify ≤ 3_RTFINDING
regression_test: services/api/test/redteam/rt-races.test.ts::budget for 3 claims, 10 concurrent humans ⇒ verify ≤ 3 and the rest refused before verify [RT-A-03]; services/api/test/redteam/rt-anvil.test.ts::on-chain budget for 3 claims, 8 concurrent humans ⇒ verify ≤ 3 [RT-A-03] (+ services/api/test/regression/T-24-verified-claim-retry.test.ts::budget burst…, ::a BudgetExhausted revert after verify keeps the intent…)
fix_commit: (uncommitted, wave-2 API fix pass; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
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

Admission is budget-aware: `slots = min(claimsPerHour − claimsThisHour, ⌊(budget − spent) / price⌋) − inFlight − commitsSince(read)`, computed synchronously from the `campaignState` already fetched; no slot ⇒ 409 `budget_exhausted` (or 429 `hourly_cap` when the hour binds) BEFORE `decide()` can verify. A mined claim releases its slot as a commit (`claimOnChain`), so a request that read the counters before it still counts it. Defence in depth: `BudgetExhausted` after verify is now retryable — the T-24 intent is kept and the same human completes after a budget top-up without re-proving. `src/middleware/octroi.ts` (`admit`), `src/admission.ts`, `src/flows/entitle.ts`.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `rt-races.test.ts` / `rt-anvil.test.ts` `[RT-A-03]` and the T-24 budget cases pass. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): through the real API on Anvil (`X402_FACILITATOR=self`): budget for 3 claims, 12 concurrent humans of mixed tiers (orb / document / device) while the sponsor's on-chain `pause(id, true)` races the burst (pause landing at 0 / 60 / 400 / 1 500 ms), 4 rounds, run 3×: ≤ 3 orb/document humans verified, no verification burned (every verified-but-unserved free human holds a T-24 intent — `CampaignPaused` and chain-unavailable both kept), and after unpause every holder completes with its first proof, total serves ≤ 3. (A device-tier human may be verified on a released slot; it is offered the paid lane, not a free claim.)

```sh
cd services/api && npx vitest run test/redteam/verify-rt-a-03-anvil.test.ts   # real DataDrop on Anvil
```
