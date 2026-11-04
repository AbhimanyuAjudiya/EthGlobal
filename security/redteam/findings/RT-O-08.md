---
id: RT-O-08
title: counters.claimed cannot be known before decide(); after the free entitlement expires a same-campaign replay is serve-free and only the DataDrop revert stops it
module: packages/octroi/src/decide.ts
threat: T-18
severity: Low
likelihood: M
status: fixed
found_by: redteam-octroi
owner: builder-octroi
found_at: 2026-11-04T05:40+05:30
due: 2026-11-05T20:59+05:30
attack_test: packages/octroi/test/redteam/rt-economics.test.ts::after the free entitlement expires, a second claim on the SAME campaign is refused inside decide()_RTFINDING
regression_test: packages/octroi/test/redteam/rt-economics.test.ts::after the free entitlement expires, a second claim on the SAME campaign is refused inside decide() [RT-O-08] (packages/octroi/test/regression/redteam-wave1.test.ts::RT-O-03 / RT-O-08)
fix_commit: (uncommitted, wave-1 octroi fix pass; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd packages/octroi && npx vitest run test/redteam/rt-economics.test.ts -t 'SAME campaign'
```

Campaign with `validityDays: 1`, live for 30 days. Claim → model `DataDrop.claim(claimKey)` → `EntitlementStore.create`.
Advance 2 days (entitlement gone, campaign live). Second claim, same human, same campaign: the caller reads counters
**before** `decide()` and cannot set `claimed` (it needs `onchainClaimKey`, which needs the nullifier, which only `verify`
inside `decide()` yields) ⇒ `serve-free`.

## Impact

T-18 says "decide() denies when existingEntitlement … **or** counters.claimed"; the second half is unreachable through this
interface. The chain still reverts `AlreadyClaimed` in the API saga, so no bundle is lost — but the human's verification is
burned and the 409 depends entirely on wave 2 ordering `DataDrop.claim` before `reseller.order`.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Add `OctroiDeps.claimedOnchain?: (campaignId, claimKey) => Promise<boolean>` (or `Campaign.claimedCheck`, like
`actionCheck`), call it in step 1g after the keys are derived, map a throw to `ledger-unavailable`; update INTERFACES §5 and
drop `CampaignCounters.claimed` (or document it as "only for callers that already know the claim key").

Regression test to add (builder): `packages/octroi/test/regression/T-18-nullifier-replay.test.ts` (case: entitlement expired,
chain says claimed ⇒ `deny: replay`).

## Builder notes (optional)

`decide()` now computes "claimed" itself: the per-campaign claim record `claim:HMAC(secret,'claimed'‖campaignId‖quotaKey)` (A-33) is written create-if-absent before `serve-free` and lives until the campaign ends (≤ 180 d), and is checked after verify with the other replay reads. No new `OctroiDeps` hook was needed; `CampaignCounters.claimed` stays as optional caller knowledge.

## Verification (red team)
