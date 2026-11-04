---
id: RT-A-05
title: A pending T-24 claim intent can be completed by anyone who knows the victim's session PUBLIC key, with no proof
module: services/api/src/middleware/octroi.ts
threat: T-24
severity: Low
likelihood: L
status: fixed
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-authz.test.ts::a stranger with only the victim’s session public key cannot complete the victim’s pending claim_RTFINDING
regression_test: services/api/test/redteam/rt-authz.test.ts::a stranger with only the victim’s session public key cannot complete the victim’s pending claim [RT-A-05] (+ services/api/test/regression/T-24-verified-claim-retry.test.ts::same session, another human’s valid proof…)
fix_commit: (uncommitted, wave-2 API fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-authz.test.ts -t "public session key"
```

1. Victim's claim: verify succeeds, `DataDrop.claim` fails (`ChainUnavailable`) ⇒ `503`, intent stored under
   `sessionPubKey`.
2. Attacker: `POST /challenge { sessionPubKey: <victim's public key> }` (no proof of possession), then `POST /claim` with a
   junk `device` proof for another signal ⇒ `201`; `personhood.verify` is never called. The victim's own retry is then
   `409 replay`.

## Impact

The sealed LPA is still sealed to the victim's key, so the attacker cannot read it, but the victim's single delivery is
consumed by someone else's request: the victim proved once and receives nothing (T-24 / T-31 single delivery). Requires the
victim's session public key, which is only sent to the API (TLS), hence Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Bind the resume to something only the victim has: require the original challenge nonce (returned to the victim in the 503
body as an opaque `intentId`) or a signature by the session key over the new challenge; or at least require the resumed
request's proof to verify-or-replay for the same nullifier (`nullifier_replayed` from the verifier for the stored
`quotaKey`).

## Builder notes (optional)

A T-24 intent is bound to the human, not just the session public key: it stores `HMAC(secret,'intent'‖nullifier)` and the first attempt's signal. A resume requires (1) a proof naming the same nullifier and (2) the verifier accepting it as that human — fresh, or `already_verified` (the one-time proof was spent on the first attempt) — bound to the new challenge's signal or the first one's. Anything else falls through to the normal lane, which judges the proof on its own (a junk proof ⇒ 401, another human ⇒ their own claim), and the victim's intent is untouched. Only the served human's intent is cleared. Note: the resume now calls `personhood.verify` once (expecting `already_verified`), so two builder tests that pinned "verify is not called on retry" were updated (`test/attack/cap-race.attack.test.ts`, `test/regression/T-24-verified-claim-retry.test.ts`); the World cloud verifier must answer `nullifier_replayed` only after checking the proof **[verify Wed]**.

## Verification (red team)
