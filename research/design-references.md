# Design references — Recharge (category pass)

**Prepared:** 3 Nov 2026. Second pass after `design-foundations.md` (binding: ban list §1, signatures §2, pairing C §3, tokens §4, motion §6, voice §7) and `committee/DECISION.md` §8 and §6.7. Builds on the shipped tokens in `packages/ui/tokens.css`, `fonts.css` and the `OnchainAction` state machine in `index.ts`; nothing here replaces a token.

**Method and caveats.** 13 web searches on 3 Nov 2026; direct fetches of most design and vendor sites are blocked by this session's allow-list. **Verified first-hand:** Android's `EuiccManager` reference and Apple's developer-forum thread on the eSIM universal link. Competitor screens are press-reported or from memory and marked so; Wednesday's attach test (§6.7) screenshots the real iOS and Android sheets and corrects any string below.

## 0. The category in 2026

Travel-eSIM apps share five screens: compatibility check, destinations, a plan card with one big number, install stepper, usage meter. Airalo's October 2025 redesign added the two that matter: a "can this phone use eSIMs" alert *before* purchase and a one-tap "Check Your Connection" returning green (mobile data) or orange (Wi-Fi only) *after* install ([TechAdvisor](https://www.techadvisor.com/article/2940256/my-favourite-esim-provider-just-got-a-major-app-upgrade.html), [mid-east.info](https://mid-east.info/airalo-launches-smart-new-app-design-getting-connected-just-got-easier)). Saily's founder admits the last step stays manual — "you still have to go into the settings and flip the switch yourself" ([TechRadar](https://techradar.com/pro/we-have-to-make-esims-as-simple-as-possible-saily-says-removing-friction-is-the-next-big-battle-for-democratizing-travel-esims)). Revolut earns praise only for terse low-data notifications ([Yesim](https://blog.yesim.tech/revolut-review/)). The x402 "paywall" norm is a centred page: coin icon, "Payment Required", faucet link, loader ([rust-x402](https://docs.rs/crate/rust-x402/0.3.0/source/src/template/paywall.html), [QuickNode](https://www.quicknode.com/guides/agentic-payments/how-to-use-x402-payment-required)). The Indian coupon idiom is `*123*<16 digits>#` ([BSNL](https://assam.bsnl.co.in/recharge_excel.html)), nationwide since 2003 ([The Paypers](https://thepaypers.com/payments/news/airtel-launches-all-india-recharge-coupon)), lately with a QR under the scratch layer ([TelecomLead](https://www.telecomlead.com/telecom-services/airtel-introduces-smart-pack-paper-recharge-coupon-qr-code-58529-49582)). **Thesis:** one `Coupon` component rendered three ways — screen, push notification, paper — and eSIM screens that do what Airalo and Saily say they wish they did.

## 1. Consumer PWA, screen by screen

**Shell.** `data-type="bazaar"`, `lang` per string. No tab bar until a bundle exists; then four labelled tabs: Plan · Add data · Gift · Receipts (World's mini-app standards: tab navigation, 2–3 s first load, username over address — [docs mirror](https://world-id-docs-ef6dewf51-main-worldcoin.vercel.app/mini-apps/design/app-guidelines)). Primary action in the bottom 25 %, carrying the number. Sheets, never modals. Skeletons are the real layout in `--bg-sunken` blocks, no shimmer. A `TESTNET · test USDC · not a sale` strip (12 px Chivo Mono) tops every money screen until mainnet — Stripe's test-mode rail, not a badge.

### (a) `/` Landing / claim
- **Layout.** Wordmark top-left (Anek `wdth 110 / wght 700`); display question `clamp(32px, 9vw, 44px)`; the live, unscratched `Coupon` fills the middle; the button sits at the bottom. Desktop 5/7, coupon right.
- **Dominant.** The coupon's **300 MB**, with real data: "1,214 of 2,000 sponsor bundles left · Hedera" from the Arkiv query. Not live → omitted, never faked.
- **Copy.** H1 "Landing in Mumbai without data?" Sub "Prove you're one human. A sponsor pays for your first 300 MB." Button "Prove I'm human → 300 MB". Quiet rows: "Enter a coupon PIN" · "I'll pay · $0.40 per 100 MB" · "Open my plan". Pre-flight line under the button (Airalo borrow), from UA: "iPhone · iOS 18 · eSIM ready" or "Can't check this phone from a browser. eSIM phones: iPhone XS, Pixel 3, Galaxy S20 or later."
- **States.** Loading: coupon skeleton. Exhausted/paused: the coupon reads "Sponsor bundles finished for today · next batch 09:00 IST", button becomes "Pay $1.20 for 300 MB". Offline: last coupon, "as of 14:02".
- **Un-generic.** The product object is the hero; no three-card grid, no "Trusted by", no mockup; the only colours are teal on one button and silver latex.

### (b) `/verify` World ID
- **Layout.** Sheet over the coupon. IDKit renders the World App deeplink (mobile) or QR (desktop); our chrome is one sentence above and a tier ledger below.
- **Dominant.** "World checks you're one human. We receive a code that can't be traced to you — not your name, not your face."
- **Copy.** Title "Prove you're one human". Button "Open World App" / "Scan with World App". Ledger from `sizeBundle`, never hard-coded: "Orb · 300 MB free" / "Document · 150 MB free" / "Device · no free bundle · $0.40 per 100 MB". Footnote "One free bundle per human, not per phone."
- **States.** Waiting: World mark, "Waiting for World App · 0:42" counting up, Cancel. Proof received: "Checking · 2 s", determinate ring. Success: straight to (c). Failed: "World couldn't confirm this time. Nothing was sent. Try again, or pay $1.20 for 300 MB." Nullifier seen: "This World ID claimed its bundle on Thu 5 Nov. Open that plan · Pay for more." Fail-closed: "Can't verify right now · retry in 30 s".
- **Un-generic.** No shield-check, no "Verified human" pill, no green (green means data added). The honest tier table is the design.

### (c) `/plan/[key]` Bundle issued — the lock-screen moment
- **Layout.** **300 MB** at 64 px Anek 110/700, 2× everything else; 14 px "from Hedera · because you're human"; `MbMeter`, a 4 px teal rule on sunken draining left→right; `UsageAsOf` 12 px Chivo Mono "usage as of 14:02"; expiry **read from the Arkiv entity's `expiresAt`**: "Expires in 6 d 22 h · Sun 15 Nov 09:12 IST", disclosure "Why it expires by itself" showing the entity key; the three-line receipt (g); button "Install eSIM · 2 min"; quiet "Later — it's under Plan".
- **The push** (PWA on the Home Screen, iOS 16.4+): "300 MB · from Hedera" / "because you're human. Install takes 2 minutes." Permission is asked here, once, with a reason — never on launch. The in-app card is the same `Coupon`, so the video cuts lock screen → app without a seam.
- **States.** Issuing: three rows turning `--text-tertiary` → `--text-primary` as facts arrive — "Verified" · "Sponsor paid · 0x1a2b…9f3e ↗ HashScan" (the instant the hash exists) · "Plan written to Arkiv · ent:7f3a…". No spinner. On the entity read the odometer runs 0 → 300 once. Sponsor step failed: "The sponsor's pool didn't pay (hourly cap reached). Nothing is charged to you. Try at 15:00 or pay $1.20." Expired: "0 MB · expired Sun 09:12", "Add 100 MB · $0.40" stays. Usage ≥ 80 %: meter and "usage as of" turn `--warning`, nothing else.
- **Un-generic.** The countdown is a protocol fact, not a cron; the meter moves only on a new `usageAsOf`; the sponsor is named like a donor on a plaque.

### (d) `/install` eSIM
- **Layout.** A status pill in the OS's own words — "No Service" (`--text-tertiary`) → "Searching…" → "LTE · Jio" (`--text-primary`, 6 px teal dot) — fed by the reseller status webhook and the probe below; then a checklist in the order the system asks (Apple borrow: narrate the sheet, never fight it).
- **iOS 17.4+ (by UA):** "Install eSIM" opens `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=LPA:1$<smdp>$<code>` ([eSIM Go](https://help.esim-go.com/hc/en-gb/articles/25798471128849-Direct-Install-Installing-eSIM-s-On-An-Apple-Device-Using-Universal-Link-iOS-17-4-and-above)). Steps: 1 "Settings opens: tap Continue" 2 "Label the line *Recharge 300 MB*" 3 "Default line: keep your own" 4 "Cellular data: choose *Recharge*, allow switching" 5 "Settings → Cellular → Recharge → **Data Roaming on**" — Saily's missed step [labels from memory; screenshot Wed]. Under the button: "Didn't open? Tap again — iOS sometimes fails on the first try" (first-tap "server cannot be found", reload succeeds: [Apple forum 769597](https://developer.apple.com/forums/thread/769597)).
- **Android:** a web page cannot start the download — `ACTION_START_EUICC_ACTIVATION` is "sent by a carrier app"; `ACTION_MANAGE_EMBEDDED_SUBSCRIPTIONS` only opens the eSIM settings screen ([EuiccManager](https://developer.android.com/reference/android/telephony/euicc/EuiccManager)). So: "Copy activation code" (the whole `LPA:1$…`), steps "Settings → Network & internet → SIMs → Add SIM → *Set up manually* → paste" [memory; screenshot Wed], and try an `intent:#Intent;action=android.telephony.euicc.action.MANAGE_EMBEDDED_SUBSCRIPTIONS;end` link from Chrome (unverified; test Wed). DECISION §6.2's "LPA intent" needs a native wrapper.
- **Second device:** the QR appears only here, "For another phone".
- **After install:** "Check connection" (Airalo borrow) fetches a 1 KB probe: "Online over mobile data" (`--positive`) / "Online over Wi-Fi only — turn Wi-Fi off to test" / "Offline · Data Roaming on?". Expectation: "LTE usually shows 1–3 min after install", using Wednesday's measured median.
- **States.** Unsealing (`openLpa`, text only); link didn't open; no service after 3 min → troubleshooter rows (Data Roaming, line on, airplane toggle). The 90-second stage cutover lives in `DEMO-SCRIPT.md`.
- **Un-generic.** The status bar's words as the hero; ICCID and code in Chivo Mono `slashed-zero`, split on `$`, always copyable.

### (e) `/pay` — the 402 moment, human and agent
- **Human.** A 402 is a receipt-shaped sheet and *is* the `OnchainAction` component. Review: "Add 100 MB · $0.40"; "Valid with your plan until Sun 15 Nov 09:12"; pay-from as a segmented control of `accepts[]` by network name — "Base · 12.40 USDC" / "Hedera · 3.10 USDC", never chain ids; "Network fee $0.00 — paid by the facilitator" (or the true figure); "Worst case: if settlement fails you pay nothing. This approval expires in 5:00" (`validBefore`). No wallet: "Continue with Coinbase Wallet / MetaMask". Button **"Pay $0.40 USDC"**. Signing: "Approve in MetaMask…", "0.40 USDC leaves your account; 100 MB arrives", Cancel. Sending: `0x1a2b…9f3e` copy ↗, "4 s", ring sized to ~5 s. Confirmed: "+100 MB · settled · 400 MB total", meter extends once. Failed: "Didn't go through: the facilitator rejected the signature (expired). Nothing left your account. Try again."
- **Agent** (`/agent`: one sheet, two controls): stepper "≤ $10 / day" ($1 · $5 · $10 · $25) and "Pause". Policy as a sentence: "When your plan drops below 20 % or expires, your agent buys 100 MB for $0.40 on Hedera, up to $10 a day." Rows: "03:12 · +100 MB · $0.40 · agent uaid:hcs-14:… ↗". Push: "+100 MB · paid by your agent · $0.40 · 03:12". Simulated usage clock → meter labelled "simulated usage" (Q-USER-RECHARGE-2). States: "Daily cap reached · $10.00 · resumes 00:00 IST · Add 100 MB once · $0.40"; "Agent account has $0.80 left"; paused.
- **Un-generic.** No "Payment Required" heading, no coin icon, no faucet link, a hash within a second. The agent is a receipt, not a chatbot: no bubbles, no robot, its UAID shown as identity.

### (f) `/gift` — gift to an ENS name, the boarding pass
- **Layout.** "Who gets it?" resolving live — "rahul.eth → 0x1a2b…9f3e · Ethereum mainnet"; size row 300 MB · 1 GB · 3 GB at $1.20 · $4.00 · $12.00 (one price, no invented discounts); button "Gift 1 GB to rahul.eth · $4.00" → sequence (e). Result: `BoardingPass` — landscape, perforation (dashed rule, two `mask` notches), 11 px labels: TO rahul.eth · FROM you · 1 GB · MUMBAI · VALID UNTIL Sun 15 Nov 09:12; the stub carries the 16-digit PIN in Chivo Mono (4 × 4) and a QR of `/card/<serial>`.
- **Copy.** "Gift sent. rahul.eth can claim until Sun 15 Nov. If unclaimed, [the USDC returns to you / the gift lapses]" — **decide the refund rule in `octroi` first; the copy says what the escrow entity does.** "Save card" (1080 × 1920 PNG) · "Print" (§3). Receiving push: "vitalik.eth sent you 1 GB". Claim: "Approve in your wallet to claim — no payment" or "Enter the PIN".
- **States.** "rahul.eth has no address set. Gift by PIN instead." Resolves to a contract: warn. Already claimed. Escrow expired.
- **Un-generic.** Real fields in a real idiom; ENS avatar only if the text record exists, never a blockie; no gift box, ribbon or confetti.

### (g) `/receipts` — three-line receipts
Ancestor: the paper coupon's "MRP · Talk value · Service tax" block [memory]. Per event: header "+100 MB · Sat 7 Nov 03:12 · Hedera · Final", then three ruled lines in two columns — "You · $0.40" / "Sponsor · —" / "Network fee · $0.00". Disclosure: hash, HCS sequence, Arkiv key, facilitator, finality. Grouped by day, sticky headers, day totals right-aligned, "Download CSV". Pending rows carry the ring; failed rows show the reason, only the amount in `--negative`. Empty: a ghost row with real headers, "Your first bundle will appear here". Multiple plans are rows, not cards (Jetpac's "eSIM wallet", [Jetpac](https://www.jetpacglobal.com/blog/best-esim-for-europe/)).

## 2. Sponsor dashboard `/sponsor/[id]`

Density per `design-foundations.md` §5a: 48 px rail (Campaigns · Claims · Quotas · Exports · Settings), 28–32 px rows at 13 px, text left, numbers right, units in headers, one hero figure per pane, `⌘K`, `/`, `j/k`. Linear limits a dashboard to a few insights ([plushcap mirror](https://www.plushcap.com/content/linear/blog/linear-best-practices-for-designing-linear-dashboards)); Mercury's grayscale-plus-one-accent is from memory.

- **Campaign list:** rows, not cards — name · Live/Paused · "1,214 / 2,000 claims" · "$607.00 / $1,000.00" · "expires Sun 15 Nov".
- **Campaign page.** Hero **"1,214 claims"** at 32 px; beside it 14 px "$607.00 of $1,000.00 · 2,000 cap · 120/h". **Budget burn:** one horizontal bar (spent | committed | remaining) and one line of claims per hour, `--series-1`, no area fill, the hourly cap as a dashed rule, axes labelled. **Claims by credential level:** a three-row table — Orb / Document / Device: claims · MB issued · cost · avg MB — not a donut. **Expiring quotas:** Arkiv query as a table: key · MB left · "expires Sun 09:12" · tier, with "38 plans expire in 24 h". **Claims table:** time · HMAC'd key (`0x…`, copy) · tier · MB · cost · tx ↗ · status (`OnchainAction` vocabulary). **Export:** "Export claims CSV (HMAC'd keys)" · "Copy Arkiv query". **Pause** is slide-to-confirm.
- **Empty state teaches:** ghost rows with headers and one verb — "Create a campaign — name, budget, bundle size by tier, hourly cap." No KPI tile wall, no "+12.5 %", no sparkline cards; a delta is one line under the hero.

## 3. The physical scratch coupon

- **Format.** ISO ID-1, 85.60 × 53.98 mm, 3 mm bleed, 2 mm safe; 350 gsm uncoated warm-white card (paper, not PVC). Black plus one spot colour matched at Wednesday's 19:00 proof to `oklch(0.52 0.085 195)` ≈ `#117878`. Scratch: silver rub-off latex over a 34 × 12 mm panel on release varnish; we supply a 100 % K keyline on a separate PDF page.
- **Front.** Wordmark top-left (Anek 110/700, 12 pt). Top-right the one number "300 MB" 20 pt, "Mumbai · 7 days" 8 pt. Middle "because you're human" / `क्योंकि आप इंसान हैं` (8 pt, `lang="hi"`, leading 1.6). On the latex: "rub here · यहाँ रगड़ें" in Baloo 2 (§8.3's only Baloo use). Under it the PIN "4821 9930 1127 5064" — Chivo Mono 11 pt, slashed zero, 4 × 4; 15 random digits plus a Verhoeff check digit so typos fail on the device. Visible QR 22 × 22 mm, ECC M, `https://<host>/card/<serial>`: the serial is public, the PIN under latex is the value — scan to preview, scratch to redeem. Serial 8 chars, 7 pt mono; "Expires 30 Nov 2026".
- **Back.** The three-line receipt — "Bundle 300 MB / Paid by Hedera $0.50 / Network fee $0.00" — and the ENS write-in: "To: ________ .eth — write a name to gift this card, or redeem at /card". `/card` is the `*123*PIN#` homage.
- **Print CSS** (`packages/ui/print.css`, via `scripts/print-cards.ts`): `@page { size: 91.6mm 59.98mm; margin: 0 }` (bleed included), crop marks, `print-color-adjust: exact`, `font-display: block` so no fallback face is rasterised, mm→px at 3.78, `.coupon[data-variant="print"]` hides the canvas and prints the PIN layer, spot colour as `--ink-spot`. One `Coupon` markup, three variants: `screen` (canvas latex over a scanned-foil WebP ≤ 60 KB), `notification` (two lines), `print`.

## 4. Iconography and illustration

One set, one weight: Phosphor Regular or Lucide at `stroke-width 1.5` (not its 2 px default), 16 px inline, 20 px in controls, `currentColor`, never in tinted circles. Allowed: copy, external link, chevron, QR, SIM card, pause, play, check (stepper only), warning triangle, close. Banned: shield-check, robot, gift box, rocket, sparkles, coin stacks, globe-with-pins, any emoji (including on the card). Words beat icons: "No Service", "LTE", "Final" are typeset. No illustration. Real texture wins in three places: scanned silver latex on the screen coupon; faint paper grain on the coupon only, never the canvas; B-roll photographs. Sponsor and World marks as supplied, monochrome, never recoloured.

## 5. Motion: the three hero moments (values from `tokens.css`)

1. **Bundle issued.** Verify sheet exits 208 ms `--ease-exit`; `/plan` enters 260 ms `--ease-standard`, `translateY(24px) → 0` + opacity. Each Issuing row goes tertiary → primary in 180 ms as its fact arrives; the hash row slides in 180 ms the instant the hash exists. On the Arkiv read: odometer 0 → 300 in 400 ms, the meter fills over 300 ms starting 100 ms later, once. Then nothing moves. `navigator.vibrate(10)` where supported. Reduced motion: opacity ≤ 100 ms, number set, `--duration-odometer: 0`.
2. **LTE connects.** Pill text cross-fades: out 100 ms `--ease-exit`, in 180 ms; the teal dot scales 0.6 → 1 over 180 ms — the one permitted scale, not a hover. While "Searching…", a 1 px determinate ring sized to Wednesday's median attach time; no pulse loops. The check result enters from below in 220 ms.
3. **Scratch reveal.** Finger-tracked 1:1, brush radius 24 px, `destination-out` on a canvas over the already-rendered PIN. At ≥ 45 % cleared the rest fades 180 ms `--ease-exit`; "Redeem" enables with a 100 ms colour transition; 10 ms haptic per 10 %. Keyboard/reduced motion: a "Reveal PIN" button, 100 ms. No sound.

Globally: sheets on the 400/35 spring; press 98 % + 6 % darker in 80 ms; the meter snaps on data ticks; the countdown re-renders once a minute (seconds only under 1 h); nothing bounces.

## 6. Accessibility and localisation

**Strings** (Anek Devanagari; `lang="hi"`/`"mr"`; brand nouns, units and numerals stay Latin; the §6.7 copy reviewer signs off Wed 19:00):

| English | Hindi | Marathi |
|---|---|---|
| Prove you're one human | साबित करें कि आप एक इंसान हैं | तुम्ही एक माणूस आहात हे सिद्ध करा |
| 300 MB · from Hedera · because you're human | 300 MB · Hedera की ओर से · क्योंकि आप इंसान हैं | 300 MB · Hedera कडून · कारण तुम्ही माणूस आहात |
| Install eSIM · 2 min | eSIM इंस्टॉल करें · 2 मिनट | eSIM इंस्टॉल करा · 2 मिनिटे |
| Add 100 MB · $0.40 | 100 MB जोड़ें · $0.40 | 100 MB जोडा · $0.40 |
| usage as of 14:02 | 14:02 तक का उपयोग | 14:02 पर्यंतचा वापर |
| Expires in 6 d 22 h | 6 दिन 22 घंटे में समाप्त | 6 दिवस 22 तासांत संपेल |
| Didn't go through. Nothing left your account. | पूरा नहीं हुआ। आपके खाते से कुछ नहीं गया। | पूर्ण झाले नाही. तुमच्या खात्यातून काही गेले नाही. |
| rub here | यहाँ रगड़ें | इथे घासा |

**Numbers.** `Intl.NumberFormat('en-IN')`. Data: MB integers below 1 GB ("300 MB"), one decimal in GB above ("1.5 GB"), never both on one screen, no-break space before the unit. Money: the currency that moves, two decimals — "$0.40 USDC"; rupees only as a secondary line for Indian sponsors ("≈ ₹33", "₹1,20,000"). Time: 24-hour, "IST" when the viewer's zone differs, "Sun 15 Nov", relative with absolute beside it. Hashes `0x1a2b…9f3e`, PINs 4 × 4, ICCIDs in fives. **Contrast** (WCAG 2 on sRGB, computed): §4 text pairs stand; teal meter on sunken 4.7:1 light / 10.5:1 dark (non-text ≥ 3:1); ink "rub here" on `#b9b9b9` latex 9.2:1; PIN ink on paper 17.4:1; `--text-disabled` makes no claim. **Semantics.** 48 px targets; 2 px accent focus ring, 2 px offset; `MbMeter` is `role="meter"` with `aria-valuenow/max` and a text twin; the countdown a `<time datetime>`, `aria-live="off"`; the pill `role="status"`; the scratch canvas has a button twin. Devanagari: leading 1.6, 14 px floor, no letter-spacing, uppercase or italics; layouts tested with the Marathi column. RTL not needed. Both themes; the coupon stays paper-light in dark mode on purpose — it is an object.

## 7. Do not ship — the 15 likeliest regressions

1. Any hue 260–300 (CI grep); World's black-and-white is not an invitation to crypto purple.
2. A shield-check icon or "Verified human" pill after World returns.
3. Confetti, "Success!", or a toast for a claim or payment.
4. A bare spinner at Issuing, Sending or Searching.
5. The meter animating on usage ticks, or the odometer on every visit.
6. "Expires in 6.93 days", relative-only time, or expiry computed client-side rather than read from Arkiv.
7. A raw `0x…`/ICCID without copy + explorer link, or a chain id shown to a traveller.
8. The x402 norm: centred "Payment Required", coin icon, faucet link, "Connect Wallet" as the only CTA.
9. A QR as the same-phone install path.
10. Notification permission on launch, or "Welcome to Recharge!".
11. A phone mockup, 3D SIM, "How it works" three-card grid or logo marquee on `/`.
12. A KPI tile wall or a credential-level donut on `/sponsor`.
13. A chat UI, robot avatar or first-person monologue for the agent.
14. A gift box, ribbon or emoji on `/gift` or the printed card.
15. Inter/Geist/Poppins via a component library; proportional figures in any amount; `hover:scale-105`; `backdrop-filter`; a "Beta" pill; "Seamless/Effortless"; a "10k+ humans" number before it is true.

## 8. Ten references, one borrow each

1. [Airalo redesign, Oct 2025 (TechAdvisor)](https://www.techadvisor.com/article/2940256/my-favourite-esim-provider-just-got-a-major-app-upgrade.html) — compatibility alert before money; green/orange connection check after install.
2. [Saily founder interview (TechRadar)](https://techradar.com/pro/we-have-to-make-esims-as-simple-as-possible-saily-says-removing-friction-is-the-next-big-battle-for-democratizing-travel-esims) — the last step is manual; narrate the switch and show connection status in-app.
3. [eSIM Go: Apple universal link](https://help.esim-go.com/hc/en-gb/articles/25798471128849-Direct-Install-Installing-eSIM-s-On-An-Apple-Device-Using-Universal-Link-iOS-17-4-and-above) — exact `carddata=LPA:1$…` format; gate by UA on 17.4+.
4. [Apple Developer Forums 769597](https://developer.apple.com/forums/thread/769597) — first-tap "server cannot be found" → our "tap again" line.
5. [Android `EuiccManager`](https://developer.android.com/reference/android/telephony/euicc/EuiccManager) — no web-triggered install; copy the code honestly.
6. [Revolut eSIM review (Yesim)](https://blog.yesim.tech/revolut-review/) — terse low-data notifications; never bury the plan three menus deep.
7. [World mini-app design standards (docs mirror)](https://world-id-docs-ef6dewf51-main-worldcoin.vercel.app/mini-apps/design/app-guidelines) — username over address, Verify over sign-in, 2–3 s load, tab navigation.
8. [rust-x402 paywall](https://docs.rs/crate/rust-x402/0.3.0/source/src/template/paywall.html) and [QuickNode x402 guide](https://www.quicknode.com/guides/agentic-payments/how-to-use-x402-payment-required) — the norm to beat: centred heading, coin icon, loader, success redirect.
9. [Stripe: "Payment successful" pages](https://stripe.com/resources/more/payment-successful-pages) and [custom success page](https://docs.stripe.com/payments/checkout/custom-success-page) — confirm, summarise, say what happens next; fulfil from the webhook, not the redirect (our "settling" tag).
10. [BSNL `*123*<PIN>#`](https://assam.bsnl.co.in/recharge_excel.html), [Airtel All-India coupon, 2003](https://thepaypers.com/payments/news/airtel-launches-all-india-recharge-coupon), [Airtel Smart Pack QR](https://www.telecomlead.com/telecom-services/airtel-introduces-smart-pack-paper-recharge-coupon-qr-code-58529-49582) — 16 digits under latex, a dial-code redeem path, QR plus scratch.

Also, from `design-foundations.md` §8: Family (an animation that stops abruptly is a bug), Hyperliquid (dark text on the light accent), Kite (density as a setting).
