---
id: RT-A-06
title: A redeemed card or PIN gift re-delivers an LPA through POST /gift/claim once its entitlement has expired (VALIDITY_DAYS < claim window)
module: services/api/src/flows/gift.ts
threat: T-53
severity: Med
likelihood: L
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-authz.test.ts::VALIDITY_DAYS=1: after the card’s entitlement expires the PIN never delivers a second LPA_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-authz.test.ts -t "VALIDITY_DAYS=1"
```

`VALIDITY_DAYS=1`, a campaign card (7-day claim window). Redeem by PIN ⇒ `201`. Advance 1 day: `POST /card/redeem` ⇒ `410`
(it checks `state === 'claimed'`), but the PIN path of `POST /gift/claim` ⇒ `201` with a new `sealedLpa`. `claimEscrow` only
refuses when `claimedKey !== key`, and the key is deterministic (`giftent:<giftId>`); the entitlement is gone, `markClaimed`
is idempotent for that key, the on-chain claim is skipped (`claimed()`), the receipt write is ignored as a replay, and
`fulfil()` orders (idempotently) and seals the profile again to the new session.

## Impact

One PIN, two LPA deliveries (T-31 "exactly once"): anyone who learns the PIN later (a shared card photo, a printed card) gets
the activation code again, and the ledger shows a fresh `mbTotal` for an already-consumed profile. Only reachable when
`VALIDITY_DAYS` is below the claim window (env allows 1–30; the default 7 equals the 7-day window), hence likelihood L.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

In `claimEscrow`, refuse any escrow already in `state: 'claimed'` (the `/card/redeem` route already does; move that check
into `claimEscrow` so both PIN routes and the giftId route share it), or keep a per-gift "delivered" receipt and refuse when
it exists. Optionally refuse `VALIDITY_DAYS < GIFT_CLAIM_WINDOW_S / 86400` at boot.

## Builder notes (optional)

## Verification (red team)
