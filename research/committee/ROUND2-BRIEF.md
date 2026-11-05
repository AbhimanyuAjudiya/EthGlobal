# Round 2 — Rebuttal & Revision Brief (from the Chair)

All five Round-1 critiques are in (`round1-security.md`, `round1-vc-skeptic.md`, `round1-veteran-judge.md`, `round1-power-user.md`, `round1-ops-feasibility.md`). Aggregate scoreboard (from each critic's own ranking):

| Idea | Ops P(all 3 sponsors real) | Security survivability /10 | VC realism /10 | Judge verdict | User desire /10 |
|---|---|---|---|---|---|
| Dhwani | 0.30 (0.50 if ENS replaces Anon-RPC & hardware bought by Wed) | 7 | 2 (no flow; ~3% haircut vs UPI 0%) | **#1 — P(top-10) 12%, EV ≈ $3,150, judge's vote** | 8 |
| Octroi | 0.55 | **8** | 2 (no payers) | #2 on sponsor EV (≈ $2,750), no finalist image | 3 |
| Recharge | 0.40 | 6 | 3 (commodity margin $1–3/GB) | mid | **8** |
| CallSheet | 0.35 (Definitive mainnet-only) | 2 (caller is insider; custodial session keys) | **5** (re-venue to Hyperliquid perps) | kill (trading-bot anti-pattern) | 7 |
| Asli | **0.60** | 5 | **5** (Galxe has World ID since 2024) | kill | 4 |
| Boli | 0.40 | 4 (TTS farm w/o Orb) | 3 (AI4Bharat gives data away) | mid | 5 |
| Challan | 0.55 | 2 (TDS credit needs PAN; hook voluntary) | 2 (adverse selection) | mid | 3 |
| Bhishi | **0.60** | 2 (bond < default exposure; Chit Funds Act) | 2 | kill | 3 |
| Gavel | 0.35 | 7 | 1 (Uniswap's own CCA UI) | kill | 3 |
| Nilami | 0.30 | 4 | 2 (Clanker fees −95%) | kill | 4 |
| Kilowatt | 0.30 (103 ph) | 3 | 1 | #3 EV via empty Whitechain field | 2 |
| Udhaar | 0.50 | **1** (FEMA hawala) | 1 | kill | 5 |

**Facts established in Round 1 that bind everyone:** Arc Studio is Circle's AI coding agent and must be the project's starting point for Arc prizes; World "Agent Pass" has no public docs (AgentKit limited beta) → design around IDKit; Orb is paused in India → Indian users verify via Selfie Check / NFC passport (Device level), Devcon foreigners already hold Orb IDs; World IDs resell for ~$0.50 → "one human" is a price, not a guarantee; Arc testnet USDC implements EIP-3009 (offline-signed transfers are real); Arc mainnet is 7 weeks old → every "USDC on Arc" flow hides a bridge for users holding USDC elsewhere; Definitive Flash is mainnet-only beta; Hedera x402 has working testnet facilitators; 0G Compute serves chat LLMs, not ASR; Anon-RPC is a browser-worker draft spec; Uniswap's own app has had a CCA Auctions tab since Feb 2026; Clanker fee revenue fell ~95% Feb→Sep 2026; AI4Bharat publishes 7,348 h of free Indic speech; Galxe has supported World ID since May 2024; NPCI plans to open UPI One World to all tourists this winter.

**The central unresolved tension.** The ideas judges and users love (Dhwani, Recharge) have weak revenue; the ideas with a revenue case (CallSheet, Asli) are judged as anti-patterns or lack a wedge. The founder's mandate is BOTH: a top-10-shaped build with load-bearing sponsor integrations AND a credible path to ≥$10k/week. The research (`ideation.md` §2) says the only proven small-team paths are fee-on-flow on an already-liquid venue (Hyperliquid builder codes ≤10 bps; Polymarket builder codes) or B2B compliance/infra that someone is obliged to buy.

**A fact about this build the committee must now price in.** The founder has instructed the orchestrator to START BUILDING as soon as the idea is finalised (i.e., 3–5 Nov, before kickoff). The code will exist publicly before the window opens. Therefore the honest entry options are: (i) enter **Continuity** with the pre-built open-source repo and ship major, visible features during the window (unlocks continuity-only prizes: Uniswap $5k, Arkiv $4k, Arc $3k, Whitechain $3k, 0G $3k, World [Cont] $2.5k, Hedera ~$1.5k, Definitive $1.5k, 1inch top tier); or (ii) treat the pre-build as a reference implementation and have the human team re-implement from scratch during the window (risky: judges and sponsors can see the public repo's history). Every member must now re-state their track position under THIS reality, not the hypothetical one.

## What each proposer must deliver in `round2-<role>.md`
1. **Answer every numbered question** aimed at your three ideas (Q-SEC-*, Q-VC-*, Q-JUDGE-*, Q-USER-*, Q-OPS-*): quote the question id, then CONCEDE (and say what changes) or REBUT (with evidence). No question may be skipped.
2. **Submit exactly ONE v2 proposal** — a revised version of one of your ideas OR a hybrid with another member's idea — that explicitly fixes the critiques and satisfies both mandates. Use the 11-field template. Field 6 must survive the VC's method (re-derive with their assumptions; show low/base/high). Field 7 must survive Ops (≤85 person-hours; every sponsor integration real; graceful degradation if one fails). Include the "one image" a judge remembers and the one design signature that makes it unmistakably not AI-generated.
3. **Vote**: rank the other members' Round-0 ideas top-3 (not your own) and say which single idea you would build if yours were struck.
4. **Track position under the pre-build reality**: Continuity vs from-scratch, with reasoning.
Length 1,500–2,500 words. Be adversarial toward weak arguments, including your own.
