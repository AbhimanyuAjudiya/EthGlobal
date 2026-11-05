# Wave 3 (web) — design review of the 24 visual baselines

**Reviewer:** redteam-wave3-web, 4 Nov 2026. **Input:** `apps/web/e2e/__screenshots__/*-{light,dark}-360.png` (12 routes × 2
themes, 360 px, full page), plus five Hindi captures made for this review at 360 × 780 (`$RT_OUT/wave3-web/hi/`, not
committed — there is no Hindi baseline). **Spec:** `research/design-references.md` §1–§7 (screen by screen),
`research/design-foundations.md` §1 (ban list) and §2, `docs/build-briefs/web.md` §2 and §8. **Grep gate:**
`scripts/check-design-bans.sh` (packages/ui `tokens.test.ts` "design bans") passes — no purple hue, gradient, blur, banned
face, emoji, `hover:scale`, `shadow-xl`, Beta pill or hype word in source. The problems below are the ones a grep cannot see.

Verdict in one line: **the tokens are right and the copy is mostly verbatim, but the product object is missing.** The coupon
is a white rounded card with a big number. It has no latex, no perforation and no PIN row, so the logo-swap test fails on
`/`, `/plan` and `/card`. The fixed tab bar also hides the primary action on three money screens.

## Top 10 fixes, ranked

