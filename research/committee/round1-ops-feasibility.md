# Round 1 — Member #9, Ops / 48-Hour Feasibility

**Lens.** Can ≤5 humans plus an AI pair-programmer ship each idea live and demoable by Sun 8 Nov 09:00 IST with every claimed sponsor integration real? Window: Thu 21:00 → Sun 09:00 = 60 clock hours ≈ 36 build hours. I plan on **~125 productive person-hours (ph)** (5 × 25 h after sleep, Devcon/Pragma overlap, Dhanteras traffic, merges) and refuse any plan above **~85 ph**, because first contact with live sponsor APIs costs 2–3 h per rail that nobody budgets.

**Two shaping constraints.** (1) The orchestrator's sandbox blocks every testnet RPC and sponsor API (`docs/ENVIRONMENT-CONSTRAINTS.md`), so anything pre-built runs on Anvil with fixture transports; *all* live wiring, deploys, hardware and sponsor handshakes happen on-site, inside my "sponsor wiring" column. (2) From-scratch rules forbid project code before kickoff and AI-only builds are ineligible — humans must author the core contracts/hooks and the commit history must show it.

## 0. Verified facts (8 searches, 2 Nov) that change feasibility

| Dependency | Finding | Ideas hit | Ops consequence |
|---|---|---|---|
| **Arkiv SDK** | TS `@arkiv-network/sdk` v0.6.0 on Kaolin testnet (chain 60138453025); `createEntity({payload, contentType, attributes})` with `expiresIn`; writes need faucet test ETH; Python SDK lags on another testnet ([docs](https://arkiv.dev.golem.network/docs/sdk)) | 7 ideas | Proposals' `btl/annotations` shape is stale: 1–2 h rework, TS only; claim Kaolin ETH before kickoff |
| **Arc Studio** | Circle's *AI coding agent* generating frontend/backend/Solidity and deploying to Arc testnet; all five Arc prizes require starting there ([explainer](https://www.kucoin.com/blog/arc-studio-explained-how-circle-s-ai-coding-agent-builds-onchain-apps-and-smart-contracts)) | 6 ideas | Kickoff hours 0–2 go to generating the base in Studio, then importing our harness; its output is AI code, so humans must visibly rewrite the core |
| **World "Agent Pass"** | No official docs found; the official product is **AgentKit**, *limited beta* for verified-World-ID developers (`agentkit.fetch` + `@x402/hono`) ([World docs](https://docsearch.algolia.com/mcp/docs/website/docs.world.org), [Cointelegraph](https://cointelegraph.com/news/world-launches-agentkit-coinbase-integration-enable-human-verified-ai-agents-embargo)); Orb paused in India | 9 ideas | Treat Agent Pass tracks as speculative; bank **IDKit**; judges cannot verify live → pre-verified team phones + simulator |
| **Hedera x402** | x402.org public facilitator advertises `hedera:testnet`; Blocky402 testnet; `hedera-dev/x402-hedera` alpha with hosted facilitator; USDC testnet 0.0.429274; faucets at portal.hedera.com and faucet.circle.com ([Hedera docs](https://docs.hedera.com/solutions/ai/x402/facilitators)) | Boli, Octroi, Recharge | Lowest-risk rail in the set: 6–10 ph, self-run `/verify`+`/settle` as fallback |
| **Definitive Flash** | Beta; self-serve integrator key; 11 EVM **mainnets** + Solana; **no testnet found** ([Flash docs](https://flash.definitive.fi/docs), [EVM overview](https://flash.definitive.fi/docs/evm-overview)) | CallSheet, Gavel | Real money on Base; exits live on a different chain from the Sepolia entry |
| **0G Compute** | TEE providers serving **chat LLMs** with signed responses; latency claims conflict (50–100 ms vs "varies"); faucet 0.1 OG/day ([overview](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/overview), [SDK](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/sdk)) | Boli, Kilowatt | No ASR on the marketplace: Boli's "TEE Whisper" is impossible as written; pre-claim OG daily; safe-stop mandatory |
| **Anon-RPC** | Draft 0.3.2 *wallet/web-app* standard: hash-pinned client in a sandboxed Web Worker, on-chain specifier; the reference worker is plain `fetch`, anonymity comes from a mixnet/onion transport ([spec](https://ethereum.github.io/anon-rpc/spec/), [networks](https://ethereum.github.io/anon-rpc/networks/)) | Dhwani (Gavel swap) | Browser-only; a Pi cannot consume it natively; "run a worker" = build an anonymizing transport, 8–12 ph, EF criteria unpublished |
| **Uniswap CCA** | Repo `Uniswap/continuous-clearing-auction`; contracts live on Ethereum/Unichain/Arbitrum/Base mainnets; **no Unichain Sepolia deployment confirmed**; seeds a v4 pool at final price ([Uniswap blog](https://blog.uniswap.org/token-auctions-are-coming-to-the-uniswap-web-app), [docs](https://docs.uniswap.org/contracts/liquidity-launchpad/CCA)) | Nilami, Gavel | Self-deploy from repo (+3–4 ph); hook-compatible migration unverified |

Knowledge-based, not searched: ggwave runs 8–16 B/s audible (103 B ≈ 7–13 s) and its Python bindings are fine on a Pi Zero 2 W; buy a ReSpeaker 2-Mics HAT, not loose I2S parts; hardware must be in hand by Wed because Dhanteras (Fri) and Diwali (Sun) kill couriers and Lamington Road. eSIM resellers: eSIM Access self-serve (1–3 business days), eSIM Go (business approval), Airalo Partners (weeks).

## 1. Work breakdown (person-hours; critical path in wall-clock hours)

| Idea | Contracts | Backend/agents | Frontend | Sponsor wiring | Hardware/physical | Demo prep | **Total** | Critical path | Team |
|---|---|---|---|---|---|---|---|---|---|
| Dhwani | 4 | 18 | 18 | 21 | 14 | 10 | **85** | 28 h: audio chain → ggwave decode → 3009 relay → voice | 5, one embedded/audio |
| Boli | 3 | 26 | 12 | 26 | 0 | 10 | **77** | 24 h: 0G ledger/compute → grading → x402 loop | 5 |
| Bhishi | 16 | 10 | 14 | 14 | 0 | 10 | **64** | 20 h: contract+tests → PWA → 5-phone rehearsal | 4 |
| CallSheet | 20 | 22 | 8 | 19 | 0 | 10 | **79** | 28 h: hook + vaults + batch executor, then mainnet exits | 5, two Solidity |
| Nilami | 29 | 12 | 16 | 17 | 0 | 10 | **84** | 30 h: CCA deploy → hook → migration → reveal | 5, two Solidity |
| Asli | 10 | 14 | 14 | 17 | 0 | 10 | **65** | 18 h: escrow → verifier → Arkiv | 4 |
| Octroi | 1 | 28 | 12 | 22 | 0 | 10 | **73** | 20 h: 402→pay→200 on Hedera → quota ledger | 4 |
| Gavel | 7 | 26 | 16 | 20 | 0 | 10 | **79** | 24 h: indexer → Arkiv bulk ingest → agent | 5 |
| Kilowatt | 24 | 22 | 16 | 23 | 8 | 10 | **103** | 32 h: three chains + 0G + relay + lock | 5, zero slack |
| Recharge | 8 | 24 | 12 | 23 | 6 | 10 | **83** | 22 h software, plus external reseller days | 5 |
| Challan | 20 | 12 | 12 | 17 | 0 | 10 | **71** | 22 h: hook + accumulator tests → ledger → certificate | 4 |
| Udhaar | 12 | 16 | 14 | 19 | 4 | 10 | **75** | 22 h: escrow → settler flow → CRE | 4–5 |

**Pre-build policy (all twelve).** Legitimate before kickoff: a brand-neutral design system; a Foundry monorepo with Anvil harness, chain-agnostic deploy scripts and `chains.json`; a generic adapter interface with fixture transports (no sponsor semantics); CI; README/video/hygiene templates (FEEDBACK.md, `arkiv.schema.json`, CHANGELOG skeletons); and all non-code work — accounts, faucets (Whitechain needs a 30-day GitHub; 0G is 0.1/day; Kaolin ETH; Hedera ECDSA accounts with USDC association; Arc USDC; World dev-portal app+action), hardware with stock OS images, LOIs, legal memos, SDK reading. Must wait for Thu 21:00: every contract, hook, bot, agent, PWA, sponsor adapter with product semantics, and the Arc Studio project itself. Disclose pre-installed libraries in the README.

**Mandatory handshake sprint.** Thu 21:00–Fri 02:00: each sponsor rail does one real round-trip (an Arkiv entity, a 402→pay→200, an Arc deploy, a 0G request id, an IDKit verify) before any product code. A rail that fails by **Fri 06:00** is swapped per the fallbacks below. This is the biggest P(ship) lever for every idea.

## 2. Per-idea assessment

**Dhwani.** *Deps:* Pi + audio HAT in hand by Wed (P fail 0.30 → laptop/Pi 4 or phone-as-box); EIP-3009 on Arc USDC (0.35 → ERC-2612 permit + our router, still USDC-gas relay); Anon-RPC judged real (0.45 → ENS subnames/text records, 3 h). *Mocks:* INR rate, embedded-key PWA, single box, pre-rendered TTS, chirp in video if the hall is loud. The mock a judge catches: an Anon-RPC "worker" that is a plain fetch proxy — the EF authors of the spec will see it instantly. *P(all 3 real) 0.30; partial 0.80; **0.50 if ENS replaces Anon-RPC at the Fri 06:00 gate**.* Online mode on real hardware is a 0.9 build; the chirp is the bonus, never the dependency.
- Q-OPS-DHWANI-1: Does Arc USDC's ERC-20 interface expose `transferWithAuthorization` on 5042002? If not, is permit+router acceptable to the proposer?
- Q-OPS-DHWANI-2: Anon-RPC is a browser-worker standard — which component consumes it (the Pi cannot), and is a self-run relay honestly "producing anonymity"?
- Q-OPS-DHWANI-3: Who has shipped ALSA/I2S audio on a Pi before, and what is the Plan-B box if the HAT fails?

**Boli.** *Deps:* 0G Compute serves LLMs only (P "TEE ASR" fails 0.90 → honest redesign: local Whisper, 0G LLM grades transcript-vs-prompt and signs the certificate; 0G call fails altogether 0.30 → Storage root + safe-stop); Hedera testnet facilitator (0.20 → self-run); Agent Pass access (0.60 → IDKit only). *Mocks:* Whisper-small, heuristic anti-spoof, scripted buyer. Catchable: a README claiming "TEE ASR" when the code shows an LLM grader — say it plainly instead. *P 0.40; partial 0.85.*
- Q-OPS-BOLI-1: Where does Whisper actually run, and is "0G LLM grades the local transcript" acceptable as the load-bearing 0G use?
- Q-OPS-BOLI-2: Which World product is "Agent Pass" in docs today? If only AgentKit beta exists by Thursday, do we submit IDKit?
- Q-OPS-BOLI-3: How many OG tokens does ~200 grading calls need, and has daily faucet claiming started?

**Bhishi.** *Deps:* Arc testnet/faucet amounts (0.15 → Base Sepolia, lose Arc); judges verifying World ID live in India (0.50 → pre-verified team phones + simulator); Arkiv API drift (0.15). *Mocks:* compressed cycle, seeded slot buyer, staging World — all acceptable if one real verification log exists. *P 0.60; partial 0.92.* One well-tested contract plus three mature-ish rails; the lowest-variance build on the list.
- Q-OPS-BHISHI-1: Can any judge World-verify live in India? If not, is team-verified + simulator acceptable to the proposer?
- Q-OPS-BHISHI-2: Who owns the 21:00 "start in Arc Studio, then import our Foundry layout" step, and does Studio's scaffold constrain it?

**CallSheet.** *Deps:* Definitive mainnet-only beta (0.90 no testnet; eligibility ambiguity 0.40) — exits on Base from EOAs while entries and vaults live on Unichain Sepolia; Shutter unconfirmed (0.10, drand tlock is fine); Agent Pass (0.60 → IDKit). *Mocks:* scripted callers, perf-fee accounting, and the cross-chain disjoint — the Definitive judge accepts it; a finalist judge asks why the stop order protects money on another chain. *P 0.35; partial 0.75.*
- Q-OPS-CALLSHEET-1: How do Unichain Sepolia vault funds get Flash exit orders on Base mainnet without a bridge — or are we accepting two disjoint demos?
- Q-OPS-CALLSHEET-2: Mainnet budget ($100?) for real fills and gas, and who holds that key?
- Q-OPS-CALLSHEET-3: If Definitive is Continuity-only, is the third sponsor Shutter (unconfirmed) or ENS?

**Nilami.** *Deps:* CCA self-deploy plus migration into a *hooked* v4 pool (0.40 → own uniform-price auction, losing the CCA story); 20 World-verified audience phones in India (0.60 → team phones); Arkiv (0.15). *Mocks:* compressed dividend, commit-reveal not Shutter, scripted bidders. Catchable: the Uniswap judge checking whether the auction is actually Uniswap's CCA. Sealed bids also fight CCA's design, which is continuous public clearing. *P 0.30; partial 0.75.*
- Q-OPS-NILAMI-1: Does the CCA migrator accept a custom hook address, or does it seed a hookless pool — has anyone read the migrator code?
- Q-OPS-NILAMI-2: How do commit-reveal bids reconcile with per-block clearing without rewriting CCA?

**Asli.** *Deps:* World verification in India (0.50 → team accounts/simulator); Arc testnet + Studio (0.15); Arkiv (0.15); reading Whitechain Sepolia for the action (0.10). *Mocks:* off-chain actions, fraud scoring, invoicing — none load-bearing. *P 0.60; partial 0.90.* The easiest build here.
- Q-OPS-ASLI-1: Is anyone talking to Arkiv/Whitechain devrel today for the LOI, and does the demo target *their* testnet?
- Q-OPS-ASLI-2: Arkiv entity vs onchain nullifier registry — which is source of truth, and how do we avoid a dual-write mismatch on stage?

**Octroi.** *Deps:* Hedera facilitator (0.20 → self-run, explicitly allowed); Agent Pass (0.60 → IDKit); Arkiv read latency/rate limits on a per-request lookup (0.35 → write-through plus cached reads). *Mocks:* self-hosted facilitator, scripted 500-agent farm — both honest. *P 0.55; partial 0.90.* Zero Solidity also qualifies the No-Solidity $2k.
- Q-OPS-OCTROI-1: Measured Kaolin query latency for attribute filters — is a per-request read viable, and does a cached read still count as "reading from Arkiv"?
- Q-OPS-OCTROI-2: If only AgentKit beta exists, which World track is the submission?

**Gavel.** *Deps:* Definitive mainnet-only/eligibility (0.45 → Anon-RPC swap, itself risky, or ENS); Arkiv bulk-write throughput and test-ETH cost for thousands of entities (0.35 → aggregates only); archive RPC limits for historical CCAs (0.25 → index three auctions). *Mocks:* fee accounting, partial backfill, a simple policy "agent", and the same Sepolia-bid/Base-exit disjoint as CallSheet. *P 0.35; partial 0.75.*
- Q-OPS-GAVEL-1: Which auctions, which archive RPC, and what does the entity count cost in Kaolin ETH?
- Q-OPS-GAVEL-2: Is there any token the agent can both buy in a live CCA and exit through Flash in one demo?

**Kilowatt.** *Deps:* Whitechain Sepolia infra — faucet gate, RPC stability, no 4337 bundler (0.30 → EIP-2771 relayer as "gasless"); 0G on Galileo (0.30 → safe-stop); ESP32 lock hardware by Wed (0.35 → screen simulation, WOW gone); Bridge Kit (0.30 → faucet USDC). *Mocks:* KYC, telemetry (a simulator by construction), SPV. 0G and Whitechain judges will accept it; finalist judges see three chains and fake telemetry. *P 0.30; partial 0.65.*
- Q-OPS-KILOWATT-1: Which chain is cut if we are behind at Sat 09:00?
- Q-OPS-KILOWATT-2: Is any 4337 bundler/paymaster live on Whitechain Sepolia, or is "gasless" a 2771 relayer?

**Recharge.** *Deps:* reseller API approval by Thu (0.50 → pre-bought inventory; x402 still gates QR release, so the mock is honest); Arc "marketplace discovery API" (unverified product, 0.50 → Advanced Stablecoin Logic via the pool contract); Agent Pass (0.60 → IDKit); live eSIM activation on stage (0.30 → second phone pre-installed). *Mocks:* usage telemetry, fulfilment source, minimal HCS-14. Hedera and World judges will not care about the reseller; a finalist judge will ask "is provisioning real?" *P 0.40; partial 0.85.*
- Q-OPS-RECHARGE-1: Which reseller account was opened today, with what ETA and India wholesale price?
- Q-OPS-RECHARGE-2: What exactly is Arc's "marketplace discovery API"? If unverifiable by Tue, which Arc prize?
- Q-OPS-RECHARGE-3: Does pre-buying 30 India eSIM profiles count as project work under from-scratch rules? (I say inventory is not code — disclose it.)

**Challan.** *Deps:* v4 PoolManager on Unichain Sepolia with our own pool (0.10); a World nationality/residency credential reachable from IDKit (0.70 → labelled self-attestation); Arkiv (0.15), Swarm bonus gateway access (0.40). *Mocks:* residency self-attested, INR rate, the government deposit leg. Catchable: the World judge sees the "Indian" gate is a checkbox — the central claim is mocked unless the credential exists. *P 0.55; partial 0.90.*
- Q-OPS-CHALLAN-1: Does World ID 4.0 expose a residency credential to IDKit today? If not, is a self-attestation still a "real trust decision"?
- Q-OPS-CHALLAN-2: Where does the swap-time INR/USD rate come from on Unichain Sepolia — a signed operator rate?

**Udhaar.** *Deps:* Chainlink CRE writing to Arc testnet (0.50 → write to Sepolia and relay; CLI simulation is explicitly allowed); World (0.50 → staging); a human settler paying real ₹ on stage over venue connectivity (0.20 → pre-recorded clip). *Mocks:* manual disputes, API rate inside the CRE run. *P 0.50; partial 0.90.*
- Q-OPS-UDHAAR-1: Does CRE support Arc testnet (5042002) as a write target? If not, where does the state change land, and does it still gate netting?
- Q-OPS-UDHAAR-2: What is the fallback when UPI or venue Wi-Fi is down during the live settler payment?

## 3. Chair's cross-cutting questions

**(A) From-scratch vs Continuity — delivery risk.** Continuity would triple effective hours and remove the Definitive/World eligibility ambiguity — a huge risk reduction on paper. In practice it is unavailable: none of the twelve has a pre-existing open-source base, a repo created this week is fake continuity, and the sandbox cannot touch testnets anyway, so live wiring stays in the window whatever the track. **From-scratch**, with risk moved out of the window legitimately (accounts, faucets, hardware, generic templates, SDK study, LOIs, legal memos), then the Thu-night handshake sprint and the Fri 06:00 swap gate. The AI pair-programmer does tests, boilerplate, fixtures and docs; humans author the contract/hook and the commits show it, with an AI-use statement in the README.

**(B) Graceful degradation when one sponsor fails on-site.** Graceful: **Octroi** (Arkiv → cache, Agent Pass → IDKit, facilitator → self-run; product still works), **Bhishi**, **Asli**, **Challan**, **Udhaar** (each loses a ledger or a credential, keeps the money loop), **Boli** (0G safe-stop is required by the rules, so it is built in). Medium: **Dhwani** (Anon-RPC → ENS in 3 h; hardware failure degrades to phone-as-box), **Recharge** (reseller → inventory). Poor: **CallSheet/Gavel** (no Definitive means naive exits and a Sepolia-only demo), **Nilami** (CCA failure means rewriting the auction), **Kilowatt** (any one of three chains breaks the lifecycle).

**(C) Five-person split for my top idea, Bhishi.** (1) Contracts lead — human-authored `Bhishi.sol`, Foundry tests, Arc USDC decimal/gas quirks, deploy. (2) Integrations — Arc Studio start at 21:00, Arkiv writes/queries plus schema and feedback files, IDKit cloud verification and the EIP-712 attestation signer; owns the Fri 06:00 gate. (3) Frontend/mobile — PWA, five-phone flow, live bid ticker, Bhishi Rate. (4) Backend/indexer — event listener → Arkiv entities, cycle cron, rate index, demo seeding scripts, fallback DB. (5) Producer — README section per sponsor, sub-3-minute video, rehearsal, judge-phone logistics, timekeeping, and the pitch. Dhwani variant: swap the backend role for an embedded/audio engineer who owns the Pi from Wednesday, and give Integrations the Anon-RPC-vs-ENS decision.

## 4. Ranking by P(ship)

| # | Idea | P(all 3 real & demoable) | P(convincing partial) | ph |
|---|---|---|---|---|
| 1 | Bhishi | 0.60 | 0.92 | 64 |
| 2 | Asli | 0.60 | 0.90 | 65 |
| 3 | Octroi | 0.55 | 0.90 | 73 |
| 4 | Challan | 0.55 | 0.90 | 71 |
| 5 | Udhaar | 0.50 | 0.90 | 75 |
| 6 | Boli (with the 0G redesign) | 0.40 | 0.85 | 77 |
| 7 | Recharge (reseller by Tue) | 0.40 | 0.85 | 83 |
| 8 | CallSheet | 0.35 | 0.75 | 79 |
| 9 | Gavel | 0.35 | 0.75 | 79 |
| 10 | Dhwani (0.50 with ENS as third sponsor) | 0.30 | 0.80 | 85 |
| 11 | Nilami | 0.30 | 0.75 | 84 |
| 12 | Kilowatt | 0.30 | 0.65 | 103 |

Ops note: Dhwani is the only idea whose rank moves materially with one pre-kickoff decision. If the committee wants its WOW, buy the hardware Wednesday, plan ENS as the third sponsor and treat Anon-RPC as a Friday-morning upgrade — that is a 0.50 project, not a 0.30 one.

## 5. KILL LIST

- **Kilowatt** — 103 ph across three chains, 0G and hardware against 125 available: no slack for a single failed handshake.
- **Nilami** — the whole pitch rests on an unverified CCA-to-hooked-pool migration and sealed bids that contradict CCA's continuous clearing.
- **Gavel** — Definitive has no testnet, so the agent's exit happens on Base mainnet for a token it never bought in the Sepolia auction; an indexer demo with a split-brain story.
- **CallSheet** — the same mainnet-only Definitive disjoint, stacked on a hook plus session-key vaults plus a Telegram bot in 28 wall-clock hours, with the sponsor's from-scratch eligibility still disputed.
