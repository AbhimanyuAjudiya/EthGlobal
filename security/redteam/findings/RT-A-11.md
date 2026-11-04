---
id: RT-A-11
title: Pending-profile delivery, T-24 intents, the treasury day counter and "audit key shown" live only in process memory; after a restart a pending-profile claim is never retried
module: services/api/src/deps.ts
threat: T-25
severity: Med
likelihood: M
status: fixed
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-lpa-idem.test.ts::a pending-profile entitlement still completes after a process restart_RTFINDING
regression_test: services/api/test/redteam/rt-lpa-idem.test.ts::a pending-profile entitlement still completes after a process restart [RT-A-11] (+ services/api/test/regression/T-25-durable-state.test.ts; services/api/test/redteam/rt-authz.test.ts::auditKey stays hidden after a restart [RT-A-04])
fix_commit: (uncommitted, wave-2 API fix pass; orchestrator commits)
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

Every item is persisted: (1) the treasury day total is `ReceiptStore.spentUsd6ForDay('gift-reclaim', today)` from the ledger, checked under an in-process lock with the pending-receipt write, and the settled reclaim PATCHES the pending receipt (`ReceiptStore.patch`) instead of writing a twin, so it is counted once; (2) "audit key shown" is a ledger once-marker (RT-A-04); (3) pending-profile delivery targets and (4) T-24 intents hold capability keys, so they go to a sealed local store, not the world-readable ledger: `src/state.ts` `DurableState` — one JSON file at `STATE_FILE`, sealed to `SERVER_SEAL_KEY`, replaced atomically, mode 0600, refused at boot if it cannot be opened; `STATE_FILE` is required in live. Boot retries every pending delivery once (`retryPendingOnBoot`, `src/index.ts`), then `/me` retries ≤ 1/min. **Residual:** the Idempotency-Key cache stays in memory (money paths are idempotent by their natural keys, T-74); the state file is single-writer (one API process per deployment, THREAT-MODEL §8) and must sit on a persistent volume in live.

## Verification (red team)
