---
id: RT-O-07
title: Input-boundary gaps — untyped throws (RangeError/TypeError), a throw after verify, and shouldTopUp / decide trusting unvalidated numbers (cap bypass on a non-positive price)
module: packages/octroi/src
threat: T-30
severity: Low
likelihood: L
status: fixed
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-05T20:59+05:30
attack_test: packages/octroi/test/redteam/rt-topup-gift.test.ts::a non-positive stepPriceUsd6 (%s) is refused, not a buy that bypasses the cap_RTFINDING
regression_test: packages/octroi/test/redteam/rt-topup-gift.test.ts::a non-positive stepPriceUsd6 (%s) is refused, not a buy that bypasses the cap [RT-O-07] (+ six other [RT-O-07] cases in rt-challenge/rt-fuzz/rt-topup-gift; packages/octroi/test/regression/redteam-wave1.test.ts::RT-O-07)
fix_commit: (uncommitted, wave-1 octroi fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/octroi && npx vitest run test/redteam -t '(RangeError|TypeError|non-positive|NaN|hostile|non-hex32).*_RTFINDING'
```

ARCHITECTURE §9 rule 2: octroi "throws `RechargeError('invalid_request')` only for malformed input". Today:

| Call                                                                                          | Result                                                                                          | Test                                                                         |
| --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `challenge('x'.repeat(256), …)`                                                               | `RangeError('challenge field too long')`                                                        | `rt-challenge.test.ts`                                                       |
| `challenge(…, now = NaN / 1.5 / Infinity, …)`                                                 | `RangeError` from `BigInt()`                                                                    | `rt-challenge.test.ts`                                                       |
| `decide({ payment: null })`                                                                   | `TypeError` (reads `payment.accepted`)                                                          | `rt-fuzz.test.ts`                                                            |
| verifier returns a non-hex32 `nullifierHash`                                                  | `RechargeError(invalid_request)` thrown **after** `verify` (verification burned, user sees 400) | `rt-fuzz.test.ts`                                                            |
| `shouldTopUp(e, p, spent = cap, now, stepPrice = 0n / −400000n)`                              | `{ buy: true }` past the cap                                                                    | `rt-topup-gift.test.ts`                                                      |
| `shouldTopUp(e(expired), …, now = NaN, …)`                                                    | `{ buy: true }` (both expiry comparisons are false for NaN)                                     | `rt-topup-gift.test.ts`                                                      |
| `decide()` with `campaign.validityDays = 0`, `claimsPerHour ≤ 0`, fractional `claimsThisHour` | `serve-free` with `expiresAt == now`; cap comparison slips                                      | `rt-fuzz.test.ts` (fast-check counterexample `[-1, 0, -1.0000000000000002]`) |

(The hybrid-payload `TypeError` is RT-O-02.) Every other export fuzzed with `fc.anything()` settles and throws only `Error`s
(passing `rt-fuzz.test.ts` cases), and `consumeChallenge(anything)` never throws or accepts.

## Impact

500s instead of 400/deny; a wasted World verification; and an agent whose step price comes from a bad source (T-57) is not
protected by its own cap. Inputs normally come from validated stores/env, hence Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

- `challenge()`: validate `audience`/`path` byte length and `Number.isSafeInteger(now) && now ≥ 0`; throw `RechargeError('invalid_request')`.
- `decide()`: guard `typeof req.payment === 'object' && req.payment !== null` (and `proof`); map a key-derivation failure
  after `verify` to `deny('invalid-proof', 'verifier_nullifier')`.
- `decide()` free lane: validate the `Campaign` with `campaignSchema`-equivalent bounds (or accept only `Campaign` built by
  `campaignFromPayload`) and require integer, non-negative counters.
- `shouldTopUp`: `stepPriceUsd6 > 0n`, `spentTodayUsd6 ≥ 0n`, `Number.isFinite(now)` else `{ buy: false, reason: 'ok' }`
  (or throw `invalid_request`).

Regression test to add (builder): `packages/octroi/test/regression/T-30-should-topup.test.ts` (non-positive price, NaN now)
plus the typed-throw cases next to the existing unit tests.

## Builder notes (optional)

`challenge()` throws `RechargeError('invalid_request')` for a > 255-byte field or a clock that is not a non-negative safe integer; `consumeChallenge` returns `'invalid'` for such a clock (NaN used to pass both comparisons). `decide()`: non-object request/payment/proof ⇒ `deny invalid-request`; the campaign is validated with `campaignToPayload` (validityDays 0, claimsPerHour ≤ 0, NaN ⇒ `invalid-request 'campaign'`), counters must be integers/bigints ≥ 0 (`'counters'`), both before the nonce is consumed; a malformed verifier nullifier ⇒ `invalid-proof 'verifier_nullifier'` (no throw after verify). `shouldTopUp`: step price ≤ 0, spent < 0 or non-finite `now` ⇒ `{ buy: false, reason: 'ok' }` (A-41).

## Verification (red team)
