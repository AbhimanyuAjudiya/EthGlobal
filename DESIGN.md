---
name: Recharge
description: The design language of Recharge, a mobile-first PWA that hands a traveller landing in Mumbai a sponsored eSIM data bundle. Warm paper, one oxide-teal accent, a single Devanagari-capable display face at two widths, a mono face for every number, and the recharge coupon as the one hero object. Reads like a printed ledger that happens to be on a phone, never like a crypto dashboard.
version: 2.0 (2026-11-06 frontend rebuild)
binding: research/design-foundations.md §1 (ban list, enforced by packages/ui/tokens.test.ts), research/design-references.md §1–§7 (screen-by-screen spec, 15 regressions), packages/ui/tokens.css (token names)
---

# Recharge — DESIGN.md

## Overview

Recharge is a paper object on a phone. Every screen has **one dominant element** at twice the size of anything else: the coupon's MB number on `/`, `/plan` and `/card`; one sentence on `/verify` and `/agent`; the status pill on `/install`; the `OnchainAction` sheet on `/pay`; the boarding pass on `/gift`; the claims figure on `/sponsor`. Everything else is ruled rows, quiet labels and one teal button carrying a number.

The feel: **warm, flat, exact.** Paper-coloured canvas (never pure white or black), hairline rules instead of boxes, tabular figures everywhere, sentence case, no decoration that is not information. Motion explains state and then stops.

Reference families (structure borrowed, never their colours or copy): Wise (one bold display face, one accent, numbers as copy), Mercury (grayscale plus one accent, light weights), Linear (dense console rows, one hero figure per pane), Stripe (the test-mode rail, receipts as the UI).

## Colors

Token names are fixed in `packages/ui/tokens.css` (`light-dark()` pairs; never hard-code a hex in app code). Values may be tuned, names may not change.

| Role                | Token                                                                         | Light                          | Dark                | Rule                                                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------- | ------------------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Canvas              | `--bg-canvas`                                                                 | warm paper L .985              | warm ink L .16      | the page itself                                                                                                                                              |
| Surface             | `--bg-surface`                                                                | L .995                         | L .20               | cards, sheets; sits on canvas with a hairline, never a shadow                                                                                                |
| Sunken              | `--bg-sunken`                                                                 | L .962                         | L .13               | skeleton blocks, meter tracks, code wells, segmented control track                                                                                           |
| Raised / Overlay    | `--bg-raised`, `--bg-overlay`                                                 | = surface                      | L .24 / .28         | menus, popovers; elevation by lightness in dark                                                                                                              |
| Hairline            | `--border-subtle`                                                             | L .90                          | L .30               | every rule and card edge                                                                                                                                     |
| Strong              | `--border-strong`                                                             | L .76                          | L .44               | hover edge of a linked card, segmented selection                                                                                                             |
| Input               | `--border-input`                                                              | L .64                          | L .50               | fields (3.2:1)                                                                                                                                               |
| Text                | `--text-primary / -secondary / -tertiary`                                     | L .20 / .44 / .55              | L .93 / .72 / .63   | tertiary for labels and "as of" lines                                                                                                                        |
| Accent              | `--accent` (hover `--accent-hover`, tint `--accent-subtle`, on `--on-accent`) | oxide teal oklch(.52 .085 195) | oklch(.78 .11 195)  | **one teal per screen**: the primary button, the meter fill, the current-tab bar, focus rings. ≤ 5 % of pixels, never a gradient, never a tinted icon circle |
| Positive / Negative | `--positive`, `--negative` (+ `-subtle`)                                      | green 150 / red 25             |                     | **money moved** (data landed, payment settled / failed amount). Never for "verified", never for decoration                                                   |
| Warning             | `--warning` (+ `-subtle`)                                                     | amber 75–85                    |                     | usage ≥ 80 %, unverified links, stuck transactions                                                                                                           |
| Series              | `--series-1…6`                                                                | fixed order                    |                     | charts only; a 7th folds into "Other"                                                                                                                        |
| Object              | `--latex`, `--ink-spot`                                                       | silver / teal                  | same in both themes | the coupon is paper-light in dark mode on purpose                                                                                                            |

Banned (CI grep): any hue 260–300, gradients, `backdrop-filter`/blur, neon or glow borders, `#000`/`#fff` canvases, rainbow tags.

## Typography

One family does display and text in Latin and Devanagari: **Anek Devanagari** (variable, `wdth` 100–110, `wght` 400–700). **Chivo Mono** sets every figure, hash, PIN, ICCID, time and the testnet rail. **Baloo 2** appears once, on the scratch latex. No other face, ever (Inter, Geist, Poppins, DM Sans, Space Grotesk are banned).

