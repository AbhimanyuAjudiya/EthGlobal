# Round 2 — Judge's Eye (member #1)

Round 1 was right about two of my three ideas and right about Dhwani's revenue. **Boli and Bhishi are withdrawn**; every question on them is answered below as a concession so nothing is skipped. Dhwani returns as my single v2 with the revenue model replaced, the security fixes adopted, Anon-RPC dropped, and the track position reversed under the pre-build reality. No web searches were spent; all facts below come from Round 1's verified findings.

## 1. Answers to every numbered question

### Dhwani

| ID | Verdict | Answer |
|---|---|---|
| Q-SEC-Dhwani-1 | CONCEDE | Box holds one *relayer* key with a float capped at 5 USDC (≈3,800 relays at 65k gas × 20 gwei); the merchant's receiving key never touches the box — `to` is the merchant wallet or the off-ramp deposit address, set once by signed setup. v2 uses `receiveWithAuthorization` into `DhwaniSplitter`, so a captured chirp can only be landed by our contract to the intended merchant; the box speaks only after `status=1`; balance ≥ value is checked before relaying and `from` is rate-limited. |
| Q-SEC-Dhwani-2 | CONCEDE / REBUT | Fee: `to` = `DhwaniSplitter` (pull, forward, retain) — on-chain. But v2 charges no payment fee in India (see field 6). Deductor: s.194S covers payments to *residents*; a non-resident tourist selling USDC for chai creates no 194S duty for the merchant. Resident payers would make him a deductor in kind, so India mode routes every receipt to an FIU-registered off-ramp, which deducts as exchanges do. CA memo is pre-kickoff work. |
| Q-VC-Dhwani-1 | CONCEDE | No such data point exists; 10/day was invented. v2 adopts your 0.3/day for India and moves revenue off that hinge entirely. |
| Q-VC-Dhwani-2 | REBUT | He never holds USDC: the FIU-registered off-ramp pays INR to his bank within minutes at ≈2.2–3% all-in (1% fee + GST + 1% TDS). He takes it against *no sale*, not against UPI: a foreign payer has no UPI, and a card POS costs 2% plus rental he does not have. Concede the corollary: no resident will ever choose it, and UPI One World's winter rollout erodes the tourist wedge — India is the launch stage, not the market. |
| Q-VC-Dhwani-3 | CONCEDE | An offshore (Singapore/UAE) hardware-and-software company that never custodies funds; merchant off-ramp contracts sit with the FIU-registered partner; India mode ships only with such a partner signed. |
| Q-JUDGE-DHWANI-1 | REBUT | "He doesn't touch crypto. The tourist's dollars land at a registered Indian exchange that pays rupees to his bank in minutes and deducts TDS like any exchange. This week's probe is Indians spending offshore stablecoins on cards — the opposite flow: a foreigner paying an Indian who receives rupees." |
| Q-JUDGE-DHWANI-2 | CONCEDE | Rule: one live chirp; no decode in 12 s → press the box's QR button, online mode, the video carries the chirp. Decode rate is unmeasured; target ≥90% at 20 cm/70 dB with ggwave's audible Fast profile and RS ECC, measured Wednesday and printed in the README. Below 80% the chirp is demoted to video. |
| Q-JUDGE-DHWANI-3 | CONCEDE | Anon-RPC is a browser-worker draft; a Pi cannot consume it honestly, "run a worker" means building a mixnet transport, and EF's criteria are unpublished. Dropped. Third sponsor becomes 0G "Agents with a Body", ENS the 3-hour fallback. |
| Q-USER-DHWANI-1 | CONCEDE | Arc-only was wrong. v2 accepts USDC on Base, Arbitrum and Arc: the box watches three RPCs and the merchant is paid where the payer pays (3 taps from a Base wallet); consolidation to Arc is a dashboard button via Bridge Kit. The chirp packet carries a chain byte; EIP-3009 exists on every Circle USDC, so the box relays on any chain it holds gas for (demo: Arc with USDC gas, Base Sepolia with an ETH float). |
| Q-USER-DHWANI-2 | CONCEDE | For the demo an embedded key — a trick, as you say. The product path is an EIP-7702/4337 session key delegated from the main wallet, allowed to sign 3009 authorizations up to $50/day, funded by one top-up; the PWA never becomes a second wallet of record. |
| Q-USER-DHWANI-3 | CONCEDE | Unmeasured. Arithmetic: 103 bytes at ggwave audible Fast ≈ 7–13 s including preamble. Measurement on the Pi is Wednesday's first task; the number goes in the README whatever it is. |
| Q-OPS-DHWANI-1 | REBUT | Yes — Security verified Arc testnet USDC (`0x3600…0000`) implements EIP-3009 with a documented relayer flow; the fresh-account-full-drain revert is handled by never draining to zero. Permit + router is acceptable as fallback. |
| Q-OPS-DHWANI-2 | CONCEDE | No component can consume it honestly; dropped (see Q-JUDGE-DHWANI-3). |
| Q-OPS-DHWANI-3 | CONCEDE | The team must name one person who has shipped ALSA/I2S audio by Tuesday; buy a ReSpeaker 2-Mics HAT plus a USB mic and USB sound card Wednesday. Plan B: Pi 4 + USB audio. Plan C: a laptop as the box with a Bluetooth speaker — the voice is what judges see, the Pi is what they touch. |

