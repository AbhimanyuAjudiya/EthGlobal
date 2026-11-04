---
id: RT-A-07
title: x402 v1 field filter is a byte regex: a JSON \u escape smuggles "maxAmountRequired" past it and the payment is served
module: services/api/src/middleware/x402.ts
threat: T-28
severity: Low
likelihood: L
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-payment.test.ts::"maxAmount\\u0052equired" inside accepted ⇒ 400, never served_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-payment.test.ts -t "u0052"
```

A valid top-up `PAYMENT-SIGNATURE` with `"maxAmount\u0052equired":"400000"` inserted into `accepted` ⇒ `200` (settled). The
literal spelling is refused with `400` before settle (control passes). `V1_AMOUNT` runs over the decoded bytes, the codec's
zod parse strips the key, and `sameRequirements` compares the stripped object.

## Impact

A-18 says a v1 field is refused outright; it is silently dropped instead. No money impact (amount, payTo, asset are still
exact), so Low — but the rule is enforced by spelling, not by structure.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Check the parsed JSON, not the bytes: `JSON.parse(decoded)` once in the middleware and refuse if `accepted` (or the root) has
own key `maxAmountRequired`, or make the protocol schema `strictObject` for `accepted` so any unknown key fails the parse.

## Builder notes (optional)

## Verification (red team)