| Style            | Face    | Size                                | Weight / width | Leading | Use                                                                       |
| ---------------- | ------- | ----------------------------------- | -------------- | ------- | ------------------------------------------------------------------------- |
| Hero number      | display | `--text-64` (clamp 44–64 on phones) | 700 / wdth 110 | 1.0     | the MB, the claims count; unit at `--text-24` 500, baseline-aligned       |
| Display question | display | `clamp(32px, 9vw, 44px)`            | 700 / 110      | 1.1     | the one H1 per screen                                                     |
| Title            | display | `--text-24`                         | 600 / 110      | 1.15    | sheet titles, console pane titles                                         |
| Section title    | display | `--text-20`                         | 600 / 100      | 1.15    | groups inside a screen                                                    |
| Body             | text    | `--text-16`                         | 400–500 / 100  | 1.45    | sentences, steps                                                          |
| Row              | text    | `--text-14`                         | 400 / 100      | 1.45    | ruled rows, menu items, table cells (13 px in the sponsor console)        |
| Label            | text    | `--text-13`                         | 500            | 1.45    | `--text-tertiary`, sentence case, never uppercase (Devanagari forbids it) |
| Figure           | mono    | inherits                            | 400–700        |         | `[data-hash]`, `.amount-mono`, `.tnum-zero`: tabular, slashed zero        |
| Rail             | mono    | `--text-12`                         | 400            |         | "TESTNET · test USDC · not a sale", "usage as of 14:02"                   |

Rules: `tabular-nums` on `html`; no letter-spacing, italics or uppercase in Hindi/Marathi (`:lang(hi), :lang(mr)` get leading 1.6, 14 px floor); numbers formatted by `lib/format.ts` (`Intl.NumberFormat('en-IN')`, "300 MB", "$0.40 USDC", "Sun 15 Nov 09:12", `0x1a2b…9f3e`); buttons carry the amount ("Add 100 MB · $0.40").

## Layout

- **One column, 16 px gutters, `max-width: 44rem`** (`.screen`), the primary action in the bottom quarter. The sponsor console is `.screen--wide` at 72 rem with a sticky left rail from 1024 px.
- **4 px grid.** Inside a row 4/8; between rows 12; between groups 24; between sections 40 (phone) / 48 (desktop). Expose these as `--space-1…10` in `tokens.css` (4, 8, 12, 16, 24, 32, 40, 48, 64, 96 px) and use nothing else.
- **Desktop (≥ 880 px)** is a second composition, not a stretched phone: `/` goes 5/7 with the coupon on the right; `/plan`, `/pay`, `/gift`, `/agent` put the object (coupon, action sheet, boarding pass, policy sentence) in a left column and the ruled details in the right; `/sponsor/[id]` is panes in a 12-column grid with one hero figure per pane.
- **Equal edges:** every block sits on the column's left and right lines; nothing hangs out to one side; no horizontal scroll at 360 px (Playwright asserts it).
- **Rows, not cards.** Lists are ruled rows (`.ruled`) with label left, value right, units in the label. A card is reserved for an object (coupon, boarding pass, sheet). Never a card inside a card; never a three-tile grid.
- **Header:** wordmark · wallet control · "Menu" (a word, not a hamburger) on one 72 px row with a hairline below. **Tab bar** (Plan · Add data · Gift · Receipts) only once a plan exists, sticky at the bottom, 56 px, a 2 px teal bar over the current tab.
- **Sheets, never modals.** A sheet slides up from the bottom on a phone (`--duration-spatial-in`, `--ease-standard`, translateY 24 px → 0 + opacity) and sits in place on desktop.

## Elevation & Depth

Two levels only, by lightness and hairline, not shadow:

1. **Rest:** surface on canvas, 1 px `--border-subtle`, no shadow.
2. **Lifted:** a linked card on hover (`translateY(-2px)`, border → `--border-strong`, `--shadow-2`); sheets, menus and popovers (`--shadow-2`).

Add to `tokens.css`: `--shadow-1: 0 1px 2px oklch(0.2 0.012 70 / 0.06)` (fields on focus only) and `--shadow-2: 0 8px 24px oklch(0.2 0.012 70 / 0.10)` (dark: `/ 0.4`). Never a shadow and a strong border on the same resting element; never `shadow-xl`.

## Shapes

