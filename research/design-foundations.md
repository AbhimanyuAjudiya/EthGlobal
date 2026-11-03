# Design foundations (idea-agnostic) — ETHGlobal Mumbai 2026

**Prepared:** 3 Nov 2026. **Scope:** the visual and interaction layer that must hold whichever product is chosen (merchant soundbox + dashboard, sealed trading-calls desk, verified-human data market, bot-pricing middleware, token-auction terminal, eSIM app, tax-withholding hook UI, ROSCA). A second pass adds category-specific references once the idea is fixed.

**Method and caveats.** 12 web searches on 2 Nov 2026. Direct fetches of most design sites (benji.org, cred.club, vercel.com, linear.app, agency blogs) are blocked by this session's network allow-list, so product observations lean on third-party style breakdowns and press and are marked as such. Two sections are *verified* rather than quoted: the typography table (every candidate downloaded from `github.com/google/fonts` `main` and inspected with fontTools) and the colour tokens (WCAG ratios computed; chart series run through the dataviz palette validator). Everything else is design opinion.

## 0. The brief in one paragraph

The products the founder admires share no visual style: Hyperliquid is near-black with one mint accent, Zerodha Kite is white and tiny, CRED is black with serif headlines, Family is soft and animated, Linear is a tuned grotesque on a dark canvas. What they share is a visible decision at every layer: a display face chosen for a reason, a text face with tabular figures, a neutral ramp with a temperature, exactly one accent, motion that only explains a state change, copy that says a number. "AI slop" is the absence of decisions, the statistical mean of Tailwind docs and 2021 Dribbble shots, which is why it is recognisable in two seconds ([Anti-AI-UI](https://github.com/Vanszs/Anti-AI-UI), [Purple Gradient Problem](https://dev.to/james_anderson_h/the-purple-gradient-problem-why-ai-ui-all-looks-alike-and-how-to-fix-it-3j65)). The test for every screen this week: *swap the logo for a competitor's; would anyone notice?*

## 1. Tells of AI-generated UI — the ban list

The 2025–26 discourse is codified in pieces that converge on one list: [925 Studios](https://www.925studios.co/blog/ai-slop-design-tells), [Mania Design](https://www.mania.design/blog/spot-the-slop-a-ui-designers-guide-to-fixing-ai-defaults/), [smoothui](https://smoothui.dev/blog/ai-design-slop), [vibecodekit](https://vibecodekit.dev/ai-slop-design), [Hallmark](https://rohitraj.tech/notes/anti-ai-slop-design-skill-hallmark-guide-2026) and [Anti-AI-UI](https://github.com/Vanszs/Anti-AI-UI), whose README cites arXiv:2603.13036 on design homogenisation in "vibe coding" (arXiv unreachable here; unverified). Most authors sell anti-slop tooling; the list still matches what reviewers flag. Banned, with why each reads as machine output:

1. **Purple/indigo/violet accents and purple→blue or purple→cyan gradients, gradient-filled headline text.** The most-cited tell, the default of several component kits, and Phantom's long-standing brand colour, so the wallet-category default too.
2. **Glassmorphism** (backdrop-blur, 1px white border, inner glow) and "aurora" blobs. It hides the absence of a layout.
3. **Inter (or Geist, Poppins, DM Sans) as the only face at default weights.** "Nobody made a typography decision" (925 Studios); Poppins and DM Sans also lack tabular figures (verified, §3), so numbers wobble.
4. **The centered hero composite**: H1 + subhead + dual CTA + "Trusted by" strip + three feature cards with icon-in-tinted-square. Any three together is the signature (Anti-AI-UI).
5. **One radius everywhere** (`rounded-2xl`), cards nested in cards, left-border callout cards.
6. **Emoji as icons or bullets**, mixed icon sets, icons in coloured circles.
7. **Hype copy**: Supercharge, Unlock, Seamless, Effortless, Empower, Next-gen; rhetorical triads; "Welcome back, User!".
8. **`hover:scale-105`**, bounce easings, every section fading-and-rising on scroll, count-up stats, infinite logo marquees.
9. **The stock dashboard**: four KPI cards with sparklines and a green "+12.5%", a donut, "Recent activity", a sidebar of eight generic icons.
10. **Fake specificity**: "10k+ users", "99.9% uptime", five-star testimonial cards, a "Most popular" pricing badge, before any of it is true.
11. **Dark mode as inversion**: `#000` canvas, `#fff` text, blue-grey slate, neon glow borders, 1px gradient borders.
12. **Two elevation systems at once**: `shadow-xl` under every card *and* a border.
13. **Undisciplined numbers**: proportional figures, misaligned columns, `$1,234,567.891234`, four-decimal percentages, no units.
14. **One state only**: no empty states, generic shimmer for loading, a toast or a modal for everything.
15. **Untouched kit defaults**: shadcn zinc + 0.5rem radius + default Button; Lucide at 24px everywhere.
16. **Badge inflation**: pills, chips, "Beta"/"New" tags, rainbow tag colours.
17. **Hero imagery**: 3D blobs, isometric coins, "abstract network" lines, floating angled phone mockups, mesh gradients.
18. **Monotonous rhythm**: every section `max-w-7xl`, `py-24`, centered and symmetric; no full-bleed moment.
19. **Chart slop**: rainbow categorical colours, dual y-axes, gradient fills under lines, 3D donuts, missing axis labels.
20. **Web3 slop**: "Connect Wallet" as the only CTA, raw `0x…` everywhere, "Transaction submitted!" with confetti, a spinner with no hash or ETA, gas in gwei shown to a shopkeeper.

## 2. Signatures of deliberate design — adopt

1. **A real type hierarchy.** One characterful display face, one workhorse text face with tabular figures, one mono for hashes; three weights per face. Resend is the 2026 reference, "a developer tool with the typography of an editorial": a 96px display serif over a neutral sans on black ([everyonesdesign](https://everyonesdesign.pages.dev/companies/resend.html), [webtrends, Jan 2026](https://webtrends.pages.dev/news/2026-01-10-editorial-serif-tech-marketing)). CRED did it in 2022 with serif headings inside a fintech app ([UX Planet](https://uxplanet.org/thoughts-on-creds-ui-revamp-apr-2022-6d2b4dcfcfc6)). Linear shows the cheap version: Inter Variable with `cv01`/`ss03`, i.e. even the workhorse is tuned ([design-gallery](https://design-gallery.pages.dev/design/linear.app)).
2. **Density with intentional whitespace.** Hyperliquid's default screen is resizable terminal panels ([style reference](https://www.webdesignhot.com/api/design-md/hyperliquid.md)), called dense but cleaner than Binance's ten-plus modules ([OneKey](https://onekey.so/blog/ecosystem/hyperliquid-cex-ux-comparison/)). The trick: a 4px micro-grid inside rows, 24–32px between groups, grouping by proximity and rules rather than boxes.
3. **One accent, tonal neutrals, semantics reserved.** Raycast uses red "as a punctuation colour" ([shadcn.io breakdown](https://www.shadcn.io/design/raycast)); Uniswap uses pink once per screen, on the swap button ([style reference](https://www.webdesignhot.com/api/design-md/uniswap/export/google-alpha)). Green and red mean money moved and nothing else.
4. **Motion that communicates state.** The Family write-ups praised by the Bitcoin design community are about simplicity, progressive disclosure and motion that explains where things went; the same reviewer dinged one animation for stopping abruptly, which is the bar ([Studio21, Aug 2024](https://studio21design.substack.com/p/august-2024-bitcoin-design-monthly)). Nothing bounces; numbers tick; panels enter from where they logically come from.
5. **Copy that says a number.** Buttons carry the amount ("Pay ₹1,240"), labels the unit, statuses the time ("Confirmed · 14 s"). Sentence case.
6. **Iconography discipline.** One set (Phosphor or Lucide), one stroke weight, two sizes (16 inline, 20 in controls), no tinted circles, no emoji.
7. **Empty states that teach.** A ghost row with real column headers plus one verb. Airalo's October 2025 app checks device compatibility *before* asking for money and offers a connection check after ([tbreak](https://tbreak.com/airalo-app-redesign-esim-setup-uae-2025/), [TechAdvisor](https://www.techadvisor.com/article/2940256/my-favourite-esim-provider-just-got-a-major-app-upgrade.html)).
8. **Number formatting as a system.** Tabular figures; right-aligned columns; fixed decimals per asset (INR 0 or 2, USDC 2, ETH 4, percentages 2); `Intl.NumberFormat('en-IN')` for ₹1,20,000 and ₹1.2 Cr; fiat first; addresses as `0x1a2b…9f3e` with copy and explorer link; relative time with absolute on hover.
9. **Skeletons shaped like content.** The loading state is the real layout with text replaced by blocks of the right width; numbers arrive last; layout never shifts. Kite ships light and dark and a denser Terminal Mode ([Z-Connect, 31 Oct 2025](https://zerodha.com/z-connect/?p=432223)): density is a setting.
10. **Haptics-like micro-interactions.** Pressed = 98% scale + 6% darker in 80 ms; a success tick drawn once; slide-to-confirm for irreversible money moves; toggles with a short thump; on iOS, light-impact and success haptics.
11. **Dark/light parity by design.** Dark canvas around L 0.14–0.18, text around L 0.93, accent chroma down 15–30%, elevation via lightness not shadow ([OKLCH patterns](https://dev.to/raxxostudios/oklch-first-color-systems-5-patterns-and-the-wide-gamut-wins-12p1)). Both modes mandatory: merchants in daylight, traders at night.
12. **Product as the hero.** Raycast's marketing chrome "is genuinely the same surface" as the product ([design-gallery](https://design-gallery.pages.dev/design/raycast)); Linear avoids the screenshot-in-hero its imitators copy ([webtrends](https://webtrends.pages.dev/posts/linear-landing-page-breakdown)).
13. **Keyboard-first on desktop.** ⌘K palette, shortcuts printed beside actions, designed focus rings (2px accent, 2px offset). Kalshi's new "Bloomberg Terminal-style" interface shows where serious retail markets are heading ([KuCoin flash](https://www.kucoin.com/news/flash/kalshi-launches-bloomberg-terminal-style-interface-for-prediction-market-traders)).
14. **One dominant element per screen.** Uniswap's swap card is the page; Polymarket's market page is one probability with a chart under it ([2026 review](https://ai-trading-ranked.pages.dev/posts/polymarket-review-2026)). Make the number 2× everything else.

## 3. Type system — three verified pairings

**Verification.** 147 Google Fonts families were downloaded from `google/fonts` `main` on 2 Nov 2026 and inspected with fontTools for the `tnum` feature, digit advance widths, Devanagari `locl` language systems (`MAR` = Marathi forms), the ₹ glyph (U+20B9) and variable axes (Appendix A). Headlines: **Poppins, DM Sans, Hind, Yantramanav and Fraunces have neither `tnum` nor equal-width digits** (display words only, never amounts); **Instrument Sans, Red Hat, Onest, JetBrains Mono, Outfit, Sora, Karla and Space Mono have no ₹ glyph** (the rupee would render in a fallback); IBM Plex has no `tnum` because its digits are already tabular. All three pairings are OFL, on Google Fonts, and self-hostable via `@fontsource` (npm, `fonts.googleapis.com` and `fonts.gstatic.com` are all reachable from the build container).

### A. "Ledger" — editorial-financial (dashboards, desks, anything CRED/Mercury-adjacent)
- **Display: Eczar** (Rosetta / Vaibhav Singh; variable 400–800; Latin + Devanagari in one file; `tnum`, ₹; Marathi `locl`). A high-contrast serif that sets *Hindi headlines natively*, so bilingual screens keep one voice.
- **Text: Schibsted Grotesk** (Bakken & Bæck, 2023; variable 400–900; `tnum`, `zero`, ₹): newsy, slightly narrow, unused in crypto. **Devanagari text: Mukta** (Ek Type, Mumbai; 7 weights; `tnum`; `HIN`/`MAR`) served only for U+0900–097F via `unicode-range`.
- **Mono: IBM Plex Mono** (₹; dotted zero, slashed via `zero`).
- Fallbacks: `Georgia, "Noto Serif Devanagari", serif` / `system-ui, "Noto Sans Devanagari", sans-serif` / `ui-monospace, Menlo, monospace`.

### B. "Terminal" — data-dense desktop (auction terminal, trading desk, pricing console)
- **One family, IBM Plex**: Plex Sans `[wdth 75–100, wght 100–700]` for UI (tabular digits by default, ₹, six stylistic sets); **IBM Plex Sans Devanagari** (Mike Abbink / Bold Monday; 7 weights; Latin + Devanagari; ₹) for Hindi/Marathi; **IBM Plex Mono** for hashes, amounts and order IDs. The width axis is the density control: `wdth 85` in tables, `100` in forms.
- **Optional display: Archivo** `[wdth 62–125]` (Omnibus-Type; `tnum`, `zero`, ₹) at `wdth 125, wght 600` for the one hero number per screen.
- Rationale: Plex reads as instrument, not SaaS; coherent across scripts without x-height surgery; not an LLM default.

### C. "Bazaar" — mobile-first Indian consumer (soundbox app, ROSCA, eSIM)
- **Anek Devanagari** (Ek Type, 2022; variable `wdth 75–125, wght 100–800`; Latin + Devanagari; `tnum`, `zero`, ₹; `HIN`/`MAR`) does **display and text in both scripts**: `wdth 110 / wght 700` for amounts and headlines, `wdth 100 / wght 400–500` for body. One variable file, a Mumbai foundry, a face no template ships.
- **Mono: Chivo Mono** (Omnibus-Type; variable 100–900; `tnum`, `zero`, ₹) or Plex Mono.
- **Alternative display: Baloo 2** (Ek Type; rounded; `tnum`; `HIN`/`MAR`) when warmth beats precision.

### Rules for all three
- `font-variant-numeric: tabular-nums` on `html`; `slashed-zero` on addresses and hashes.
- Set `lang="hi"` / `lang="mr"`: the `MAR` language system swaps Marathi letterforms (ल, श) automatically in Anek, Mukta, Eczar, Baloo 2 and Noto. Tiro Devanagari (Tiro Typeworks: John Hudson, Fiona Ross, Paul Hanslow) ships separate Hindi and Marathi fonts for the same reason.
- Devanagari: `line-height ≥ 1.6`, no `letter-spacing`, no `text-transform`, no italics, a 14px floor where Latin gets 13px, 20–30% more width budgeted.
- Numerals stay Latin (as PhonePe and Google Pay do), formatted `en-IN`.
- Scale 11 / 12 / 13 / 14 / 16 / 20 / 24 / 32 / 44 / 64; leading 1.1–1.2 display, 1.45 text, 1.6 Devanagari; `size-adjust` in `@font-face` to match x-heights across scripts.

```css
/* Pairing A wiring; swap names for B or C */
@font-face{font-family:"Mukta";src:url(/fonts/mukta-400.woff2) format("woff2");font-weight:400;
  font-display:swap;size-adjust:104%;
  unicode-range:U+0900-097F,U+1CD0-1CF9,U+200C-200D,U+20A8,U+A830-A839,U+A8E0-A8FF;}
:root{
  --font-display:"Eczar",Georgia,"Noto Serif Devanagari",serif;
  --font-text:"Schibsted Grotesk","Mukta",system-ui,"Noto Sans Devanagari",sans-serif;
  --font-mono:"IBM Plex Mono",ui-monospace,Menlo,monospace;}
html{font-family:var(--font-text);font-variant-numeric:tabular-nums;}
[data-hash],[data-address],.amount-mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums slashed-zero;}
:lang(hi),:lang(mr){line-height:1.6;letter-spacing:0;text-transform:none;font-style:normal;}
```

## 4. Colour — tonal neutrals, one accent, verified tokens

**Approach.** Neutrals carry the identity: a warm ink ramp (OKLCH hue 70–80, chroma 0.004–0.012) that reads as paper and charcoal, not Tailwind slate. One accent on at most ~5% of pixels (primary action, focus, selection, links), never a gradient. Semantic hues are reserved: positive 150, negative 25, warning 75–85. **Accent window rule:** the accent hue sits ≥40° from every semantic hue and outside 260–300 (purple/indigo), which leaves 185–225 (teal→azure) or 325–350 (rose). Default: "oxide" teal 195; the rose alternative (`oklch(0.55 0.17 350)` light / `oklch(0.78 0.13 350)` dark) also passes. Dark mode is its own set of steps. Hex is the sRGB rendering.

```css
:root{
  --bg-canvas:oklch(0.985 0.004 80);   /* #fbfaf7 */
  --bg-surface:oklch(0.995 0.002 80);  /* ≈#fdfcfa */
  --bg-sunken:oklch(0.962 0.006 80);   /* #f5f2ee */
  --bg-raised:oklch(0.995 0.002 80);
  --border-subtle:oklch(0.90 0.006 80);/* #e0deda */
  --border-strong:oklch(0.76 0.008 80);/* #b4b1ab, decorative rules only */
  --border-input:oklch(0.64 0.010 80); /* #8f8c85, 3.2:1 for WCAG 1.4.11 */
  --text-primary:oklch(0.20 0.012 70); /* #1a1510 */
  --text-secondary:oklch(0.44 0.012 70);/* #57514c */
  --text-tertiary:oklch(0.55 0.010 70);/* #75716b */
  --text-disabled:oklch(0.70 0.008 70);/* #a29e99, no AA claim */
  --accent:oklch(0.52 0.085 195);      /* #117878 */
  --accent-hover:oklch(0.46 0.075 195);
  --accent-subtle:oklch(0.95 0.030 195);/* #d8f5f5 */
  --on-accent:oklch(1 0 0);
  --positive:oklch(0.50 0.13 150);     /* #137738 */
  --positive-subtle:oklch(0.93 0.06 150);/* #ccf4d3 */
  --negative:oklch(0.52 0.17 25);      /* #b63132 */
  --negative-subtle:oklch(0.94 0.035 25);
  --warning:oklch(0.52 0.105 75);      /* #8c5f0e */
  --warning-subtle:oklch(0.95 0.05 85);
  --focus:var(--accent);
  /* categorical series: fixed order, never cycled; validated for light */
  --series-1:#00948e;--series-2:#cf7b26;--series-3:#a04c9a;
  --series-4:#8b8c1f;--series-5:#2063b0;--series-6:#96353b;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg-canvas:oklch(0.16 0.006 70);    /* #0f0d0b */
  --bg-surface:oklch(0.20 0.007 70);   /* #181613 */
  --bg-sunken:oklch(0.13 0.005 70);    /* #080706 */
  --bg-raised:oklch(0.24 0.008 70);    /* #221f1b */
  --bg-overlay:oklch(0.28 0.008 70);   /* #2b2825 */
  --border-subtle:oklch(0.30 0.008 70);--border-strong:oklch(0.44 0.008 70);
  --border-input:oklch(0.50 0.010 70); /* #67625d, 3.2:1 */
  --text-primary:oklch(0.93 0.006 80); /* #eae7e3 */
  --text-secondary:oklch(0.72 0.008 80);/* #a7a49f */
  --text-tertiary:oklch(0.63 0.008 80);/* #8c8984 */
  --text-disabled:oklch(0.48 0.008 80);
  --accent:oklch(0.78 0.11 195);       /* #4fcdcd */
  --accent-hover:oklch(0.84 0.10 195);
  --accent-subtle:oklch(0.25 0.03 195);
  --on-accent:oklch(0.16 0.006 70);    /* dark text on a light accent, Hyperliquid-style */
  --positive:oklch(0.78 0.14 150);     /* #6fd087 */
  --positive-subtle:oklch(0.24 0.04 150);
  --negative:oklch(0.74 0.15 25);      /* #fb817a */
  --negative-subtle:oklch(0.25 0.05 25);
  --warning:oklch(0.82 0.13 80);       /* #f0ba59 */
  --warning-subtle:oklch(0.26 0.04 80);
  --series-1:#0e9a94;--series-2:#cb7d34;--series-3:#ae5ea8;
  --series-4:#91922f;--series-5:#407bc5;--series-6:#b5494e;
}}
/* repeat the dark block under :root[data-theme="dark"] for the manual toggle */
```

**Verified contrast (WCAG 2 ratio on the sRGB rendering).** Light: primary text 17.4:1 on canvas, secondary 7.5, tertiary 4.7, accent-as-text 5.1, white on accent 5.3; positive/negative/warning 5.4 / 5.8 / 5.4 on canvas and 4.7 / 4.9 / 4.8 on their tints. Dark: primary 15.8, secondary 7.8, tertiary 5.6 (4.7 on raised), accent 10.1, ink on accent 10.1; positive/negative/warning 10.2 / 7.9 / 11.0 and 8.6 / 6.6 / 8.8 on tints. Every text pair clears AA; input borders clear 3:1; `--text-disabled` and `--border-strong` make no claim.

**Chart series.** The six slots pass the dataviz validator in both modes: lightness band, chroma ≥ 0.10, adjacent CVD ΔE 12.7 light / 12.2 dark (target ≥ 8), normal-vision floor 22.9 / 20.0 (≥ 15), all ≥ 3:1 on surface. Rules: fixed order, a 7th series folds into "Other"; scatter and maps carry at most two slots (1 and 3 fail the all-pairs deutan check); sequential ramps are one hue light→dark; diverging is positive/negative around a neutral midpoint; P&L uses semantic tokens, never series; chart text wears text tokens.

## 5. Layout and component principles

### (a) Data-dense desktop terminal / dashboard
- **Shell:** 48px icon rail (240px expanded) + a CSS grid of resizable panes (react-resizable-panels), persisted per user. Panes get a 1px `--border-subtle`, no shadow; dark elevation runs canvas → surface → raised → overlay by lightness.
- **Tables are the product:** 28–32px rows at 12–13px; text left, numbers right, units in the header; sticky header; hover row; one accent for the selected row. Deltas flash the cell background (120 ms in, 600 ms out); digits never animate.
- **Hierarchy:** one hero figure per pane at 24–32px in the display face; everything else 12–14px. No KPI-card row by default; a KPI is a single number with unit and a one-line delta.
- **Keyboard:** ⌘K, `j/k` rows, `/` filter, hints in the mono face.
- **Density toggle** (compact/comfortable) on day one, as Kite's Terminal Mode. Dark default, light fully designed.

### (b) Mobile-first consumer flows
- **Thumb architecture:** primary action in the bottom 25%; bottom sheets, not modals; a labelled 4–5 item tab bar; 48px targets; 16px gutters; one column.
- **Money is a sequence, not a form:** amount (big numeric pad, display face, ₹ first) → recipient → review (fees, ETA, worst case) → confirm (slide or biometric) → receipt (shareable; hash behind a disclosure). PhonePe's 2025 home is a bento of modules on its WidgetX framework ([YourStory](https://yourstory.com/2025/04/phonepe-reimagining-financial-empowerment), [PhonePe tech blog](https://tech.phonepe.com/category/mobile/)); borrow the grouping, not the density.
- **Progressive disclosure** per Family: one thing shown, the next revealed on intent.
- **Network reality:** cached data with a timestamp when offline; silent retries; nothing blocks on a pending transaction.
- **Bilingual by construction:** every string has a Devanagari variant; layouts tested with the longest Marathi string.

### (c) Marketing page that is not a template
- First fold is the **live product component**, not a screenshot or mockup.
- Asymmetric grid (5/7 or 4/8); display type at `clamp(40px, 7vw, 96px)` in sentence case stating a verifiable number; one CTA; no "Trusted by", no three-card grid; two full-bleed moments; section widths that vary by content.
- Monochrome plus the accent; photographs of real merchants and receipts over illustration; real company details (CIN/GST once incorporated); real pricing or none.
- Entrances: at most one per viewport, 200 ms, opacity + 8px; no parallax, marquee or scroll-jacking.

## 6. Motion and onchain state

**Durations and easings.** Micro (press, toggle) 80–120 ms; state change (hover, selection, tab, tooltip) 150–200 ms; spatial (sheet, drawer, pane, route) 220–300 ms in, 0.8× out. Standard easing `cubic-bezier(0.2, 0, 0, 1)`, exits `cubic-bezier(0.3, 0, 1, 1)`, gestures on a spring (stiffness ≈ 400, damping ≈ 35) so sheets track the finger. Animate only `transform` and `opacity`; never layout, colour on scroll, or table rows on data ticks. No bounce, overshoot, scale-on-hover or gradient animation. `prefers-reduced-motion` collapses everything to opacity at ≤ 100 ms. One permitted flourish: an odometer on the hero number, ≤ 400 ms.

**Onchain action states** (one component, used everywhere):

| State | What the user sees | Rules |
|---|---|---|
| Review | Amount, recipient, network, itemised fee, ETA, worst case | Pre-flight checks run here (balance incl. fee, allowance, device/network) so the wallet never opens for a doomed transaction |
| Confirm in wallet | "Approve in Phantom/MetaMask…" with cancel | Show a simulation summary (what leaves, what arrives) when the stack provides one |
| Sending | Hash immediately: `0x1a2b…9f3e`, copy, explorer link; elapsed time; a determinate ring sized to typical block time | Never a bare spinner; persist pending hashes locally so a reload reconciles |
| Confirmed | 1 confirmation; result applied with a quiet "settling" tag; *available* and *pending* balances shown separately | Optimistic updates only for the user's own view; third-party state waits |
| Final | Chain-specific (L2 safe/finalized, Hedera consensus): "Paid · Final" as metadata | Receipts cite finality; trading UIs show it on hover |
| Rejected in wallet | Back to Review, inputs intact | Not an error; neutral tone |
| Failed on chain | Decoded revert in plain words, next step, the hash, and the honest note that the network fee was still charged | Never "Something went wrong" |
| Stuck | After 2× expected time: speed up / cancel via replacement, one sentence of explanation | Same component, new row, no modal |

## 7. Copy and microcopy voice

**Rules.** Sentence case. Verbs on buttons, with the amount. Numbers over adjectives. Present tense. No exclamation marks, emoji or "oops". One idea per sentence, 12 words max in UI. Fees itemised before the wallet prompt. Risk as a worst case in rupees with a date, never a label. One approved plain term per jargon word, identical in UI, docs and support.

| Avoid | Use |
|---|---|
| Supercharge your payments | Settle UPI-size payments in 3 s for 0.3% |
| Transaction submitted! 🎉 | Sending · 0x1a2b…9f3e · 4 s |
| Gas: 21000 × 12 gwei | Network fee ₹0.90 (included in total) |
| Slippage tolerance 0.5% | Price may move up to 0.5% before this settles; you get at least 1,240.00 USDC |
| High-risk product | You could lose up to ₹1,240 if the pool fails; funds are locked until 14 Nov |
| Approve token | Allow this app to use up to 1,500 USDC from your account (one-time) |
| Connect wallet | Continue with Phantom / Create account |
| Something went wrong | Didn't go through: the price moved more than 0.5%. Nothing left your account except the ₹0.90 network fee. Try again |

**Glossary for non-crypto users:** gas → network fee; wallet → account (show a QR, not the address); seed phrase → recovery phrase; sign → approve in your wallet; bridge → move to [network]; USDC → digital dollars (USDC); finality → final; revert → didn't go through; nonce, mempool, gwei, calldata → never shown. Indian statutory items (1% TDS, 30% gains treatment) are explicit line items with the statutory name and a link, never folded into "fee"; Indian-user wording needs legal review before launch.

## 8. Ten screens to study, one thing to borrow from each

1. **Hyperliquid trade** (app.hyperliquid.xyz/trade): near-black, one mint accent, resizable panes, dark text on light accent buttons ([style reference](https://www.webdesignhot.com/api/design-md/hyperliquid.md), [OneKey](https://onekey.so/blog/ecosystem/hyperliquid-cex-ux-comparison/)). Borrow: the accent as a *state* colour.
2. **Kalshi terminal** (kalshi.com): Bloomberg-style grid for traders beside a Robinhood-simple mobile app ([KuCoin flash](https://www.kucoin.com/news/flash/kalshi-launches-bloomberg-terminal-style-interface-for-prediction-market-traders), [comparison](https://www.kucoin.com/blog/polymarket-vs-kalshi-2026-comparison)). Borrow: two densities from one data model.
3. **Polymarket market page** (polymarket.com): probability as the hero, TradingView chart beneath, 2026 web redesign and late-2025 native apps per a [review](https://ai-trading-ranked.pages.dev/posts/polymarket-review-2026); experiments in [Human Invariant](https://humaninvariant.substack.com/p/novel-interface-designs-for-prediction). Borrow: one number, 2× everything else.
4. **Uniswap swap card** (app.uniswap.org): Basel (Lift Type) for display and body, large-radius hero card, pink once ([style reference](https://www.webdesignhot.com/api/design-md/uniswap/export/google-alpha); content sites by [Sanctuary Computer](https://www.sanctuary.computer/uniswap)). Borrow: one hero element per screen.
5. **Family** (family.co): progressive disclosure and motion that explains; the founder's "Family Values" post is the canonical text ([Studio21](https://studio21design.substack.com/p/august-2024-bitcoin-design-monthly)). Borrow: an animation that stops abruptly is a bug.
6. **CRED** (cred.club; open-source [NeoPOP](https://github.com/CRED-CLUB/neopop-web), Apache-2.0): serif headings in fintech, a predecessor system "built to highlight numbers", extruded buttons ([UX Planet](https://uxplanet.org/thoughts-on-creds-ui-revamp-apr-2022-6d2b4dcfcfc6), [AIM](https://analyticsindiamag.com/cred-open-sources-its-ui-design-system-neopop/)). Borrow: numbers as typography; luxury without gradients.
7. **Linear** (linear.app): tuned Inter, dark-first, a six-week UI redesign ([design-gallery](https://design-gallery.pages.dev/design/linear.app), [redesign post via daily.dev](https://app.daily.dev/posts/how-we-redesigned-the-linear-ui-part--rovtqjd5k)). Borrow: tune the workhorse; keyboard everything.
8. **Raycast** (raycast.com): marketing chrome equals product chrome; red as punctuation ([shadcn.io](https://www.shadcn.io/design/raycast)). Borrow: the landing page is the app.
9. **Resend** (resend.com): 96px display serif over a neutral sans on black ([everyonesdesign](https://everyonesdesign.pages.dev/companies/resend.html)). Borrow: type contrast is the cheapest way to not look generated.
10. **Zerodha Kite** (kite.zerodha.com): white, dense, no marketing inside the terminal, light and dark, Terminal Mode ([Z-Connect](https://zerodha.com/z-connect/?p=432223), [APKMirror](https://www.apkmirror.com/apk/zerodha/kite-by-zerodha/kite-by-zerodha-3-2-8-release/)). Borrow: restraint as brand; density as a setting.

Also: **Airalo's Oct 2025 app** for pre-flight checks ([tbreak](https://tbreak.com/airalo-app-redesign-esim-setup-uae-2025/), [tuttoandroid](https://www.tuttoandroid.net/news/2025/10/14/nuova-app-airalo-esperienza-migliorata-1122066/)); **Saily**, the cleanest eSIM UI in a 2026 roundup ([EarthSIMs](https://www.earthsims.com/esim/best-esim-apps-2026/)); **PhonePe's bento home** ([design.phonepe.com](https://design.phonepe.com/)); and the **Base app** as a caution: Coinbase Wallet became a Farcaster-fed social super-app in July 2025 ([The Block](https://www.theblock.co/post/362713/coinbase-unveils-base-app-rebrands-wallet-as-all-in-one-social-and-trading-platform), [Bankless](https://www.bankless.com/read/base-app-preview)) and was reportedly being rebuilt trading-first after users found it too social ([DigitalToday](https://www.digitaltoday.co.kr/en/view/1421/coinbase-base-app-shifts-to-trading-focus-scales-back-social-features), single source). Do one thing on the first screen.

**From memory, unverifiable this session, confirm before citing:** Stripe's "Test mode" rail as the model for a sandbox/live switch; Mercury's grayscale with one blue; Vercel Geist's black/white plus one blue; Rainbow's gradient as a brand asset rather than a template; Phantom's purple (since 2021) as the reason purple is the wallet default to avoid.

## Appendix A — font audit (condensed; fontTools over `google/fonts` `main`, 2 Nov 2026)

"Tab digits" = `tnum` present, or digits already equal-width ("default"). `MAR` = Marathi language system in the Devanagari `locl` table.

| Family | Axes | Tab digits | ₹ | Devanagari | MAR | Verdict |
|---|---|---|---|---|---|---|
| Eczar | wght 400–800 | tnum | Y | Y | Y | Display A |
| Schibsted Grotesk | wght 400–900 | tnum | Y | – | – | Text A |
| Mukta | 7 static | tnum | Y | Y | Y | Devanagari text A |
| IBM Plex Mono | static | default | Y | – | – | Mono A/B |
| IBM Plex Sans | wdth 75–100, wght 100–700 | default | Y | – | – | Text B |
| IBM Plex Sans Devanagari | 7 static | default | Y | Y | – | Devanagari text B |
| Archivo | wdth 62–125, wght 100–900 | tnum | Y | – | – | Display B |
| Anek Devanagari | wdth 75–125, wght 100–800 | tnum | Y | Y | Y | Display + text C |
| Chivo Mono | wght 100–900 | tnum | Y | – | – | Mono C |
| Baloo 2 | wght 400–800 | tnum | Y | Y | Y | Alt display C |
| Noto Sans (GF build) | wdth 62.5–100, wght 100–900 | tnum | Y | Y | Y | Universal fallback |
| Noto Sans Devanagari | wdth 62.5–100, wght 100–900 | default | Y | Y | Y | Fallback |
| Tiro Devanagari Hindi / Marathi | static | – | Y | Y | separate fonts | Long-form Hindi/Marathi |
| Bricolage Grotesque | opsz, wdth, wght | tnum | Y | – | – | Display option (watch 2025 overuse) |
| Newsreader | opsz, wght | tnum | Y | – | – | Editorial display option |
| Source Serif 4 | opsz, wght | tnum | Y | – | – | Editorial text option |
| Fraunces | opsz, wght, SOFT, WONK | – | Y | – | – | Display words only |
| Inter | opsz, wght | tnum | Y | – | – | Banned as default |
| Geist / Geist Mono | wght | tnum / default | Y | – | – | Banned as default |
| Poppins | static | – | Y | Y | – | Banned: no tabular digits |
| DM Sans | opsz, wght | – | Y | – | – | Banned: no tabular digits |
| Instrument Sans / Serif | wdth, wght / static | tnum / – | – | – | – | No ₹ glyph |
| JetBrains Mono | wght | default | – | – | – | No ₹ glyph |
| Space Grotesk | wght | tnum | Y | – | – | 2021 crypto default |
| Plus Jakarta Sans, Manrope, Figtree | wght | tnum | Y | – | – | Template-adjacent |
| Hind, Yantramanav | static | – | Y | Y | – | No tabular digits |

Tooling: fontTools read `GSUB.FeatureList` for `tnum`, `hmtx` for digit widths, `GSUB.ScriptList` (`dev2`) for `MAR`, `cmap` for U+20B9 and U+0915. Colour: OKLCH → linear sRGB (Ottosson matrices), clip, WCAG 2 ratio; series validated with the dataviz skill's `validate_palette.js` (`--mode light --surface #fffefd`, `--mode dark --surface #181613`).
