---
id: RT-P-08
title: No live code path mints campaign-funded scratch cards; the runbook's Thu 09:00 print of 200 cards can only be done with the MODE=local X-Seed-Card-Campaign hook
module: docs/ONSITE-RUNBOOK.md; services/api/src/flows/gift.ts
threat: T-85
severity: Med
likelihood: M
status: fixed
found_by: redteam-wave3-ops
owner: builder-api + builder-ops-demo (Founder decides)
found_at: 2026-11-04T16:10+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-ops/run.sh::live_card_minting_path_RTFINDING
regression_test: services/api/test/sponsor-cards.test.ts (8 cases: mint+redeem, 200 cap, bad sizes, stranger/tampered/stale/read-bearer 401, replay 409, paused 423, budget 409, rate 429) + security/redteam/wave3-ops/run.sh::a live, authenticated card-minting path exists
fix_commit: (uncommitted, wave-3 ops fix pass on claude/ethglobal-mumbai-build; orchestrator commits)
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

## Builder notes

`POST /sponsor/:id/cards` (INTERFACES §7 row + amendment A-43). Body `{ count 1–200, mb 100–3000 step 100, auth: { sponsor, nonce, issuedAt, signature } }`; the signature is EIP-712 `SponsorCards{campaignId, sponsor, count, mb, nonce, issuedAt}` (protocol `SPONSOR_CARDS_TYPES`), ≤ 10 min old, by the registered AND on-chain sponsor (a SponsorLogin read bearer is 401). Unpaused, unexpired, count ≤ (budget − spent) / pricePerClaim; nonce one-shot via a ledger once-marker (409 replay); 5 batches/min/campaign after the signature check; degraded-ledger guard; deliberately not idempotent (a cached replay would re-show PINs). 201 `{ campaignId, mb, claimBy, cards: [{ serial, pin, mb }] }`: PINs exist only in that body; the ledger holds serial + PIN HMAC (shared `mintCard`, the seed hook uses it too); the log holds `op: card.mint, count, mb`. `scripts/print-cards.ts --mint N --campaign <id> --mb 300 --save <file>` calls it (live: `cast wallet sign --data --account $SPONSOR_ACCOUNT` from the Foundry keystore, verified byte-identical to viem's signature; local: the Anvil sponsor role) and writes the PINs 0600 before rendering. Runbook Thu 09:00 rewritten; MODE=local on the VPS explicitly forbidden.
