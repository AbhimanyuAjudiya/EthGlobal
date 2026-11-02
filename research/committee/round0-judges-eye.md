# Round 0 — Judge's Eye (member #1)

**Lens:** what places top-10 under Technicality / Originality / Practicality / Usability / WOW in a 4-min live demo + 3-min Q&A.
**Method:** read every 2024–2026 finalist and all 2026 winner corpora; regex-grepped the full 18,693-row showcase CSV for each idea. Web search was unavailable this round, so facts marked **[verify]** must be checked on day 0.

**What the finalist data says.** 2026 finalists come in four shapes: a physical object on the table (Hands Unchained, Carte Bleue, ETH Arcade, Leek); a new market primitive (ArcBook, Lotus, Cumulant, Canary); agents paying or answering to *humans* (Accrue, Novi Corpus, OpenBook); privacy with a one-line hook (VEIL VPN, Lortnoc Tahc). Every multi-prize finalist made each sponsor load-bearing; none of the ~30 "agent trades DeFi for you" entries since Cannes placed. Judging day (8 Nov) is Diwali [verify], with Devcon's EF crowd in town: physical, Indian, privacy-literate demos will land.

---

## Proposal 1 — **Dhwani** ("sound"): the stablecoin soundbox

**1. One-liner.** A ₹1,499 box on the shop counter that announces "paanch sau rupaye prapt hue" when USDC lands — and lets a *payer with no internet* pay by letting their phone chirp at it.

**2. User & pain.** Ramesh runs a chai stall at BKC. 10M+ Indian merchants own a PhonePe/Paytm soundbox [verify count]; the sound *is* the receipt. This week 15,000 Devcon visitors without UPI try to pay him; he loses the sale or takes dollars at a 20% haircut. Reverse case: his customer's data ran out — cash only.

**3. Why now.** Arc makes USDC the gas token, so a merchant device can relay customers' payments without holding ETH. Diwali week is peak retail. Arc Studio, Arkiv and Anon-RPC are new pushes with no ETHGlobal history. Data-over-sound (ggwave, ≤140-byte payloads with ECC) runs on a $15 Pi Zero 2 W.

**4. Core mechanism.** Two payment modes, one box (Pi Zero 2 W + I2S mic + speaker + OLED; ESP32-S3 is the production BOM).
- *Online mode:* box shows a QR (EIP-681 link / `ramesh.dhwani.eth`). Payer sends USDC on Arc. Box polls for the transfer **through Anon-RPC**, speaks the amount in Hindi/Marathi/English with INR conversion, writes a receipt entity to Arkiv.
- *Offline-payer mode (the novel bit):* payer's PWA (airplane mode) signs an **EIP-3009 `transferWithAuthorization`** for Arc USDC and encodes a 103-byte packet — `from`(20) + `value`(6) + `validBefore`(4, minutes) + `nonce seed`(8, keccak-expanded) + `sig`(65) — as an audible ggwave chirp (~6–12 s [verify on hardware]). The box decodes, rebuilds the EIP-712 digest, recovers the signer, checks balance via Anon-RPC, **submits the tx itself paying gas in USDC**, waits for inclusion, speaks. Merchant relays; customer needs no connectivity or gas; the nonce prevents replay.
- *Onchain:* USDC transfer on Arc testnet (5042002); Arkiv receipt entities; ENS text records. *Offchain:* audio modem, offline TTS (pre-rendered Hindi/Marathi number phrases composed on-device), dashboard queries, our own Anon-RPC worker fronting Arc.

**5. Sponsor map (claim these 3).**
| Partner / track | Role | What breaks if removed |
|---|---|---|
| **Arc** — Best DeFi/Onchain Finance App built in Arc Studio ($3k) [verify Arc Studio is the scaffold; start the repo from it] | USDC settlement; USDC-as-gas lets the box relay 3009 txs | Merchant must hold ETH → offline-payer mode impossible; a chaiwala cannot manage two assets |
| **Arkiv** — Build from scratch ($4k) + Swarm bonus ($500) | The *khata*: one entity per receipt (merchant, amount, INR rate, tx hash, payer pseudonym with BTL expiry); dashboard reads = Arkiv queries; Swarm holds the spoken-receipt audio | Centralized DB → unverifiable ledger; multi-box aggregation and accountant export vanish |
| **Ethereum Foundation** — Best Use of Anon-RPC ($5k) | All box reads via Anon-RPC; we also **run a new worker** fronting Arc RPC (the "produce anonymity" prong) [verify chain coverage] | Every poll leaks shop IP ↔ merchant address ↔ daily revenue to an RPC provider; zero prior Anon-RPC consumers in the dataset |
Unclaimed extras: ENS subnames; swap-in **0G "Agents with a Body"** (voice Q&A over the ledger via 0G Compute) if Anon-RPC is unusable.

