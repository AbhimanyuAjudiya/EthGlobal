---
id: RT-A-02
title: The per-ICCID daily top-up cap is checked before settle without a reservation: N concurrent payments all pass
module: services/api/src/routes/claim.ts
threat: T-30
severity: Low
likelihood: M
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-races.test.ts::TOPUPS_PER_ICCID_PER_DAY=2: five concurrent paid top-ups settle at most 2_RTFINDING
regression_test:
fix_commit:
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

## Verification (red team)
