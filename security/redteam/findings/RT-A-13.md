---
id: RT-A-13
title: Idempotency-Key "same key, different body ⇒ 409" is recorded only after the first response: concurrent different bodies are both processed
module: services/api/src/middleware/idempotency.ts
threat: T-74
severity: Low
likelihood: L
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-lpa-idem.test.ts::one Idempotency-Key, two different bodies, concurrently ⇒ at most one processed_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-lpa-idem.test.ts -t "concurrently"
```

One client (IP), `Idempotency-Key: rt-same-key`, two `POST /card/redeem` with different PINs at once ⇒ `[201, 201]`.
Sequentially the second is `409` (control passes). `bodies.set(client, …)` happens only after a 2xx, and the in-flight set is
keyed by the full scope (which includes the body hash).

## Impact

AP12.2's property does not hold under concurrency. Each request is independently authorised (its own challenge and PIN), so
nothing is leaked or double-spent; Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Record `bodies.set(client, { bodyHash, … })` before `next()` (and delete it on a non-2xx), or key the in-flight set by `client`
(route ‖ key ‖ clientIp) rather than by the full scope.

## Builder notes (optional)

## Verification (red team)
