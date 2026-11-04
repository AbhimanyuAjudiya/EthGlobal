---
id: RT-W-09
title: 'Copy ships an internal build note and a wrong instruction: "Step wording from memory; checked against real phones on Wednesday", "16 digits, on the back of the card" (the PIN is on the front under the latex), and a hard-coded "Mumbai · 7 days" on 14-day plans'
module: apps/web/i18n/en.json (install.screenshotNote, card.pinHint); apps/web/components/ScratchRedeem.tsx; apps/web/app/print/cards/page.tsx
threat: n/a (design-foundations §1.10, §7)
severity: Low
likelihood: H
status: open
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-static.spec.ts::no internal dev note in shipped UI strings_RTFINDING; apps/web/test/redteam/rt-static.spec.ts::PIN hint does not send people to the back of the card_RTFINDING; apps/web/test/redteam/rt-static.spec.ts::no hard-coded English copy in consumer components_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd apps/web && ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts rt-static -g "copy hygiene"
```

1. `/install` (every platform) shows "Step wording from memory; checked against real phones on Wednesday." — a note to
   the team, rendered to travellers (visible in `install-*-360.png`).
2. `/card` and `/gift/claim` hint "16 digits, on the back of the card"; design-references §3 puts the PIN on the
   **front**, under the latex ("PIN under the latex" is the field label right above it). The back carries the receipt.
3. `validity: 'Mumbai · 7 days'` is a literal on the screen coupon and the print sheet, while the plan screen of the same
   bundle says "Expires in 14 d 0 h" (`plan-light-360.png`) — fake specificity (design-foundations §1.10).

## Impact

Trust: a traveller is told to look on the wrong side of a scratch card, the install screen admits the steps are
guesses, and the coupon's one fact besides the MB is wrong for the campaign. Each is the kind of detail a judge
screenshots.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Delete `install.screenshotNote` (keep the `[screenshot Wed]` list in the README, where it already is); `card.pinHint`
→ "16 digits under the silver strip"; derive the validity line from the campaign (`validityDays` on `/plans` and the card
preview) and the city from config, or omit it.
