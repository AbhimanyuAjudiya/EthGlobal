# @ethglobal/ui

Design tokens, the product components and the print sheet, implemented from `research/design-foundations.md`,
`research/design-references.md` and `research/committee/DECISION.md` §8.

| File           | Contents                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.css`   | §4 OKLCH colour tokens (surfaces, borders, text, accent, positive/negative/warning, six data-viz series), §3 type scale, §6 motion durations/easings/spring                                                                                        |
| `fonts.css`    | The three type pairings as `[data-type="ledger" \| "terminal" \| "bazaar"]`, Google Fonts `@import … &display=swap`, `tabular-nums` on `html`, hash/address mono rule, Devanagari rules, `.tnum` / `.tnum-zero` / `.pnum` / `.density-*` utilities |
| `tailwind.css` | `@theme inline` bridge so Tailwind v4 emits `bg-canvas`, `text-ink-secondary`, `bg-series-3`, `font-display`, `text-14`, `ease-standard`, …                                                                                                        |
| `index.ts`     | Typed token names, the type scale, motion values for JS animation, and the onchain action state machine vocabulary                                                                                                                                 |

## Components

`@ethglobal/ui/components` — React 19 function components, props in and markup out: no network, no chain
logic, no imports from protocol or adapters. Amount, fee and expiry strings come from the app (formatted with
`@ethglobal/protocol/units`); the components only split values into typographic parts. Styles:
`@import '@ethglobal/ui/components.css'` once; `@ethglobal/ui/print.css` on the print route. Every state is
rendered in light and dark at `/ui` in `apps/web` (tooling, noindex); `/ui/print?count=10` is the print sheet.

| Component                                | What it is                                                                                                                                                       | States / props worth knowing                                                                                                                             |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Coupon`                                 | The recharge coupon: MB at 2× everything else, "300 MB · from <sponsor> · because you're human", PIN 4 × 4 in Chivo Mono, "usage as of HH:MM", QR via `renderQr` | `variant` screen / notification / print; `lang` en / hi (§6 strings, Latin numerals); `status`; paper-light in both themes (`data-color-scheme="light"`) |
| `ScratchCard`                            | The coupon under silver latex: canvas, `destination-out`, 24 px brush, rest fades at 45 %                                                                        | `revealed`, `onReveal`; "Reveal PIN" button twin; reduced motion or no canvas → latex block + button                                                     |
| `MbMeter`                                | Remaining MB, 4 px teal rule draining left → right, `role="meter"` + text twin                                                                                   | warning at ≥ 80 % used; snaps on data ticks; `fillOnce` for the one permitted fill                                                                       |
| `UsageAsOf`                              | "usage as of 14:02", en-IN 24-hour, `<time datetime>`                                                                                                            | `viewerTimeZone` appends the zone; `tone="warning"`; `lang="hi"`                                                                                         |
| `BoardingPass`                           | Gift to an ENS name: perforated stub with PIN and QR, TO / FROM / DATA / CITY / VALID UNTIL                                                                      | countdown as text (`Countdown`): minutes, seconds under 1 h; open / claimed / lapsed                                                                     |
| `OnchainAction`                          | The eight-state receipt-shaped sheet below; props are a union per state so a hash is required from `submitted` on                                                | stuck flag at 2× expected; `declined` and `blocked` on idle; every 0x value via `Hash` (copy + explorer)                                                 |
| `Receipt`                                | Three ruled lines: you / sponsor / network fee                                                                                                                   | `labels` for the card back; `failed` tints only the amount                                                                                               |
| `Button`, `Field`                        | 48 px primitives; one teal primary carrying the amount; neutral field errors                                                                                     | `variant` primary / secondary / quiet                                                                                                                    |
| `Hash`, `Countdown`, `RuledList`, `Icon` | Shared pieces                                                                                                                                                    | Lucide paths at stroke 1.5, allowed set only                                                                                                             |
| `PrintSheet` + `print.css`               | 10 ISO ID-1 cards per A4 with perimeter crop marks, or one 91.6 × 59.98 mm page per card                                                                         | `side` front / back (mirrored for duplex) / keyline                                                                                                      |