| Family   | Token                 | Value   | Use                                                          |
| -------- | --------------------- | ------- | ------------------------------------------------------------ |
| Controls | `--radius-control`    | 0.5 rem | buttons, fields, segmented control, menu items               |
| Objects  | `--radius-object`     | 1 rem   | coupon, boarding pass, sheets, panes                         |
| Pills    | `--radius-pill` (new) | 999 px  | the status pill, Live/Paused state, the one testnet rail     |
| Rules    | —                     | 0       | tables, ruled rows, the meter track (4 px tall, square ends) |

Icons: Lucide at `stroke-width 1.5`, 16 px inline, 20 px in controls, `currentColor`, never in a tinted circle. Allowed set only: copy, external link, chevron, QR, SIM card, pause, play, check (stepper), warning triangle, close, wallet. No emoji, no illustration, no shield-check.

## Components

All in `@ethglobal/ui/components` (`.ui-*`, `.coupon`, `.boarding-pass`, `.onchain-action`, `.mb-meter`, `.receipt`, `.ruled`, `.hash`, `.scratch`) plus app-level pieces in `apps/web/app/styles/*.css`.

- **Button** (`.ui-button`): 48 px, radius-control, 600 weight, carries the amount. Primary = teal fill (one per screen); secondary = hairline outline on surface; quiet = text only, 44 px. Hover: fill steps 6 % toward ink and the box moves up 1 px (fine pointer only); press: down 1 px and `scale(.985)` in 90 ms; disabled: `--text-disabled` on sunken, no transform. Block on phones below 480 px.
- **Field** (`.ui-field`): label above, 48 px input, `--border-input`, on focus `--accent` border + `--shadow-1`; error in `--text-secondary` prose, never red boxes; mono variant for PINs and codes.
- **Coupon**: the brand. Paper-light in both themes, `--radius-object`, faint grain on the coupon only, MB at hero size, "from <sponsor> · because you're human", PIN 4 × 4 under latex, QR, serial. Three variants: screen / notification / print (print markup is frozen: snapshot-tested).
- **Ruled rows / Receipt**: label left `--text-secondary`, value right mono, 1 px hairline between, three lines for money (You / Sponsor / Network fee).
- **MbMeter**: 4 px teal rule on sunken, drains left → right, `role="meter"`, warning tint at ≥ 80 %. Moves only on a new `usageAsOf`.
- **Status pill**: the OS's own words ("No Service" tertiary → "Searching…" → "LTE · Jio" primary with a 6 px teal dot), `role="status"`, radius-pill, hairline.
- **Segmented control**: sunken track, surface thumb with `--border-strong`, labels by network name, never chain ids.
- **Sheet**: surface, radius-object top corners on a phone, title at `--text-24`, body rows, actions at the bottom; closes with Escape and a Close button.
- **Skeleton**: the real layout with text replaced by `--bg-sunken` blocks of the right width; numbers arrive last; no shimmer.
- **Empty state**: a ghost row with the real column headers and one verb ("Create a campaign — name, budget, bundle size by tier, hourly cap"). Never an illustration.
- **Table** (console): 32 px rows at 13 px, text left, numbers right, units in headers, sticky header, hover row tint `--bg-sunken`.
- **Testnet rail**: 12 px mono, `--bg-sunken`, full width above every money screen.

Motion (tokens only; animate `transform` and `opacity`): hover 140 ms in / 200 ms out; press 90 ms; sheet 260 ms in / 208 ms out; the odometer 400 ms **once** on issue; reduced motion collapses everything to ≤ 100 ms and drops transforms. Nothing bounces, nothing animates on scroll, no loops, no confetti, no toast for money.

## Do's and Don'ts

**Do**

- Make the number the hero and the button say what it costs.
- Use hairlines and spacing to group; boxes only for objects.
- Show a hash the instant it exists, with copy and an explorer link; say "Final" in words.
- Give every list an empty state that teaches and every load a skeleton shaped like the content.
- Keep light and dark parity by token; test both at 360 px.
- Put Hindi and Marathi strings in Anek with 1.6 leading; keep units, numerals and brand nouns Latin.

**Don't**

- No purple, gradients, glass, glow, shadow-xl, `hover:scale-105`, bounce easings, scroll reveals.
- No shield-check, "Verified human" pill, confetti, "Success!", spinner without a hash, "Payment Required" heading, coin icon.
- No three-card grid, "Trusted by", phone mockup, KPI tile wall, donut, logo marquee.
- No chat bubbles or robot for the agent; no gift box or ribbon on `/gift`; no emoji anywhere.
- No raw `0x…` without copy + explorer; no chain id shown to a traveller; no relative-only time.
- No hype copy (Seamless, Effortless, Supercharge, Unlock, Empower, Next-gen) and no "Beta" pill.
