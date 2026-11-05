# ETHGlobal Mumbai 2026 — Sponsor & Prize Brief

> **Provenance note.** `ethglobal.com` is denied by this session's network policy, so this brief is reconstructed from search-engine snippets of the official page (`ethglobal.com/events/mumbai/prizes`, `/info/details`), the open-source "Backboard" toolbox repo built for this event (0xvikram/backboard-skills, generated 2026-10-19), and aggregators (hashtagweb3, ethstars, hacklist, blockcritics). Where sources conflict the official-page snippet wins and the conflict is noted. **Re-verify every amount and rule on the official page before submitting.**

## Event facts

| Item | Value |
|---|---|
| Dates | Hacking opens **Thu 5 Nov 2026, 21:00 IST**; hackathon 6–8 Nov; Pragma Mumbai summit 5 or 6 Nov |
| Venue | Jio World Convention Centre, Bandra Kurla Complex, Mumbai (co-located week with **Devcon 8, 3–6 Nov**) |
| Submission deadline | **Sun 8 Nov 2026, 09:00 IST** via Hacker Dashboard (one source says Sat 7 Nov 09:00 — assume the earlier to be safe) |
| Team size | Up to 5 |
| Entry tracks | **Classic "From Scratch"** (all work must begin after kickoff) or **Continuity** (extend an existing open-source project / ship a feature; judged on progress made during the window). Many partner prizes are *Continuity-only* — flagged below. |
| Partner prize cap | Select **up to 3 partner prize programs** at submission. Multiple tracks from one partner = 1 program. Arkiv's bonus explicitly "counts as one partner prize". |
| Finalist judging | Optional; live pitch **4 min demo + 3 min Q&A**; top-10 finalists. Finalist award at NY 2026 was ~$1,500 × team member (reference). |
| Rubric (5 categories) | **Technicality** (problem complexity, solution sophistication), **Originality**, **Practicality** (finished, working, usable by target audience now), **Usability** (UI/UX/DX), **WOW factor** |
| AI policy | "AI tools should assist, not create the entire project. Submissions relying entirely on AI without meaningful team contribution may be ineligible for partner prizes or finalist consideration." |
| Total pool | ~$150k–175k across 13 partners + finalist awards (aggregators cite $100k–$175k) |

## Partners at a glance

