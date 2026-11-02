# Round 1 — Crypto-Native Power User (member #8)

**Lens.** I have installed and deleted ~200 crypto apps and live in Hyperliquid, Polymarket, Telegram bots, World App and Uniswap. One question: would a real person — Devcon foreigner, Indian hacker, chaiwala, signals follower, agent operator — open this twice unpaid, and does it look designed, or like the 4,000th purple-gradient Next.js dashboard. Tap counts are first-time, on a phone, from "I have the link" to first value. Four of six web checks spent: World ID levels in India, Tez Cash Mode, Uniswap CCA status, crypto-to-UPI competitors.

**Three facts that reshape every journey.**
1. **World ID in India is Selfie Check or NFC-passport "Official ID".** Orb has been paused there since Dec 2023 with no sign of resuming. Nine of twelve ideas put a World App install (~100 MB, phone number, selfie) before first value for Indians — while most Devcon foreigners already hold Orb-level IDs. World-gating is cheap for foreigners, expensive for Indians.
2. **Arc mainnet is seven weeks old.** Nobody landing at BOM holds USDC on Arc; they hold it on Base, Arbitrum, Polygon or Solana. Every "pay in USDC on Arc" flow hides a bridge (5–8 taps and a wait) before the first tap of value. Consumer ideas must accept USDC where it already is and settle wherever they like.
3. **Uniswap's web app has had an Auctions (CCA) tab since 2 Feb 2026** and self-serve auction creation since 24 Jun 2026; Aztec's CCA drew 17k bidders. A CCA front end must out-design Uniswap Labs on their own feature.

## The twelve

### 1. Dhwani — the stablecoin soundbox (Judge's Eye)
**Journey.** Merchant: plug in, scan setup QR, name the shop — 4 taps. Payer, online: open wallet, scan the OLED QR, confirm — 3 taps *if* the wallet knows chain 5042 and holds Arc USDC; otherwise "unknown network", a bridge, 12+ taps and cold chai. Offline: install PWA, fund an embedded key ("a second wallet?"), airplane mode, hold the phone to the box through a 6–12 s chirp. Tez's Cash Mode took a couple of seconds and I never once saw it used in the wild before Google folded Tez into GPay. Confusions: 3 (chain, second wallet, chirp length).
**Twice?** Merchant: yes, structurally — a soundbox needs zero attention and the voice is the receipt. Payer: yes if the box takes the USDC I actually hold; no if Arc-only.
**Share.** A video, not a screenshot: chai stall, box announcing "paanch sau rupaye prapt hue" after a foreigner's phone chirps; the next stall asks for one. Virality 9/10.
**References.** Right for hardware, blind to software. Best: Paytm Soundbox 4.0, Square (merchant dashboard, receipts), Stripe Terminal, Toast, Teenage Engineering/Nothing — so it reads "made", not "Pi in a project box". **Signature:** one recorded human voice, never robotic TTS; a thermal-strip monospace receipt; an OLED showing only the amount. Saffron and cream.
**Desire 8/10.**
- Q-USER-DHWANI-1: Does the QR carry multi-chain EIP-681 (Base/Arbitrum/Polygon USDC) or Arc only? If Arc-only, show the bridge path and tap count on a judge's phone.
- Q-USER-DHWANI-2: Is the offline PWA a second wallet with an embedded key, or a session key from the main wallet (7702/4337)? How is it funded and topped up?
- Q-USER-DHWANI-3: Measured chirp duration and decode success at ~70 dB ambient?

