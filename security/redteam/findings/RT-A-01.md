---
id: RT-A-01
title: Two concurrent paid top-ups on one entitlement settle twice but mbTotal grows once (lost update through HTTP)
module: services/api/src/flows/fulfil.ts
threat: T-27
severity: Med
likelihood: M
status: verified
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-races.test.ts::two concurrent paid top-ups (two distinct payments) both land in mbTotal_RTFINDING
regression_test: services/api/test/redteam/rt-races.test.ts::two concurrent paid top-ups (two distinct payments) both land in mbTotal [RT-A-01] (+ services/api/test/regression/T-27-topup-race.test.ts::two concurrent paid top-ups ⇒ +200 MB)
fix_commit: (uncommitted, wave-2 API fix pass; orchestrator commits)
verified_at: 2026-11-04 (redteam-verify, Claude)
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-races.test.ts -t "two concurrent paid top-ups"
```

1. Provision a free entitlement (mbTotal 300).
2. Sign two distinct EIP-3009 payments (human, stranger) for `GET /esim/topup?key=K&mb=100` and send both at once.
3. Both answer `200` with their own `PAYMENT-RESPONSE`; `reseller.topUp` is called twice; `/me/K` shows `mbTotal: 400`, not 500.

`topUp()` reads the entitlement, then `fulfilTopUp()` patches `mbTotal = existing.mbTotal + mb` from that stale read; the
per-key `KeyedMutex` used by `serveFree` and gift claims is not taken here. This is the end-to-end form of RT-O-06 (store
has no compare-and-swap), reproduced through the real route.

## Impact

Two payments of $0.40 are taken and the reseller grants 200 MB, but the ledger (the user's `/me`, the agent's threshold
input, the sponsor view) records 100 MB. The user is shown less data than they paid for and the agent buys earlier than
its policy says (the daily cap still bounds it). The expiry extension of the lost patch is also lost. Concurrent top-ups
are normal here: the agent and the human (or two devices) top up the same key. On the self-run facilitator RT-A-12 hides
this by failing one settlement; with the remote facilitator (live) both settle.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Run the top-up fulfilment under `deps.mutex.run(key, …)` and re-read the entitlement inside it (`fulfilTopUp` should take
the key, not the pre-read payload), or make the patch relative (`mbTotal += mb`) with a CAS in the store (RT-O-06). Add the
regression to `services/api/test/regression/T-27-topup-race.test.ts` (case: two concurrent paid top-ups ⇒ +200 MB).

## Builder notes (optional)

`fulfilTopUp` patches with the function form of `EntitlementStore.patch` (octroi A-38): `(current) => ({ mbTotal: current.mbTotal + mb, expiresAt })`, recomputed from each fresh row on every compare-and-swap attempt, so a concurrent top-up (or usage patch) is never lost. Each response reports the total its own patch produced. `src/flows/fulfil.ts`.

## Verification (red team)

**2026-11-04 — redteam-verify (Claude): VERIFIED.**

- Regression: `rt-races.test.ts` `[RT-A-01]` and `T-27-topup-race.test.ts` pass. (re-run 2026-11-04, green under the CI `_RTFINDING` filter).
- Variant (new, not covered by the regression): FOUR distinct payers top up one entitlement concurrently while a usage webhook lands: all four 200, `mbTotal == 300 + 400`, the webhook's `mbUsed` survives.

```sh
cd services/api && npx vitest run test/redteam/verify-rt-a-01-02-08-topup.test.ts -t RT-A-01
```
