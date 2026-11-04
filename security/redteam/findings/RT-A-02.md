---
id: RT-A-02
title: The per-ICCID daily top-up cap is checked before settle without a reservation: N concurrent payments all pass
module: services/api/src/routes/claim.ts
threat: T-30
severity: Low
likelihood: M
status: fixed
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-races.test.ts::TOPUPS_PER_ICCID_PER_DAY=2: five concurrent paid top-ups settle at most 2_RTFINDING
regression_test: services/api/test/redteam/rt-races.test.ts::TOPUPS_PER_ICCID_PER_DAY=2: five concurrent paid top-ups settle at most 2 [RT-A-02] (+ services/api/test/regression/T-27-topup-race.test.ts::a refused or failed top-up frees its slot…, ::Admission: a commit after the counter read…)
fix_commit: (uncommitted, wave-2 API fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-races.test.ts -t "five concurrent"
```

`TOPUPS_PER_ICCID_PER_DAY=2`; five signed payments sent at once ⇒ `settle` called 5×, five `200`s. Sequentially the third is
`429 daily_cap` before settle (control case passes). `topUpGuard` counts today's receipts, which are written only after
settle, so every in-flight request sees the same count.

## Impact

The server-side daily cap (the safety net behind a runaway agent, INTERFACES §7 "429 daily_cap before settle") does not hold
under concurrency. Each payment was authorised by its payer, so the loss is bounded by what the payer signed; the agent's own
cap still applies. Hygiene/defence-in-depth.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Reserve a slot synchronously before settle (an in-process counter per `iccidHash` and UTC day, like `Admission`), release it
when the request fails before settlement, and keep the receipt count as the cross-process floor.

## Builder notes (optional)

`topUpGuard` takes a synchronous reservation (`Admission.take('topup:<sha256(key)>:<day>', cap, receiptsToday, mark)`) before any 402 or settlement. A slot is released when the request ends; a served (200) top-up is recorded as a commit, which is still subtracted from any request whose receipt read began before it. The ledger receipts stay the cross-process floor. Shared with RT-A-03 (one primitive, `src/admission.ts`).

## Verification (red team)
