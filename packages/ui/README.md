# @ethglobal/ui

Design tokens for every surface in the monorepo, implemented from `research/design-foundations.md`.
No components yet; those arrive with the product.

| File           | Contents                                                                                                                                                                                                                                           |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tokens.css`   | §4 OKLCH colour tokens (surfaces, borders, text, accent, positive/negative/warning, six data-viz series), §3 type scale, §6 motion durations/easings/spring                                                                                        |
| `fonts.css`    | The three type pairings as `[data-type="ledger" \| "terminal" \| "bazaar"]`, Google Fonts `@import … &display=swap`, `tabular-nums` on `html`, hash/address mono rule, Devanagari rules, `.tnum` / `.tnum-zero` / `.pnum` / `.density-*` utilities |
| `tailwind.css` | `@theme inline` bridge so Tailwind v4 emits `bg-canvas`, `text-ink-secondary`, `bg-series-3`, `font-display`, `text-14`, `ease-standard`, …                                                                                                        |
| `index.ts`     | Typed token names, the type scale, motion values for JS animation, and the onchain action state machine vocabulary                                                                                                                                 |

## Usage

```css
/* app/globals.css */
@import '@ethglobal/ui/fonts.css';
@import 'tailwindcss';
@import '@ethglobal/ui/tokens.css';
@import '@ethglobal/ui/tailwind.css';
```

```html
<html lang="en" data-type="ledger">
  <!-- data-theme="light|dark" pins the theme; omit it to follow the system -->
</html>
```

Colour tokens are written once with `light-dark()`; `color-scheme` on `:root` follows `prefers-color-scheme`
and `[data-theme]` overrides it. Any element can opt into the other palette with `color-scheme: dark`.
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