| #   | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Screens                            | Why it ranks here                                                                                                                                   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **The tab bar covers the primary action.** `.tab-bar` is `position: fixed` and nothing below it is padded, so "Pay $0.40 USDC" (`/pay`), the review rows and the disabled Pay (`/gift`), and the Network-fee line of the receipt (`/plan`) sit under it, and "Install eSIM · 2 min" is below the first viewport. Give `.screen` a bottom padding of `calc(var(--tab-h, 56px) + env(safe-area-inset-bottom) + 16px)` when the TabBar renders. Put the screen's one primary action in a sticky action row above the tabs ("primary action in the bottom 25 %, carrying the number").                                                      | pay, plan, gift (both themes)      | It is the money button. A judge on a phone cannot tap it without scrolling past an overlay.                                                         |
| 2   | **Ship the coupon signature.** The landing and `/card` coupons have no silver latex panel, no "rub here · यहाँ रगड़ें" (Baloo 2), no 4 × 4 PIN row, no serial/perforation idiom. Render the _unscratched_ state (§1a "the live, unscratched Coupon") with the scanned-foil WebP (≤ 60 KB) over a ghost PIN row. Drop the second "Recharge" wordmark inside the coupon: it repeats the header and the sponsor line, so "Recharge" appears 4× on `/`.                                                                                                                                                                                     | landing, card, plan                | design-references §0 thesis ("one Coupon component rendered three ways"). Without it the hero is a generic stat card, i.e. design-foundations §1.9. |
| 3   | **Make Hindi/Marathi first-class** (RT-W-08). 121 Devanagari strings render under `lang="en"`, so the `:lang(hi)` 1.6 leading never applies: the two-line landing button's matras touch the line above. Review values fall back from Chivo Mono to a monospace Devanagari with wide gaps ("इंस्टॉल से 7 दिन मान्य"). English is left in place: "Mumbai · 7 days", "Expires in", "Claim by", "Network fee", "usage as of", day names. Pass `lang` through `Button`/`Field`/`RuledList`/`Receipt`/`Countdown`/`Coupon` (also for `mr`). Never set Devanagari in the mono face. Add hi and mr baselines for `/`, `/plan`, `/pay`, `/card`. | all consumer screens               | Hindi is a stated product requirement (§6). There is no Hindi baseline at all, so the visual suite cannot catch any of this.                        |
| 4   | **Offline has to work** (RT-W-06). Offline, `/plan/<key>` renders only the header. `/offline` has no header, and its H1 "You're offline" touches the top edge: the cap height is clipped in `offline-*-360.png`. Serve a real `/plan/[key]` shell from the SW, and give `/offline` the `AppHeader` and `--space` top padding.                                                                                                                                                                                                                                                                                                           | offline, plan                      | The product's H1 is "Landing in Mumbai without data?"                                                                                               |
| 5   | **Fix the copy that is wrong** (RT-W-09). Delete "Step wording from memory; checked against real phones on Wednesday." from `/install`. Change "16 digits, on the back of the card" to "16 digits under the silver strip": the PIN is on the front, under the latex. Replace the hard-coded "Mumbai · 7 days" with the campaign's real validity: `/plan` says "Expires in 14 d 0 h" for the same bundle.                                                                                                                                                                                                                                | install, card, gift-claim, landing | Fake specificity (§1.10) and an instruction that sends people to the wrong side of a physical card.                                                 |
| 6   | **Mono is for numbers, not sentences.** Right-column values in `RuledList` set full sentences in Chivo Mono ("Valid with your plan until Wed 18 Nov 16:20", "$0.00 — paid by the facilitator", "no free bundle · $0.40 per 100 MB"), and they wrap ragged-right in a right-aligned column. Use the text face for prose and keep mono for amounts, hashes, PINs and times. Drop the redundant row label ("Valid" / "Valid with your plan…").                                                                                                                                                                                             | pay, gift, verify (tier ledger)    | It reads like an untouched data-table kit default (§1.15). Combined with #3 it makes Hindi unreadable.                                              |
| 7   | **No orphaned chips.** The agent stepper wraps 3 + 1 ("≤ $25 / day" alone on a row). The gift sizes wrap 2 + 1 ("3 GB · $12.00" alone). The landing's two CTAs each break onto two lines at 360 px ("Prove I'm human / → 300 MB", "I'll pay · $0.40 per / 100 MB"). Use `grid-template-columns: repeat(n, 1fr)` segmented controls with shorter labels ("$1 · $5 · $10 · $25" with "/ day" once in the legend). On the landing below 400 px, stack the paths: full-width primary "Prove I'm human → 300 MB", then the pay path as the first quiet row.                                                                                  | agent, gift, landing               | A wrap with an orphan is the clearest "nobody looked at 360 px" tell.                                                                               |
| 8   | **One dominant element per screen.** `/verify`: the bold H1 dominates, but the spec makes the _sentence_ dominant (or the H1 is the sentence). `/sponsor`: the two `OnchainAction` step headings (≈ 28 px) are larger than the page title "Campaigns", and "Campaigns" appears twice. `/plan`: "300 MB" appears three times (hero, meter line, receipt header). `/install`: the status pill is meant to be the hero ("the OS's own words") but is a 14 px chip with a 4 px grey dot. Set the pill at display size, de-duplicate, and scale the sponsor step headings to the pane-title size.                                            | verify, sponsor, plan, install     | design-foundations §2.14 "make the number 2× everything else".                                                                                      |
| 9   | **Numbers as a system.** Balances use Western grouping ("999,986.80 USDC"), but web.md §8 asks for `en-IN`: "9,99,986.80 USDC". The CTA reads "Fund 1000 USDC and create" (no grouping, no decimals) where it should read "Fund $1,000.00 USDC". The `/receipts` day total shows the sponsor's cost ($0.50) on a traveller's ledger where "You" paid $0.00, so total the "You" column or label the figure "Sponsor paid". The plan expiry adds "until" where the spec has "Expires in 6 d 22 h · Sun 15 Nov 09:12 IST".                                                                                                                 | pay, sponsor, receipts, plan       | Money copy is what people screenshot. Wrong grouping on an India-first product is a credibility hit.                                                |
| 10  | **Cover what matters in the baselines, and fix the small targets.** None of the 24 screenshots shows `/sponsor/[id]`, the sponsor's dominant screen ("1,214 claims", the table). None shows iOS or Android `/install`, a Hindi screen, an error state, or the Issuing → Final transitions. Add them. Hit areas are below 44 px for the wordmark (92 × 30), `Hash` copy (28 × 28) and the sponsor rail (35 wide) (RT-W-07). Hide the on-screen QR on `/card` (a QR of the page you are on), keeping it for print and share. Give the "Why it expires by itself" and "Details" disclosures a chevron: today they read as body text.       | all                                | The visual suite is the design gate. It does not look at the screens that carry the product's argument.                                             |

## Screen by screen

Legend: **Dominant** = the one element the spec makes 2× everything else; **Strings** = exact-copy check against
design-references; **Tells** = design-foundations §1 items visible in the pixels; **Signature** = the coupon idiom; **Parity** =
dark vs light.

### `/` landing (`landing-{light,dark}-360.png`)