**6. Revenue → $10k/week.** The merchant pays, because the alternative is a lost sale. (a) 0.8% fee on non-UPI payers only (UPI is 0% domestically): 1,500 boxes in tourist corridors × 10 foreign payments/day × $15 × 0.8% = **$1,800/day = $12.6k/week**. (b) Device margin: ₹1,499 retail vs ~$9 BOM → $9 × 500 boxes/week = $4.5k/week. (c) Subscription ₹99/mo (PhonePe charges ₹49–125): 10k boxes → $2.7k/week. Devcon-week pilot: 60 boxes × 40 tx × $12 × 0.8% ≈ $1.6k/week — a proof point, not the model. First three customers: Jio World Centre F&B concessionaires for Devcon week; a Goa beach-shack/hostel association via a reseller; a 10–20 outlet Mumbai chai chain.

**7. Hackathon scope.** Live: both payment modes with real Arc testnet txs (judge pays from their own phone), Hindi voice, Arkiv dashboard, Anon-RPC traffic panel. Honest mocks: INR rate from a public API; one pre-flashed box, no fleet management; payer PWA uses an embedded key; if the hall is too loud, the chirp runs in the <3-min video and online mode runs live.

**8. Prior art.** Closest three: **Web3 Soundbox** (Paris 2023, Axelar 1st; software-only phone beep on receipt — no device, no offline payer, no privacy); **MelodyPay** (ETHOnline 2026, 0 prizes; acoustic air-gapped *wallet*, phone-to-phone, no relayer or merchant product); **ultrasonic.fyi** (Cannes 2026, 0 prizes; merchant emits a *request* ultrasonically — the reverse direction, payer still needs internet). None combined payer-offline signed authorization, merchant-pays-gas relay, the soundbox form factor and Anon-RPC. Google Pay "Tez" shipped audio-QR payments in India in 2017: the UX is proven.

**9. Biggest risk & mitigation.** Audio decode fails in a noisy hall. Mitigate: 103-byte payload, RS ECC, external speaker at 20 cm, venue rehearsal, retry chirp, instant QR fallback. Second: Arc testnet USDC lacks EIP-3009 [verify day 0] → Base Sepolia USDC (3009 confirmed) via Bridge Kit, or ERC-2612 permit + our router.

**10. UI/UX references.** PhonePe/Paytm Soundbox, Square Reader, SumUp Solo, Google Pay Tez Cash Mode, Stripe Terminal.

**11. Self-score.** T 8 (audio modem + 3009 relay + Anon-RPC worker + Arkiv schema) · O 8 (form factor + offline direction never done; 3 audio attempts scored 0) · P 9 (a merchant can use it tonight; proven business) · U 9 (zero-literacy, voice-first) · **W 10** (the box talks back — the image judges remember).

---

## Proposal 2 — **Boli** ("speech", also "bid"): verified humans sell Indic speech to agents that pay in four seconds

**1. One-liner.** A Karya-style speech-data market where the buyer is an AI agent paying per utterance over x402 on Hedera, every sample is graded inside 0G before money moves, and every seller is one World-ID human.

**2. User & pain.** Sunita (Nashik, Marathi speaker) earns ₹200/hr recording sentences for Karya — the real company selling rural Indian speech to Microsoft/Google — but payouts are weekly, tasks rationed, buyers only Karya's. An Indic-LLM lab (Sarvam, Krutrim, AI4Bharat) needs 200 Malvani-dialect numeral utterances *tonight* and cannot buy exactly that from verified humans without a 6-week vendor contract.

**3. Why now.** Hedera's $6.5k track demands exactly this shape (x402 endpoint + HCS-14/ERC-8004 + Agent Kit; "pay-per-call data APIs"). World's Agent Pass is new; 0G wants verifiable inference artifacts. Bhashini and Indic-LLM funding make speech data the scarcest input; synthetic-voice farms make *verified human* the moat. Hands Unchained (Lisbon finalist, 0G 2nd + World 1st) proved humans-paid-for-training-data can place; Thenar (its robot clone, 0 prizes) proved execution decides it.

**4. Core mechanism.**
- *Bounty:* a buyer agent (Hedera Agent Kit, HCS-14 UAID + ERC-8004 registration, carrying a World **Agent Pass**) posts a coverage gap ("Marathi, numerals, female, 18–30, 300 utterances, $0.04 each").
- *Record:* Sunita's Marathi PWA verifies her once via **IDKit** (Orb nullifier → one human, one seller) and feeds prompts.
- *Grade before pay:* audio is encrypted to **0G Storage** (root hash); **0G Compute** TEE inference runs ASR (transcript-vs-prompt WER), anti-TTS spoof check and fingerprint dedup, returning a signed quality certificate with its request id. Ungraded = unsellable (safe-stop if 0G is down).
- *Buy:* agent calls `GET /sample/:id` → HTTP 402 → pays on Hedera testnet → receives decryption key + license receipt, logged to an HCS topic. Payment settles **100% to the seller**; Boli charges the agent a separate 402 for search + certificate.
- *Onchain:* x402 settlement, HCS-14 identity, HCS receipts, 0G artifacts. *Offchain:* ASR (inside 0G TEE), key release, catalog.

