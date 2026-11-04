---
id: RT-A-04
title: The read-only SponsorLogin bearer also authorises POST /sponsor: a captured dashboard header rewrites the campaign and re-mints the once-only audit key
module: services/api/src/routes/sponsor.ts
threat: T-72
severity: Med
likelihood: M
status: fixed
found_by: redteam-wave2
owner: builder-api
found_at: 2026-11-04T15:05+05:30
due: 2026-11-05T20:59+05:30
attack_test: services/api/test/redteam/rt-authz.test.ts::a captured dashboard bearer cannot rewrite the campaign or re-read the auditKey_RTFINDING; services/api/test/redteam/rt-authz.test.ts::auditKey stays hidden after a restart (new deps over the same ledger)_RTFINDING
regression_test: services/api/test/redteam/rt-authz.test.ts::a captured dashboard bearer cannot rewrite the campaign or re-read the auditKey [RT-A-04]; ::auditKey stays hidden after a restart (new deps over the same ledger) [RT-A-04] (+ services/api/test/regression/T-72-sponsor-scope.test.ts)
fix_commit: (uncommitted, wave-2 API fix pass; orchestrator commits)
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

Read and write are separated by making registration a one-time write: `POST /sponsor` for an id that is already registered is 409 `campaign_exists` whoever signs (per-id mutex + a ledger once-marker `claim:HMAC('sponsor-registered'‖id)`, scope `'once'`, protocol A-42), so the dashboard bearer can no longer rewrite a campaign or mint its audit key; the audit key appears only in the first registration's 201. "Audit key shown" on `GET /sponsor/:id` is a ledger once-marker (`claim:HMAC('sponsor-audit-shown'‖id)`), so a restart (or a second process) does not show it again. **Residual (Low):** registration itself is still authorised by a `SponsorLogin` signature because the PWA (`apps/web/lib/sponsor.ts`, being edited by another builder) signs that; a bearer captured before the sponsor's first registration could register first. The full fix is a `SponsorRegister{campaignId, sponsor, issuedAt, campaignHash}` typed message in protocol + the PWA; the API side is then a one-line verifier swap.

## Verification (red team)
