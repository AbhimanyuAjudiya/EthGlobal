---
id: RT-O-08
title: counters.claimed cannot be known before decide(); after the free entitlement expires a same-campaign replay is serve-free and only the DataDrop revert stops it
module: packages/octroi/src/decide.ts
threat: T-18
severity: Low
likelihood: M
status: open
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

**2026-11-04 — redteam-verify (Claude): REOPENED.** The named regression passes (`rt-economics.test.ts` `[RT-O-08]`,
`test/regression/redteam-wave1.test.ts::RT-O-03 / RT-O-08`). It does not hold for a campaign longer than 180 days.

### Repro (verification variant)

```sh
cd packages/octroi && npx vitest run test/redteam/verify-rt-o-08-long-campaign.test.ts
```

1. Campaign with `validityDays: 1`, `expiresAt = now + 365 d` (nothing bounds it: `campaignSchema.expiresAt` is `msSchema`;
   `/sponsor/register` and `DataDrop.createCampaign` accept any future expiry).
2. Human claims on day 0 → `serve-free`; the per-campaign claim record is reserved until
   `min(campaign.expiresAt, now + MAX_LOCK_MS)` = day 180 (`decide.ts:326`).
3. Day 181: the entitlement, the live locks (last 30 days) and the claim record are all gone ⇒ the same human's second claim
   on the same campaign is **`serve-free`** — exactly the pre-fix RT-O-08 state ("only the DataDrop revert stops it").

Control (90-day campaign, day 60 ⇒ `replay`) passes in the same file. Failing test (marked `// RT-FINDING`, suffixed
`_RTFINDING`): `packages/octroi/test/redteam/verify-rt-o-08-long-campaign.test.ts::a 365-day campaign still refuses the same human on day 181 inside decide()_RTFINDING`.

Impact: Low, as filed — DataDrop's `AlreadyClaimed` still refuses the same `claimKey` on chain, so the sponsor does not pay
twice, but the API saga does the verify/reserve work and depends on the revert.

Suggested fix (builder's choice): bound campaign expiry to ≤ 180 d (campaignSchema / `/sponsor/register`, documented in
INTERFACES), or renew the claim record (CAS re-put) before it expires while the campaign lives, or have decide() consult
`DataDrop.claimed(id, claimKey)` when the record is absent and the campaign is older than `MAX_LOCK_MS`.
