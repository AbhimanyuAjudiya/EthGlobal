---
id: RT-A-17
title: A free claim served on-chain whose 202 never reached the client (64.5 s, browser timed out, memory-only session key gone) is undeliverable forever and the human's one claim is refused as replay
module: services/api/src/middleware/octroi.ts (rebindPending); services/api/src/flows/fulfil.ts (pendingResponse, retryPending)
threat: T-24 (and T-60)
severity: High
likelihood: M
status: fixed
found_by: orchestrator (live pre-deploy, real Orb claim 2026-11-05 18:53 IST)
owner: builder-api
found_at: 2026-11-05T18:53+05:30
due: 2026-11-05T22:53+05:30
attack_test: 'services/api/test/regression/T-24-claim-rebind.test.ts::the same human from a new session: the same 202 and plan key, the LPA then seals to the new key only (red at 606f0b8: 409 replay; the live claim of 18:53 IST is the original repro)'
regression_test: 'services/api/test/regression/T-24-claim-rebind.test.ts (4 cases: re-bind to a new session key and the LPA seals to it only; sealed ⇒ replay and the target does not move; another human on the same session key is judged on their own; ≤ 3 re-binds an hour); services/api/test/regression/T-24-verified-claim-retry.test.ts and test/claim.test.ts::same proof twice → 409 replay stay green'
fix_commit: e4a8f87 (cherry-picked from the worktree commit d7f9360)
verified_at:
duplicate_of:
sign_off:
---

## Repro

Live API, 2026-11-05 18:53 IST, a real Orb-verified IDKit 4 claim: `POST /claim` → `decision: serve-free` → `claimOnChain`
mined `Claimed` (`0xc47edbd7…`) → `fulfil()` wrote the entitlement, `reseller.order` failed (vendor balance 0) ⇒
`pending-profile` → the API answered **202 after 64.5 s**. The browser's request had timed out long before: the client
never saw the plan key, and `apps/web/lib/session-key.ts` (memory only, T-60) was the only key the pending LPA would ever
be sealed to. Reloading the page makes a new keypair; the human proves again (a fresh IDKit result for the new challenge);
the verifier answers `nullifier_replayed` (one-time uniqueness proof, API-FACTS §4.5) ⇒ `verifyPerson` ⇒
`deny: replay` (409) — and with a permissive verifier `alreadyServed` denies the same. The `serveFree` guard in
`flows/entitle.ts` is never reached. The T-24 `intents` retry covers only a chain step that failed _after_ verify; a
claim that _succeeded_ and then lost its response has no path back.

```sh
cd services/api && npx vitest run test/regression/T-24-claim-rebind.test.ts   # red at 606f0b8: 409 replay on the second claim
```

## Impact

The sponsor paid (`Claimed` mined, budget spent), the human's one free claim for the campaign is spent (the World proof is
one-time per (action, user) and the ledger claim locks hold), and nothing can ever deliver the bundle: the pending
delivery's target is a public key whose secret no longer exists anywhere. Every slow reseller or RPC round (the 64.5 s
here was a 60 s eSIM Access poll plus a Hedera receipt) that crosses the browser's timeout burns a human permanently.
High: a verified human loses the product's core promise; M: it needs a lost response on a served claim, which the live
latencies make routine rather than rare.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Treat "served but undelivered" like the T-24 intent: when a `/claim` carries a proof of the SAME nullifier for the SAME
campaign and that human's entitlement (`freeEntitlementKey(secret, campaign, nullifier)`) is still `pending-profile` with
a pending delivery, re-bind the delivery target (`PendingDelivery` = session key + challenge nonce) to the new request —
after consuming the new challenge and letting the verifier judge the proof (fresh, or `already_verified`, RT-A-05) —
and answer exactly the original 202 (plan key, `pending-profile`, claim receipt). Refuse with `replay` once the LPA is
sealed (`ready`/`installed`/`active`: the first session owns it, T-60/T-31) and for any other nullifier. Under the
entitlement's mutex, idempotent, ≤ 3 re-binds an hour per entitlement.

## Builder notes (optional)

Done as proposed. `rebindPending` in `middleware/octroi.ts` runs before `resumeIntent`/`decide()` because that is
where the refusal actually happens (`verifyPerson` → `deny: replay`); the common case costs one HMAC — the ledger is read
only when `deps.pendingDelivery` (durable, keyed by the entitlement key) holds an entry for this human's key, which it
does for the 18:53 IST claim too, so the fix applies to it without a migration. The verifier judgement is shared with
`resumeIntent` (`sameHuman`). `retryPending` (the `/me` and boot order retry) now takes the same mutex, so an order in
flight cannot seal to a key the re-bind has just replaced. The 202 is rebuilt from the ledger (`pendingResponse`: the
entitlement row and its `claim` receipt) through the same `entitledBody` builder `fulfil()` uses, so the body does not
gain a field and `openapi.json` is unchanged; the audit trail is the `claim.rebind` log event (campaign id only, T-50).
The limiter is `deps.rebinds` (`WindowLimiter(3, 1 h)`), 429 `rate_limited` with `retryAfterS`. Not covered here: the
gift/card lanes (`flows/gift.ts`, being edited in parallel — their once-only `gift-delivered` marker has the same shape of
gap for a lost 202) and README AP6.3 (no route delivers a pending LPA sealed by a later retry; this fix makes that
delivery target the live session, AP6.3 still has to hand the box over).
