---
id: RT-W-13
title: 'A successful slow claim renders as a network error: the web client timed every API call out at 30 s while /claim runs the chain claim and the eSIM order (a live Orb claim answered 202 after 64.5 s), so the traveller saw "check your connection", a Try again that re-claims, and never got the plan key'
module: apps/web/lib/api.ts (call timeoutMs); apps/web/components/VerifySheet.tsx (claim / phaseFor); apps/web/lib/pay402.ts (fetchWithPayment timeoutMs)
threat: T-25, T-40
severity: Med
likelihood: H
status: fixed
found_by: orchestrator (live pre-deploy)
owner: builder-web
found_at: 2026-11-05T18:53+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/api.test.ts::a 202 that lands after 64.5 s is a success
regression_test: 'apps/web/test/api.test.ts::/claim, /card/redeem and /gift/claim get ENTITLE_TIMEOUT_MS (≥ 120 s); a cheap call keeps 30 s; apps/web/test/verify-sheet.test.tsx::a 202 (profile pending) is delivered like a 201 and routes to the plan page / a claim request that dies (timeout, network) says the claim may have gone through and offers "Check my plans", not "Try again" / past 10 s the Checking line says what is running and that it takes a while'
fix_commit: (this commit: web entitling-route timeout, 2026-11-05)
verified_at:
duplicate_of:
sign_off:
---

## Repro

Observed 2026-11-05 18:53 IST on the real stack, one Orb-verified IDKit claim on `/verify`:

```text
API   POST /claim → decision serve-free → DataDrop.claim mined (Claimed) → reseller order failed (vendor balance 0)
      → entitlement written as pending-profile (T-25) → 202 { entitlementKey, status: 'pending-profile', claimTx, … }
      after 64.5 s
web   lib/api.ts call(): httpJson(…, { timeoutMs: 30_000 }) for EVERY route → AbortSignal.timeout fires at 30 s
      → HttpError(0, 'timeout') → ApiError(0, 'network') → VerifySheet phaseFor() → { kind: 'closed', retryS: 30 }
      → "Can't reach Recharge. Check your connection. Can't verify right now · retry in 30 s" + [Try again]
```

Unit repro (no stack): `apps/web/test/api.test.ts` — a mocked `fetch` that answers 202 after a 64.5 s fake-timer delay
must resolve `api.claim()` with the key and `status: 'pending-profile'`; before the fix the 30 s timeout rejected it.

## Impact

Availability / UX on the free lane, at the moment the sponsor has already paid: `Claimed` is on-chain, the human's
one-time World verification is consumed (T-24), the API has the plan — and the traveller is told to check their
connection. "Try again" re-runs `/challenge` + IDKit; a second proof from the same human is refused (`already_claimed`),
so the copy invites a dead end. `deliver()` and `/plan` already handled the 202 shape (no `sealedLpa` → `endSession()`,
Coupon status `plan.pendingProfile`): the key was lost purely in the transport layer. The paid lanes had the same
shape: `pay()` left `fetchWithPayment` on its 30 s default while the API waits for the settlement receipt and the
reseller order before answering 200/201, so a slow paid top-up could render as a network error after the USDC moved.

The API's own per-step budgets for an entitling route (services/api/src/chain.ts, flows/entitle.ts, flows/fulfil.ts,
packages/adapters/src/live/esimaccess-reseller.ts): DataDrop `claimed` read ≤ 20 s (viem http 10 s, retryCount 1),
`simulateContract` ≤ 20 s, `writeContract` 20 s (retryCount 0), `waitForTransactionReceipt` (2 s polls, viem cap
180 s; seconds on Hedera/Base), reseller `/esim/order` 10 s + `/esim/query` polls for ≤ 30 s (10 s each), then the
Arkiv create/patch + receipt + HCS writes. Nominal sum ≈ 120 s before the receipt wait; the client allowed 30 s.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Raise the client timeout of the entitling routes to the API's budget plus margin without touching the cheap calls;
treat 202 exactly like 201; show what is running once the claim is slow; and, when the request dies after the proof
left, say the claim may have gone through and offer the plan list instead of a re-claim.

## Builder notes

`lib/api.ts`: `ENTITLE_TIMEOUT_MS = 180_000` (the nominal 120 s budget + margin; the receipt wait is the one piece the
API does not bound below viem's 180 s) and a `timeoutMs` option on `call()`; `/claim`, `/card/redeem`, `/gift/claim`
pass it, everything else keeps 30 s (`AbortSignal.timeout` is still the abort). `lib/pay402.ts pay()` passes the same
value to `fetchWithPayment`. `VerifySheet`: past `SLOW_CLAIM_MS` (10 s) the status line reads
`verify.checkingLong` ("Claiming on-chain and preparing your eSIM · N s · this can take a minute"); the 201/202 path is
unchanged (`deliver()` → `/plan/<key>`, which shows `plan.pendingProfile`); a `network` error from the claim request
(timeout or a dropped socket, never a 4xx/5xx the API did answer) is the new `unconfirmed` state — `verify.unconfirmed`
("… Your claim may still have gone through on our side. Check your plans before trying again — the same World ID can't
claim twice.") with one link, `verify.checkPlans` → `/plan` — and no "Try again". i18n keys appended to en/hi/mr.

Residual (API side, not fixed here): when the socket really drops after the API served, the key exists only on the
API; `/plan` on that device has nothing to open until the key can be recovered by session pubkey (or returned in the
`already_claimed` body).
