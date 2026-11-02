# Round 1 — Member #6, VC / Market Skeptic

**Lens.** Will this be a ≤5-person business clearing US$10,000/week (~$1.43k/day) by ~May 2027? I re-derived every revenue claim with my own assumptions, priced in India's regime (30% s.115BBH, 1% TDS s.194S on every VDA transfer, Online Gaming Act 2025, RBI/FIU stablecoin hostility — including today's RedotPay card probe, `ideation.md` §3.2), and penalised every "capture X% of Y" argument. Offenders: Boli ("<0.5% of Indic data spend"), Kilowatt ("2% of EV financing"), CallSheet ("1% of Axiom's peak day"), Nilami ("10% of early Clanker"), Challan ("10% of an assumed $50M/week"), Dhwani (1,500 boxes × 10 foreign payments/day). Eight searches were spent only on facts that could flip a verdict; the rest leans on `ideation.md` §1–3 and `winners.md` §4.

**Facts that moved verdicts (re-verify before R2):**
- Clanker fees fell from ~$22.4M (Feb 2026) to ~$0.3–0.5M/month (Jun–Sep) and ~$1.15M in Oct (revenue ~$0.19M); holder payouts $0 since May ([DefiLlama](https://defillama.com/protocol/clanker)). The "early Clanker" comparable no longer exists.
- Uniswap CCAs are marquee events (Aztec $59M/17k bidders, CAP $16.4M, STRATO) with a no-code tool since June 2026 and no published aggregate count — dozens a year, not a market ([The Block](https://www.theblock.co/post/387505/uniswap-roll-out-continuous-clearing-auctions-frontend-reshaping-token-launch-process)).
- Galxe integrated World ID in May 2024 ([Binance Square](https://www.binance.com/en/square/post/2024-05-08-galxe-announces-integration-with-world-id-to-enhance-user-data-privacy-and-security-7831019085321)): verified-human quests are an incumbent feature.
- AI4Bharat's IndicVoices: 7,348 hours of Indic speech, free ([Inc42](https://inc42.com/?p=446830)); Shaip pays contributors up to ₹200 per audio hour.
- India eSIM wholesale ~€2.50 per 1GB/7d (Bappy reseller API, vendor claim) vs retail $3.60–6.30/GB → ~$1–3 margin per plan.
- Soundbox rentals: PhonePe ₹299 setup + ₹50–100/mo, Paytm ~₹78–150/mo, GPay SoundPod ₹499 + ₹5/day; ~20M devices deployed (2024 estimate; [TechCrunch](https://techcrunch.com/2023/09/04/indian-fintechs-amplify-sound-box-pitches-to-woo-merchants)).
- Battery Smart: reportedly >₹1,000 crore of debt raised, incl. $15M Mirova (Apr 2026) and $13M responsAbility (Jul 2026); BatteryPool's NBFC partners deploy ₹1–2 crore/month ([Autocar Pro](https://www.autocarpro.in/news/battery-smart-secures-usd-15-million-debt-from-mirova-to-expand-baas-network-132301), [eMobility+](https://emobilityplus.com/2026/01/13/batterypool-brings-sachetized-ev-battery-financing-to-indias-commercial-mobility-sector)).

## Per-idea verdicts

Format: model → my re-derivation → month-6 weekly range (low / base / high) and the hinge → incumbents and wedge → kill risks → realism /10 → R2 questions.

### 1. Dhwani — stablecoin soundbox (Judge's Eye)
**Model:** 0.8% on non-UPI payments (1,500 boxes × 10 foreign payments/day × $15), $9 device margin on 500 boxes/week, ₹99/mo on 10k boxes.
**Re-derivation:** 1,500 × 10/day = 15,000 foreign crypto payments a day = 5.5M/yr against ~10M total foreign tourist arrivals — half of all visitors making a crypto street payment daily. Realistically ≤1% of visitors ever pay a merchant in crypto, ~$100 each at QR-level merchants: $7–10M/yr of addressable GMV *in total*, $1.1–1.5k/week at 0.8% with 100% share. Merchant side: Ramesh's USDC becomes INR only through an FIU-registered exchange (1% fee + 18% GST + 1% TDS, `ideation.md` §3.5) — an all-in ~3% haircut against UPI's 0%. ₹99/mo competes with PhonePe at ₹50–100 for a device that chirps on every UPI sale; Dhwani chirps a few times a year.
**Range:** $0 / $200–500 (device margin + a few hundred Goa/BKC boxes) / $2–3k (a Goa reseller + one Indian chain). **Hinge:** foreign crypto payments per box per day — the model needs 10; I expect <0.3.
**Incumbents:** Paytm/PhonePe/GPay (~20M devices, field-sales armies); abroad, Binance Pay merchant, Pundi X, CoinGate. The offline-payer chirp is real engineering, but UPI Lite X already solves offline in India and a $0 phone app (Web3 Soundbox, 2023) replicates "sound as receipt".
**Kill risks:** "spend USDC in India" is this week's regulatory target; ambiguous s.194S treatment of goods-for-VDA barter; hardware CAC. **Realism: 2/10** — finalist-grade demo, no business.
- Q-VC-Dhwani-1: One data point, from any Indian merchant anywhere, supporting 10 foreign crypto payments per box per day.
- Q-VC-Dhwani-2: Ramesh's legal USDC→INR path and all-in haircut vs UPI's 0% — why does he take it?
- Q-VC-Dhwani-3: Which entity, in which jurisdiction, holds merchant contracts and fee revenue after the RedotPay probe?

### 2. Boli — Indic speech market (Judge's Eye)
**Model:** $0.01 fee per certified utterance (25% of $0.04); $10k/week = 1.0M utterances/week.
**Re-derivation:** 1M utterances/week ≈ 830 audio-hours/week ≈ 43k hours/yr — six IndicVoices corpora a year through a marketplace born at a hackathon, while AI4Bharat and Bhashini release theirs free. Price check: $0.04 × ~1,200 utterances per audio hour ≈ $48/hour, vendor parity for scripted read speech, not a discount; seller pay of ₹2.5/utterance ≈ ₹3,000/audio-hour is ~15× what Shaip pays contributors, so Boli is expensive on *both* sides. Labs (Sarvam, Krutrim) procure by contract with QA, not via an agent at 3 a.m.
**Range:** $0 / $50–200 (pilot bounties from one academic group) / $1k (a lab adopts it for dialect long-tail). **Hinge:** a per-utterance marketplace buyer exists — I find none.
**Incumbents:** Karya (Microsoft/Google contracts, rupee payouts via UPI), Shaip, Appen; free substitutes AI4Bharat, Bhashini, Common Voice. TEE grading and instant pay are a prize story; buyers pay for licence provenance and QA, which a 36-hour anti-spoof heuristic cannot carry.
**Kill risks:** Orb paused in India → Sunita holds Device/Document credentials (≈8% of Indians have passports), so "one human, one seller" is hollow for the persona; paying Indian workers in HBAR/USDC adds off-ramp and TDS friction Karya avoids. **Realism: 3/10.**
- Q-VC-Boli-1: Name one buyer paying per-utterance from a marketplace today rather than via vendor contract or free corpora, and their $/audio-hour.
- Q-VC-Boli-2: Which World credential does a rural Marathi speaker actually hold, and how does it beat a TTS farm?
- Q-VC-Boli-3: Who converts Sunita's HBAR to rupees, who bears the 1% TDS, and is it still faster than Karya's weekly UPI payout?

### 3. Bhishi — auction ROSCA (Judge's Eye)
**Model:** 2% of each pot; $500k/week of pots = 4,300 groups of ten at ₹4,200/month.
**Re-derivation:** 4,300 active USDC chit groups among people who hold USDC, accept 1% TDS and 30% VDA exposure on payouts, and trust strangers. The structural flaw precedes regulation: a member who wins in month 2 of a 12-month cycle and defaults owes ten more contributions; the bond covers one. Either collateral ≈ pot (then nobody needs a chit) or World ID plus "slash" is theatre. Diaspora "committees" run on WhatsApp and bank transfer at 0%, enforced by acquaintance — the mechanism Bhishi removes and replaces with nothing.
**Range:** $0 / $50–200 / $1k (one UAE community partner). **Hinge:** stranger-group default rate.
**Incumbents:** KSFE, Shriram Chits, Margadarsi (licensed foremen posting security equal to the chit value), Chitmonks (SaaS to them), The Money Club (years in, no public revenue). 27 ETHGlobal chit entries, zero finalists — the market speaking too.
**Kill risks:** Chit Funds Act 1982 — a platform taking 2% of every pot is an unregistered foreman; Prize Chits Banning Act 1978; every payout is a VDA transfer. **Realism: 2/10.**
- Q-VC-Bhishi-1: The month-2 winner defaults; who funds the remaining ten months?
- Q-VC-Bhishi-2: Name a registered foreman willing to run chits in USDC with VDA tax on each payout.

### 4. CallSheet — sealed calls, per-fill fee (Operator)
**Model:** 0.75% per mirrored fill; $1.33M/week mirrored volume ≈ 1,000 funded followers at $150 × 1.3 fills/day.
**Re-derivation:** The fee instrument is the only proven one among the twelve (Trojan/Maestro/Axiom at 0.75–1%, `ideation.md` §1.1). The venue is the problem: fills route through a v4 pool on Unichain (0.4% of Uniswap volume) — spot tokens with v4 liquidity — while Indian signal groups overwhelmingly call BTC/ETH/alt *perps* on CEXs or Hyperliquid. Conversion of 2–4% funded-and-active from 45k members is high; paid-group conversion runs 1–2% and active-funded is a fraction. For Indian followers every mirrored swap is a VDA-for-VDA transfer with 1% TDS on both legs (Circular 13/2022) plus 30% on gains, so the real market is Dubai/SEA — fine, but then "India runs the largest Telegram-signals economy" is not your market.
**Range:** $200 / $1–2k (200–400 active followers, $150–300k weekly volume) / $8–15k (one hot caller in a memecoin week; hit-driven). **Hinge:** ~1,000 active funded followers by month 6 with no owned distribution.
**Incumbents:** Hyperliquid vaults (non-custodial copy by design, 10% profit share, 0% per fill), Bybit/Binance/OKX copy trading (free to followers), pvp.trade, Polycopy ($30/mo), Dexari (decayed to ~$900 quarter-to-date — the generic-frontend warning). Sealed calls are a real wedge for honest callers; the dishonest majority *want* to front-run followers and will not adopt.
**Kill risks:** Definitive/World eligibility; Unichain liquidity; India tax makes the stated channel the wrong channel. **Realism: 5/10** — 7 as a Hyperliquid builder-code product (`ideation.md` G2) at the cost of Uniswap's $10k.
- Q-VC-CallSheet-1: What share of your three target groups' calls are spot tokens with Unichain/v4 liquidity vs CEX/HL perps? If <20%, what is the day-30 product?
- Q-VC-CallSheet-2: HL vaults and Bybit charge followers 0% per fill plus profit share; why does a follower pay 0.75% per fill for the same entry?
- Q-VC-CallSheet-3: Names, group sizes and current VIP pricing of the three callers, with written commitment to route followers within 30 days.

### 5. Nilami — human-gated CCA launchpad (Operator)
**Model:** 20 bps of secondary volume + 0.5% of raises; $4.25M/week secondary ≈ "10% of early Clanker".
**Re-derivation:** Early Clanker (Nov 2024, Farcaster-native distribution, Base's content-coin mania) is gone: fees −95% Feb→Sep 2026, October revenue ~$0.19M; Base killed creator rewards, ZORA −95%. 10% of Clanker's *current* volume at 20 bps is tens of dollars a week. Raise fees: real CCAs (Aztec, CAP, STRATO) are run by funded teams on Uniswap's free no-code tool — they will not pay 0.5%; small creators launch for $0 on pump.fun/Clanker/Zora. World-gating bidders removes the bots that *are* launch volume.
**Range:** $0 / $50–300 / $3–5k in a hit week (median ≈ 0). **Hinge:** one token with legs — a lottery ticket, not a plan.
**Incumbents:** Clanker, Flaunch, Zora, pump.fun, Believe, Doppler, Uniswap's own CCA UI. Fairness and a bidder dividend serve humans; launch revenue comes from traders.
**Kill risks:** fan tokens for Indian creators → SEBI/consumer-protection and VDA exposure; the "casino" discount with EF-heavy judges. **Realism: 2/10.**
- Q-VC-Nilami-1: Re-run the arithmetic on Clanker's October 2026 run-rate, not November 2024.
- Q-VC-Nilami-2: Which creator has committed to launch knowing only World-verified humans may bid?

### 6. Asli — verified-conversion CPA (Operator)
**Model:** 20% of campaign spend + $0.05/payout; $50k/week spend = 5 campaigns × 1,000 conversions × $10.
**Re-derivation:** Buyers exist and are in the building — the strongest 30-day signal in the deck. But $50k/week of *recurring* spend means two $25k campaigns every week for six months from chains whose growth budgets shrank after Black October; a $15k prize pool is event marketing, not a CPA line. Supply: zero earners on day one; with Orb paused in India, Indian earners carry Device/Document credentials, so "Orb-level human" supply is non-Indian. 1,000 verified conversions per campaign is months away.
**Range:** $0–200 (one pilot, then nothing) / $500–1,500 ($2.5–7.5k campaign spend/week) / $4–6k (two chains adopt it as their standard dev-acquisition rail). **Hinge:** a chain paying $10 per verified deploy vs $0.50–2 per Galxe/Intract "user", half farmed.
**Incumbents:** Galxe (World ID since May 2024), Layer3, Intract (Bengaluru, tens of millions of Indian users), QuestN — all with sybil scoring. Refund-by-default escrow and a public Arkiv ledger are honest increments, not a moat; Galxe ships escrow in a sprint.
**Kill risks:** DPDP Act 2023 if "KYC-ready signups" are resold; Indian earners' USDC income and TDS; the dev-acquisition niche's ceiling. **Realism: 5/10.**
- Q-VC-Asli-1: What does an advertiser get that a World-gated Galxe campaign does not, worth a 20% take?
- Q-VC-Asli-2: Where do the first 1,000 verified earners come from and what fraction can be Orb-level?
- Q-VC-Asli-3: Which sponsor devrel has a *recurring* monthly UA budget (size?) rather than a one-off prize pool?

### 7. Octroi — price-not-block middleware (Sponsor Stacker)
**Model:** $299/mo + $0.02 per human quota grant + 1.5% of x402 overage; 45 providers at ~$1k/mo.
**Re-derivation:** The proposer concedes take-rate is cold (`ideation.md` §1.6: $42M x402 settled *lifetime*, 87% of payments <$0.10, ~4,000 wallets = 90% of spend). So this is SaaS to 45 API operators paying $1k/month for a human-exemption lane — I cannot name five. Faucets have no revenue; RPC free tiers have abuse teams and Cloudflare; Turnstile and Pay-Per-Crawl are free; Unkey/Kong do rate limits. The $0.02-vs-SMS-OTP comparison is wrong — the alternative is a free CAPTCHA.
**Range:** $0 / $100–400 (hobbyist x402 sellers, sponsor goodwill) / $1.5–2k (one India LLM-API vendor + a dozen sellers). **Hinge:** ≥45 API sellers for whom human-backed-agent exemption is a paid problem in 2026 — they do not exist.
**Kill risks:** Agent Pass immaturity; facilitator commoditisation (Coinbase's is free). **Realism: 2/10** — best sponsor EV in the deck, clearest prize bait.
- Q-VC-Octroi-1: List ten live x402 sellers with >$1k/month real (non-wash) revenue who would pay $299/month.
- Q-VC-Octroi-2: Why does a faucet or RPC operator pay $1k/month when Turnstile + Pay-Per-Crawl cost $0?

### 8. Gavel — CCA terminal and agent desk (Sponsor Stacker)
**Model:** 1% router fee on bids/exits + $49/mo pro; $1M/week routed or 1,000 subs.
**Re-derivation:** CCAs are dozens of events a year hosted free on app.uniswap.org. A bidder in a $16M auction will not pay 1% ($160k) to route through a desk. 1,000 × $49 subscribers for analytics on a market whose biggest-ever auction had 17k bidders is implausible; Dune is free. Agent-by-policy bidding is a niche of a niche.
**Range:** $0 / $0–150 / $1k. **Hinge:** CCAs per week (currently <1). **Incumbent:** Uniswap Labs' own UI. **Realism: 1/10.**
- Q-VC-Gavel-1: How many CCAs cleared in October 2026, total raise, and what fraction of bids would plausibly route through a third-party desk at 1%?

### 9. Kilowatt — telemetry-metered battery leases (Sponsor Stacker)
**Model:** 1% origination + 0.25% servicing + 10% of spread; $1M/week originations ≈ 400 batteries/week.
**Re-derivation:** $1M/week ≈ ₹37 crore/month — larger than BatteryPool's entire NBFC credit line (₹1–2 crore/month) and a top operator's growth rate; Battery Smart already borrows from Mirova/responsAbility at institutional terms. Unit math: 1% of a ~$1,200 e-rickshaw pack (not $2.5k) is $12; 10% of spread ≈ $15/battery/yr. The stack also needs an RBI-registered lender of record and a FEMA-compliant route for foreign USDC into Indian consumer credit (crypto-denominated ECBs do not exist); GIFT City wrappers take two quarters and crores.
**Range:** $0 / $0 / $500–1k (one pilot pool, one-off). **Hinge:** a licensed NBFC partner plus a USDC capital source inside six months — neither plausible. **Realism: 1/10** for six-month revenue; a legitimate 24–36-month fintech. Whitechain's $300k grant is runway, not revenue.
- Q-VC-Kilowatt-1: Who is lender of record, under which licence, and how does USDC enter India legally?
- Q-VC-Kilowatt-2: Why would an operator already funded by Mirova/responsAbility add a crypto tranche?

### 10. Recharge — x402 eSIM (Mumbai Native)
**Model:** ~$2–2.5 margin per plan; Devcon week ~$6k margin plus branded sponsor data; steady state one 4,000-attendee conference per week.
**Re-derivation:** Wholesale ~€2.50 per 1GB/7d vs retail $3.60–6.30 → $1–3 margin; $10k/week = ~5,000 plans/week = 260k/yr, Airalo-scale for one country from a standing start. "One conference a week": ~50 crypto conferences above 2k attendees a year, whose organisers can take Airalo/Saily/Holafly partner deals at zero cost; Silent.link and Bitrefill have sold crypto-paid eSIMs since 2021; attendees install before boarding. Agent top-up and ENS gifting carry ~zero willingness to pay. Indians have ₹300/month Jio plans — no domestic TAM.
**Range:** $0 / $100–300 / $1.5–2.5k (one conference deal a month plus a nomad trickle). **Hinge:** conference cadence — needs weekly, realistic monthly. Devcon week itself: $2–6k gross margin if the reseller account is live by Friday — the only idea that literally takes cash on day one.
**Kill risks:** reseller approval lag; commodity margins; the attendee whose card fails 3DS already has Airalo installed. **Realism: 3/10.**
- Q-VC-Recharge-1: What share of Devcon attendees switch from an Airalo profile installed at home to one bought on arrival, and why?
- Q-VC-Recharge-2: Name conference *organisers* (not sponsors) who will pay $2.50/attendee in Q1 2027, and what Airalo/Saily quoted them.

### 11. Challan — TDS-withholding v4 hook (Mumbai Native)
**Model:** 0.15% on hook-routed volume + B2B licences; 10% of an assumed $50M/week of Indian DEX flow.
**Re-derivation:** Indian on-chain volume is large (Chainalysis: +99% YoY to June 2025; India #2 in flows), so $50M/week of Indian swaps is not the problem. Adverse selection is: the hook *adds* 1% TDS plus 0.15% to a swap whose untaxed twin is one click away, in a thinner pool. Only compliance-minded users opt in — KoinX's 200k reports over years ≈ 1–2% of holders — and they already trade untaxed on Hyperliquid without consequence. "10% of flow" voluntarily paying 1.15% more is the purest capture-X% fallacy in the deck.
**Range:** $0 / $0–500 (one pilot licence) / $3k (two B2B licences). **Hinge:** an Indian wallet licensing rather than building — Okto and CoinSwitch already built.
**Incumbents:** Okto/CoinDCX and CoinSwitch DeFi (in-house TDS), KoinX/ClearTax (ex-post reporting — the form Indians actually pay for; `ideation.md` G3).
**Kill risks:** the deductor of record needs a TAN, FIU-IND VASP registration and Form 141 filings — exchange-grade compliance for 15 bps; converting skimmed tokens to INR for the monthly deposit itself triggers s.194S and carries FX risk. **Realism: 2/10** — right customer (the legally obligated), wrong form (a pool, not reporting SaaS).
- Q-VC-Challan-1: Why does any user route through a pool charging 1.15% more than the identical untaxed pool?
- Q-VC-Challan-2: Who is deductor of record, is VASP registration required, and how is the skim converted to INR without triggering s.194S?
- Q-VC-Challan-3: What did Okto/CoinSwitch say when asked to license it?

### 12. Udhaar — UPI tab with verified settlers (Mumbai Native)
**Model:** 0.5% platform + 1.5% settler; Devcon $280k GMV → $1.4k; $10k/week needs $2M/week of tabs, 12–18 months out.
**Re-derivation:** The proposer's own numbers concede the case; I add only that $280k GMV assumes 5,000 foreigners each pushing ₹5,000 through QR-only merchants when most visitor spend is card-settled hotels and cabs. Post-Devcon GMV ≈ Goa nomads.
**Range:** $0 / $0–100 / $500. **Hinge:** enforcement tolerance.
**Incumbents:** UPI One World (NPCI), ATMs, informal "bro pay" at 0%, Binance P2P; ShieldRamp/uWu/Nomadia as unmonetised prior art.
**Kill risks:** a resident settler taking USDC for INR is dealing outside FEMA's authorised persons (USDC's FEMA status is unsettled — that *is* the risk); aggregating settlers for a fee is an unlicensed payment system; FIU-IND VASP exposure; the RedotPay probe shows appetite this week. **Realism: 1/10.**
- Q-VC-Udhaar-1: Which authorised person under FEMA stands behind the settler leg, and where is the written legal opinion?

## Chair's cross-cutting questions

**(A) From-scratch vs Continuity.** From scratch, for a revenue reason as much as a prize one: Continuity only pays if you bring an existing product with users, and none of these twelve exists. The pre-kickoff work that moves revenue is non-code and permitted — LOIs, pre-orders, a reseller account, a CA/FEMA memo, three named callers or advertisers. Spend 3–5 Nov on sales, not scaffolds. The $28–37k continuity pool is not worth the finalist discount.

**(B) Paying customer within 30 days of 8 Nov** (my probability of ≥$1 / of ≥$2k of revenue): Asli 40% / 25% (a sponsor devrel buys one verified-deploy campaign — the hackathon is the sales meeting); Recharge 60% / 15% (attendees pay Friday; sponsor-branded data maybe); CallSheet 35% / 10% (followers pay per fill if any caller goes live); Dhwani 25% / 5% (a chain buys 20 boxes — device margin, not the model); Boli 20% / 2%; Challan 10% / 5% (licence LOI, cash unlikely); Octroi 10% / 2%; Nilami, Gavel, Bhishi, Kilowatt, Udhaar <5%.

**(C) Prize bait with no business.** Octroi (best sponsor EV, no buyer), Gavel (no market), Nilami (comparable evaporated), Kilowatt (a real business for a licensed lender, not for this team in six months), Boli (free substitutes), Dhwani (unforgettable demo, 3% merchant haircut), Udhaar and Bhishi (illegal as described). The deck's shared disease: six of twelve monetise flows that are either taxed 1% per transfer for the stated users or sit in the regulator's sights this week. Stop pitching Indian *users*; pitch Indian *pain sold abroad* or non-Indian users.

## Ranking by realistic month-6 weekly revenue (base case; high case in brackets)

1. **CallSheet** — $1–2k ($8–15k, hit-driven) — only proven fee instrument; wrong venue, wrong country for followers
2. **Asli** — $0.5–1.5k ($4–6k) — buyers in the room; incumbents already human-gate
3. **Dhwani** — $200–500 ($2–3k) — device margin, not payments
4. **Recharge** — $100–300 ($1.5–2.5k) — cash on Friday, commodity after
5. **Octroi** — $100–400 ($1.5–2k)
6. **Challan** — $0–500 ($3k B2B)
7. **Boli** — $50–200 ($1k)
8. **Bhishi** — $50–200 ($1k)
9. **Nilami** — $50–300 ($3–5k lottery)
10. **Gavel** — $0–150 ($1k)
11. **Udhaar** — $0–100 ($500)
12. **Kilowatt** — $0 ($1k one-off)

None reaches $10k/week in my base case. CallSheet's high case does, which is why it ranks first; its probability-weighted month-6 revenue is still ~$2–3k/week.

## KILL LIST (one decisive reason each)

- **Udhaar** — resident settlers dealing USDC-for-INR outside FEMA's authorised channels, in the week RBI/FIU moved on RedotPay.
- **Kilowatt** — needs an RBI-licensed lender and a FEMA-legal route for foreign USDC before dollar one; 24–36 months, not six.
- **Gavel** — the "market" is a few dozen auctions a year, hosted free on Uniswap's own frontend.
- **Nilami** — the comparable is dead: Clanker fees −95% Feb→Sep 2026, and World-gating excludes the traders a launch needs.
- **Bhishi** — early-winner default is unsolved by a one-month bond, and a 2% platform is an unregistered foreman under the Chit Funds Act.
- **Octroi** — the paying population (x402 sellers with real revenue) is near zero; Cloudflare gives the alternative away.
- **Challan** — adverse selection: nobody pays 1.15% more to enter a tax pool when the untaxed twin is one click away; the B2B buyers already built in-house.
- **Dhwani** — ≤0.3 foreign crypto payments per box per day (not 10), a ~3% merchant haircut vs UPI's 0%, and "spend USDC in India" is this week's regulatory target.
- **Boli** — buyers get 7,348 hours of Indic speech free from AI4Bharat; the per-utterance agent buyer does not exist.

**Conditional survivors:** CallSheet (if re-venued onto Hyperliquid/perps or honestly scoped to non-Indian spot degens), Asli (if one sponsor signs a recurring campaign before kickoff), Recharge (as a Devcon-week cash experiment, not a company). If the committee wants one project that is both demoable and a business, make CallSheet and Asli answer their R2 questions with names, not models.