### Boli (withdrawn)

| ID | Verdict | Answer |
|---|---|---|
| Q-SEC-Boli-1 | CONCEDE | Nothing stops it; the 0G certificate asserts transcript ≈ prompt, not that a human spoke. With Device-level IDs at $0.50, the market is a TTS farm with a stamp. |
| Q-SEC-Boli-2 | CONCEDE | Spend would have been code-bounded, but the agent read attacker strings; moot. |
| Q-SEC-Boli-3 | CONCEDE | Our server; no DPDP consent was designed; biometric data of rural women was the product. |
| Q-VC-Boli-1 | CONCEDE | I cannot name one. |
| Q-VC-Boli-2 | CONCEDE | Selfie or Document level; it does not beat a TTS farm. |
| Q-VC-Boli-3 | CONCEDE | Nobody; USDC she cannot spend is not pay. |
| Q-JUDGE-BOLI-1 | CONCEDE | An LLM judging an off-TEE Whisper transcript; the README would have had to say so. |
| Q-JUDGE-BOLI-2 | CONCEDE | Device-level only; not one human, one seller. |
| Q-JUDGE-BOLI-3 | CONCEDE | We could not; we were the buyer. |
| Q-USER-BOLI-1 | CONCEDE | No route exists for her. |
| Q-USER-BOLI-2 | CONCEDE | No, and doubtful. |
| Q-OPS-BOLI-1 | CONCEDE | On our server; the 0G grader would have been decorative. |
| Q-OPS-BOLI-2 | CONCEDE | Only AgentKit beta exists; IDKit was the honest submission. |
| Q-OPS-BOLI-3 | CONCEDE | Unbudgeted; faucet claiming had not started. |

### Bhishi (withdrawn)

| ID | Verdict | Answer |
|---|---|---|
| Q-SEC-Bhishi-1 | CONCEDE | 10 × ₹5,000: month-2 pot ₹50,000, winner bids 10% and takes ₹45,000, then owes ₹50,000 over months 3–12; the ₹5,000 bond is slashed; the ₹45,000 shortfall falls on the other nine at ₹5,000 each. Every honest member loses a month. Unsolvable without collateral ≈ pot. |
| Q-SEC-Bhishi-2 | CONCEDE | None; a USDC chit cannot register, and a 2% platform is the foreman in law. |
| Q-VC-Bhishi-1 | CONCEDE | The remaining nine members. |
| Q-VC-Bhishi-2 | CONCEDE | I cannot name one. |
| Q-JUDGE-BHISHI-1 | CONCEDE | Nothing beyond World gating. |
| Q-JUDGE-BHISHI-2 | CONCEDE | A vanity number. |
| Q-USER-BHISHI-1 | CONCEDE | Nothing; the dividend netted silently. |
| Q-OPS-BHISHI-1 | CONCEDE | No judge can verify live in India; team-verified plus simulator would have been the honest demo. Moot. |
| Q-OPS-BHISHI-2 | CONCEDE | Moot for Bhishi; for Dhwani v2 the Integrations lead owns the 21:00 Arc Studio step, Studio scaffolds the splitter and dashboard, and our firmware and relayer are imported beside it. |

## 2. v2 proposal — Dhwani v2, the stablecoin soundbox

**1. One-liner.** A counter box that speaks in a recorded Marathi voice when USDC lands from Base, Arbitrum or Arc, relays an offline payer's chirped EIP-3009 authorization paying gas in USDC on Arc, keeps a queryable Arkiv khata, and answers the merchant's spoken questions through a 0G agent. Sold to the people who already have stablecoin flow: event organizers and stablecoin PSPs. India is the stage.

