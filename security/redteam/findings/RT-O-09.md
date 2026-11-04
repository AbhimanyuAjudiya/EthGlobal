---
id: RT-O-09
title: decideGiftReclaim returns a zero-value refund when the fee is ≥ the amount paid (design)
module: packages/octroi/src/gift.ts
threat: T-71
severity: Low
likelihood: M
status: fixed
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-05T20:59+05:30
attack_test: packages/octroi/test/redteam/rt-topup-gift.test.ts::fee ≥ paid → deny, never a zero-value refund (a 0n transfer still costs the treasury gas and writes a gift-reclaim receipt)_RTFINDING
regression_test: packages/octroi/test/redteam/rt-topup-gift.test.ts::fee ≥ paid → deny, never a zero-value refund (a 0n transfer still costs the treasury gas and writes a gift-reclaim receipt) [RT-O-09] (+ packages/octroi/test/gift.test.ts::fee ≥ usd6 is nothing-to-refund)
fix_commit: (uncommitted, wave-1 octroi fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/octroi && npx vitest run test/redteam/rt-topup-gift.test.ts -t 'zero-value refund'
```

`decideGiftReclaim({ …eligible…, feeUsd6: 4_000_000n })` for a gift paid `4000000` ⇒ `{ kind: 'refund', usd6: 0n, feeUsd6: 4000000n }`
(README decision 10 left this open).

## Impact

The API would call `treasury.refund(to, 0n)`: the treasury pays gas (EVM) or a fee (Hedera; an HTS transfer of 0 may also be
rejected, leaving a pending `gift-reclaim` receipt) for nothing, and a `gift-reclaim` receipt + HCS message are written. An
attacker buying many minimum-price gifts (if `GIFT_RECLAIM_FEE_USD6` ≥ the minimum gift price) can make the treasury burn gas
per gift. Bounded and cheap to fix ⇒ Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Return `deny` with a new reason `'nothing-to-refund'` when `usd6 ≤ fee` (add it to `GiftReclaimVerdict` and INTERFACES §5;
API maps it to 409/410), or skip the transfer and write the receipt only. State the rule in the `/gift` copy.

Regression test to add (builder): `services/api/test/regression/T-71-reclaim.test.ts` (case: fee ≥ paid ⇒ no
`treasury.refund` call) and a unit case in `packages/octroi/test/gift.test.ts`.

## Builder notes (optional)

`GiftReclaimVerdict` deny reason `'nothing-to-refund'` when `max(fee, 0) ≥ usd6` (A-39); the API maps it to 410 `expired` in `RECLAIM_DENY_CODES` (no `treasury.refund`, no receipt). The suggested `services/api/test/regression/T-71-reclaim.test.ts` is the API builder's.

## Verification (red team)