### 2. Boli — Indic speech sold to agents (Judge's Eye)
**Journey.** Seller: WhatsApp link → PWA → "verify you are human" → Play Store → World App → phone number → Selfie Check (no Orb in India; rural sellers hold no NFC passport) → back to Boli → hold-to-record → 0G grading wait → "₹2.50 earned" — in Hedera USDC. 10–12 taps, five-plus minutes, four confusions (World App, wallet, Hedera, "how do I get rupees"). Karya pays to UPI.
**Twice?** Seller: only if payout lands in UPI or a balance redeemable for mobile recharge; USDC she cannot spend is not pay. Buyer lab: wants the catalog, pays invoices, not 402s — the agent buyer is for the sponsor.
**Share.** The "₹ earned by this room" leaderboard is a decent stage beat; screenshot is a Marathi sentence, a waveform, "+₹2.50 paid by agent 0x…". Hackers share it; sellers never will. Virality 5/10.
**References.** Karya and Prolific right; HF Datasets and OpenRouter are developer pages. Best: Karya, Toloka, Prolific, Scale Rapid (buyer), Duolingo speaking exercise. **Signature:** vernacular-first — one big hold-to-speak circle, the prompt in a real Devanagari face (Mukta/Baloo), the grade stub shown *before* the money. Not an English UI with a language toggle.
**Desire 5/10.**
- Q-USER-BOLI-1: How does Sunita turn Hedera USDC into rupees — which off-ramp, who eats the 1% TDS and spread, how many days?
- Q-USER-BOLI-2: At Selfie level, does one-human-one-seller hold, and does a World App install survive a ₹8,000 Android with 2 GB free?

### 3. Bhishi — the auction chit fund (Judge's Eye)
**Journey.** Organiser's WhatsApp link → connect wallet (Indian funds sit on CoinDCX/Okto: withdraw, bridge to Arc) → World App → approve USDC → join (bond plus first contribution, two txs) → wait a month. 15+ taps, three new concepts. Monthly: approve, contribute, bid — with 1% TDS on each transfer and 30% on the "dividend", which is netted invisibly against next month, so the product's best moment is the one you cannot see.
**Twice?** Monthly by construction — if the organiser drags me in. I would never seek it; the tax surface alone kills a ₹5,000 chit for a salaried Indian.
**Share.** The Bhishi Rate ticker is one good screenshot; chits are private by nature. Virality 4/10.
**References.** Money Club/KSFE right for domain, Splitwise right for the ledger, Polymarket/Robinhood generic. Best: Splitwise, Monzo/Revolut group pots, Kalshi (clearing display), KSFE Chitty, Zerodha Kite. **Signature:** the khata — ruled paper ledger, a monthly rubber stamp, the auction as a countdown dial; no charts.
**Desire 3/10.**
- Q-USER-BHISHI-1: What does a member *see* on dividend day? If it is netted silently, how does "you earned ₹412" become a moment?
- Q-USER-BHISHI-2: Walk through a ₹5,000/month member's TDS and 30% exposure; does the UI show it or hide it?

### 4. CallSheet — sealed executable calls in Telegram (Operator)
**Journey.** Already in Telegram — good. /start → vault (generated wallet, or WalletConnect inside Telegram, which breaks on iOS?) → deposit USDC on Unichain (nobody has USDC on Unichain; 0.4% of Uniswap volume) → follow a caller → sealed card → reveal → batch fill → stop/TP via Definitive on Base — a second chain for exits. ~10 taps, two chains, two balances. Trojan onboards in 3 taps because it generates the wallet; copy that or lose the follower before the first call.
**Twice?** Yes — the only idea built for people who already do this daily, and sealing fixes a pain I have personally paid for (front-run by the caller). But callers call HL perps and Solana memes, not Unichain spot; a uniform-price batch into a $20k pool is a slippage machine. The product wants to be a Hyperliquid builder-code front end; the prize is pulling it off its venue.
**Share.** The reveal card "CALL #41 · +12.4% · 83 followers filled at 1.2013" is the pvp.trade/Hyperliquid PnL-card genre; callers post it to recruit. Virality 8/10.
**References.** Right category; GMGN density is wrong for Telegram, Trojan's inline keyboards are the real pattern. Best: pvp.trade, Trojan/BONKbot, Hyperliquid (PnL card), PolyCop (copy confirmations), Axiom (web). **Signature:** the sealed envelope — the call arrives redacted with black bars and a countdown, un-redacts at reveal; every fill receipt shows three lines: you / caller / protocol. Dark, monospace numerals, zero gradients.
**Desire 7/10** (8 as a concept, 6 as specified).
- Q-USER-CALLSHEET-1: Where does follower USDC live, and can the whole loop (entry, split, exits) run on Base mainnet with $5 fills instead of Unichain Sepolia plus Base?
- Q-USER-CALLSHEET-2: What does a demo call trade on Unichain and how deep is that pool?
- Q-USER-CALLSHEET-3: Generated wallet (3 taps) or WalletConnect-in-Telegram (10 taps, iOS-hostile)?

