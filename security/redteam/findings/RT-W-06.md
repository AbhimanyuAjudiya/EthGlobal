---
id: RT-W-06
title: 'Offline, /plan/<key> renders an empty header: the service worker serves the /plan shell, whose client redirect needs the network, so the "as of 14:02" snapshot never shows'
module: apps/web/public/sw.js; apps/web/components/routes.tsx (PlanIndex)
threat: T-61
severity: Med
likelihood: H
status: fixed
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-console-and-sw.spec.ts::offline /plan/<key> renders the snapshot, not an API replay
regression_test: apps/web/test/redteam/rt-console-and-sw.spec.ts::offline /plan/<key> renders the snapshot, not an API replay; apps/web/test/redteam/rt-console-and-sw.spec.ts::caches hold the shell only after a claim and an install visit
fix_commit: (uncommitted: wave-3 web fix pass in the working tree; orchestrator commits)
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd apps/web && ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts rt-console-and-sw -g "offline"
```

1. With the service worker allowed (the builder's suite runs with `serviceWorkers: 'block'`, so this path was never
   exercised), claim a bundle, open `/plan/<key>` online (the snapshot is saved to IndexedDB), go offline, reload.
2. `sw.js` answers the navigation with `caches.match('/plan')` — the `/plan` _index_ shell. Its `PlanIndex` calls
   `router.replace('/plan/<key>')`, a client navigation that fetches the RSC payload from the network and fails
   offline. The body is the wordmark and the language switch, nothing else (no MB, no "Offline · as of …").

## Impact

The product's headline is "Landing in Mumbai without data?". The one screen a traveller opens with no connection —
their plan, to see what they have and whether it expired — is blank. `PlanView` already implements the IndexedDB
fallback; it is never reached. Not a confidentiality issue (no LPA or API response is replayed — that part holds and is
kept as a passing regression), but web.md §5 makes it a requirement; Med, likelihood H (every offline open).

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Precache a real `/plan/[key]` shell: make the `[key]` page's static shell renderable for any key (it already is: the
key is read client-side via `useParams`), precache one instance (e.g. `/plan/_`), and in `sw.js` answer any
`/plan/<anything>` navigation with that cached shell (`caches.match('/plan/_')`) so `PlanRoute` hydrates with the real
URL and `readPlan` falls back to the snapshot. Add a Playwright spec with `serviceWorkers: 'allow'` + `setOffline(true)`
asserting "Offline · as of HH:MM" and the MB number.

## Builder notes

`public/sw.js` (cache v2) precaches `/`, `/offline`, `/plan` **and the `/_next/static` scripts, styles and fonts those documents reference** (read from the cached HTML), and answers every `/plan/<anything>` navigation offline with the `/plan` shell — no per-key document is stored. The `/plan` page (`PlanIndex`) reads the key from the address bar after hydration and renders `PlanView` directly, which falls back to the IndexedDB snapshot ("Offline · as of HH:MM" + the MB) or, with no snapshot, an honest offline card. `/offline` gained the app header.
