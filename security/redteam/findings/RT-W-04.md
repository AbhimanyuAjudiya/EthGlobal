---
id: RT-W-04
title: "Slide-to-confirm is a native range input: one End keystroke on the focused slider sends the sponsor's Pause transaction"
module: apps/web/components/SlideToConfirm.tsx
threat: T-72
severity: Low
likelihood: L
status: open
found_by: redteam-wave3-web
owner: builder-web
found_at: 2026-11-04T17:25+05:30
due: 2026-11-05T20:59+05:30
attack_test: apps/web/test/redteam/rt-console-and-sw.spec.ts::one End keystroke on the focused slider does not pause the campaign_RTFINDING
regression_test:
fix_commit:
verified_at:
duplicate_of:
sign_off:
---

## Repro

```sh
cd apps/web && ./node_modules/.bin/playwright test -c test/redteam/playwright.redteam.config.ts rt-console-and-sw -g "slider"
```

1. Sponsor opens `/sponsor/<id>`; Tab to "Slide to pause claims"; press **End** once → `value = 100` → `onConfirm()` →
   `pauseCall(id, true)` is sent from the sponsor wallet (the demo wallet signs it without a prompt in MODE=local).
2. The pointer path holds: a single click near the end of the track does not pause (pointer-up below 100 resets) —
   kept as a passing regression.

## Impact

design-foundations §2.10 and wave3-web-ops W11.4: slide-to-confirm exists so an irreversible money move cannot
happen from one accidental key or click. With an injected wallet the wallet's own confirm still stands between the
keystroke and the chain, hence Low; with the demo wallet (the judged demo) one keystroke pauses the campaign on stage.

## Fix (proposed by the red team; the builder may choose another that passes the attack test)

Require a gesture, not a value: confirm only when the value reached 100 through ≥ 3 distinct `input` events spanning
≥ 300 ms from the same pointer/keyboard interaction (Home/End/PageUp jumps disabled: `onKeyDown` ignores them; arrows
step 10 % so the keyboard path is ≥ 10 deliberate presses), then show "Release to pause" before firing. Keep the
accessible name; add `aria-describedby` with the instruction.