### 5. Nilami — one-human-one-bid CCA launchpad (Operator)
**Journey.** Launch page → World App (Orb for foreigners, Selfie for Indians) → connect → bridge to Unichain → commit (tx 1) → return for reveal (tx 2; miss it, lose it) → clearing → claim (tx 3) → dividend claims (tx 4+). Six transactions for one allocation; Uniswap's Auctions tab does it in two taps, ungated. Commit-reveal is the worst UX pattern in retail crypto.
**Twice?** Launchpad users return when launches moon, not when they are fair. Degens want to snipe; people who want fairness do not trade memes. The bidder dividend is the one clever hook. As a creator I use the Uniswap app unless Nilami brings a verified-human audience.
**Share.** Live clearing on the big screen is theatre; "3,120 humans, one price: $0.042". Virality 6/10.
**References.** Clanker/Flaunch/Zora/pump.fun are the bot-casino aesthetic Nilami claims to oppose. Best: Uniswap Auctions tab (the incumbent), Echo/Sonar, Legion, Coinlist, Fjord Foundry. **Signature:** the auction house — a clearing line that moves only at reveal, bids as anonymous human silhouettes stacking, an allocation receipt like a share certificate; light theme, serif numerals, paddle numbers.
**Desire 4/10.**
- Q-USER-NILAMI-1: Why would a bidder leave the Uniswap web app's Auctions tab for a World App install plus commit-reveal?
- Q-USER-NILAMI-2: What happens to the bidder who commits and misses the reveal window?

### 6. Asli — pay per verified human conversion (Operator)
**Journey.** Earner: campaign link → World App → the action "deploy on Whitechain Sepolia", whose faucet wants a 30-day-old GitHub and rate-limits by IP → verifier wait → USDC on Arc, which cannot reach CoinDCX without another bridge. 12–20 taps including faucet hell. Advertiser: Arc Studio deploy, fine for a devrel.
**Twice?** Earner: Indian students grind $5–10 tasks (Intract proved it) — if the money reaches a chain their exchange supports, or INR. Advertiser: yes; the sanest B2B here. Still Galxe with a face scan, and the demo is a dashboard.
**Share.** Referral links; "I earned $10 for deploying on Whitechain". Virality 4/10.
**References.** Correct and complete. Add Stripe Dashboard (escrow and refund clarity) and Dune (public ledger embed). **Signature:** the refund meter — an escrow bar that drains per verified human and reads "paid to bots: ₹0"; Stripe-white, no quest-card carnival.
**Desire 4/10.**
- Q-USER-ASLI-1: On which chain does the earner receive USDC, and how does it reach an Indian exchange or UPI without a bridge?
- Q-USER-ASLI-2: Name a first-campaign action a student completes in under five minutes without a gated faucet.

### 7. Octroi — price bots, exempt humans (Sponsor Stacker)
**Journey.** API dev: npm i, six config lines, dashboard — one install, two confusions (who funds Arkiv GLM writes; who runs the facilitator). Agent operator: my agent gets a 402 denominated on Hedera; my agents hold USDC on Base. End-human: a weather API asks me to scan my face to stay on the free tier.
**Twice?** Dev: maybe, for a faucet. Agent operator: I pay x402 on Base; Hedera is a prize, not a rail. End-human: bounce.
**Share.** "402 → paid 0.001 → 200" terminal screenshot — the genre CT has seen four thousand times. Virality 3/10.
**References.** Stripe Radar, Unkey, Cloudflare — exactly right. Add Vercel and Resend. **Signature:** the toll naka — a live request stream where each request is a stamped ticket, "HUMAN · FREE" or "BOT · 0.001 USDC"; monospace, light, Linear-grade restraint.
**Desire 3/10.**
- Q-USER-OCTROI-1: Which real agents hold Hedera funds today? If the first payers are Base-USDC agents, why is the paid lane on Hedera?
- Q-USER-OCTROI-2: What does the end-human see when a free API demands World ID, and what is the fallback when they refuse?