**5. Sponsor map (claim these 3).**
| Partner / track | Role | What breaks if removed |
|---|---|---|
| **Hedera** — AI Agents That Pay: x402 ($6.5k) | Pay-per-utterance rail, HCS-14 agent identity, Agent Kit buyer | No machine-speed purchase of 300 samples; invoicing and API keys return; no accountable agent identity |
| **0G** — Build with 0G ($5k) | TEE-graded quality certificate gating every sale; encrypted storage | No neutral grading → buyers pay for junk or trust our server (OpenBook's finalist lesson was enforced quality) |
| **World** — Agent Pass ($5k) + IDKit ($2.5k) | One human = one seller; buyer agents prove a human/lab stands behind them | One person + a TTS model = 1,000 "sellers"; the dataset is worthless |
Alternate: Arkiv as the queryable public catalog if 0G Compute is unstable.

**6. Revenue → $10k/week.** Seller gets $0.03/utterance (≈₹2.5; 100/hr ≈ ₹250/hr, matching Karya); buyer pays $0.04 incl. our **$0.01 certificate+search fee (25% take)**. $10k/week = **1.0M certified utterances/week = 143k/day = 1,430 workers doing one hour/day.** GMV $40k/week against a market where Bhashini alone budgets >₹1,000 crore [verify] — under 0.5% of Indic data spend. First three customers: an Indic LLM lab's data team (agent buyer); a grant-funded university speech group (AI4Bharat-type); a global data vendor (Appen-type) reselling verified-human Indic audio.

**7. Hackathon scope.** Live: judge records one sentence → 0G certificate (request id on screen) → autonomous agent pays via x402 (HashScan tx) → judge's Hedera wallet credits in seconds → leaderboard "₹ earned by this room." Honest mocks: Whisper-small ASR; heuristic anti-spoof; one buyer agent we run plus one judge-triggered; Agent Pass verified server-side.

**8. Prior art.** Closest three: **DeTrain** (BA 2025, 0G 2nd — generic TEE-evaluated data bounties; no speech, no x402, no human verification, batch payouts); **SonicIP** (New Delhi 2025, 0 prizes — demographic-verified voice-data marketplace; no agent buyer, grading or instant settlement); **Thenar / Hands Unchained** (ETHOnline 2026 / Lisbon finalist — humans sell robot-training data to agents; same thesis, different modality, no low-resource-language angle). Boli's differences: per-sample agent procurement, grade-before-pay in a TEE, Agent Pass accountability on the *buyer*, a specific scarce market.

**9. Biggest risk & mitigation.** 0G Compute latency on Galileo turns a 4-second demo into 40. Mitigate: pre-warm the provider, keep a grading job in flight, show the request id asynchronously, hold Arkiv as fallback sponsor. Secondary: "another agent marketplace" smell — pitch Sunita first, the agent second.

**10. UI/UX references.** Karya (worker app), Prolific, Duolingo speaking exercises, Hugging Face Datasets (catalog), OpenRouter (agent-side pricing page).

**11. Self-score.** T 8 (x402 + HCS-14 + TEE grading + key escrow) · O 6 (Karya/DeTrain exist; the combination is new) · P 8 (buyers and sellers exist today) · U 8 (vernacular voice-first app) · W 7 (money arriving for saying a sentence — participatory but less visceral than hardware).

---

## Proposal 3 — **Bhishi** (Marathi for chit fund): the auction-ROSCA that prints India's retail interest rate

**1. One-liner.** Onchain chit funds: the monthly pot goes to the member accepting the biggest discount, the discount flows back to everyone as dividend, slots are sybil-proof and tradable, and every auction prints a live "Bhishi Rate".

**2. User & pain.** Priya's office kitty (12 women, ₹5,000/month) lost ₹1.8 lakh when the organizer's cousin joined under three names, won early and vanished. Every Indian household knows a chit; registered chits turn over lakhs of crores [verify] and the informal market is larger. Pain: defaults, multi-slot fraud, opaque organizers, no exit mid-cycle.

**3. Why now.** Arc's "Advanced Stablecoin Logic" track wants exactly scheduled-contribution/netting/payout logic in USDC; World ID is the only cheap one-human-one-slot primitive; Arkiv gives portable credit history. Digital-chit startups (The Money Club, Chitmonks) are raising on centralized ledgers; the Chit Funds Act caps foreman commission at 7% — the revenue model is statute.

**4. Core mechanism.** `Bhishi.sol` on Arc: `createGroup(N, C, bond)`, `join(worldAttestation)`, monthly `contribute()`, `bid(discount ≤ 40%)` in a window (open bids for the demo; commit-reveal optional), `settle()` → highest-discount bidder receives `N·C − D`, 5% foreman commission, `D − commission` netted equally against everyone's next contribution. One win per slot. Slot = ERC-721 with a one-month collateral bond, transferable only to World-verified non-members; default → bond slash + slot re-auction. Each auction emits an implied monthly rate `D / (N·C − D)` → the Bhishi Rate index. *Onchain:* all money and auction logic on Arc; Arkiv entities for bids, settlements and on-time history (queryable credit score). *Offchain:* World proof verification + EIP-712 attestation, UI, cycle cron (Chainlink CRE if time).

**5. Sponsor map (claim these 3).**
| Partner / track | Role | What breaks if removed |
|---|---|---|
| **Arc** — Advanced Stablecoin Logic ($3k), Arc Studio start | USDC pots, netting, bonds, payouts | Members would hold ETH for a ₹5,000 chit — adoption dies |
| **World** — Best Use of IDKit ($2.5k) | Nullifier per group → one human, one slot | Priya's cousin problem returns; the #1 fraud vector is open |
| **Arkiv** — Build from scratch ($4k) | Queryable bid/settlement/credit history; Bhishi Rate computed from Arkiv reads | No portable reputation → every group starts blind; no index |
Unclaimed alternate: Chainlink CRE for cycle automation (state change).

**6. Revenue → $10k/week.** Platform takes **2% of each pot** (inside the 7% statutory cap; the organizer keeps 3–5%). $10k/week = $500k/week in pots = $2.17M/month = **4,300 active groups × ₹42,000 monthly pot (10 × ₹4,200)**. Alternative B2B: SaaS to registered foremen at ₹99/member/month. First three customers: a Kerala/Tamil Nadu registered chit company digitizing auctions; UAE Indian-diaspora "committee" groups (USDC natural, regulation lighter); a delivery-rider cooperative running weekly chits.

**7. Hackathon scope.** Live: five phones (three team, two judges) join a 10-USDC bhishi on Arc testnet; 60-second open auction; settle; winner receives 45 USDC, others see their dividend; the ticker prints "this room priced one-month credit at 10%." Honest mocks: cycle compressed to minutes; slot transfer with a pre-seeded buyer; regulation is a disclaimer, not a license.

**8. Prior art.** Saturated genre: **27 ROSCA/chit entries, zero finalists**. Closest three: **cheat.fund** (New Delhi 2025, 0 prizes — rotation-based, no auction, no sybil resistance); **DeChitFund** (HackMoney 2021 — bidding, no dividends, no identity, abandoned); **Savio** (Cannes 2025, Circle gasless — random/auction payouts, no slot market, no credit history). Also Tanda/Ronda (BA 2025), PotLuck (ETHOnline 2026). Bhishi's differences: real auction-ROSCA economics with dividend netting, World-gated collateralized tradable slots, Arkiv credit history, the rate index.

**9. Biggest risk & mitigation.** Judge fatigue ("another chit fund") and the explainer eating the demo. Mitigate: open on Priya's fraud, auction live within 90 seconds, lead with the Bhishi Rate as the novel artifact. Regulatory attack (Chit Funds Act, 30%/1% TDS) → software for registered foremen + diaspora first.

**10. UI/UX references.** The Money Club, KSFE Chitty app, Splitwise (group ledger clarity), Polymarket (live bid tension), Robinhood (one-number screens).

**11. Self-score.** T 7 · O 5 · P 7 · U 8 · W 7. Lowest finalist odds of my three, highest revenue legibility — the committee's conservative finance option.

---

## Position: From Scratch vs Continuity

**From Scratch, for all three.** Nine of ten multi-prize finalists I studied (VEIL VPN, DIVE, KOLlateral, Hands Unchained, ArcBook, Canary among them) were from-scratch; continuity finalists (Void Tactics, Happy Hour, Novi Corpus) were mature products whose Originality/WOW judges visibly discounted. Continuity-only prizes are small ($1.5k–5k); the from-scratch pools we target (Arc, Arkiv, EF, Hedera x402, 0G, World) plus the finalist award ($1.5k × 5 = $7.5k) are the EV. Hedge legitimately: before kickoff verify every **[verify]** item, flash the Pi with stock ggwave/TTS libraries, claim faucets, write *no project code*, and disclose pre-installed third-party libraries in the README for rule clarity.

**Ranking by finalist probability:** Dhwani > Boli > Bhishi. One Judge's Eye vote: Dhwani — the only demo here a judge can retell to another judge in one sentence.