- **Dominant:** "300 MB" in Anek is the largest element, so this passes. But the coupon fills only the middle third. Between the sub-head and the coupon there are ≈ 70 px of dead space, and the coupon's lower half is empty.
- **Strings:** H1, sub-head, both paths, the quiet rows and the pre-flight line are verbatim. The count line "1,982 of 2,000 sponsor bundles left · Recharge (demo sponsor)" comes from `/plans` (live, not faked). Good.
- **Tells:** both CTAs wrap to two lines at 360 px (#7). "Enter a coupon PIN" and "Open my plan" have no affordance (no chevron or underline) and are 30 px tall.
- **Signature:** missing (#2). No latex, PIN row or serial. "Recharge" appears 4× (header, coupon wordmark, sponsor line ×2 because the demo sponsor is named "Recharge").
- **Parity:** good. The coupon stays paper in dark on purpose. In dark the accent CTA becomes a light teal with dark text (the Hyperliquid borrow), and the hue is outside 260–300.
- **Hindi** (captured): the H1 wraps well and the two-line human CTA has collapsed leading (lang="en"). "Mumbai · 7 days" stays English.

### `/verify` (`verify-*`)

- **Dominant:** the H1 "Prove you're one human" at 24 px bold outweighs the spec'd dominant sentence (#8).
- **Strings:** title, lede ("…not your name, not your face."), tier ledger ("Orb · 300 MB free / Document · 150 MB free / Device · no free bundle · $0.40 per 100 MB") and footnote are verbatim. The local-only "Simulated World ID" button and its note are labelled honestly, and they do not ship in live (verified).
- **Tells:** a sheet inside a page inside a bordered coupon strip (card-in-card, §1.5). The ledger values in mono wrap ragged (#6). There is no shield-check, no "Verified human" pill and no green, so the spec's bans hold.
- **Parity:** good. The notification coupon is light grey on dark, which reads as "paper".

### `/plan/[key]` (`plan-*`)

- **Dominant:** "300 MB" at 64 px passes, but it is repeated in the meter line and the receipt header (#8).
- **Strings:** "from Recharge (demo sponsor) · because you're human" matches the pattern. "usage as of 16:20" and "simulated usage" are present. Issuing rows read "Verified / Sponsor paid 0xfc08…0e86 ⧉ / Plan written to Arkiv ent_000198". "Install eSIM · 2 min" and "Later — it's under Plan" are verbatim. The expiry adds "until" (#9).
- **Tells:** the tab bar overlays the receipt's Network-fee line, and the primary CTA starts at y ≈ 790, below a 780 px viewport (#1). The "Why it expires by itself" disclosure has no affordance. The A2HS row ("Not now") and the notification explainer stack three quiet blocks under the CTAs: a sequence of fine pieces with no rhythm.
- **Signature:** the in-app coupon has no notification-variant seam (§1c "the in-app card is the same Coupon, so the video cuts lock screen → app"). It is the big-number card again.
- **Parity:** identical layout. The teal meter on sunken passes in both themes.

### `/install` (`install-*`, desktop UA)

- **Dominant:** should be the status pill in the OS's words. Here it is a 14 px chip with a near-invisible 4 px dot (#8).
- **Strings:** "No Service" ✓. "Step wording from memory; checked against real phones on Wednesday." is an internal note shipped to users (#5, RT-W-09).
- **Security-relevant pixels:** on a desktop UA the full activation code `LPA:1$local.test$…` is printed on load, with no tap and no warning, while the QR is gated (RT-W-01). The baseline is synthetic (`local.test`), which satisfies W7.
- **Missing:** there are no iOS or Android baselines, so "Didn't open? Tap again", the five iOS steps and the Android copy-code screen are never visually reviewed (#10).

### `/pay` (`pay-*`)

- **Dominant:** the `OnchainAction` sheet "Add 100 MB · $0.40" ✓.
- **Strings:** "Valid with your plan until Wed 18 Nov 16:20", "Network fee $0.00 — paid by the facilitator", "Worst case: if settlement fails you pay nothing. This approval expires in 5:00." and "Pay $0.40 USDC" are verbatim. There is no "Payment Required", coin icon or faucet, so the x402 norm is beaten.
- **Tells:** the CTA sits under the tab bar (#1). Prose is set in mono (#6). The network segment "Local chain · 999,986.80 USDC" breaks the en-IN grouping (#9). The trailing "Your agent" link dangles below the tab bar. The MB size chips carry no price, so the price appears only in the sheet title.
- **Hindi** (captured): Devanagari in the mono column falls back with wide gaps, and "Local chain" and "demo wallet" stay English.

### `/agent` (`agent-*`)

- **Dominant:** the policy sentence ✓ (24 px, the largest text on the screen).
- **Strings:** the sentence matches, except "…for $0.40 on Local chain…" where the spec says "on Hedera" (expected in local). The empty state "Your agent's top-ups will appear here" ✓. No chat UI, robot or first person, so the spec's bans hold.
- **Tells:** the stepper wraps 3 + 1 (#7). The "Add data" tab is highlighted on the Agent screen, a wrong active tab.

### `/gift` (`gift-*`)

- **Dominant:** "Who gets it?" ✓.
- **Strings:** sizes and prices are verbatim. The D-7 rule copy appears before paying: "If unclaimed by Wed 11 Nov, you can reclaim the USDC (minus network fee) here until Fri 11 Dec" ✓.
- **Tells:** size chips wrap 2 + 1 (#7). A ≈ 40 px empty status line sits between the field and the chips. The review sheet renders before any name with the title "Gift 1 GB to … · $4.00", repeats "Who gets it?" as its blocked message, and the tab bar covers it (#1). The dashed-border sheet is the third container style on one screen. No gift box, ribbon or confetti ✓.

### `/gift/claim` (`gift-claim-*`)

- **Dominant:** the PIN field. Sixty per cent of the screen is empty below a bordered card.
- **Strings:** "Enter the PIN" and "16 digits, on the back of the card" — wrong side (#5). The spec's "Approve in your wallet to claim — no payment" lead is absent when no `?id=` is present: fine, but nothing tells a recipient what to do.
- **Tells:** the PIN input shows no 4 × 4 mask or `4821 9930 1127 5064`-style placeholder (PINs are 4 × 4 everywhere else).

### `/receipts` (`receipts-*`)

- **Dominant:** the per-day ledger ✓ (rows, not cards — good).
- **Strings:** "+300 MB · Wed 11 Nov 16:20 · Local chain · Final", You / Sponsor / Network fee and "Download CSV" ✓.
- **Tells:** the day total "$0.50" is the sponsor's cost on the traveller's ledger (#9). The amounts in mono and the day total in sans make two number faces in one column. "Details" has no affordance.

### `/sponsor` (`sponsor-*`)

- **Dominant:** none. The create form is long, and the two step cards' 28 px headings outweigh the page title (#8).
- **Strings:** the empty state "Create a campaign — name, budget, bundle size by tier, hourly cap." is verbatim ✓. "Fund 1000 USDC and create" is unformatted money (#9). "Allow DataDrop to use up to 1000 USDC" exposes the contract's internal name to a sponsor (say "Allow the Recharge contract…").
- **Tells:** at 360 px the "48 px rail" becomes a wrapped text row ("Settings" alone on line 2). No KPI tiles, donut or sparkline ✓.
- **Missing:** no `/sponsor/[id]` baseline (#10). That screen holds the hero "1,214 claims", the burn bar, the claims-per-hour line and the tables. The red-team run rendered it (`rt-xss`, `rt-console-and-sw`), and its controls behave apart from RT-W-04.

### `/card/[serial]` (`card-*`)

- **Dominant:** the coupon ✓.
- **Strings:** "300 MB · Not yet redeemed", "PIN under the latex", "Check PIN" ✓, but the hint says "on the back of the card" (#5). "Claim by Wed 18 Nov" and "Mumbai · 7 days" are hard-coded English (RT-W-08/09).
- **Tells:** an on-screen QR that encodes the URL of the page you are on (#10). The label says "under the latex" while no latex is drawn until a PIN is typed (#2).
- **Signature:** the serial "e7276875" and the QR are present (the most coupon-like screen), but the latex and the 4 × 4 PIN layer are absent in the unscratched state.

### `/offline` (`offline-*`)

- **Dominant:** "You're offline", clipped at the top edge with no header or wordmark (#4).
- **Strings:** "Your last plan reading is under Plan. Payments and claims need a connection." ✓. That promise is not kept offline (RT-W-06).

## What is good (keep it)

- The tokens hold up. Warm neutrals, one teal accent within budget, no banned hue, gradient, blur or face, and dark mode is a
  designed palette (warm `#0f0d0b` canvas, the coupon kept as paper), not an inversion.
- The copy is verbatim from the spec on every English screen checked: the landing question, the honest tier ledger, the
  worst-case line, the D-7 reclaim rule before payment, the receipts header. "TESTNET · test USDC · not a sale" is on every
  money screen. No "Success!", toast, confetti or "Welcome".
- The x402 moment has none of the norm's tells (no "Payment Required" heading, coin icon or faucet). The agent is a
  sentence, not a chatbot.
- Accessibility basics pass: axe reports 0 serious/critical violations in both themes on every route, including error
  states. There is no horizontal scroll at 360 px anywhere. LCP on `/` is 984 ms at 360 px under 150 ms RTT / 1.6 Mbps /
  CPU ×4. Chromium reports the PWA installable.

## Performance note

The first load of `/` declares ≈ 822 KiB of transfer. `@ethglobal/ui/fonts.css` requests **eleven** Google Fonts families
(Anek Devanagari, Archivo, Baloo 2, Chivo Mono, Eczar, IBM Plex Mono/Sans/Sans Devanagari, Mukta, Schibsted Grotesk) on
every page, including the `/print/cards` sheet. Only the "bazaar" pairing (Anek, Archivo or the chosen text face, Chivo
Mono, and Baloo 2 for print) is used. Ship only that pairing and self-host it (`font-src 'self'`): this cuts the 3G first
load and stops sending every traveller's IP to Google before they have data.