**2. User & pain.** Demo persona: Ramesh, F&B vendor at Jio World Centre, facing 10,000 Devcon visitors without UPI. Paying customer: the acquirer — ETHGlobal/Devcon/ETHIndia/Token2049 vendor programs and stablecoin PSPs (Binance Pay merchant program, Solana Pay processors, Xflow for India). Their pain: cashless-festival vendors (Weezevent, Glownet) cannot take USDC, and no stablecoin PSP has a merchant device its merchants keep. Paytm's 20M-box business shows the device is what makes merchants stay.

**3. Why now.** Arc testnet USDC has verified EIP-3009 and USDC gas, so a merchant device can relay customers' payments without ETH; Arc mainnet is seven weeks old and Circle wants merchant-side showcases; Devcon week is the densest stablecoin-holding crowd Indian merchants will ever see; NPCI's UPI One World rollout makes the India tourist wedge a 12-month window — which is why revenue cannot depend on it.

**4. Core mechanism.** Online: box shows a QR; payer sends USDC on Base/Arbitrum/Arc; box confirms inclusion, speaks the amount with INR conversion, writes an Arkiv entity (attributes: merchant, chain, amount, INR rate, tx hash; `expiresIn` on the payer pseudonym). Offline: payer's PWA (airplane mode) signs `receiveWithAuthorization` for `DhwaniSplitter` and chirps a 104-byte packet (chain byte, `from`, value, `validBefore`, nonce seed, signature) via ggwave; the box rebuilds the EIP-712 digest, recovers the signer, checks balance, submits paying gas in USDC on Arc, speaks after `status=1`. Voice agent: merchant presses the button and asks "aaj kitna aaya?"; audio → Whisper on our server → 0G Compute LLM (TEE-signed, request id logged) turns the question into an Arkiv query and returns a *structured* answer `{count, total, peak_hour}` the box speaks from its recorded number phrases — no robotic TTS, no free-form speech. Onchain: USDC transfers on three chains, splitter, Arkiv writes. Off: audio modem, voice bank, dashboard, 0G calls.

**5. Sponsor map.**

| Partner / track | Role | What breaks if removed |
|---|---|---|
| **Arc** — DeFi/Onchain Finance App in Arc Studio ($3k); Bridge Kit consolidation; Continuity "bring your project to Arc" ($3k) | USDC-as-gas relay; splitter deployed from a Studio scaffold the humans rewrite | Merchant needs ETH → offline mode impossible; one chain fewer to be paid on |
| **Arkiv** — Build from scratch / Continuity ($4k) + Swarm ($500) | The khata: every receipt an entity; dashboard, export and the voice agent all *read* Arkiv; Swarm holds the spoken-receipt audio | Ledger becomes our Postgres; multi-box aggregation and verifiable export vanish; the agent has nothing trustworthy to read |
| **0G** — Agents with a Body ($5k) / Keep Building ($3k) | The box is the body; Compute answers merchant questions with signed inferences; safe-stop built in | Box answers only the fixed "today's total" button; the merchant loses the one interface a low-literacy user can use |
Fallback at the Fri 06:00 gate: ENS subnames and text records (3 h) replace 0G.

**6. Revenue, re-derived with the VC's assumptions.** The 0.8% India fee is deleted. Unit economics: ESP32 production BOM ≈ $12, B2B device price $29 (margin $17), SaaS $1.50/box/month (PhonePe ₹50–100, Paytm ₹78–150). Event programme: 40 boxes rented at $25 + 1.5% of vendor GMV (cashless-festival norm 2–3%). India: 0.3 foreign payments/box/day, no fee, a 25 bps off-ramp referral.
- **Low (India only):** 300 boxes × 0.3 × $15 × 0.25% ≈ $5/day + one-off device margin ≈ **$100/week**.
- **Base (month 6):** two events/month at $120k vendor GMV ($2.8k each = $1.3k/week) + one PSP pilot shipping 2,000 boxes over six months ($1.3k/week margin) + 2,000 × $1.50 SaaS ($0.7k/week) = **≈ $3.3k/week**.
- **High (month 9):** PSP partner at 15,000 boxes ($5.2k/week SaaS) + 1,000 boxes/month device margin ($3.9k/week) + four events/month ($2.6k/week) = **≈ $11.7k/week**.
Hinge: one PSP or organizer contract by Q1 2027; without it the base case stands and misses the bar — I say so plainly. First three customers: the ETHIndia vendor programme (December), a Dubai Indian-restaurant group already on Binance Pay, a Solana Pay processor wanting merchant hardware. The pre-kickoff task that moves revenue is two LOIs, not code.

