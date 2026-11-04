---
id: RT-W-06
title: 'Offline, /plan/<key> renders an empty header: the service worker serves the /plan shell, whose client redirect needs the network, so the "as of 14:02" snapshot never shows'
module: apps/web/public/sw.js; apps/web/components/routes.tsx (PlanIndex)
threat: T-61
severity: Med
likelihood: H
status: open
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-console-and-sw.spec.ts::offline /plan/<key> renders the snapshot, not an API replay_RTFINDING
regression_test:
fix_commit:
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
