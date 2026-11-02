# Round 0 — Member #4, Mumbai Native / Consumer

**Lens:** real users in the Jio World Centre that week, real Indian pain, distribution. **Sources note:** web search and fetches were blocked in this session, so India facts are from my own knowledge (mid-2026) and tagged `[verify]` with the URL to check; prior art is grepped from `ethglobal-showcase.csv` (18,693 rows).

## Mumbai-week realities the committee must price in
1. **The hackathon is on Diwali weekend.** Dhanteras (India's biggest gold-buying day) is Fri 6 Nov; Diwali is Sun 8 Nov — submission morning `[verify: drikpanchang.com]`. Markets heave on 6–7 Nov, stalls shut on 8 Nov, Indian hackers leave early: film any vendor demo on Friday/Saturday.
2. **Tax:** flat 30% on VDA gains (s.115BBH), no loss offset, **1% TDS on every transfer (s.194S)**, thresholds ₹50,000/yr for "specified persons" else ₹10,000; CBDT Circular 13/2022: both sides of a crypto-to-crypto swap deduct, exchanges may deduct in kind `[verify: incometaxindia.gov.in]`. So Indians hold stablecoins, hate selling, and only CEXs (CoinDCX, Mudrex, CoinSwitch) handle TDS for them.
3. **Rails:** UPI is free and universal; foreigners can use it only via NPCI's **UPI One World** prepaid wallet (in-person KYC, few counters, low uptake) `[verify: npci.org.in/what-we-do/upi-one-world]`. FIU-registered off-ramps (Onramp.money, Transak, Mudrex) pay INR only to the KYC'd user's own account — **no legal API pays a stranger's UPI QR from crypto**; humans with GPay are the only bridge.
4. **Gambling:** the Online Gaming Act 2025 banned real-money games; Dream11, Probo and MPL stopped money play `[verify: pib.gov.in]`. Prediction/betting ideas are **offshore-only**; I propose none.
5. **Audience:** Devcon 7 Bangkok drew ~12,500; expect 10k+ in BKC, half foreign, plus ~3k Indian hackers who want USDC as a dollar hedge (INR ~₹88–90/USD `[verify]`). WhatsApp/Telegram first, mobile only.

**From-scratch vs Continuity: From-scratch, all three.** Consumer demos win on "built this weekend" wow; spend the pre-window on *non-code* assets: eSIM reseller accounts and inventory, World ID app registration, Whitechain faucet claims, a settler list, a CA memo on s.194S, sponsor conversations. Continuity-only money (Uniswap $5k, Arkiv $4k, World [Cont] $2.5k) is smaller than the finalist upside it costs.

---

## Proposal 1 — **Recharge**: eSIM data you buy, gift and let your agent top up with USDC

**1. One-liner.** x402-metered mobile data for the 5k foreigners landing at BOM: free welcome data for verified humans, top-ups by ENS name, and an agent that buys 100 MB at a time when you run low. "Recharge" is the Indian word for mobile top-up; Paytm and FreeCharge were born as recharge apps.

**2. User & pain.** Lena, 29, Solidity dev from Berlin, lands at BOM T2 at 02:40 on 3 Nov with no data. The Airtel/Jio counter wants passport, visa, photo and an Indian reference contact; activation can take hours `[verify: DoT foreign-national SIM KYC]`. Her Airalo card payment fails 3DS on airport Wi-Fi; the hotel address is in a Telegram message she cannot open. She has 400 USDC. Second buyer: the sponsor who wants to be the one who "gave you data in Mumbai". Third: Rahul, Pune hacker, gifting 1 GB by name to a teammate who went dark at 3 a.m.

**3. Why now.** Devcon week is India's densest-ever crowd of wallet-holding foreigners; Hedera's x402 track wants pay-per-call data APIs; Arc prize #4 wants a mobile-web consumer agent using the marketplace discovery API; World wants Agent Pass apps. Crypto-paid eSIMs exist (Silent.link `[verify]`) but none meter or gift data agentically.

**4. Core mechanism.** Onchain: a sponsor pool contract (Arc Studio, USDC gas) funding one 300 MB welcome bundle per World ID nullifier; a gift escrow keyed to ENS names; x402-protected `/esim/provision` and `/esim/topup?mb=100` endpoints settling USDC on Hedera testnet, the buyer agent registered via HCS-14, run on Hedera Agent Kit, receipts on HCS. ENS: an `esim` text record on `lena.eth` holds a salted ICCID hash so "top up lena.eth" resolves without exposing the profile. Offchain: provisioning through a reseller API (eSIM Go / eSIM Access / Airalo Partners `[verify access]`) or pre-bought inventory, plus usage polling that triggers the agent's purchase. Novelty: data becomes a stream an agent pays for, giftable by name, with a sybil-proof free tier.

**5. Sponsor map.** *Hedera — x402 ($6.5k).* Remove: no metering rail or agent identity; the product collapses to a static checkout. *World — Agent Pass app ($5k) / IDKit ($2.5k).* Remove: every free profile costs ~$2 wholesale, so a sponsor-funded tier becomes a sybil farm. *Arc — mobile-web consumer agent with marketplace discovery API ($3k), fallback Bridge Kit ($3k).* Remove: users need a gas token on arrival, the exact problem. ENS integrated, unclaimed.

**6. Revenue.** Retail India eSIM ≈ $4.5–5 per GB/7 days, wholesale ≈ $2–2.8 `[verify: airalo.com/india-esim]` → 25–35% gross margin. Devcon week: 5,000 foreigners × 40% × $10 = $20k GMV ≈ $6k margin, plus 3 sponsors × $5k branded welcome data. Steady state: (a) white-label "data included with your ticket" at $2.50/attendee — one 4,000-person conference a week (~50 crypto events/yr) = $10k/week; (b) nomads at 4,000 plans/week × $2.50 margin. First three customers: a Mumbai sponsor funding welcome data; a hacker house buying 200 × 1 GB; foreign attendees paying USDC at a table on day 1. Offshore entity; eSIM resale needs no telecom licence `[verify per jurisdiction]`.

**7. Hackathon-window scope.** Live: World ID verify → free bundle → a real eSIM installs on a real iPhone on stage and data flows; the agent pays x402 for a 100 MB top-up when usage trips a threshold; 500 MB gifted to `rahul.eth`. Mocked: usage telemetry simulated if the reseller's usage API lags (it often does); fulfilment from pre-purchased inventory if the API account is not approved by 5 Nov; HCS-14 registration minimal.

**8. Prior art.** GSpot (Lisbon 2023, 2 prizes: eSIM connectivity with ZK-KYC — https://ethglobal.com/showcase/gspot-dpqnf); GeSIM (New Delhi 2025: decentralised eSIM manifesto — https://ethglobal.com/showcase/gesim-n6qpi); topizzy (ETHOnline 2025: USDC airtime — https://ethglobal.com/showcase/topizzy-vsvk5); also ETH-ernet and Billcheap. None meter data via agent payments, gift by ENS, or use proof-of-personhood to fund a free tier; Silent.link sells crypto eSIMs without either.

**9. Biggest risk & mitigation.** Reseller onboarding and activation lag. Mitigation: open two reseller accounts now, pre-buy 30 India profiles, rehearse on three devices, keep one as stage fallback.

**10. UI/UX references.** Airalo, Saily, Holafly, Revolut eSIM, Paytm recharge screen, Apple's eSIM install sheet.

**11. Self-score.** T6 (x402 + agent loop + reseller integration) · O7 (metered, giftable, sybil-proof data) · P9 (sellable Friday) · U8 (one scan) · W8 (phone lights up on stage).

---

## Proposal 2 — **Challan**: the Uniswap v4 hook that makes DeFi legal for Indians

**1. One-liner.** A v4 hook that withholds India's 1% TDS in kind at swap time for wallets proving Indian residency via World ID, enforces the ₹50k annual threshold per *human*, and writes a queryable deduction ledger to Arkiv that outputs the certificate a CA needs. "Challan" is the tax-deposit receipt every Indian knows.

**2. User & pain.** Arjun, 31, Bengaluru PM, holds 2.4 ETH on Base. Legally a DEX buy makes him the deductor — 1% TDS, a TAN, a quarterly return — so Indians either stay on CEXs or swap onchain and pray. In 2025 the IT department's NUDGE campaign sent notices to thousands of crypto traders `[verify]`; Indian DeFi wallets (CoinDCX's Okto, CoinSwitch) built in-house TDS handling, proving demand `[verify]`. The moment: Arjun on the Devcon floor watching a non-Indian swap in one tap, knowing his tap is a violation.

**3. Why now.** The Income-tax Act 2025 (effective 1 Apr 2026) keeps the VDA regime `[verify]`; CARF/DAC8 reporting began 1 Jan 2026 in the EU/OECD and India has committed to CARF `[verify]` — pool-level withholding/reporting is the next global primitive and India is the hardest case. Uniswap's $10k wants v4 hooks with a FEEDBACK.md; Arkiv wants a flagship read+write; World wants IDKit as a real trust decision. Indian sponsor judges will get it instantly.

**4. Core mechanism.** `beforeSwap/afterSwap` hook: if the swapper's address is bound to a World ID nullifier carrying an Indian-residency credential (World ID 4.0 passport-based Identity Check `[verify availability]`; fallback: a self-attested residency credential via IDKit), the hook accumulates annual consideration per nullifier; above ₹50,000 it skims 1% of the output token into a TDS vault, emits `Deduction` and writes {nullifier-hash, salted PAN-hash, token, amount, INR value, block, challan-ref} to Arkiv. Non-Indian wallets swap untouched. Offchain: the vault operator (a TAN-holding, FIU-registered deductor — the business) converts and deposits; a worker reads Arkiv to render Form 26Q-style statements and a Form 16A-style certificate. Novelty: compliance moves from venue to pool; the threshold follows the human, so wallet rotation cannot dodge it; residency is proven in zero knowledge; prior hooks gate Indians out, this one lets them in legally.

**5. Sponsor map.** *Uniswap — Build with Uniswap ($10k).* Remove: no product. *World — IDKit ($2.5k), or Agent Pass if an agent swaps for a human.* Remove: no per-human thresholds or ZK residency — back to KYC-per-wallet, i.e. a CEX. *Arkiv — from scratch ($4k) + Swarm bonus (certificate PDFs keyed from Arkiv entities).* Remove: no queryable ledger, the CA cannot reconcile, the "legal" claim fails. Chainlink CRE integrated, unclaimed.

**6. Revenue.** 0.15% compliance fee on hook-routed volume plus B2B licences. India ranks #1 in Chainalysis grassroots adoption 2024–25 `[verify]`; Indian CEX spot volume runs ~$1–2B/month even after TDS `[verify]`; onchain Indian swap flow is unmeasured — flag for the VC skeptic. Arithmetic: 10% of an assumed $50M/week Indian DEX flow × 0.15% = $7.5k/week, plus three licences at $3–5k/month ≈ $2.5–3.5k/week → ~$10–11k/week. First three customers: an Indian DeFi wallet (Okto, CoinSwitch DeFi, Mudrex); a crypto-tax firm (KoinX-type) buying ledger access; an Indian-founded protocol wanting a compliant pool. India-compliant by design; until the entity holds a TAN, users stay responsible and the UI says so.

**7. Hackathon-window scope.** Live: hook on Unichain Sepolia (1301); IDKit binds wallet to nullifier; an "Indian" wallet swaps and the UI shows "TDS 1% — ₹412 withheld", the vault ticks, the Arkiv row appears, a certificate downloads; a non-Indian wallet swaps untouched; a sub-threshold swap shows 0%. Mocked: nationality proof self-attested in test mode (labelled); INR rate via CRE simulation; the government deposit leg.

**8. Prior art.** Effe (HackMoney 2026: v4 compliance gating without revealing identity — https://ethglobal.com/showcase/effe); Poolswap (Brussels 2024: KYC-gated v4 pools); Turing Swap (Lisbon 2026, World AgentKit 3rd: identity-aware fees via AgentBook — https://ethglobal.com/showcase/turing-swap-ck2y6); also UniV4HookKyc, Calary (Taipei, Uniswap runner-up — https://ethglobal.com/showcase/calary-se95k), financoor/INRfolio (ex-post Indian tax reports). Nobody has done withholding tax at the pool with per-human thresholds ("Mev Tax Hook" means MEV).

**9. Biggest risk & mitigation.** Is in-kind withholding by a pool a valid s.194S deduction when the deductor is not the buyer? Mitigation: frame as deductor-as-agent, as exchanges do under Circular 13/2022; an Indian CA reviews a two-page memo before kickoff; hand-built hook, tests and real swaps to pass the AI-slop smell test.

**10. UI/UX references.** Okto/CoinDCX TDS receipts, Zerodha Console, ClearTax, Stripe Tax, Uniswap swap confirmation with a "TDS" line.

**11. Self-score.** T8 (hook + ZK credential + threshold accounting + ledger) · O8 (withholding at the pool is unseen) · P6 (legal dependency) · U6 (invisible when it works) · W7 ("the pool that pays your taxes").

---

## Proposal 3 — **Udhaar**: run a UPI tab with a verified local, settle in USDC

**1. One-liner.** Every foreigner at Devcon gets an Indian friend with GPay: open a USDC tab on Arc with a World-ID-verified local who pays your UPI QRs all week; settle once at a Chainlink reference rate. "Udhaar" is the shopkeeper's credit tab; Khatabook digitised it for 10M merchants.

**2. User & pain.** Marco, 34, from Lisbon, at the vada pav stall outside the Jio World Garden gate, 13:10 on Friday 6 Nov. The vendor takes only UPI QR (zero MDR, no card machine). Marco has ₹0 cash and USDC on Base. Next to him Priya, 24, Pune hacker with GPay, wants USDC as a dollar hedge without a CEX's spread, KYC lag and 1% TDS on sale. This already happens informally — "bro pay, I'll send USDT" — with no accounting, trust or rate. Mumbai specifics: autos are metered and UPI-happy, cabs surge BKC↔Bandra, Dhanteras crowds, Diwali Sunday shutters.

**3. Why now.** Both sides of this market share a building for five days; UPI One World barely works for visitors; no licensed API pays a stranger's VPA (reality #3), so verified humans are the only compliant-ish bridge. Arc wants stablecoin logic and Bridge Kit; World wants IDKit as a trust decision; Chainlink wants a state-changing CRE workflow.

**4. Core mechanism.** The foreigner scans the merchant's `upi://pay?pa=…&am=…` QR; the app parses it, opens or extends a tab (USDC locked on Arc) and a proximity handshake picks a nearby settler, whose phone gets the deep link — GPay opens prefilled, one tap. Each item releases when the foreigner confirms (the vendor's soundbox chirps) with a dispute window; the tab nets daily at a Chainlink INR/USD reference written by a CRE workflow, settler spread 1.5%. World ID binds settler reputation and annual INR volume to a nullifier, enforcing the ₹50k s.194S threshold per human. ENS: a proposed `com.upi` text record so any ENS name can be paid in INR; settlers live at `priya.udhaar.eth`. Arc Bridge Kit funds the tab from any asset.

**5. Sponsor map.** *World — IDKit ($2.5k).* Remove: sybil settlers, fake reputation, threshold gaming. *Arc — Advanced Stablecoin Logic ($3k: per-item release, spread, disputes) or Bridge Kit ($3k).* Remove: a foreigner needs a gas token to buy chai. *Chainlink — CRE ($1.5k).* Remove: rate arguments by hand. ENS integrated, unclaimed.

**6. Revenue.** Platform 0.5% + settler 1.5% on INR volume. Devcon week: 5,000 foreigners × ₹5,000 ≈ $280k GMV → $1.4k platform — honest. $10k/week needs ~$2M/week of tabs, i.e. ~20k monthly travellers across QR economies where cards fail (PromptPay, VietQR, QRIS, Pix, M-Pesa) and nomad corridors: realistically 12–18 months out. First three customers: fee-paying foreigners at the gate; a hacker house running its chai-and-cab tab; a Bandra café letting settlers hold standing tabs. Regulatory: gray — offshore, non-custodial, INR never touches the platform, per-human caps; FIU-IND and FEMA exposure must be reviewed.

**7. Hackathon-window scope.** Live: real QR, real ₹ paid from a settler's GPay, release and netting on Arc testnet, CRE run via CLI. Mocked: no INR/USD feed on Arc testnet so CRE fetches an API rate; disputes manual.

**8. Prior art — crowded lane, I rank this last.** ShieldRamp (New Delhi 2025, World Best Mini App 2nd: P2P UPI off-ramp with Pluto web proofs — https://ethglobal.com/showcase/shieldramp-okrzw); uWu (HackMoney 2026: scan UPI QR, USDC escrow, LP pays INR, validator proofs — https://ethglobal.com/showcase/uwu-w0mvu); Nomadia (Taipei 2025 finalist: P2P currency exchange with World ID — https://ethglobal.com/showcase/nomadia-vksf3). Plus ChainPe (ETHIndia 2022 finalist), CryptoUPI, QryptoPay, ETHPark-QR, khaaliSplit. Difference: a standing tab not per-transaction escrow, proximity matching, per-human threshold compliance, the `com.upi` record, any-asset funding — real but incremental.

**9. Biggest risk & mitigation.** Being read as a VDA–fiat exchange needing FIU-IND registration. Mitigation: non-custodial, caps, legal memo; seed liquidity with 20 recruited Indian hackers and our own ₹.

**10. UI/UX references.** PhonePe/GPay scan flow, Binance P2P, Splitwise, Revolut split, Nomadia.

**11. Self-score.** T5 · O4 · P8 · U8 · W6.

---

## My ranking and ask
**Recharge first** (usable Friday, sells itself, agent-pay wow), **Challan second** (deepest Indian pain, biggest cheque, most original, legal homework), **Udhaar third** (most authentic, most crowded). Critics: pressure-test Recharge's reseller dependency and Challan's s.194S deductor theory; both are fixable before 5 Nov without code.
