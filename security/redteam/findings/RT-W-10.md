---
id: RT-W-10
title: 'The live build serves the /ui tooling routes: /ui/print renders a print-ready sheet of Recharge-branded scratch cards with 20 Verhoeff-valid PINs and real-looking serials, unauthenticated'
module: apps/web/app/ui/**
threat: T-64
severity: Low
likelihood: M
status: fixed
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: security/redteam/wave3-web/run.sh::live_ui_tooling_routes
regression_test: 'security/redteam/wave3-web/run.sh::live: /ui tooling routes are not served (RT-W-10 fixed); apps/web/test/ui-fixtures.test.ts::every gallery PIN is 16 digits and void on purpose'
fix_commit: (uncommitted: wave-3 web fix pass in the working tree; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
bash security/redteam/wave3-web/run.sh --live-only        # part 3 boots `next start` from a NEXT_PUBLIC_MODE=live build
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3100/ui/print?count=20     # 200
```

`/ui`, `/ui/print`, `/ui/print?count=20` and `/ui/tokens` answer 200 in the live build (`robots: noindex` only).
`/ui/print` is the same `PrintSheet` as the token-protected `/print/cards`, with `app/ui/fixtures.ts` PINs (each passes
`isValidPin`, so the card's on-device Verhoeff check accepts them) and `https://recharge.example/card/<serial>` QRs.

## Impact

Anyone can print convincing counterfeit Recharge scratch cards from the production host and sell them in Mumbai; the
fake PIN passes the on-device check and fails only at the API ("not found"), after the buyer has paid the street vendor.
The real PINs are safe (T-64's token holds — 17 bypass variants incl. the CVE-2025-29927 header stay 404), hence Low.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Gate `app/ui/layout.tsx` with `if (process.env.NEXT_PUBLIC_MODE !== 'local') notFound()` (or exclude `app/ui` from the
live build); give the gallery fixtures an obviously void PIN (`0000 0000 0000 000x` fails Verhoeff on purpose) and a
"SPECIMEN" overprint.

## Builder notes

`app/ui/layout.tsx` calls `notFound()` unless `NEXT_PUBLIC_MODE === 'local'`: the live build answers 404 for `/ui`, `/ui/print`, `/ui/print?count=20`, `/ui/tokens`. The gallery's fixture PINs are now one digit off a valid Verhoeff check digit, so a printout fails the on-device check on purpose.