### 8. Gavel — CCA terminal and agent desk (Sponsor Stacker)
**Journey.** Open terminal → live CCAs across Ethereum, Base, Unichain, Arbitrum — a handful a month → connect → set policy → agent bids → Definitive exit on Base with real money. ~8 taps. Confusions: which chain is this auction on; does the agent custody my bid.
**Twice?** Axiom works because 30,000 tokens launch a day. A terminal for a market with a few auctions a month has no daily open.
**Share.** Dune-style "Aztec CCA: 17k bidders, clearing path" — analysts share once. Virality 3/10.
**References.** Fine. Add Parsec (dense onchain terminal) and TradingView. **Signature:** the gavel strike — each auction's price discovery as one bold line with snipe attempts marked; brass-and-green bench palette instead of terminal black.
**Desire 3/10.**
- Q-USER-GAVEL-1: How many CCAs are live in a typical week, and what does a user open the terminal for on a day with none?
- Q-USER-GAVEL-2: Does the policy agent custody bid funds or sign via a session key?

### 9. Kilowatt — telemetry-metered battery leases (Sponsor Stacker)
**Journey.** Driver never sees a wallet (paymaster) — good — until "battery locked, pay ₹X" because an ML score said so. Investor: bridge USDC to Arc, deposit into a waterfall vault, ~6 taps. Three chains, invisible if done right.
**Twice?** Not a consumer product; the driver uses it under duress, the investor returns for coupons. The lock clicking shut is the best physical WOW after Dhwani — and the one that gets dunked as "DeFi repo-man", virality of the wrong kind.
**Share.** The lock clip. Virality 5/10, half hostile.
**References.** Centrifuge/Maple right for investors; Samsara, the real fleet-telematics UI, is missing. Best: Centrifuge, Maple, Samsara, Battery Smart/Sun Mobility driver app, Tesla Fleet dashboards. **Signature:** the odometer — repayment in kilometres, not rupees ("4,120 of 20,000 km paid"), on a high-contrast industrial dashboard.
**Desire 2/10.**
- Q-USER-KILOWATT-1: What does the driver see and consent to before a remote lock, and what is the dispute path when the score is wrong?
- Q-USER-KILOWATT-2: Who is the user in the four-minute demo — driver, investor or operator?

### 10. Recharge — eSIM data by USDC, gifted by ENS, topped up by agent (Mumbai Native)
**Journey.** Lena at BOM on airport Wi-Fi: poster QR → page → World ID (Orb-verified already: 2 taps) → "300 MB free — install" → Apple's eSIM sheet via universal link (3 taps; must be direct install, she cannot scan a QR on the same phone) → Data Roaming on → data flows. 7–8 taps, one unavoidable confusion (Apple's sheet). Top-up: pay USDC from Base, not Hedera, or it is a bridge again. Agent: "allow up to $10 of top-ups" needs honest framing.
**Twice?** Yes — the only idea I would use on day 1 and day 4 with nobody pushing me. Airalo has tens of millions of users because the pain is real; 3DS failing on airport Wi-Fi and the Jio counter KYC are exactly real. Sending `rahul.eth` 1 GB at 3 a.m. is a crypto-native primitive that is genuinely delightful.
**Share.** "I got 300 MB in Mumbai for being human", plus gift notifications ("vitalik.eth sent you 1 GB"); sponsors want their logo on the welcome bundle. Virality 7/10.
**References.** Strong and correct. Best: Saily (cleanest install flow), Airalo (plan cards), Revolut (in-app eSIM), Apple's eSIM sheet (embrace it), Jio/Paytm recharge screen. **Signature:** the recharge voucher — one big MB meter styled as a prepaid scratch card with a "USDC per 100 MB" ticker; gifts as boarding-pass cards addressed to an ENS name. The orange FreeCharge era, not glass.
**Desire 8/10.**
- Q-USER-RECHARGE-1: Which chains can a landing foreigner pay from — Base/Arbitrum/Solana USDC or Hedera only — and what is the tap count for someone holding USDC on Base?
- Q-USER-RECHARGE-2: Same-phone install: Apple universal link / Android direct install, or a QR the user cannot scan?
- Q-USER-RECHARGE-3: Agent permission UX (cap, revoke), and does the top-up fire *before* the user runs dry given reseller usage-API lag?

