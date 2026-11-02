# Round 1 — ETHGlobal Veteran Judge (member #7)

**Lens.** I pattern-match each of the 12 proposals against the 149 finalists and ~2,200 sponsor placements in `winners.md`, score it as a live 4-min demo + 3-min Q&A on the official rubric, smell-test it for AI-slop, and judge each claimed sponsor the way that sponsor's async reader would (load-bearing vs decorative, newest primitive as mechanism, hygiene files). Base rates: ~500 projects → P(top-10) ≈ 2% for a median entry; a physical object or a one-sentence privacy hook roughly triples it; a launchpad, dashboard or copy-trading shape halves it. Sponsor numbers are P(placed prize | top-decile execution). Finalist award = $7,500 (5 × $1,500).

**What my five searches established (everything else is from the corpus).** (1) No source resolves the Definitive/World "continuity-only" conflict; I price Definitive at P(eligible)=0.6 and treat World's Agent Pass/IDKit as open. (2) No commercial stablecoin soundbox exists; the nearest thing is Xflow's compliant USDC acceptance for Indian businesses (stablecoin leg offshore, fiat via an AD-I bank) — a Q&A answer for Dhwani, not a competitor. (3) Hedera x402 on testnet is real (r402-hedera and uvd-x402-sdk support `hedera:testnet`; Hedera's own x402 bounty winners ran on testnet) but no public facilitator is confirmed running — plan to self-host. (4) Orb verification in India was paused in Dec 2023 and nothing says it resumed: every idea gating *Indian* humans must assume Device/Document-level credentials. (5) From `ideation.md` §3.2: today RBI/FIU are probing offshore stablecoin cards, so "spend USDC in India" is in the regulator's sights this exact week.

---

## 1. Dhwani — stablecoin soundbox (Judge's Eye)

**Scores (self T8 O8 P9 U9 W10).** T7: ggwave and EIP-3009 relays are library-grade; the Anon-RPC worker and composed Hindi/Marathi TTS are the real work. O8: the three prior audio entries scored zero because they were phone-to-phone toys; payer-offline, merchant-relays-gas, in a soundbox is new. P7: the box works tonight, but the first Indian judge asks who converts Ramesh's USDC to rupees and who bears 1% TDS; without a one-line Xflow-style answer this falls to 5. U8: voice-first is right; the embedded-key payer PWA is a demo trick. W9: the only proposal where a judge's own phone makes an object on the table speak.
**Pattern.** NoNet (New Delhi finalist, Hedera 1st: tx without internet), cellfi (Taipei finalist, USDC over SMS), Fluxo (BA, offline mesh, Hedera 2nd) and ETHastic (Cannes, LoRa payments, Arc 2nd) show offline/physical payments place; ETH Arcade and LeekWallet show a Pi/ESP32 object reaches finals with zero sponsor help. The anti-pattern to dodge is §4.5 "demos dependent on live latency": chirp → Arc inclusion → speak has three waits.
**Odds.** P(top-10) **12%**, highest of the twelve. Arc Studio DeFi/Finance app (25%): USDC-as-gas genuinely enables the relay; the Arc judge will ask whether a payments box is a "finance app" — ETHastic says yes. Arkiv from-scratch (25%, Swarm 30%): receipts-with-BTL is a plausible khata, but a receipt log is the archetypal "could be Postgres" use; make the multi-box aggregation query the hero. EF Anon-RPC (20%): zero prior consumers, the "run a worker" prong is exactly what EF asks, and the Devcon crowd is privacy-literate; the risk is EF deciding a merchant poll is not a privacy app.
**Image.** A chai-stall box says "paanch sau rupaye prapt hue" four seconds after a judge's phone chirps at it. Judges will retell it.
**Slop.** Low — hardware, audio DSP and vernacular TTS cannot be vibe-coded.
- Q-JUDGE-DHWANI-1: What is the 20-second answer to "how does the chaiwala get rupees, and is this legal after today's RBI/FIU card probe?"
- Q-JUDGE-DHWANI-2: What is the hard cutover rule if the live chirp fails twice (seconds budgeted, who presses QR), and what decode rate did you measure at venue-level noise?
- Q-JUDGE-DHWANI-3: Does Anon-RPC cover Arc (5042002) today, and does EF count a worker you run yourself as "Anon-RPC"?

## 2. Boli — verified humans sell Indic speech (Judge's Eye)

**Scores (self T8 O6 P8 U8 W7).** T6: 0G Compute serves chat-completions from listed providers; running ASR and anti-spoof *inside* the TEE is probably impossible on Galileo, leaving an LLM grading a transcript produced off-TEE. O6: agreed — Hands Unchained's thesis with the modality swapped. P7: Karya proves the labour side; the agent buyer in the demo is us. U7. W6: a balance ticking up after a sentence is participatory but small.
**Pattern.** Hands Unchained (Lisbon finalist, World 1st + 0G 2nd), Accrue (NY finalist, Hedera) and Distro (NY finalist, World 2nd) make "verified humans paid per graded unit of work" a 3-for-3 archetype in 2026, each with a visceral hook (robot arm, loading spinner, clips). Thenar, the robot-arm clone, scored zero: the archetype places only with its own hook. Boli's hook is Sunita at ₹250/hr.
**Odds.** P(top-10) **6%**. Hedera x402 (20%): pay-per-utterance + HCS-14 + Agent Kit is the track's suggested shape, but this will be the thickest field at the event. 0G Build (15%): 0G reads repos; if grading is "LLM reads transcript", they will see it. World IDKit (20%) / Agent Pass (8%): one-human-one-seller is a real trust decision (Hands Unchained precedent); Agent Pass on the buyer, "verified server-side", is mocked.
**Image.** A judge says a Marathi sentence; a HashScan payment lands in their wallet as the room leaderboard increments. Decent, not retold.
**Slop.** Medium — "data marketplace for agents" is the most-cloned 2026 shape (OpenBook, DeTrain, Mnemosyne); the vernacular worker app saves it.
- Q-JUDGE-BOLI-1: Exactly which computation runs inside 0G Compute and returns the signed certificate — ASR, or an LLM judging a transcript Whisper produced on your server?
- Q-JUDGE-BOLI-2: With Orb paused in India, are Marathi sellers Device-level only, and does that still justify "one human, one seller" to the World judge?
- Q-JUDGE-BOLI-3: How do you stop judges reading the buyer agent as "we paid ourselves"?

## 3. Bhishi — auction chit fund (Judge's Eye)

**Scores (self T7 O5 P7 U8 W7).** T6: netting arithmetic and an open auction. O4: 27 ROSCA entries, zero finalists; the dividend auction is the standard Indian chit, novel only to non-Indians. P7. U7. W5: a rate on a ticker; every India event has a chit fund and judges visibly sigh.
**Pattern.** cheat.fund (New Delhi, 0), Savio (Cannes 2025, Circle only), Tanda/Ronda, PotLuck, Saving Circles (BA, Chainlink only). The category has never produced a finalist — §4.5 "generic category without a mechanism twist".
**Odds.** P(top-10) **2%**. Arc Advanced Stablecoin Logic (20%): scheduled contributions and netting is what the track names (OpenPop precedent). World IDKit (12%): one-human-one-slot is legitimate but crowded. Arkiv (15%): credit-history reads are real but thin.
**Image.** "This room priced one-month credit at 10%." A number, not a picture.
**Slop.** High — "onchain chit fund with World ID" is the default LLM answer to "India hackathon idea".
- Q-JUDGE-BHISHI-1: What appears in minute one that cheat.fund, Savio and Saving Circles did not show?
- Q-JUDGE-BHISHI-2: Is a Bhishi Rate from one five-phone group an index or a vanity number?

## 4. CallSheet — sealed executable calls (Operator)

**Scores (self T8 O7 P8 U7 W7).** T8: hook-enforced uniform fill, tlock, session-key vaults and Definitive exits is real engineering. O6: KOLlateral owns the persona, PrivBatch owns the batch-privacy hook, 68 copy-trade entries own the category; sealing the call is the twist. P7: Definitive is likely mainnet-only, so entry (Unichain Sepolia) and exit (Base mainnet) are different chains and different money. U6: Telegram + vault funding + World registration is three surfaces in four minutes. W6: "bot front-runs, then is defeated" is a narrative, not a sense.
**Pattern.** KOLlateral (Lisbon finalist, Uniswap 1st + 0G 3rd) placed by making the caller accountable; KagamiAI (New Delhi finalist, 0 sponsors) is the copy-bot ceiling; none of the ~30 agent/copy-trading entries since Cannes placed. The post-Binance-hack mood helps the non-custodial pitch; the Devcon crowd dislikes trading bots.
**Odds.** P(top-10) **5%**. Uniswap Build (20%, ~$2.5k expected): a uniform-price batch hook with onchain fee split is a mechanism, which UF rewards. Definitive (27% = 0.6 eligible × 0.45): the theme is literally social trading and the field is ~30 teams. World (10%): registering callers is a gate, not a change of terms — decorative to the World judge.
**Image.** None a judge retells; a chart where the bot loses.
**Slop.** Medium-High — Telegram bot + leaderboard + copy-trading is the modal showcase entry.
- Q-JUDGE-CALLSHEET-1: With entry on Unichain Sepolia and exits on Base mainnet, what single screen shows one coherent trade?
- Q-JUDGE-CALLSHEET-2: What stops the caller pre-positioning before posting the sealed hash — is "nobody can front-run followers" true of the caller?
- Q-JUDGE-CALLSHEET-3: What happens in the first 30 seconds that is not a Telegram message?

## 5. Nilami — one human, one bid CCA launchpad (Operator)

**Scores (self T8 O6 P8 U8 W8).** T7: CCA + hook + commit-reveal + Arkiv is composition; the risk is CCA's testnet readiness. O5: 126 launchpad hits; BlindPool/CircEveryBid did sealed CCAs, world.fun did human gating, Proof-of-Human (NY, World 1st) did one-human-one-slot with USDC settlement; the bidder dividend is new. P7: hit-driven, "casino" read. U7. W7: twenty phones bidding and a clearing price landing on the big screen is genuinely tense.
**Pattern.** r00t.fund (Lisbon, Uniswap 3rd, not a finalist); bouncerAI and MemeWarp (2025 finalists with zero sponsor prizes) — launchpads reach finals only on gimmick and never did in 2026. §4.5 names launchpads explicitly.
**Odds.** P(top-10) **4%**. Uniswap (25%): CCA is named in Mumbai scope and nearly untouched; the UF judge wants a CCA build. World Agent Pass/IDKit (18%): allocation-by-human is the right World use, but Proof-of-Human already won with it. Arkiv (10%): the proposer concedes it is replaceable; the Arkiv judge will agree.
**Image.** The clearing price appearing while the room holds its phones — good, but it is a token launch in front of EF judges.
**Slop.** High — fair-launch launchpad with proof-of-human.
- Q-JUDGE-NILAMI-1: Is the CCA contract live on Unichain Sepolia with a stable ABI today, or will you fork it?
- Q-JUDGE-NILAMI-2: What do you say when the World judge asks how this differs from Proof-of-Human Drops?

## 6. Asli — pay per verified human conversion (Operator)

**Scores (self T6 O6 P9 U8 W6).** T5: escrow + verifier + IDKit + Arkiv is a weekend of glue. O5: Distro (NY finalist, World 2nd) and payload.exchange (BA finalist, 3 sponsors) are this product with a consumer-visible loop; Refer/CPA did it in 2023. P8: buyers are in the building — true. U7. W4: a dashboard row turns green.
**Pattern.** Distro placed because a judge watched a clip get paid per view; Asli is its B2B back office. §4.5 "dashboards".
**Odds.** P(top-10) **3%**. World IDKit (15%): uniqueness per campaign is a real trust decision. Arc Advanced Stablecoin Logic (18%): refund-by-default escrow fits the Mand(ate)/Clawback precedents. Arkiv (15%): an attribution ledger read by advertisers is a fair use.
**Image.** None.
**Slop.** High — "Galxe with World ID and escrow".
- Q-JUDGE-ASLI-1: What does a judge see in minute one that is not a form and a payout?
- Q-JUDGE-ASLI-2: Without Orb in India, is Device-level uniqueness strong enough to sell "pay only for real humans"?

## 7. Octroi — price the bots (Sponsor Stacker)

**Scores (self T7 O8 P8 U7 W6).** T6: in the proposer's words, "no new crypto". O6: Glassbox402's own description says "charging humans and AI agents differently" and BookerBob (World 2nd) already made "who is behind the agent" change terms; the portable, protocol-expiring quota is the genuinely new piece. P7. U6. W4: a counter of priced bots on a dashboard — the Stacker's W6 is generous.
**Pattern.** Glassbox402 (Lisbon finalist, Hedera) is the direct ancestor; it placed at a 173-project event when x402 was four months old. By Mumbai, x402 gateways (AgentGate, Turnstile, OnchainRouter, router402, MCPay) are the single most common submission; `ideation.md` G7 rates the prize fit "very high" and the revenue "low".
**Odds.** P(top-10) **3%**. Hedera x402 (22%) + No-Solidity (10%): the deliverables are copied from the track text, including the self-run facilitator. World Agent Pass (15%) / IDKit (10%): the best Agent Pass fit of the twelve — the credential *is* the free tier. Arkiv (30%, Swarm 30%): the only proposal that uses a native Arkiv primitive (BTL) as mechanism rather than storage; the Arkiv judge will notice.
**Image.** None; it is middleware.
**Slop.** Medium — real mechanism, generic surface.
- Q-JUDGE-OCTROI-1: What is the one README sentence that separates this from Glassbox402's human/agent pricing?
- Q-JUDGE-OCTROI-2: Does Agent Pass expose a credential an API can verify server-side today, or is the human lane mocked?
- Q-JUDGE-OCTROI-3: Is there anything physical or visible in the room?

## 8. Gavel — CCA terminal + agent desk (Sponsor Stacker)

**Scores (self T7 O7 P7 U8 W6).** T6: indexer, mirror, policy bot, one Definitive order. O5: TARE's "measure Uniswap truth" applied to an auction format with almost no auctions to measure. P5: the proposer admits volume is thin — the terminal will show our own test auction. U7. W4: a terminal.
**Pattern.** TARE (ETHOnline finalist) measured 125k real swaps; LYNX (NY finalist, 0 sponsors) had a thesis. Gavel has neither the data nor the thesis yet; §4.5 "dashboards", plus the "another trading bot" smell.
**Odds.** P(top-10) **2%**. Uniswap (18%): UF pays for tooling (TARE, Backtester), but a bidder on an empty venue is thin. Definitive (20% incl. eligibility): a TWAP exit is a real order bolted to the side. Arkiv Mirror/from-scratch (25%, Swarm 30%): mirroring CCA events is exactly what "Mirror" means — Gavel's one strong sponsor.
**Image.** None.
**Slop.** High.
- Q-JUDGE-GAVEL-1: How many CCAs exist to index on 6 Nov; if the answer is "ours", what does the terminal show?
- Q-JUDGE-GAVEL-2: Why would a judge remember this over LYNX or TARE?

## 9. Kilowatt — telemetry-metered battery leases (Sponsor Stacker)

**Scores (self T7 O9 P6 U6 W8).** T7: many parts (4337 paymaster, 0G compute/storage, waterfall vault, ESP32 relay), modest depth in each. O8: zero prior art in 18,693 rows; machine-attested pay-per-km credit is a real idea. P5: no fleet, no NBFC, simulated telemetry, three chains — "could the audience use it today" is no. U5: three personas (driver, investor, lender) in four minutes. W7: a battery lock clicking shut on a missed payment is an image if the ESP32 is on the table; a browser simulator is not.
**Pattern.** explorador.pt (Lisbon finalist, 0 sponsors) shows local real-economy credit can place on narrative alone; ColdProof and BananaMesh (ESP32 boxes, Graph 1st / World 1st) show hardware wins sponsor firsts. Three chains invites "why" in Q&A and the §4.5 scope failure.
**Odds.** P(top-10) **4%**. Whitechain Tokenize (30%): lease NFT + gasless test-USDT billing hits all three Whitechain asks in an empty field — the strongest single sponsor fit among the twelve. Arc Studio DeFi (20%): a USDC waterfall vault is unambiguously a finance app. 0G Agents-with-a-Body (25%): the Physical-AI field will be nearly empty; Build-with-0G (8%).
**Image.** The lock click, conditional on hardware.
**Slop.** Low-Medium — too specific to be slop, but reads as over-architected.
- Q-JUDGE-KILOWATT-1: If forced to one chain, which survives and does the story still hold?
- Q-JUDGE-KILOWATT-2: Will a physical battery and lock be on the table, or a simulator?
- Q-JUDGE-KILOWATT-3: What do the first 30 seconds show a judge who has never seen an e-rickshaw?

## 10. Recharge — x402 eSIM data (Mumbai Native)

**Scores (self T6 O7 P9 U8 W8).** T5: x402 endpoint, reseller call, nullifier check, ENS text record. O6: GSpot (Lisbon 2023, 2 prizes), GeSIM, topizzy and Silent.link exist; agent top-up and gift-by-name are the new parts. P8: the most usable-on-Friday proposal here, if the reseller account clears. U8: scan, install, data. W7: a judge's iPhone going from "No Service" to LTE, paid by an agent, is good — a phone, not a box.
**Pattern.** VEIL VPN (Cannes finalist, World 1st + Arc 1st + ENS 1st) is pay-as-you-go connectivity with World gating — but VEIL's core was a TEE proof of no-logs; Recharge's core is a reseller API. Solva (Taipei finalist) shows "payments that just work" can place.
**Odds.** P(top-10) **5%**. Hedera x402 (18%): metered data endpoint + Agent Kit buyer is load-bearing. World Agent Pass/IDKit (18%): a nullifier-funded welcome bundle is World ID changing economics (sponsor-funded tier) — a good fit. Arc consumer-agent/marketplace-discovery (12%): the payment rail is Hedera, so Arc is decorative unless the agent genuinely discovers the top-up service through Arc's marketplace API.
**Image.** An iPhone lights up with data on stage. Retellable.
**Slop.** Low-Medium — product-shaped, though x402 + Agent Pass + ENS is the modal 2026 stack.
- Q-JUDGE-RECHARGE-1: Is a reseller account approved, and what is the measured activation latency on stage?
- Q-JUDGE-RECHARGE-2: What breaks if Arc is removed, given settlement is on Hedera?
- Q-JUDGE-RECHARGE-3: Does an eSIM kiosk read to finalist judges as a crypto project or a merchant?

## 11. Challan — TDS-withholding v4 hook (Mumbai Native)

**Scores (self T8 O8 P6 U6 W7).** T7: hook + per-nullifier annual accumulator + Arkiv ledger + certificate; the ZK residency credential will be self-attested in the demo, and the judge will notice. O8: withholding at the pool with per-human thresholds is unseen and timely (Income-tax Act 2025, CARF). P5: nobody chooses a pool that costs 1% while a free pool is one click away unless a wallet routes them; the deductor theory is unresolved. U5: invisible when it works. W6: "the pool that pays your taxes" lands with Indian judges; non-Indians need the explainer.
**Pattern.** Calary (Taipei, Uniswap runner-up), Effe, Poolswap, ClosingBell-Hook, BondZero — compliance and fee-logic hooks win Uniswap tracks and have never been finalists.
**Odds.** P(top-10) **3%**. Uniswap (25%, ~$2.5k): a hand-built hook with tests, novel fee logic and FEEDBACK.md is what UF's reviewers reward. World IDKit (18%): a per-human threshold is a real trust decision. Arkiv (20%, Swarm 20%): deduction ledger → certificate PDF is a legitimate read path.
**Image.** A swap confirmation reading "TDS 1% — ₹412 withheld" and a challan downloading. Legible to half the room.
**Slop.** Low — too legally textured to be generated.
- Q-JUDGE-CHALLAN-1: What is the CA memo's conclusion on in-kind withholding by a non-buyer deductor; if "probably invalid", what is the project?
- Q-JUDGE-CHALLAN-2: Who is the user — a person, or a wallet (Okto) that routes through the pool?
- Q-JUDGE-CHALLAN-3: Can a non-Indian judge follow the demo in 60 seconds?

## 12. Udhaar — USDC tab, verified local pays UPI (Mumbai Native)

**Scores (self T5 O4 P8 U8 W6).** T4. O4: Nomadia (Taipei finalist), ShieldRamp (New Delhi, World 2nd), uWu, ChainPe, ETHPark-QR — the lane is full. P7: works at the gate if settlers exist; FIU/FEMA exposure is the Q&A killer, sharpened by today's card probe. U7. W6: the vendor's soundbox chirps when the settler's GPay fires — a real moment judges have seen before.
**Pattern.** Nomadia and ETHPark-QR placed in 2024–25; at a ~500-project India event there will be ten of these.
**Odds.** P(top-10) **3%**. World IDKit (15%): settler reputation per nullifier is a real trust decision. Arc Advanced Stablecoin Logic (15%): per-item release and disputes fit. Chainlink CRE (15%): a rate workflow writing onchain qualifies as a state change, barely.
**Image.** A vada pav paid by a stranger's GPay while USDC releases. Seen before.
**Slop.** High — the most-generated India idea.
- Q-JUDGE-UDHAAR-1: What is the one-sentence difference from ShieldRamp and uWu?
- Q-JUDGE-UDHAAR-2: What do you answer when an Indian judge asks about FIU-IND registration for facilitating VDA–fiat exchange?

---

## Chair's cross-cutting questions

**(A) From-scratch vs Continuity.** From-scratch, without hedging. Nine of ten multi-prize finalists were from-scratch; the continuity finalists (Void Tactics, Novi Corpus, Happy Hour) were mature products judged on a visible in-window delta with Originality and WOW discounted. A repository created this week is fake continuity, and 1inch's "real git history" rule shows sponsors check. Continuity-only pools are $1.5–5k each; the one fat one (Whitechain $6k) is irrelevant to our top ideas. Prep legally before 5 Nov 21:00: accounts, faucets, reseller and hardware procurement, a CA memo, flashed stock libraries, zero product code, all disclosed in the README.

**(B) Demos that survive a noisy hall, flaky Wi-Fi and slow testnets.** Survive: Recharge (the demo *is* the phone's own cellular data; only provisioning needs Wi-Fi), Challan (one pre-seeded swap on Unichain Sepolia), CallSheet (mainnet fills and Telegram on mobile data), Kilowatt in simulator mode, and the three laptop dashboards (Octroi, Asli, Gavel), which survive because nothing happens in them. Fragile: Nilami (20 audience phones on venue Wi-Fi hitting one testnet), Boli (0G Galileo latency; a pre-warmed in-flight job is mandatory), Bhishi (five phones on Arc testnet), Udhaar (UPI works on mobile data but needs a real vendor). Dhwani is bimodal: its online mode (QR → Arc tx → box speaks) survives because TTS is local and one tx can be pre-staged; its offline chirp is the single most noise-sensitive moment of the twelve. The rule I would impose: chirp once live, cut to QR after ten seconds, and let the sub-3-minute video carry the chirp — the Pi speaking is the WOW, the chirp is the Technicality.

**(C) My vote.** Dhwani: it is the only proposal with the exact shape of the 2026 finalist slate — a physical object on the table, a payment loop that closes onchain in under ten seconds, a local hook, and a privacy angle for an EF-heavy room — and the only one a judge can retell to another judge in one sentence. Nothing else here clears 6% on my finalist estimate; the rest are sponsor plays.

---

## Ranked by expected total prize value

EV = P(top-10) × $7,500 + Σ P(placed) × expected tier (Uniswap tiers ≈ $2.5k avg; Hedera x402 ≈ $2.2k avg; Arkiv $3k/$1k + $500 Swarm; Arc $3k flat; Whitechain priced at $3k; EF at $4k).

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

Reading: Dhwani is the only idea whose finalist EV exceeds any single sponsor line. Octroi is second on money purely through sponsor design (BTL-as-quota, Agent-Pass-as-free-tier) — the best sponsor hedge and the worst finalist pitch in the set; its Arkiv idea should be stolen by whatever wins. Kilowatt's rank is carried by Whitechain's empty field.

## KILL LIST

- **Udhaar** — the Nomadia/ShieldRamp/uWu lane, with an FIU-IND question that cannot be answered on stage in the week RBI is probing stablecoin spending.
- **Bhishi** — 27 chit-fund entries, zero finalists; the "twist" is the standard Indian chit mechanism.
- **Asli** — Distro already placed with this loop and a visible consumer moment; Asli is its dashboard.
- **Gavel** — a terminal for an auction format with no auctions to index.
- **Nilami** — launchpad is a named anti-pattern, Proof-of-Human already won World with one-human-one-slot, and it is a token launch in front of EF judges.
- **CallSheet** — copy-trading is the category finalist judges auto-discount, and entry and exit live on different chains with different money.

Conditional keeps: Recharge (dies without a reseller account by 4 Nov), Challan (dies if the CA memo says the deduction is invalid), Boli (dies if 0G Compute cannot perform the grading), Octroi (sponsor hedge only).
