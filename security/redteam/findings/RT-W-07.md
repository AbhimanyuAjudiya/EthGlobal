---
id: RT-W-07
title: 'Touch targets below 44 px on every route: the wordmark home link (92×30), Hash copy buttons (28×28), sponsor rail links (35×48)'
module: apps/web/components/Shell.tsx; packages/ui/components/Hash.tsx; apps/web/app/sponsor/layout.tsx
threat: n/a (web.md §8 "48 px targets")
severity: Low
likelihood: H
status: open
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-a11y-mobile-perf.spec.ts::touch targets ≥ 44 px on every consumer route_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd apps/web && ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts rt-a11y-mobile-perf -g "touch targets"
```

At 360 × 780, every visible `a[href]`, `button`, `input`, `summary`, `[role=radio|button]` is measured:
`a.wordmark "Recharge"` 92 × 30 on all 19 consumer routes; `button.hash__copy` 28 × 28 on `/plan/<key>` and
`/receipts`; sponsor rail "Claims" 35 × 48 and "Quotas" 39 × 48. Everything else passes (axe serious/critical = 0 in
both themes on every route incl. error states; no horizontal scroll at 360 px — kept as passing regressions).

## Impact

The copy-hash button is the only way to copy a transaction hash on a phone; at 28 px it is a miss-tap next to the
explorer link. web.md §8 requires 48 px; WCAG 2.5.5 is 44 px.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

`.wordmark { min-height: 48px; display: inline-flex; align-items: center }`; `.hash__copy` keeps its 16 px icon but
gets a 48 × 48 hit area (`padding` or a `::before` inset of −10 px); the sponsor rail links `min-width: 48px; padding-inline: 8px`.
Add the 44 px check to `e2e/a11y.spec.ts`.
