---
id: RT-W-03
title: 'A crafted /plan/<any-key> link silently re-points the device''s "current plan": /install loses the traveller''s own LPA and the Add-data, Agent and Install tabs act on the attacker''s key'
module: apps/web/components/PlanView.tsx; apps/web/lib/store.ts (plans.latest/setCurrent)
threat: T-73
severity: Med
likelihood: L
status: open
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-lpa-plumbing.spec.ts::a crafted /plan/<garbage> link does not hijack /install and the tabs_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd apps/web && ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts rt-lpa-plumbing -g "crafted"
```

1. Traveller claims a bundle; `/install` shows the iOS "Install eSIM" universal link.
2. Traveller taps a link in a chat: `https://<host>/plan/attacker-chosen-key` (any string — even one the API answers
   404 for). `PlanView` calls `store.setCurrent(entitlementKey)` **before** it knows whether the key is real or theirs.
3. `/install` now resolves `plans.latest()` → `attacker-chosen-key` → no LPA → "install.noLpa". The traveller's own
   activation code is unreachable from the install screen until they find and reopen their own plan URL.
4. With a real key the attacker owns, the TabBar's "Add data" (`/pay?key=<attacker>`) and `/agent` now act on the
   attacker's entitlement: the next top-up the traveller pays lands on the attacker's eSIM.

## Impact

Install-flow denial by link at the one moment the traveller has no data (airport Wi-Fi), and misdirected paid top-ups.
The entitlement key is meant to be treated as a capability (T-73 mitigation: "the PWA treats the entitlement key as a
capability"); here a URL parameter is trusted to rewrite device state. Likelihood L (needs a click), impact Med.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

- `setCurrent(key)` only for keys this device already holds (`plans.keys().includes(key)`) **and** after `/me`
  answered 200; never from a bare URL visit.
- `/pay?key=` and `/receipts?key=` for a key not in `plans.keys()`: show "This plan isn't on this phone — top up
  rahul's plan?" with the plan's MB and expiry before any 402 (gifting a top-up is legitimate, silent is not).
- Regression: Playwright case "visiting /plan/<foreign key> leaves currentKey and /install unchanged".
