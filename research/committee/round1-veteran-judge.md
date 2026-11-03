# Round 1 — ETHGlobal Veteran Judge (member #7)

**Lens.** Each proposal is pattern-matched against the 149 finalists and ~2,200 sponsor placements in `winners.md`, scored as a live 4-min demo + 3-min Q&A, smell-tested for AI-slop, and each claimed sponsor is judged as its async reader would (load-bearing vs decorative, newest primitive as mechanism, hygiene). Base rate: ~500 projects → P(top-10) ≈ 2% for a median entry; a physical object or a one-sentence privacy hook triples it; a launchpad, dashboard or copy-trading shape halves it. Sponsor numbers are P(placed | top-decile execution). Finalist award = $7,500.

**Five searches.** (1) Nothing resolves the Definitive/World "continuity-only" conflict; Definitive is priced at P(eligible)=0.6, World as open. (2) No commercial stablecoin soundbox exists; the nearest is Xflow's compliant USDC acceptance for Indian businesses (stablecoin leg offshore, fiat via an AD-I bank) — Dhwani's Q&A answer, not a rival. (3) Hedera x402 on testnet is real (r402-hedera, uvd-x402-sdk, Hedera's own bounty winners) but no public facilitator is confirmed — self-host. (4) Orb verification in India was paused Dec 2023 with no sign of resumption: ideas gating *Indian* humans get Device/Document credentials only. (5) `ideation.md` §3.2: RBI/FIU are probing offshore stablecoin cards this week — "spend USDC in India" is in the regulator's sights.

---

## 1. Dhwani — stablecoin soundbox (Judge's Eye; self T8 O8 P9 U9 W10)

**T7** ggwave and EIP-3009 relays are library-grade; the Anon-RPC worker and vernacular TTS are the real work. **O8** three prior audio entries scored zero as phone-to-phone toys; payer-offline, merchant-relays-gas, in a soundbox is new. **P7** works tonight, but the first Indian judge asks who converts Ramesh's USDC to rupees and who bears 1% TDS; with no one-line answer this is a 5. **U8** voice-first is right; the embedded-key payer PWA is a demo trick. **W9** the only proposal where a judge's phone makes an object on the table speak.
**Pattern.** NoNet (New Delhi finalist, Hedera 1st), cellfi (Taipei finalist), Fluxo (BA, Hedera 2nd) and ETHastic (Cannes, LoRa payments, Arc 2nd) say offline/physical payments place; ETH Arcade and LeekWallet say a Pi/ESP32 object reaches finals unaided. Anti-pattern to dodge: §4.5 live latency — chirp → Arc inclusion → speak is three waits.
**Odds.** P(top-10) **12%**, highest here. Arc Studio finance app 25% — USDC-as-gas enables the relay; "is a payments box a finance app?" (ETHastic says yes). Arkiv from-scratch 25%, Swarm 30% — receipts-with-BTL is a plausible khata but smells of Postgres; make the multi-box aggregation query the hero. EF Anon-RPC 20% — zero prior consumers, the "run a worker" prong is what EF asks, privacy-literate crowd; risk: EF decides a merchant poll is not a privacy app.
**Image.** A chai-stall box says "paanch sau rupaye prapt hue" four seconds after a judge's phone chirps at it. Retold.
**Slop.** Low — hardware, DSP and Marathi TTS cannot be vibe-coded.
- Q-JUDGE-DHWANI-1: The 20-second answer to "how does the chaiwala get rupees, and is it legal after today's RBI/FIU probe?"
- Q-JUDGE-DHWANI-2: Cutover rule if the live chirp fails twice, and the decode rate measured at venue noise?
- Q-JUDGE-DHWANI-3: Does Anon-RPC cover Arc, and does EF count a worker you run yourself?

## 2. Boli — verified humans sell Indic speech (Judge's Eye; self T8 O6 P8 U8 W7)

**T6** 0G Compute serves chat-completions from listed providers; ASR and anti-spoof *inside* the TEE is probably impossible on Galileo, leaving an LLM grading an off-TEE transcript. **O6** agreed: Hands Unchained's thesis, modality swapped. **P7** Karya proves the labour side; the demo's buyer agent is us. **U7**. **W6** a balance ticking up after a sentence — participatory, small.
**Pattern.** Hands Unchained (Lisbon finalist, World 1st + 0G 2nd), Accrue and Distro (NY finalists) make "verified humans paid per graded unit" 3-for-3 in 2026, each with its own visceral hook; Thenar, the robot-arm clone, scored zero. Boli's hook is Sunita at ₹250/hr.
**Odds.** P(top-10) **6%**. Hedera x402 20% — the suggested shape, in the thickest field. 0G Build 15% — 0G reads repos and will see "LLM reads transcript". World IDKit 20% / Agent Pass 8% — one-human-one-seller is a real trust decision; Agent Pass on the buyer is mocked.
**Image.** A judge speaks Marathi; a HashScan payment lands in their wallet. Decent, not retold.
**Slop.** Medium — "data marketplace for agents" is the most-cloned 2026 shape; the vernacular worker app saves it.
- Q-JUDGE-BOLI-1: Which computation runs inside 0G Compute and signs the certificate — ASR, or an LLM judging a Whisper transcript from your server?
- Q-JUDGE-BOLI-2: With Orb paused in India, are sellers Device-level only, and is that still "one human, one seller"?
- Q-JUDGE-BOLI-3: How do you stop judges reading the buyer agent as "we paid ourselves"?

## 3. Bhishi — auction chit fund (Judge's Eye; self T7 O5 P7 U8 W7)

**T6** netting arithmetic and an open auction. **O4** 27 ROSCA entries, zero finalists; the dividend auction is the standard Indian chit. **P7**. **U7**. **W5** a rate on a ticker; judges sigh at chit funds.
**Pattern.** cheat.fund, Savio, Tanda/Ronda, PotLuck, Saving Circles — never a finalist (§4.5 generic category).
**Odds.** P(top-10) **2%**. Arc Advanced Stablecoin Logic 20% — scheduled contributions and netting is what the track names. World IDKit 12% — legitimate, crowded. Arkiv 15% — credit-history reads, thin.
**Image.** "This room priced one-month credit at 10%." A number.
**Slop.** High — the default LLM answer to "India hackathon idea".
- Q-JUDGE-BHISHI-1: What appears in minute one that cheat.fund, Savio and Saving Circles did not show?
- Q-JUDGE-BHISHI-2: Is a Bhishi Rate from one five-phone group an index or a vanity number?

## 4. CallSheet — sealed executable calls (Operator; self T8 O7 P8 U7 W7)

**T8** hook-enforced uniform fill, tlock, session-key vaults, Definitive exits — real engineering. **O6** KOLlateral owns the persona, PrivBatch the batch hook, 68 copy-trade entries the category; sealing the call is the twist. **P7** Definitive is likely mainnet-only, so entry (Unichain Sepolia) and exit (Base mainnet) are different chains and money. **U6** three surfaces in four minutes. **W6** "bot front-runs, then loses" is narrative, not sensory.
**Pattern.** KOLlateral (Lisbon finalist) placed by making callers accountable; KagamiAI (New Delhi finalist, 0 sponsors) is the copy-bot ceiling; none of ~30 agent/copy-trading entries since Cannes placed. Post-Binance-hack mood helps; the Devcon crowd dislikes trading bots.
**Odds.** P(top-10) **5%**. Uniswap 20% — a uniform-price batch hook with onchain fee split is a mechanism, which UF rewards. Definitive 27% (0.6 eligible × 0.45) — the theme is literally social trading, ~30 teams. World 10% — registration is a gate, not a change of terms: decorative.
**Image.** None retold; a chart where the bot loses.
**Slop.** Medium-High — Telegram bot + leaderboard + copy-trading is the modal showcase entry.
- Q-JUDGE-CALLSHEET-1: Entry on Unichain Sepolia, exits on Base mainnet — what single screen shows one coherent trade?
- Q-JUDGE-CALLSHEET-2: What stops the caller pre-positioning before posting the sealed hash?
- Q-JUDGE-CALLSHEET-3: What happens in the first 30 seconds that is not a Telegram message?

## 5. Nilami — one human, one bid CCA launchpad (Operator; self T8 O6 P8 U8 W8)

**T7** CCA + hook + commit-reveal + Arkiv is composition; CCA testnet readiness is the risk. **O5** 126 launchpad hits; BlindPool did sealed CCAs, world.fun human gating, Proof-of-Human (NY, World 1st) one-human-one-slot with USDC; the bidder dividend is new. **P7** hit-driven, "casino" read. **U7**. **W7** twenty phones bidding and a clearing price landing on the big screen is tense.
**Pattern.** r00t.fund (Lisbon, Uniswap 3rd, not a finalist); bouncerAI and MemeWarp (2025 finalists, zero sponsors) — launchpads reach finals only on gimmick, never in 2026; §4.5 names them.
**Odds.** P(top-10) **4%**. Uniswap 25% — CCA is named in Mumbai scope and nearly untouched. World 18% — allocation-by-human is the right use, but Proof-of-Human already won with it. Arkiv 10% — the proposer concedes it is replaceable.
**Image.** The clearing price appearing while the room holds its phones — good, but a token launch in front of EF judges.
**Slop.** High.
- Q-JUDGE-NILAMI-1: Is the CCA contract live on Unichain Sepolia with a stable ABI, or will you fork it?
- Q-JUDGE-NILAMI-2: How does this differ from Proof-of-Human Drops?

## 6. Asli — pay per verified human conversion (Operator; self T6 O6 P9 U8 W6)

**T5** escrow + verifier + IDKit + Arkiv is glue. **O5** Distro (NY finalist, World 2nd) and payload.exchange (BA finalist) are this product with a consumer-visible loop. **P8** buyers are in the building. **U7**. **W4** a dashboard row turns green.
**Pattern.** Distro placed because a judge watched a clip get paid per view; Asli is its back office (§4.5 dashboards).
**Odds.** P(top-10) **3%**. World IDKit 15% — uniqueness per campaign is a real trust decision. Arc Advanced Stablecoin Logic 18% — refund-by-default escrow fits Mand(ate)/Clawback. Arkiv 15% — an attribution ledger advertisers read is fair use.
**Image.** None.
**Slop.** High — "Galxe with World ID and escrow".
- Q-JUDGE-ASLI-1: What does a judge see in minute one that is not a form and a payout?
- Q-JUDGE-ASLI-2: Without Orb in India, is Device-level uniqueness enough to sell "pay only for real humans"?

## 7. Octroi — price the bots (Sponsor Stacker; self T7 O8 P8 U7 W6)

**T6** "no new crypto", in the proposer's words. **O6** Glassbox402 already charges "humans and AI agents differently" and BookerBob already made "who is behind the agent" change terms; the protocol-expiring portable quota is the new piece. **P7**. **U6**. **W4** a counter of priced bots — W6 is generous.
**Pattern.** Glassbox402 (Lisbon finalist, Hedera) placed at a 173-project event when x402 was four months old; by Mumbai, x402 gateways (AgentGate, Turnstile, OnchainRouter, router402, MCPay) are the commonest submission. `ideation.md` G7: prize fit very high, revenue low.
**Odds.** P(top-10) **3%**. Hedera x402 22% + No-Solidity 10% — deliverables copied from the track text, self-run facilitator included. World Agent Pass 15% / IDKit 10% — the best Agent Pass fit of the twelve: the credential *is* the free tier. Arkiv 30%, Swarm 30% — the only proposal using a native Arkiv primitive (BTL) as mechanism rather than storage.
**Image.** None; middleware.
**Slop.** Medium — real mechanism, generic surface.
- Q-JUDGE-OCTROI-1: The one README sentence separating this from Glassbox402's human/agent pricing?
- Q-JUDGE-OCTROI-2: Does Agent Pass expose a credential an API can verify server-side today, or is the human lane mocked?
- Q-JUDGE-OCTROI-3: Is anything physical or visible in the room?

## 8. Gavel — CCA terminal + agent desk (Sponsor Stacker; self T7 O7 P7 U8 W6)

**T6** indexer, mirror, policy bot, one Definitive order. **O5** TARE's "measure Uniswap truth" applied to an auction format with almost no auctions. **P5** the terminal will show our own test auction. **U7**. **W4** a terminal.
**Pattern.** TARE (ETHOnline finalist) measured 125k real swaps; LYNX (NY finalist) had a thesis; Gavel has neither yet (§4.5 dashboards, "another trading bot").
**Odds.** P(top-10) **2%**. Uniswap 18% — UF pays for tooling, but a bidder on an empty venue is thin. Definitive 20% incl. eligibility — a TWAP exit bolted on. Arkiv Mirror 25%, Swarm 30% — mirroring CCA events is exactly what "Mirror" means: the one strong sponsor.
**Image.** None.
**Slop.** High.
- Q-JUDGE-GAVEL-1: How many CCAs exist to index on 6 Nov; if "ours", what does the terminal show?
- Q-JUDGE-GAVEL-2: Why would a judge remember this over LYNX or TARE?

## 9. Kilowatt — telemetry-metered battery leases (Sponsor Stacker; self T7 O9 P6 U6 W8)

**T7** many parts (4337 paymaster, 0G compute/storage, waterfall vault, ESP32 relay), modest depth in each. **O8** zero prior art in 18,693 rows; machine-attested pay-per-km credit is a real idea. **P5** no fleet, no NBFC, simulated telemetry, three chains. **U5** three personas in four minutes. **W7** a battery lock clicking shut on a missed payment is an image if the ESP32 is on the table; a simulator is not.
**Pattern.** explorador.pt (Lisbon finalist, 0 sponsors): local real-economy credit places on narrative; ColdProof and BananaMesh (ESP32 boxes, Graph 1st / World 1st): hardware wins sponsor firsts. Three chains invites "why" and §4.5 scope failure.
**Odds.** P(top-10) **4%**. Whitechain Tokenize 30% — lease NFT + gasless test-USDT billing hits all three Whitechain asks in an empty field: the strongest single sponsor fit here. Arc Studio DeFi 20% — a USDC waterfall vault is unambiguously a finance app. 0G Agents-with-a-Body 25% — nearly empty field; Build-with-0G 8%.
**Image.** The lock click, conditional on hardware.
**Slop.** Low-Medium — too specific to be slop, but over-architected.
- Q-JUDGE-KILOWATT-1: Forced to one chain, which survives and does the story hold?
- Q-JUDGE-KILOWATT-2: Physical battery and lock on the table, or a simulator?
- Q-JUDGE-KILOWATT-3: What do the first 30 seconds show a judge who has never seen an e-rickshaw?

## 10. Recharge — x402 eSIM data (Mumbai Native; self T6 O7 P9 U8 W8)

**T5** x402 endpoint, reseller call, nullifier check, ENS text record. **O6** GSpot (Lisbon 2023, 2 prizes), GeSIM, topizzy, Silent.link exist; agent top-up and gift-by-name are new. **P8** the most usable-on-Friday proposal, if the reseller account clears. **U8** scan, install, data. **W7** a judge's iPhone going from "No Service" to LTE, paid by an agent — a phone, not a box.
**Pattern.** VEIL VPN (Cannes finalist, three sponsor firsts) is pay-as-you-go connectivity with World gating, but its core was a TEE proof; Recharge's core is a reseller API. Solva (Taipei finalist) shows payments-that-just-work can place.
**Odds.** P(top-10) **5%**. Hedera x402 18% — metered data endpoint + Agent Kit buyer is load-bearing. World 18% — a nullifier-funded welcome bundle is World ID changing economics. Arc consumer-agent 12% — settlement is on Hedera, so Arc is decorative unless the agent truly discovers the service via Arc's marketplace API.
**Image.** An iPhone lights up with data on stage. Retellable.
**Slop.** Low-Medium — product-shaped, though x402 + Agent Pass + ENS is the modal 2026 stack.
- Q-JUDGE-RECHARGE-1: Is a reseller account approved, and what is the measured activation latency on stage?
- Q-JUDGE-RECHARGE-2: What breaks if Arc is removed, given settlement is on Hedera?
- Q-JUDGE-RECHARGE-3: Does an eSIM kiosk read to finalist judges as a crypto project or a merchant?

## 11. Challan — TDS-withholding v4 hook (Mumbai Native; self T8 O8 P6 U6 W7)

**T7** hook + per-nullifier accumulator + Arkiv ledger + certificate; the residency credential will be self-attested and judges will notice. **O8** withholding at the pool with per-human thresholds is unseen and timely. **P5** nobody picks a pool that costs 1% when a free one is one click away unless a wallet routes them; the deductor theory is unresolved. **U5** invisible when it works. **W6** "the pool that pays your taxes" lands with Indian judges only.
**Pattern.** Calary (Taipei, Uniswap runner-up), Effe, Poolswap, ClosingBell-Hook, BondZero — compliance and fee-logic hooks win Uniswap tracks and have never been finalists.
**Odds.** P(top-10) **3%**. Uniswap 25% — a hand-built hook with tests, novel fee logic and FEEDBACK.md is what UF reviewers reward. World IDKit 18% — a per-human threshold is a real trust decision. Arkiv 20%, Swarm 20% — deduction ledger → certificate PDF is a legitimate read path.
**Image.** A swap confirmation reading "TDS 1% — ₹412 withheld" and a challan downloading. Legible to half the room.
**Slop.** Low — too legally textured to be generated.
- Q-JUDGE-CHALLAN-1: The CA memo's conclusion on in-kind withholding by a non-buyer deductor; if "probably invalid", what is the project?
- Q-JUDGE-CHALLAN-2: Who is the user — a person, or a wallet (Okto) routing through the pool?
- Q-JUDGE-CHALLAN-3: Can a non-Indian judge follow the demo in 60 seconds?

## 12. Udhaar — USDC tab, verified local pays UPI (Mumbai Native; self T5 O4 P8 U8 W6)

**T4**. **O4** Nomadia (Taipei finalist), ShieldRamp (New Delhi, World 2nd), uWu, ChainPe, ETHPark-QR — the lane is full. **P7** works at the gate if settlers exist; FIU/FEMA is the Q&A killer, sharpened by today's card probe. **U7**. **W6** the vendor's soundbox chirps when the settler's GPay fires — real, seen before.
**Pattern.** Nomadia and ETHPark-QR placed in 2024–25; at a ~500-project India event there will be ten of these.
**Odds.** P(top-10) **3%**. World IDKit 15% — settler reputation per nullifier is a real trust decision. Arc Advanced Stablecoin Logic 15% — per-item release and disputes fit. Chainlink CRE 15% — a rate workflow writing onchain is a state change, barely.
**Image.** A vada pav paid by a stranger's GPay while USDC releases. Seen before.
**Slop.** High — the most-generated India idea.
- Q-JUDGE-UDHAAR-1: The one-sentence difference from ShieldRamp and uWu?
- Q-JUDGE-UDHAAR-2: Your answer when an Indian judge asks about FIU-IND registration for facilitating VDA–fiat exchange?

---

## Chair's cross-cutting questions

**(A) From-scratch vs Continuity.** From-scratch, no hedge. Nine of ten multi-prize finalists were from-scratch; the continuity finalists (Void Tactics, Novi Corpus, Happy Hour) were mature products judged on in-window delta with Originality and WOW discounted. A repository created this week is fake continuity, and 1inch's "real git history" rule shows sponsors check. Continuity-only pools are $1.5–5k each; the fat one (Whitechain $6k) is irrelevant to our top ideas. Legal prep before 5 Nov 21:00: accounts, faucets, reseller and hardware procurement, a CA memo, flashed stock libraries, zero product code, all disclosed in the README.

**(B) Demos that survive a noisy hall, flaky Wi-Fi and slow testnets.** Survive: Recharge (the demo *is* the phone's own cellular data), Challan (one pre-seeded swap), CallSheet (mainnet fills, Telegram on mobile data), Kilowatt in simulator mode, and the three laptop dashboards (Octroi, Asli, Gavel), which survive because nothing happens in them. Fragile: Nilami (20 audience phones on venue Wi-Fi hitting one testnet), Boli (0G Galileo latency; a pre-warmed in-flight job is mandatory), Bhishi (five phones on Arc testnet), Udhaar (needs a real vendor). Dhwani is bimodal: online mode (QR → Arc tx → box speaks) survives because TTS is local and a tx can be pre-staged; the offline chirp is the most noise-sensitive moment of the twelve. My rule: chirp once live, cut to QR after ten seconds, let the sub-3-minute video carry the chirp — the Pi speaking is the WOW, the chirp is the Technicality.

**(C) My vote.** Dhwani: it is the only proposal with the exact shape of the 2026 finalist slate — a physical object on the table, a payment loop closing onchain in under ten seconds, a local hook, and a privacy angle for an EF-heavy room — and the only one a judge can retell to another judge in one sentence. Nothing else clears 6% on my finalist estimate; the rest are sponsor plays.

---

## Ranked by expected total prize value

EV = P(top-10) × $7,500 + Σ P(placed) × tier (Uniswap ≈ $2.5k, Hedera x402 ≈ $2.2k, Arkiv $3k/$1k + $500 Swarm, Arc $3k, Whitechain $3k, EF $4k).

| # | Idea | P(top-10) | Finalist EV | Sponsor EV | **Total EV** |
|---|---|---|---|---|---|
| 1 | Dhwani | 12% | $900 | Arc $750 · Arkiv $700 · EF $800 | **≈ $3,150** |
| 2 | Octroi | 3% | $225 | Hedera $685 · World $1,000 · Arkiv $850 | **≈ $2,750** |
| 3 | Kilowatt | 4% | $300 | Whitechain $900 · Arc $600 · 0G $585 | **≈ $2,400** |
| 4 | Boli | 6% | $450 | Hedera $440 · 0G $300 · World $900 | **≈ $2,100** |
| 5 | Challan | 3% | $225 | Uniswap $625 · World $450 · Arkiv $500 | **≈ $1,800** |
| 6 | Nilami | 4% | $300 | Uniswap $625 · World $540 · Arkiv $300 | **≈ $1,765** |
| 7 | Recharge | 5% | $375 | Hedera $400 · World $600 · Arc $360 | **≈ $1,725** |
| 8 | CallSheet | 5% | $375 | Uniswap $500 · Definitive $540 · World $300 | **≈ $1,715** |
| 9 | Gavel | 2% | $150 | Uniswap $450 · Definitive $400 · Arkiv $650 | **≈ $1,650** |
| 10 | Asli | 3% | $225 | World $375 · Arc $540 · Arkiv $300 | **≈ $1,440** |
| 11 | Bhishi | 2% | $150 | Arc $600 · World $300 · Arkiv $300 | **≈ $1,350** |
| 12 | Udhaar | 3% | $225 | World $375 · Arc $450 · CRE $225 | **≈ $1,275** |

Reading: Dhwani is the only idea whose finalist EV exceeds any single sponsor line. Octroi is second on money purely through sponsor design (BTL-as-quota, Agent-Pass-as-free-tier): the best sponsor hedge and the worst finalist pitch here; whatever wins should steal its Arkiv idea. Kilowatt's rank is carried by Whitechain's empty field.

## KILL LIST

- **Udhaar** — the Nomadia/ShieldRamp/uWu lane, with an FIU-IND question that cannot be answered on stage in the week RBI is probing stablecoin spending.
- **Bhishi** — 27 chit-fund entries, zero finalists; the "twist" is the standard Indian chit mechanism.
- **Asli** — Distro already placed with this loop and a visible consumer moment; Asli is its dashboard.
- **Gavel** — a terminal for an auction format with no auctions to index.
- **Nilami** — launchpad is a named anti-pattern, Proof-of-Human already won World with one-human-one-slot, and it is a token launch in front of EF judges.
- **CallSheet** — copy-trading is the category finalist judges auto-discount, and entry and exit live on different chains with different money.

Conditional keeps: Recharge (no reseller account by 4 Nov → dead), Challan (CA memo says the deduction is invalid → dead), Boli (0G Compute cannot grade → dead), Octroi (sponsor hedge only).
