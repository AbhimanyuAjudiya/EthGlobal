---
id: RT-A-05
title: A pending T-24 claim intent can be completed by anyone who knows the victim's session PUBLIC key, with no proof
module: services/api/src/middleware/octroi.ts
threat: T-24
severity: Low
likelihood: L
status: open
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

**2026-11-04 — redteam-verify (Claude): REOPENED.** The named regressions pass (a junk proof for the SAME campaign is judged
and refused, the intent survives — also the control in the variant file). A junk request for ANOTHER campaign id deletes the
victim's intent before any proof is checked.

### Repro (verification variant)

```sh
cd services/api && npx vitest run test/redteam/verify-rt-a-04-05-06-authz.test.ts -t 'RT-A-05'
```

1. Victim claims; verify succeeds, the DataDrop step fails (503) ⇒ T-24 intent stored under the victim's session public key.
2. Stranger (knows only the PUBLIC session key) gets `POST /challenge` for that key and sends `POST /claim` with a junk proof and
   `campaignId = 0xdede…de` (any id, registered or not).
3. `resumeIntent` (`src/middleware/octroi.ts:184`): `intent.campaignId !== lane.campaignId` ⇒ **`deps.intents.delete(spk)`**,
   before the proof tag / verifier checks; the request itself is refused.
4. The victim's retry (same session, same proof) now takes the normal lane ⇒ **`409 replay` (`already_verified`)**: the one-time
   World proof is burned with no recovery — the exact T-24 harm the intent exists to prevent.

Failing test (marked `// RT-FINDING`, suffixed `_RTFINDING`):
`services/api/test/redteam/verify-rt-a-04-05-06-authz.test.ts::junk /claim for another campaign id with the victim’s session key ⇒ the victim still completes_RTFINDING`.

Impact: targeted denial of a verified human's claim for the cost of one challenge; the property RT-A-05 asked for ("completing
or touching a pending claim needs something only the victim has") is broken for cancellation. (Severity unchanged — the lead
may want Med given RT-A-03's rubric for burned verifications.)

Suggested fix: on a campaign mismatch return `undefined` without deleting (let the intent expire by TTL), or delete only after
the proof tag matches and the verifier accepts the proof as that human.
