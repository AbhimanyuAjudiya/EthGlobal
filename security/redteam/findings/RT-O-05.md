---
id: RT-O-05
title: One payment can be served twice — decide() has no in-flight/settled dedupe and SelfRunFacilitator's front-run recovery answers success to a concurrent duplicate (MockPaymentRail does not model it)
module: packages/octroi/src/decide.ts
threat: T-27
severity: Med
likelihood: M
status: fixed
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-05T20:59+05:30
attack_test: packages/octroi/test/redteam/rt-payment.test.ts::two concurrent decide() with the SAME signed payment serve at most once (front-run-recovering rail)_RTFINDING
regression_test: packages/octroi/test/redteam/rt-payment.test.ts::two concurrent decide() with the SAME signed payment serve at most once (front-run-recovering rail) [RT-O-05] (+ the Hedera case; packages/octroi/test/regression/redteam-wave1.test.ts::RT-O-05 / T-15)
fix_commit: (uncommitted, wave-1 octroi fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/octroi && npx vitest run test/redteam/rt-payment.test.ts -t 'one payment, two serves'
```

1. Rail stub with `SelfRunFacilitator.settle` semantics (`packages/adapters/src/live/self-run-facilitator.ts` lines 88–93:
   `nonce_already_used ∧ matching Transfer ⇒ { success: true, transaction: <found tx> }`, the T-15 recovery).
2. `Promise.all([decide(pay), decide(pay)])` with the **same** signed payment: both `verify` before either settles; the
   first `settle` submits, the second finds the executed authorization and returns success with the same tx ⇒ **two
   `serve-paid`, one on-chain transfer**.
3. Hedera: a facilitator that answers success for a re-submitted, already-executed transaction gives two `serve-paid` with
   the identical tx and entitlement key (second `_RTFINDING` case).
4. Passing beside them: sequential replay → `nonce_already_used` at verify; `MockPaymentRail` concurrent → one serve (it burns
   the nonce in settle and does not recover front-runs — a mock/live parity gap).

## Impact

For a new purchase the second serve collides on `paid:<payer>:<nonce>` at `EntitlementStore.create` (replay) — unless the
create race of RT-O-03 lets both through. For a **top-up** the API ignores the returned key and patches the existing
entitlement (README "Top-ups"; ARCHITECTURE §2.2 step 5): `mbTotal` is incremented twice for one payment; the reseller
idempotency key (`nonce`) delivers once, so the ledger over-states the balance (the agent's threshold logic then under-buys),
or, with any reseller that ignores the key, the operator delivers two steps for one payment. Bounded per payment ⇒ Med.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

1. In `paidLane`, before `payments.verify`, reserve the payment synchronously in a per-process set keyed by
   `network:from:nonce` (EVM) / `network:sha256(transaction)` (Hedera) — same pattern as the nonce cache — and deny
   `invalid-payment (in_flight)` on a second arrival; release on deny, keep on serve.
2. Document that the API must write the `keys.receipt(network, tx)` receipt with `create` (replay on duplicate) **before**
   `reseller.topUp` / `EntitlementStore.patch`, so the ledger is the cross-process guard.
3. Give `MockPaymentRail` the front-run recovery path so local tests see the live behaviour.

Regression test to add (builder): `packages/octroi/test/regression/T-27-serve-after-settle.test.ts` (case: concurrent
duplicate payment with a front-run-recovering rail ⇒ exactly one `serve-paid`).

## Builder notes (optional)

Settlement marker (A-33): after a successful settle, `decide()` creates-if-absent `claim:HMAC(secret,'settle'‖network‖tx)` (lifetime RECEIPT_TTL_S) before `serve-paid`; a second request for the same transaction — concurrent, sequential or cross-process — is denied (`invalid-payment 'nonce_already_used'` if verify had said so, else `replay 'settlement'`). Chosen: deny, not "the same entitlement again", because the top-up path ignores the returned key. Combined with the coordinator's T-15 item: verify `nonce_already_used` now continues to `settle()` so a front-run human is served exactly once (API test `x402.attack.test.ts` front-run case flipped to 200 then 402). MockPaymentRail still has no recovery path (stricter locally; noted in octroi README Decision 14).

## Verification (red team)
