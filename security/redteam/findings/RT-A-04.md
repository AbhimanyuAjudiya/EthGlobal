---
id: RT-A-04
title: The read-only SponsorLogin bearer also authorises POST /sponsor: a captured dashboard header rewrites the campaign and re-mints the once-only audit key
module: services/api/src/routes/sponsor.ts
threat: T-72
severity: Med
likelihood: M
status: open
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-authz.test.ts::a captured dashboard bearer cannot rewrite the campaign or re-read the auditKey_RTFINDING; services/api/test/redteam/rt-authz.test.ts::auditKey stays hidden after a restart (new deps over the same ledger)_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd services/api && npx vitest run test/redteam/rt-authz.test.ts -t "SponsorLogin scope"
```

1. The sponsor reads `GET /sponsor/:id` with `Authorization: Recharge-Sponsor <b64 {sponsor, issuedAt, signature}>`; the
   second read omits `auditKey` (AP13.4 holds).
2. The attacker base64-decodes that captured header and posts `POST /sponsor { campaign: {…any descriptive fields…}, auth:
{ issuedAt, signature } }` with the same signature ⇒ `201 { id, auditKey }`; the ledger campaign now has the attacker's
   `name`, `bundleMb`, `validityDays`, `planId`, `wholesaleUsd6PerGb`.
3. Separately, `auditShown` is process memory: after a restart the next dashboard read shows `auditKey` again.

`SponsorLogin{campaignId, sponsor, issuedAt}` does not cover the campaign payload, and the same typed message is accepted
by both routes. `CampaignStore.put` is an upsert.

## Impact

AP13.2 accepts the bearer replay risk for READING the dashboard within the hour; this turns it into WRITE access: the
attacker changes the campaign name every claimant sees in `/plans` and the PWA (phishing text within `safeTextSchema`),
changes bundle sizes / plan / validity (operator cost; `sizeBundle` caps at 300 MB but `wholesaleUsd6PerGb: 0` skips the
EV cap) and obtains the audit key the design shows only once (A-9: the published claim list becomes linkable by whoever
holds it). Price, budget and hourly cap stay chain-authoritative.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Sign the registration itself: a `SponsorRegister{campaignId, sponsor, issuedAt, campaignHash}` typed message with
`campaignHash = keccak256(canonicalJson(campaign))`, distinct from `SponsorLogin`; refuse `POST /sponsor` for an id that is
already registered unless the new payload is identical (or require a fresh `issuedAt` newer than the stored one). Return
`auditKey` from `POST /sponsor` only on the first registration, and persist "audit key shown" in the campaign entity (or
derive "first read" from a ledger flag) instead of process memory. Add the case to
`services/api/test/attack/sponsor.attack.test.ts` / a T-72 regression.

## Builder notes (optional)

## Verification (red team)