### 11. Challan — TDS-withholding v4 hook (Mumbai Native)
**Journey.** Arjun must find a Challan-routed swap UI (the hook lives on specific pools, not the Uniswap app) → connect → World ID plus an Indian-residency credential that mostly does not exist (Orb paused; most Indian passports in circulation lack an NFC chip, e-passports only began rolling out in 2025) → or self-attest to pay 1% more → swap → "TDS 1% · ₹412 withheld" → certificate. 8 taps plus a credential nobody has.
**Twice?** No Indian voluntarily routes through a pool that withholds 1% when the identical pool is one tab away. Compliance is bought by institutions (Okto, CoinSwitch DeFi) and avoided by users; the product is a licence to wallet integrators, and the proposer's own U6 says it is invisible when it works.
**Share.** Indian CT would argue about it — reach, not love; half the replies are "you built the IT department a hook". Virality 3/10.
**References.** Exactly right. Add Quicko. **Signature:** the challan itself — the government receipt format (CIN, BSR code, date) rendered beautifully, one extra line on the swap sheet, Zerodha-grade whitespace.
**Desire 3/10** (6 as "would Indian wallets license it").
- Q-USER-CHALLAN-1: Why would Arjun choose the withholding pool over the free identical pool — is the real user Arjun or Okto?
- Q-USER-CHALLAN-2: How does an Indian prove residency to World ID 4.0 today, and what does the self-attested fallback do to the word "compliant"?

### 12. Udhaar — a UPI tab with a verified local (Mumbai Native)
**Journey.** Marco at the vada pav stall: PWA → fund the tab (USDC on Arc: bridge from Base, 5+ taps before he eats) → scan the vendor's UPI QR → app finds a settler nearby (is Priya online, in range, willing at 13:10?) → wait → Priya taps GPay → soundbox chirps → Marco confirms. 6 taps after funding, 15+ first time, and a 30–90 s human-in-the-loop with a queue behind him. Confusions: "who is this stranger", "why Arc", "what if she doesn't".
**Twice?** Once, when stuck. The informal version ("bro pay, I'll send USDT") is faster because the settler is my friend beside me; the app's value is stranger-matching plus accounting, and matching is the weak link. NPCI piloted UPI One World for foreign delegates in Feb 2026 and, per a May 2026 guide, plans to open it to all inbound tourists for the 2026–27 winter season — possibly this venue, this week.
**Share.** "A stranger paid my vada pav and I sent her USDC" is a good story; a tab of chai, auto and vada pav lines settled in USDC is charming. Settlers earning 1.5% will share. Virality 6/10.
**References.** Right. Best: Splitwise (tab), Binance P2P (counterparty trust and timers), Wise (rate transparency), Cash App (request flow), GPay scan flow (mimic exactly). **Signature:** the khata — a running tab styled as the shopkeeper's red-cloth ledger (Khatabook's motif), each line merchant + ₹ + USDC, settled with a rubber stamp. A tab, not a wallet.
**Desire 5/10.**
- Q-USER-UDHAAR-1: p50 seconds from QR scan to the vendor's soundbox chirp with a stranger settler, and what happens when no settler is in range?
- Q-USER-UDHAAR-2: If UPI One World is live for tourists at Devcon, what is Udhaar's remaining reason to exist beyond "earn USDC as a settler"?

## Chair's cross-cutting questions

**(A) From-scratch vs Continuity.** From-scratch: users do not care which track we entered, and finalists discount continuity. But the thing hackathon projects never ship is onboarding, and that is exactly where a continuity head start would have gone. So spend the pre-window on everything that is not code and is UX: ten merchant and ten foreigner interviews, Hindi/Marathi copy, the recorded voice, eSIM inventory, reference boards and a strict design brief (type, palette, one signature object). Confirm with ETHGlobal whether mock-ups count as project work; if in doubt keep the Figma in-window and disclose. The 36 hours then go to making it work on a stranger's phone.

**(B) 100 real users during Devcon week.** Recharge — a table at the venue and one sponsor-funded welcome bundle gets 100 installs in a morning. Dhwani — five to ten boxes at F&B stalls on Friday–Saturday reach 100 payers *only if* the QR accepts USDC on the chains people hold. CallSheet — 100 hacker-followers in one Telegram group over a weekend with $5 real fills, on Base mainnet, not Unichain Sepolia. Asli and Boli can stunt to 100 Indian hackers for $10 or ₹2.50 if the payout is spendable. Udhaar — 100 one-time uses at the gate on Friday with 20 recruited settlers; Diwali Sunday shutters the stalls. Nilami — 100 phones bidding for five minutes on stage is 100 users on paper. Bhishi, Octroi, Gavel, Kilowatt, Challan: no.