**7. Scope (78 ph; critical path 26 h).** Contracts 6 (splitter, tests) · firmware/audio 16 (ggwave rx, voice bank, OLED, QR button) · backend 14 (three-chain watcher, relayer, Arkiv writer, Whisper + 0G service) · frontend 12 (merchant dashboard, setup) · sponsor wiring 20 (Studio start, Arkiv schema/feedback/Swarm files, 0G broker + safe-stop + changelog, Bridge Kit button) · demo/hygiene 10. Live: judge pays from their own Base or Arc wallet; one chirp; voice; Arkiv-backed dashboard; one 0G-answered question. Mocked: INR rate from an API, single box, embedded-key PWA. Degradation: 0G down → fixed-button answers; Arkiv down → SQLite mirror replayed later; chirp fails → QR; Arc RPC down → the Base path still speaks. **The image:** a judge's phone chirps at a chai-stall box and four seconds later it says "paanch sau rupaye prapt hue." **The signature:** one recorded human voice (a Marathi speaker, never TTS) composing amounts from recorded number phrases; an OLED showing only the amount in Anek Devanagari; receipts as a thermal-strip card in Chivo Mono; tonal neutrals with one kesari accent; no gradient, no emoji, no raw hex.

**8. Prior art.** Web3 Soundbox (Paris 2023, software beep, no device/offline/voice); MelodyPay (ETHOnline 2026, phone-to-phone acoustic wallet, 0 prizes); ultrasonic.fyi (Cannes 2026, merchant emits the request, payer still online, 0 prizes); commercial: Xflow (offshore-settled USDC acceptance for Indian businesses, no device) and Paytm Soundbox 4.0 (UPI only). None combine payer-offline authorization, merchant-pays-gas relay, multi-chain acceptance, a verifiable ledger and a voice agent in the soundbox form factor.

**9. Biggest risk & mitigation.** Revenue hinges on a partner: two LOIs before kickoff. Audio in the hall: the cutover rule. Continuity perception: a dated `v0-prekickoff` tag and a README that says what was built when. Regulation: no custody anywhere; India mode only with an FIU partner. Hardware: in hand Wednesday or Plan B.

**10. UI/UX references.** Paytm Soundbox 4.0, Square Reader, Stripe Terminal, SumUp Solo, Teenage Engineering (the object), Google Pay Tez Cash Mode.

**11. Self-score.** T8 (audio modem, 3009 relay on three chains, splitter, Arkiv schema, 0G structured-answer loop) · O8 · P7 (down from 9: the business is B2B2C and India needs a partner) · U9 · W10.

## 3. Vote

1. **Recharge** — the only other proposal with a retellable image (an iPhone going from "No Service" to LTE, paid by an agent), desire 8, and cash on Friday; conditions: reseller account by Tuesday, pay-in from Base/Arbitrum USDC, same-phone install.
2. **Octroi** — no finalist image, but the best sponsor design in the deck (BTL as quota, IDKit as the free tier) and the cleanest trust model; whatever wins should borrow its Arkiv idea.
3. **Asli** — buyers are in the building and Ops rates it easiest to ship, but it is Distro's back office and must sell "cheaper fraud", not "no fraud".
If Dhwani were struck I would build **Recharge**.

## 4. Track position under the pre-build reality

I reverse my Round-0 position: **Continuity, declared openly.** Once code exists publicly before kickoff, entering From Scratch risks disqualification from every prize, and "re-implementing" beside a public reference is the same thing with a worse story. Continuity's cost is a WOW discount; a physical object discounts less than any dashboard, and Void Tactics, Happy Hour and Novi Corpus reached finals from Continuity. Structure the pre-build so the window's delta *is* the sponsor work: v0 (3–5 Nov, on Anvil with fixtures since the sandbox cannot reach testnets) = Pi firmware, ggwave decode, EIP-3009 relay on Base Sepolia, voice bank, local ledger, plain dashboard. In-window = Arc port through Studio with USDC-gas relay and the splitter, Arkiv khata replacing the local ledger, the 0G voice agent, multi-chain acceptance, the design pass — more than half the product, dated commit by commit. The eligible continuity pools (Arc $3k, Arkiv $4k, 0G $3k) have thinner fields than their from-scratch twins, and finalist judging stays open. Confirm the track with ETHGlobal staff at check-in and write the AI-use statement in the README. Generate deployer and relayer keys on-site, from faucets, never in the orchestrator's context.
