---
id: RT-A-07
title: x402 v1 field filter is a byte regex: a JSON \u escape smuggles "maxAmountRequired" past it and the payment is served
module: services/api/src/middleware/x402.ts
threat: T-28
severity: Low
likelihood: L
status: fixed
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-payment.test.ts::"maxAmount\\u0052equired" inside accepted ⇒ 400, never served_RTFINDING
regression_test: services/api/test/redteam/verify-rt-a-07-v1-depth.test.ts::v1 key in extensions nested 40 deep ⇒ not served, not settled [RT-A-07] (+ ::any payment JSON deeper than 16 levels ⇒ 400 before settle, v1 key or not; 16 levels still served [RT-A-07], ::v1 key spelled with … ⇒ 400 after normalisation [RT-A-07] ×3); earlier regressions (still green): services/api/test/redteam/rt-payment.test.ts::"maxAmount\\u0052equired" inside accepted ⇒ 400, never served [RT-A-07]
fix_commit: (uncommitted, verification fix pass 2026-11-04; orchestrator commits)
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

The v1-field refusal runs on the parsed JSON, after the protocol codec has accepted the header: any object at any depth (bounded) with the v1 amount as an OWN key ⇒ 400, so a `\u`-escaped spelling is the same key. The v1 name still never appears as a literal in app code (pattern). `src/middleware/x402.ts`.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): REOPENED (Low).** The named regression passes, and so do escaped v1 keys at the top
level, in `payload`, `payload.authorization`, `accepted.extra`, `extensions` (objects and arrays), under an own `__proto__`
container and 31 levels deep (`verify-rt-a-07-v1-depth.test.ts`). Deeper than 32 levels the key is not seen.

### Repro (verification variant)

```sh
cd services/api && npx vitest run test/redteam/verify-rt-a-07-v1-depth.test.ts -t 'nested 40'
```

A valid top-up `PAYMENT-SIGNATURE` with `"extensions":{"x":{"n":{"n":…40 levels…{"maxAmountRequired":"400000"}}}}` added
⇒ **200, settled**. `hasV1Field` returns `false` once `depth > 32` (`src/middleware/x402.ts:27`); its comment says "depth is
bounded by the codec's 16 KiB cap", but 16 KiB allows thousands of levels. `extensions` is `z.record(z.string(), z.unknown())`,
so the payload parses and the v1 field is silently dropped — the outcome A-18 says must be a refusal.

Failing test (marked `// RT-FINDING`, suffixed `_RTFINDING`):
`services/api/test/redteam/verify-rt-a-07-v1-depth.test.ts::v1 key in extensions nested 40 deep ⇒ not served, not settled_RTFINDING`.

Impact: Low — nothing downstream reads the dropped key today; it defeats the "refuse outright" policy the fix implements.

Suggested fix: treat exceeding the depth bound as a refusal (`depth > 32 ⇒ 400 too deep`) rather than "no v1 field", or walk
iteratively with no bound (the 16 KiB cap already bounds the work).

## Builder notes (verification fix pass)

`paymentJsonViolation` (src/middleware/x402.ts) walks the parsed header iteratively (no recursion, no silent cut-off): any container deeper than `MAX_PAYMENT_JSON_DEPTH = 16` ⇒ 400 `PAYMENT-SIGNATURE nested too deep`; the v1 field filter compares every own key after full normalisation (JSON escapes undone by the parse, NFKC, `\p{Cf}` stripped, lower-cased) ⇒ 400. Runs after the codec's 16 KiB cap, before decide()/settle.
