---
id: RT-A-13
title: Idempotency-Key "same key, different body ⇒ 409" is recorded only after the first response: concurrent different bodies are both processed
module: services/api/src/middleware/idempotency.ts
threat: T-74
severity: Low
likelihood: L
status: verified
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-lpa-idem.test.ts::one Idempotency-Key, two different bodies, concurrently ⇒ at most one processed_RTFINDING
regression_test: services/api/test/redteam/rt-lpa-idem.test.ts::one Idempotency-Key, two different bodies, concurrently ⇒ at most one processed [RT-A-13]
fix_commit: (uncommitted, wave-2 API fix pass; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
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

The in-flight lock is keyed by client (route ‖ Idempotency-Key ‖ client IP), not by the full scope, and remembers the holder's body hash: a concurrent request with the same key is 409 (`in_flight` for the same body, `idempotency_key_reused` for another). `src/middleware/idempotency.ts`.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `rt-lpa-idem.test.ts` `[RT-A-13]` passes. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): nine concurrent `/card/redeem` with one Idempotency-Key from one client — six different PINs plus three repeats of one — ⇒ exactly one 201, the rest 409.

```sh
cd services/api && npx vitest run test/redteam/verify-rt-a-11-13-state-idem.test.ts -t RT-A-13
```