**(C) CT dunk list.** Octroi ("x402 wrapper number four thousand — now with a face scan"). Gavel ("a Dune dashboard with an agent button"). Asli ("Galxe but Worldcoin"). Nilami ("fair launch number 127; the bots are already in the Discord"). Bhishi ("twenty-eighth chit fund, zero finalists"). Challan splits the timeline — respect for the hook, "bootlicker" from the rest. Kilowatt gets dunked as dystopian, not as slop. Boli survives if Sunita, not the agent, is the hero. Dhwani, Recharge, CallSheet and Udhaar are the four CT cannot call slop: a box that talks, data that works, a PnL card, a stranger buying your vada pav. The slop tell is visual — dark purple gradients, Inter, rounded glass cards, emoji in headings, a dashboard nobody asked for. Every signature above is the antidote: one physical or cultural object (voice, scratch card, envelope, khata, challan) that a model would not pick.

## Ranked by desire
1. **Recharge — 8.** I would use it day 1 and day 4 unprompted.
2. **Dhwani — 8.** Merchants keep it; the only clip the whole hall remembers; drops to 5 if Arc-only.
3. **CallSheet — 7.** My tribe, real pain; wrong venue as specified.
4. **Udhaar — 5.** Authentic, once.
5. **Boli — 5.** The seller cannot spend the money.
6. **Nilami — 4.**
7. **Asli — 4.**
8. **Bhishi — 3.**
9. **Challan — 3.**
10. **Octroi — 3.**
11. **Gavel — 3.**
12. **Kilowatt — 2.**

Recharge and Dhwani serve the same person in the same week — the foreigner who holds USDC and nothing else. That is the strongest signal in this round that the persona, not the sponsor list, should pick the project.

## KILL LIST
- **Kilowatt** — nobody in the hall can be its user; the demo is a repo-man.
- **Gavel** — a terminal for a market with a few auctions a month has no daily open.
- **Octroi** — asks end-humans to scan their face for a free API tier, and bills agents on a chain their agents do not hold.
- **Bhishi** — monthly USDC buys with 1% TDS and 30% on dividends for a ₹5,000 chit; the twenty-eighth chit fund.
- **Challan** — nobody volunteers to pay 1% more at the pool next to a free one; it is a B2B licence, and the residency credential does not exist for most Indians.
- **Nilami** — competes with the Uniswap app's own Auctions tab while adding a World App install and commit-reveal.
- **Asli** — Galxe with World ID; payout lands on a chain the earner cannot cash out; the demo is a dashboard.
- **Boli (conditional)** — kill unless the seller's ₹2.50 lands in UPI or a redeemable balance; World App install is a wall for the rural seller.
- **Udhaar (conditional)** — kill if UPI One World is live for tourists at the venue, or the median stranger-settler wait exceeds 60 seconds.

Surviving my lens: **Recharge, Dhwani, CallSheet** — each on condition that USDC is accepted where users already hold it.

*Checked this round (4 of 6 searches):* World ID 4.0 tiers and the India Orb pause ([Biometric Update](https://www.biometricupdate.com/202604/world-targets-central-idv-ai-agent-management-role-with-selfie-biometrics), [Cointelegraph](https://cointelegraph.com/news/worldcoin-halts-iris-scanning-india-brazil-france-report)); Tez Cash Mode ([Wikipedia](https://en.wikipedia.org/wiki/Tez_(software)), [TechSpot](https://www.techspot.com/news/71022-google-unveils-tez-mobile-payment-app-uses-sound.html)); Uniswap CCA in the web app ([Uniswap blog](https://blog.uniswap.org/token-auctions-are-coming-to-the-uniswap-web-app), [The Block](https://www.theblock.co/post/378864/uniswap-continuous-clearing-auctions), [Crypto Briefing](https://cryptobriefing.com/uniswap-token-auctions-web-app/)); UPI One World for tourists ([NPCI](https://npci.org.in/blog/upi-one-world-your-digital-passport-to-seamless-payments-in-india), [The Week](https://www.theweek.in/news/biz-tech/2026/02/16/upi-goes-global-at-india-ai-summit-npcis-one-world-wallet-lets-foreign-delegates-use-scan-and-pay-in-india.html), [Wise](https://wise.com/in/blog/upi-for-foreigners)).
