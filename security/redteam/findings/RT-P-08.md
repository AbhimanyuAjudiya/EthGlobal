---
id: RT-P-08
title: No live code path mints campaign-funded scratch cards; the runbook's Thu 09:00 print of 200 cards can only be done with the MODE=local X-Seed-Card-Campaign hook
module: docs/ONSITE-RUNBOOK.md; services/api/src/flows/gift.ts
threat: T-85
severity: Med
likelihood: M
status: open
found_by: redteam-wave3-ops
owner: builder-api + builder-ops-demo (Founder decides)
found_at: 2026-11-04T16:10+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-ops/run.sh::live_card_minting_path_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
grep -rn "kind: 'card'" services/api/src      # only flows/gift.ts seedCard(), reached only through X-Seed-Card-Campaign
sed -n 193,200p docs/ONSITE-RUNBOOK.md        # "Create them on the VPS with the sponsor's funded campaign; the local hook does not exist in live"
```

The live-mode enumeration confirms the hook is dead in live (`X-Seed-Card-Campaign` on `/gift` → no 201; see OP2). There is
no sponsor-authenticated route that creates `kind: 'card'`, `fundedBy: 'campaign'` gifts.

## Impact

Thursday 09:00 is a hard deadline (printers close Friday). The only ways to get 200 redeemable PINs are (a) run the API on
the VPS with `MODE=local` (which re-enables every T-85 hook and `/__local/*` on a public host, with Anvil keys refused only
in live) or (b) mint them on a laptop's local ledger, which makes the printed cards unredeemable on the live stack. Either is
a T-85 Critical-class misconfiguration under time pressure, or a demo failure in front of judges. Med because it is a
process gap that has not happened yet.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

A live, authenticated `POST /sponsor/:id/cards { count, mb }` (SponsorLogin signature by the campaign sponsor, count ≤ the
campaign's remaining budget / pricePerClaim, PINs returned once and only to that caller, rate-limited, logged without PINs),
or a `scripts/mint-cards.ts` that does the same through it; update the runbook. Until then, the runbook must say explicitly
that MODE=local on the VPS is forbidden.
