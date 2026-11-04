---
id: RT-A-11
title: Pending-profile delivery, T-24 intents, the treasury day counter and "audit key shown" live only in process memory; after a restart a pending-profile claim is never retried
module: services/api/src/deps.ts
threat: T-25
severity: Med
likelihood: M
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-lpa-idem.test.ts::a pending-profile entitlement still completes after a process restart_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-lpa-idem.test.ts -t "process restart"
```

Reseller order fails once ⇒ `202 pending-profile`. Clear `deps.pendingDelivery` (what a restart does) and read `/me/K` a
minute later ⇒ still `pending-profile`: `retryPending` returns early without a delivery target. Same pattern: `intents`
(T-24 recovery), `treasuryDay` (TREASURY_MAX_USD6_PER_DAY restarts at 0 on every restart — the README's "Gap (octroi)"),
`auditShown` (RT-A-04), the idempotency cache.

## Impact

T-25 promises "the human never proves (or pays) twice"; a restart (deploy, crash, Fly machine move) between the failed order
and the retry leaves the human's entitlement pending forever with no route to complete it (AP6.3 already notes the retried
LPA has no delivery route). The treasury daily cap is also per process lifetime, so a crash loop multiplies it.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Persist the delivery target with the pending entity (the session public key and AAD nonce are not secrets; store them in the
entitlement payload or a `pending:` entity) and let the retry run whenever `status === 'pending-profile'`; persist
intents the same way (THREAT-MODEL T-24 already specifies a ledger `claim-intent`); compute the treasury day total from
`gift-reclaim` receipts (needs the by-kind-and-day query).

## Builder notes (optional)

## Verification (red team)