Tests: `pnpm --filter @ethglobal/ui test` (vitest + Testing Library in jsdom, the print.css snapshot, the
design-ban grep over `packages/ui/src` and `apps/web/app`); `pnpm --filter @ethglobal/ui test:print` renders
`/ui/print?count=10` to PDF in headless Chromium (build the web app first) and checks one page, PINs as text.

## Usage

```css
/* app/globals.css */
@import '@ethglobal/ui/fonts.css';
@import 'tailwindcss';
@import '@ethglobal/ui/tokens.css';
@import '@ethglobal/ui/tailwind.css';
@import '@ethglobal/ui/components.css';
```

```html
<html lang="en" data-type="ledger">
  <!-- data-theme="light|dark" pins the theme; omit it to follow the system -->
</html>
```

`fonts.css` loads all nine families through one Google Fonts `@import`, with every comma percent-encoded:
Next 16.4 / Turbopack drops an external `@import` whose URL contains a literal comma (bisected against
production builds), and the Tailwind pipeline only keeps the import when it is the first statement of the
entry stylesheet, hence the import order above.

Colour tokens are written once with `light-dark()`; `color-scheme` on `:root` follows `prefers-color-scheme`
and `[data-theme]` overrides it. A sub-tree opts into one palette with `data-color-scheme="light|dark"`, which
re-declares the tokens there (`color-scheme` alone on a descendant does not flip values already resolved on `:root`).
Rules that travel with the tokens: one accent on at most ~5 % of pixels, never a gradient; P&L uses
`--positive` / `--negative`, never series colours; series keep a fixed order and a 7th series folds into
"Other"; animate only `transform` and `opacity`; `prefers-reduced-motion` collapses durations to ≤ 100 ms.

`pnpm --filter @ethglobal/ui test` checks that every name exported from `index.ts` is declared in the CSS.

## Onchain action states

One component, used for every transaction. Eight states; the UI rows from design-foundations §6 map onto
them as follows. "Stuck" is not a state but a flag raised on `submitted`/`pending` after 2× the expected
time, and "Rejected in wallet" is the `signing → idle` edge.

| State       | §6 row              | What the user sees                                                                                                                                                                      | Leaves to                                                                                                                    |
| ----------- | ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `idle`      | Review              | Amount, recipient, network, itemised fee, ETA, worst case. Pre-flight checks (balance incl. fee, allowance, device/network) run here so the wallet never opens for a doomed transaction | `signing`                                                                                                                    |
| `signing`   | Confirm in wallet   | "Approve in <wallet>…" with cancel; simulation summary when the stack provides one                                                                                                      | `submitted` (signed and broadcast), `idle` (rejected in wallet, inputs intact, neutral tone), `failed` (pre-broadcast error) |
| `submitted` | Sending             | Hash shown immediately (`0x1a2b…9f3e`, copy, explorer link), elapsed time, determinate ring sized to typical block time. Hash persisted locally so a reload reconciles                  | `pending`, `failed`, `replaced`                                                                                              |
| `pending`   | Sending             | Transaction visible to the network, awaiting its first confirmation. Past 2× expected time the row shows speed up / cancel (one sentence, same component, no modal)                     | `confirmed`, `failed`, `replaced`                                                                                            |
| `confirmed` | Confirmed           | ≥ 1 confirmation, result applied with a quiet "settling" tag; _available_ and _pending_ balances shown separately; optimistic only for the user's own view                              | `finalized`, `pending` (reorg)                                                                                               |
| `finalized` | Final               | Chain-specific finality (L2 safe/finalized, Hedera consensus): "Paid · Final" as metadata; receipts cite it                                                                             | terminal                                                                                                                     |
| `failed`    | Failed on chain     | Decoded revert in plain words, the next step, the hash, and the note that the network fee was still charged. Never "Something went wrong"                                               | `idle` (retry)                                                                                                               |
| `replaced`  | Stuck → replacement | A same-nonce replacement (speed-up or cancel) superseded this transaction; the new hash starts a new row at `submitted`                                                                 | terminal                                                                                                                     |

`onchainActionTransitions` in `index.ts` encodes the "Leaves to" column; `canTransition(from, to)` guards it.
Invariants: never a bare spinner after `signing`; hashes are shown the moment they exist; third-party state
waits for `confirmed`; the stuck flag never opens a modal.