| Partner | Pool | Theme (partner's own words) | Chain / product to touch | From-scratch eligible? |
|---|---|---|---|---|
| Ethereum Foundation | $15,000 | Privacy: Anon-RPC, alt mempool, censorship-resistant apps | anon-rpc, alt mempool (EIP-8141 frame txs), PSE tooling | Yes (some prizes continuity-only; **one EF prize per project**) |
| Uniswap Foundation | $15,000 | Uniswap v4, hooks, Unichain, API, CCA | v4 hooks / Uniswap API / CCA | Yes ($10k) + $5k continuity |
| Hedera | $15,000 | x402 agent payments ($6.5k), Tokenize w/ Hedera Studios ($5k), No-Solidity SDKs ($2k), continuity | x402 endpoint on Hedera, Agent Kit / MCP, HCS-14 or ERC-8004, HTS/HCS | Yes |
| 0G | $15,000 | L1 for decentralised AI apps | 0G Compute (inference request id), Storage (root hash), Chain (contract) | Yes |
| Arc (Circle) | $15,000 | Apps built in **Arc Studio**: DeFi, payments, consumer agents | Arc testnet (chain 5042002, USDC gas), Arc Studio, Bridge Kit, USDC/EURC settlement | Yes |
| Arkiv | $15,000 | Web3 databases with queryable records | Arkiv testnet reads+writes, schema + feedback files in repo; +Swarm bonus | Yes |
| Whitechain | $15,000 | Tokenize (RWA flows) + Continuity | Whitechain Sepolia (chain 1874, WBT gas) | Yes ("Tokenize" $4k) |
| World | $12,500 | Proof of personhood & apps for verified humans | World ID **Agent Pass**, IDKit, (MiniKit) | Yes |
| ENS | $10,000 | Names for wallets, apps, anything onchain | ENS resolution, subnames, ENSv2, text records | Yes (breakdown unpublished at research time) |
| 1inch | $7,000 | Build an **Aqua** app: DeFi positions on Aqua + SwapVM | Official Aqua/SwapVM contracts, onchain token transfers in demo, real git history | Partly continuity-only (see below) |
| Chainlink | $5,000 | CRE workflows connecting chains to APIs, data, AI | CRE workflow (simulate via CLI ok), CCIP 2.0 for state change | Yes |
| Definitive | $5,000 | Flash API: advanced trade orders for social & agent apps | Flash API / Flash MCP advanced orders, onchain execution in demo, video on X tagging @DefinitiveFi | $3,500 open + $1,500 continuity |
| Shutter Network | ~$8,000 (proposed) | Encrypted mempool / commit-reveal, MEV protection | Shutter API | Forum proposal (1st $4k/2nd $2.5k/3rd $1.5k) — unconfirmed on official page |

## Partner detail

### Ethereum Foundation — $15,000
- **Best Use of Anon-RPC — $5,000.** Consume Anon-RPC in an app (private reads) and/or produce anonymity by running a new Anon-RPC worker.
- **Alt mempool / EIP-8141 frame transactions** — separate EF prize for "private sends, new tx shapes" (amount not surfaced).
- Remaining EF prizes likely continuity-only privacy categories (history: "Best Applications on General Privacy", "Client-Side Privacy", EIL SDK, Mopro, OneSec).
- Rule: **one EF prize per project**. EF tooling is optional for the general privacy category.
- Past EF winners: zkETHer, Wisk (New Delhi 2025), Open Paymaster/REIL (BA 2025, EIL SDK).

### Uniswap Foundation — $15,000
- **Build with Uniswap — $10,000** (from scratch). Any part of the stack: Uniswap API, AMM v2/v3/v4, CCA, new v4 hooks, extensions to official repos, ecosystem tooling. Deliverables: public open-source repo, **`FEEDBACK.md`**, completed **Uniswap Developer Feedback Form** linking to it.
- **Continuity — $5,000** (continuity-only, same scope).
- Historical track mix since 2025: Best Uniswap API Integration (12 wins), Best Uniswap Stack Contribution (11), v4 hooks (stable/volatile/privacy/agentic). Finalists who also won Uniswap: UniPerp (perp DEX as v4 hook, New Delhi), ALMA (LP agent, Cannes 26), KOLlateral (Lisbon 26), lpTOKEN.fun, TARE, Otter (MEV-resilient AMM hook), ClosingBell-Hook (tokenized-stock fee hook with Chainlink feed).
- Unichain Sepolia chain 1301.

### Hedera — $15,000 (confirmed breakdown)
- **AI Agents That Pay: x402 on Hedera — $6,500** (split reported $3,000 / $2,000 / $1,500). Requirements: ≥1 x402-protected endpoint settling on Hedera testnet/mainnet (facilitator: official x402, Ax402, Blocky402, or self-run); agent identity/reputation via **HCS-14 or ERC-8004**; use **Hedera Agent Kit** or **Hedera Network MCP**. Suggested: pay-per-call AI/data APIs, agent marketplaces where agents pay each other, open-source Hedera x402 facilitator.
- **Tokenize Anything with Hedera Studios — $5,000.**
- **"No Solidity Allowed": build with Hedera SDKs (HTS/HCS/Schedule Service) — $2,000.**
- **Continuity — ~$1,500**: move an existing Hedera project forward significantly.
- Hedera Testnet chain 296, 18-dec over JSON-RPC vs 8-dec native; ECDSA accounts; HTS association required before receiving a token.
- Past Hedera winners that were also finalists: NoNet (offline tx, New Delhi), DIVE (Cannes 26), Glassbox402 (x402 analytics, Lisbon 26), Accrue (NY 26), conduct.chat (Prague).

### 0G — $15,000
- **Build with 0G / "Build with iAI" — $5,000**, **Physical AI: Agents with a Body — $5,000**, **Wildcard: weirdest thing on 0G — $2,000**, **Keep Building on 0G — $3,000 (continuity)**. (Track names from hacklist; official snippet confirms a $5k "Build with 0G".)
- Requirements: public repo; demo video < 3 min; **real 0G usage artifact** (Compute request id / Storage root hash / 0G Chain contract address from this hackathon); dated changelog of work in window; "one sentence on what breaks if 0G is removed"; safe-stop fallback if 0G unreachable. 0G shares compute credits. Prizes at 0G's discretion.
- 0G Galileo testnet chain **16602** (`zeroGTestnet` in viem; older exports deprecated), Cancun EVM, faucet 0.1/day.
- Past 0G finalist overlap: PrivyCycle, DIVE, Hands Unchained, KOLlateral, Lortnoc Tahc, Happy Hour, LPlens.

### Arc (Circle) — $15,000
- Five prizes × **$3,000**, all requiring **Arc Studio** as the starting point: (1) Best DeFi/Onchain Finance App built end-to-end in Arc Studio (must settle in USDC or EURC); (2) Best Smart Contracts with Advanced Stablecoin Logic; (3) Best Use of **Bridge Kit** for non-USDC assets; (4) Mobile-web **consumer agent using the marketplace discovery API**; (5) Continuity: bring your project to Arc.
- Arc testnet chain 5042002, gas in USDC (18-dec native vs 6-dec token), min 20 gwei, PREVRANDAO=0.
- Historical Arc track themes: chain-abstracted USDC apps, multichain USDC payments, prediction markets w/ real-world signal, nanopayments, Circle Agent Stack, CCTP v2 hooks. Finalist overlap: VEIL VPN (nanopayments 1st), Cumulant (structured products on prediction markets), OpenBook (data marketplace for agents), Mars, Vouch DeFi.

### Arkiv — $15,000
- Tracks (hacklist): **Mirror — $4,000**, **Build on Arkiv from scratch — $4,000** (GitHub issue says $3k/$1k split), **Node tooling — $2,000**, **Continuity existing projects — $4,000**, **Arkiv + Swarm bonus — $500 × 2** (from-scratch and existing; official).
- Requirements: must actually **read** from Arkiv (SDK installed but unused doesn't count); write to Arkiv testnet; include **schema file + feedback file** in repo; Swarm bonus needs a repo file explaining what each platform stores, an Arkiv entity key and the Swarm reference it points to. One Arkiv track prize per team + bonus on top. Counts as one partner pick.
- No prior ETHGlobal history (new sponsor) → lower competition, judges hungry for a flagship integration.

### Whitechain — $15,000
- **Tokenize — $4,000** (RWA flows), **Continuity — $3,000** (bring existing product), plus 1st $1,500 / 2nd $1,500 continuity-only items; hacklist lists four prizes total on Whitechain Sepolia.
- Everything on **Whitechain Sepolia (chain 1874, WBT gas, test USDT)**; mainnet OP-Stack L2 not live. Faucet needs 30-day-old GitHub account and is IP-limited: **claim before the event**.
- New sponsor, no history → low competition.

### World — $12,500
- **World ID Agent Pass — $5,000** (build an application on Agent Pass), **World ID Agent Pass integration — $2,500**, **Best Use of IDKit — $2,500** (IDKit in a working app/mini app/onchain flow; verify ≥1 supported credential server-side or onchain), **[Cont] Best IDKit Use Case — $2,500** (continuity: real trust decision e.g. gating).
- Historical: World Pool Prize (102 awards!), Best Mini App (15), AgentKit tracks. Finalist overlap: Dark Factory, Wrld Map, ChromaMind, OnlyDanks, Aqua0, Halo, VEIL VPN, DIVE (Minikit 1st), Void Tactics, Distro, Hands Unchained, Novi Corpus.
- World Chain Sepolia chain 4801.

### ENS — $10,000
- Breakdown not published at research time. Pattern at sibling 2026 events: **Most Creative Use of ENS ($6k) + Best ENS Integration for AI Agents ($4k)** (Cannes 26); **Integrate ENS pool ($3.5k)** (HackMoney 26); ENSv2 tracks (Tokyo/ETHOnline 26).
- ENS is the single most-awarded sponsor in the dataset (243 prize rows since 2025; "Integrate ENS" pool paid 183 times) → cheap to qualify, but meaningful use (subnames, text records as data layer, agent identity) is what wins top placements.
- Finalist overlap: Magnee, claw2claw, BorrowBot, Oikonomos (HackMoney 26), VEIL VPN, npmguard, Immunity, Proof of Scan, UNSU, calendefi, POAPrivacy.

### 1inch — $7,000
- **Build an Aqua App — 1st $1,500 / 2nd $500 (continuity-only)**: "custom Aqua app implementing a sophisticated DeFi position". Remaining ~$5k presumably open "Build an Aqua App" tiers. Requirements: official Aqua/SwapVM contracts, onchain token transfers in final demo, proper git history.
- Historical finalists w/ 1inch: ArcBook (Aqua 1st, Lisbon 26), Aqua0 (BA), Hashlocked, zkFusion, 1Option, EthereumFighter.

### Chainlink — $5,000
- **Best use of Chainlink CCIP 2.0 — $3,500**; **Best workflow with CRE — $1,500** (build/simulate/deploy a CRE workflow as orchestration layer; CRE CLI simulation suffices).
- Core rule: project must use Chainlink to make a **state change** onchain; a front end merely reading Data Feeds doesn't count.
- Finalist overlap: ENShell (CRE), BMCP (CRE + CCIP), Canary (prediction-market insurance), Immunity, Vouch DeFi, Swap Pay, PrivacyLinks.

### Definitive — $5,000
- **$3,500 main + $1,500 continuity**: working trading flow through **Flash API or Flash MCP advanced orders**, onchain execution in the final demo, short product video posted on Discord and X tagging @DefinitiveFi. Theme: social trading / agent trading apps.
- New sponsor, no history.

### Shutter Network — proposed
- Forum proposal ("Melee 2 slate"): Build with Shutter track at Mumbai, 1st $4,000 / 2nd $2,500 / 3rd $1,500. Not confirmed on official page. Theme: encrypted mempool, commit-reveal, MEV protection, sealed-bid auctions.

## Strategic read (for the committee)

1. **Finalist + 3 sponsors is the money.** NY 2026 top earner stacked Sui + ENS + finalist ($7.6k); Mars stacked Arc + Hedera + World ($6.75k) without being a finalist. Three $15k-pool sponsors with *few* historical entrants (Arkiv, Whitechain, 0G, Arc Studio, Hedera x402) are where expected value per hour is highest.
2. **New sponsors = soft competition.** Arkiv, Whitechain, Definitive have zero ETHGlobal history; Arc Studio and Hedera x402 are new product pushes. Their judges want a flagship showcase.
3. **Deep integration beats token use.** Every multi-prize finalist in 2026 (VEIL VPN, DIVE, KOLlateral, Hands Unchained, ArcBook) made each sponsor product load-bearing, not decorative.
4. **Agent payments (x402 / ERC-8004), prediction-market infra, privacy, and consumer verified-human apps** are the recurring 2026 finalist themes. Hedera, Arc, 0G, World, ENS all explicitly want agent-economy builds this event.
5. **Submission hygiene matters:** FEEDBACK.md (Uniswap), schema+feedback files (Arkiv), changelog + "what breaks without 0G" (0G), <3-min video (0G), X post tagging sponsor (Definitive), real git history (1inch), live x402 endpoint (Hedera).
6. **Hard constraints:** from-scratch work starts 5 Nov 21:00 IST; AI-only builds are ineligible; many prizes are continuity-only (1inch top tier, EF partial, World [Cont], Whitechain partial, Arc #5, Uniswap $5k, 0G $3k, Arkiv $4k, Definitive $1.5k).
