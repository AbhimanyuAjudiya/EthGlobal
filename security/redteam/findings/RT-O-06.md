---
id: RT-O-06
title: Store read-modify-write has no compare-and-swap — concurrent GiftStore.markClaimed both succeed (one gift redeemed twice); concurrent EntitlementStore.patch loses a paid top-up
module: packages/octroi/src/store/gift.ts
threat: T-53
severity: High
likelihood: M
status: open
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-04T09:40+05:30
attack_test: packages/octroi/test/redteam/rt-store.test.ts::GiftStore.markClaimed: two concurrent claims of one gift with different entitlement keys → at most one succeeds_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/octroi && npx vitest run test/redteam/rt-store.test.ts -t 'compare-and-swap'
```

1. `GiftStore.create(gift)`; on a ledger that yields per call (any networked adapter):
   `Promise.allSettled([markClaimed(G, 'giftent:a'), markClaimed(G, 'giftent:b')])` ⇒ **both fulfilled**. Both read
   `state:'open'`, both `update`. The README promises "throws `already_claimed` for a different one" — true only sequentially
   (passing test beside it).
2. `EntitlementStore.patch(K, { mbTotal: 400 })` (top-up, paid) ∥ `patch(K, { mbUsed: 250 })` (usage webhook) ⇒ the final
   row is `{ mbTotal: 300, mbUsed: 250 }`: each patch merges into its own stale read and re-writes **every** field.

## Impact

- `markClaimed` is the one-claim lock of gifts and cards (`POST /card/redeem`, `/gift/claim`). N concurrent redeems of one
  PIN/gift (each with its own cheap challenge) ⇒ N bundles delivered for one paid gift — the operator pays wholesale for N−1.
  Same class as O3's "two oks ⇒ High".
- `patch` lost update: a paid top-up's `mbTotal` disappears from the ledger (user sees less data than bought; the agent's
  `shouldTopUp` buys again) or `mbUsed` moves backwards (T-34's "usedMb monotonic").

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

1. Serialise read-modify-write per logical key inside the stores: a per-process keyed mutex (`Map<string, Promise>`) around
   `markClaimed`, `patch` and `upsert`; re-read inside the lock.
2. Make `patch` field-level: apply only `patch`'s keys onto the row read **inside** the lock; offer `patch(key, (e) => next)`
   (functional update) so `mbTotal: +100` is computed from the fresh row.
3. Cross-process: as RT-O-03 — either a ledger create-if-absent/version check, or a stated single-instance constraint. For
   gifts, also write the `gift-claim` receipt with `create` (unique key per gift) **before** fulfilling, so a second claimer
   loses on the receipt even across processes.

Regression test to add (builder): `packages/octroi/test/regression/T-53-gift-single-claim.test.ts` (concurrent
`markClaimed` ⇒ one fulfilled, one `already_claimed`) and a `patch` concurrency case in
`packages/octroi/test/regression/T-36-logical-keys.test.ts`. T-53 is Med in the model with no §5.12 row; this finding argues it up to High, so the lead adds the row.

## Builder notes (optional)

## Verification (red team)
