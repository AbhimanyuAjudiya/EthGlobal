# Round 2 — Member #2, Operator / Revenue

Round 1 was right about Nilami (withdrawn), right about CallSheet's venue and custody, and right that Asli has no finalist image (parked as a sales motion, not a build). My single v2 is CallSheet re-venued onto the one fee instrument the research proves for small teams: **Lifafa** — sealed, paywalled trading calls on Hyperliquid perps, paid through builder codes, bought by humans and AI agents, with no custody of anyone's funds. Three searches used; other figures are from `ideation.md` §1.2 and Round-1 facts.

## 1. Answers to every numbered question

### CallSheet
- **Q-SEC-CallSheet-1** — CONCEDE. "Nobody can trade ahead" is withdrawn. v2 defuses the insider by venue, not cryptography: calls are allowed only on Hyperliquid perps with deep books (BTC, ETH, SOL, HYPE, HIP-3 majors), where 300 followers' flow does not move price, so pre-positioning earns the caller nothing; the caller's own fill must land within 60 s of the commit (HL fills are public per address) or the call is unscored. Sealing is a commitment plus a paywall.
- **Q-SEC-CallSheet-2** — CONCEDE custody; scope rewritten. No vaults, no router session keys. Default is one-tap: the follower signs the order in their own wallet. Auto-mirror uses a Hyperliquid API ("agent") wallet on a dedicated sub-account: agents can trade but cannot withdraw or move funds to L1 ([Chainstack](https://docs.chainstack.com/docs/hyperliquid-authentication-guide), [Privy](https://docs.privy.io/recipes/hyperliquid-guide)); builder-fee approval is signed only by the master key. Blast radius of a stolen key = that sub-account's margin, never a withdrawal; keys per follower in KMS, revocable on HL in one action.
- **Q-SEC-CallSheet-3** — $0. Demo on HL testnet and Hedera testnet; if testnet builder approval fails, ≤$50 on a key generated on-site and burned afterwards.
- **Q-VC-CallSheet-1** — CONCEDE: >80% of signal-group calls are perps on CEXs or HL. The day-30 product is v2 itself (HL perps, HIP-3 RWA perps; HIP-4 outcome markets for non-Indians).
- **Q-VC-CallSheet-2** — CONCEDE the 0.75%. Fee is a builder code ≤10 bps (5 bps for World-verified humans). Against HL vaults (pooled custody, lock-ups, 10% profit share) Lifafa is per-call opt-in inside your own account from a venue-verified caller; against Bybit copy-trading, no custody and no spread.
- **Q-VC-CallSheet-3** — CONCEDE: no names; I will not put private individuals in a committee file. Commitment: three LOIs (Dubai/SEA HL-perps groups, 3–10k members, $50–100/mo VIP) before 5 Nov 21:00, else DECISION.md downgrades the revenue thesis to "prize play".
- **Q-JUDGE-CALLSHEET-1** — One venue: entry, exits and PnL all on Hyperliquid; one screen, the lifafa card with HL fill ids.
- **Q-JUDGE-CALLSHEET-2** — Liquid universe, caller's fill inside the envelope, venue-verified PnL (SEC-1).
- **Q-JUDGE-CALLSHEET-3** — At 0:00 a real Diwali shagun envelope with the commitment hash printed on it is handed to a judge; the screen shows the same hash on a redacted card.
- **Q-USER-CALLSHEET-1** — USDC lives in the follower's own HL account; the whole loop runs on one venue; onboarding is connect wallet + one `approveBuilderFee` signature (3 taps); HL testnet for the demo, $5 mainnet positions for the hacker group.
- **Q-USER-CALLSHEET-2** — BTC and ETH perps with billion-dollar books; no Unichain pool.
- **Q-OPS-CALLSHEET-1** — The disjoint is gone: Definitive dropped, everything on HL.
- **Q-OPS-CALLSHEET-2** — $0 on testnet; optional ≤$50 mainnet on an on-site key held by the integrations lead.
- **Q-OPS-CALLSHEET-3** — Third sponsor is Arkiv; Definitive and Uniswap are out; Shutter uncounted.

### Nilami (withdrawn)
- **Q-SEC-Nilami-1** — CONCEDE: at $0.50 per ID "fair" is a price, and a fee dividend to bidders is a profit share.
- **Q-SEC-Nilami-2** — Wrapper, but sealed bids contradict CCA's continuous clearing. Conceded.
- **Q-VC-Nilami-1** — Re-run: Clanker's October revenue ≈ $0.19M/month ≈ $44k/week for all of Clanker at 1%; a 10% share at our 20 bps ≈ $900/week. Conceded.
- **Q-VC-Nilami-2** — None. Conceded.
- **Q-JUDGE-NILAMI-1** — No confirmed Unichain Sepolia CCA; a fork forfeits the Uniswap story. Conceded.
- **Q-JUDGE-NILAMI-2** — Only the CCA and the dividend differ from Proof-of-Human Drops. Conceded.
- **Q-USER-NILAMI-1** — No reason; the Auctions tab is two taps. Conceded.
- **Q-USER-NILAMI-2** — They forfeit. Conceded.
- **Q-OPS-NILAMI-1** — Unverified; nobody read the migrator. Conceded.
- **Q-OPS-NILAMI-2** — They do not reconcile without rewriting CCA. Conceded.

### Asli (parked as a sales motion: verified-deploy campaigns sold to sponsors in the hall)
- **Q-SEC-Asli-1** — CONCEDE: a rented human is a valid conversion. Price by credential tier (Orb > Document > Device) and by action cost (a contract deploy costs a farm more than a click); claim "cheaper fraud", never "no fraud".
- **Q-SEC-Asli-2** — Release key becomes a 2-of-3 multisig with per-campaign caps and a 24 h timelock; compromise is bounded to one campaign's remaining escrow.
- **Q-VC-Asli-1** — CONCEDE: refund-by-default and a public ledger are increments; paying per developer action is the only differentiator, and it is not a moat.
- **Q-VC-Asli-2** — The ~3k Indian hackers in the hall; Orb-level ≈ 0% of Indians, roughly half of foreign attendees.
- **Q-VC-Asli-3** — Cannot name one. Conceded.
- **Q-JUDGE-ASLI-1** — Nothing. Conceded; hence not my v2.
- **Q-JUDGE-ASLI-2** — No; sell "verified-tier humans". Conceded.
- **Q-USER-ASLI-1** — Pay on Base or Polygon (CoinDCX/Mudrex deposit rails), not Arc. Conceded.
- **Q-USER-ASLI-2** — "Verify, then first transaction in a World mini app" or a sponsored-gas swap; Whitechain's gated faucet was the wrong first action. Conceded.
- **Q-OPS-ASLI-1** — Not yet; Thursday's conversation is a sales call, not a build dependency.
- **Q-OPS-ASLI-2** — The on-chain nullifier registry is the source of truth; Arkiv is a derived index written by the same indexer that reads chain events.

## 2. v2 proposal — Lifafa (CallSheet re-venued)

**1. Name + one-liner.** Lifafa (Hindi: envelope) — a Hyperliquid builder-code desk where World-verified traders post sealed, paywalled perp calls with their own fill inside; humans and AI agents pay per unseal over x402 on Hedera, mirror from their own HL accounts, and every commitment and fill is a queryable Arkiv record. Fee ≤10 bps per fill, half to the caller.

**2. User & pain.** *Caller:* a Dubai HL-perps signals operator (5k members, $75/mo VIP) whose track record is screenshots and whose members leak every call within a minute. *Follower:* an HL trader who gets the call 40 s late at a worse price; an agent operator who wants a priced, machine-readable signal without an API key. Moment: the call drops.

**3. Why now.** Builder-code fees on HL were $24M in Q3 2026; Phantom ($20M+), Based ($15M) and MetaMask ($58.5k/day) prove the instrument (`ideation.md` §1.2). pvp.trade ($8.0M lifetime, $6.4k in the last 30 days — [DefiLlama](https://defillama.com/protocol/pvp.trade)) and Dexari ($8.2k/30d) prove a generic HL front end dies without a wedge; ours is caller rev-share (the Trojan/PolyCop referral mechanic), venue-verified records and agent buyers. Hedera's track text is "pay-per-call data APIs"; HL is not geo-blocked in India; judging day is Diwali, the season of the lifafa.

**4. Core mechanism.** (a) A caller verified once with IDKit seals a schema-validated call {asset, side, entry, stop, target, size%}: the body is timelock-encrypted to reveal time T (drand tlock; Shutter if confirmed), the hash, caller nullifier-hash and T are posted to a Hedera HCS topic and written as an Arkiv entity, the ciphertext stored on Swarm. (b) The caller's own HL fill must appear within 60 s (public fills API) → "skin in game" badge. (c) Buyers — humans, or Hedera Agent Kit agents carrying HCS-14 UAIDs — call `GET /lifafa/:id`, get a 402, pay USDC/HBAR on Hedera testnet, receive the key. (d) At T the card un-redacts; followers fill from their own HL accounts, one-tap (user signs) or auto-mirror (agent wallet on a sub-account); every order carries the builder code; the caller's position stays visible on HL. (e) The leaderboard is realized PnL from HL fills, served from Arkiv queries. Agents parse the schema and apply code-enforced caps (max notional, max leverage, allowlist) — the LLM never sizes a trade, so caller text cannot inject. Onchain: HL orders and fills, Hedera settlements and HCS messages, Arkiv entities. Off-chain: Telegram bot, tlock scheduler, indexer. No Solidity in the core; a HyperEVM commit contract (CoreWriter places the caller's fill atomically with the commit) is the stretch.

**5. Sponsor map.**

| Partner / track | Role | What breaks if removed |
|---|---|---|
| **Hedera** — x402 ($6.5k if open to Continuity; else Continuity ~$1.5k) + No-Solidity ($2k) | x402 unseal endpoint settling on Hedera testnet (x402.org `hedera:testnet`, self-run `/verify`+`/settle` fallback); Agent Kit buyer with HCS-14 UAID; HCS topic timestamps every commitment | Agents cannot buy a call without an account and API key; commitments lose their neutral timestamp |
| **World** — IDKit ($2.5k) / [Cont] IDKit ($2.5k) | One human = one caller record (Device/Document accepted, labelled); verified-human followers pay 5 bps instead of 10 | Burner callers launder blown-up records for free; identity stops changing terms |
| **Arkiv** — from-scratch or Continuity ($4k) + Swarm ($500) | Every lifafa, reveal and fill count is an entity; the track-record page is a public query; ciphertext on Swarm, reference in the entity; schema + feedback files | Records live only in our database and HCS; third-party browsable verification disappears (HCS keeps ordering, not queries) |

Uncounted: ENS `caller.lifafa.eth`; Definitive as a later spot lane.

**6. Revenue — the VC's method, low/base/high (month 6).** Instrument: builder fee 10 bps on perps (the HL cap; 5 bps for verified humans), split 50/50 caller/platform → platform ≈ 4–5 bps; unseal fees set by callers ($0.50–5), platform 20%; a $20/mo analytics tier (Polycopy charges $30). Assumptions: paid-group conversion 1–2% (VC's figure); perps notional per active $5–8k/day ($1–2k margin at 4–5×, one round trip).
- **Low** (pvp.trade/Dexari decay, no caller signs): 50 actives × $5k × 4 bps = $100/day → **≈ $0.9k/week**.
- **Base**: 300 actives (three groups of 5k at 2%) × $8k × 4 bps = $960/day = $6.7k + unseals (300 × 5/week × $1 × 20% = $0.3k) + 100 pro subs ($0.5k) → **≈ $7.5k/week**.
- **High** (one hot caller or 1,000 actives): $8M/day × 4 bps = $3.2k/day → **≈ $23k/week**.
Probability-weighted ≈ $4–5k/week; the base misses $10k and I say so. Hinge: 300 funded actives by month 6 — v1 needed 1,000 because spot tickets are $150 and perps notional is 50× that. pvp.trade and Dexari pay nobody to bring users; Lifafa pays callers half the fee — how Trojan and PolyCop (45% referral share) grew. First three payers: (1) a Dubai HL-perps group, LOI before kickoff; (2) an agent-trading team — one of this hackathon's own — paying x402 unseals; (3) 100 hackers in our Devcon Telegram trading $5–20 HL positions on Friday, the first real builder fees. India is not targeted; we custody nothing and touch no INR.

**7. Scope (≤85 ph).** HL integration (approveBuilderFee, orders with builder param, fills/positions polling, sub-accounts, testnet) 14 · commit-reveal service (tlock, scheduler, HCS posting) 8 · Telegram bot (seal flow, redacted card with countdown, one-tap ticket) 12 · x402 endpoint + facilitator fallback 6 · Agent Kit buyer with HCS-14 and code-enforced caps 8 · IDKit + fee tiers 5 · Arkiv entities, queries, schema/feedback, Swarm 8 · web (track record, three-line receipts, design system) 10 · demo, envelopes, video, README, CHANGELOG 10 → **81 ph**; HyperEVM contract (+10) only if ahead at Sat 09:00. Live: envelope handed to a judge; caller seals a BTC call; Arkiv entity and HCS message appear; the caller's HL testnet fill lands; an agent pays the unseal on Hedera (HashScan) and executes; reveal; three follower accounts fill with the builder code visible on the HL explorer; receipts; track record queried from Arkiv; the judge opens the envelope and the call matches. Mocked: drand not Shutter; three scripted callers plus the live one; HIP-3/HIP-4 instruments; the pro tier. Degradation: facilitator → self-run; World verification in India → pre-verified team accounts; Arkiv → HCS + cache (ordering survives, queries do not); HL testnet → mainnet ≤$50; Telegram → web.
**The image:** a judge holds a sealed Diwali envelope with a hash printed on it; an AI agent pays ₹40 on Hedera to open the digital twin; the room's phones fill BTC at one price; the judge tears the paper and the call matches. **The signature:** the lifafa itself — kraft-paper card with black redaction bars that lift at T; Eczar (Devanagari-native serif) for the call, IBM Plex Mono tabular numerals for fills, one oxide-teal accent only on the countdown; every receipt three lines, you / caller / protocol; "Lifafa kholo" as the reveal button. No gradients, no Inter, no confetti.

**8. Prior art.** **KOLlateral** (Lisbon 26 finalist) scores calls after the fact; Lifafa seals them before, pays the caller from venue fees and verifies the caller's own fill. **vouch** (NY 26) follows ENS names on Hyperliquid; no sealing, no paywall, no agents, no fee. **pvp.trade / PolyCop** (web) are group-trading bots with builder or flat fees; neither seals, verifies skin-in-game or sells to agents. Also AgentAlpha (ETHOnline 26), Shadow, Cucumber Moped Bot.

**9. Biggest risk & mitigation.** The Judge's category discount on anything copy-trading; mitigated by the physical commitment device and the agent-buys-human-data framing (Accrue/OpenBook shape), not removed — I price P(top-10) at 5%. Second: the wedge is unproven and both HL comparables decayed; the LOI deadline is the test. Third: HL testnet builder-code support is unverified — test on 4 Nov; fallback is ≤$50 mainnet. Fourth: Hedera x402's Continuity eligibility — confirm at kickoff; the floor is the ~$1.5k Continuity prize plus No-Solidity.

**10. UI/UX references.** pvp.trade and Hyperliquid (PnL card), Trojan (inline keyboards), Polycopy (pro tier), Axiom (density), the Indian shagun envelope.

**11. Self-score.** T 7 (tlock + builder codes + x402 + Agent Kit + Arkiv; no Solidity) · O 6 (sealed paywalled calls with verified skin-in-game is new; copy-trading is not) · P 8 (real fee instrument from the first fill) · U 8 (3-tap onboarding, one-tap fills) · W 7 (envelope plus live reveal).

## 3. Vote (other members' Round-0 ideas)

1. **Recharge** (Mumbai Native) — the only idea that takes cash on day one, and its v2's sponsor data-drop is a B2B line the hall can buy Thursday. 2. **Dhwani** (Judge's Eye) — the best finalist EV in the deck; its v2 B2B2C model is the first honest revenue path it has had. 3. **Octroi** (Sponsor Stacker) — best security and sponsor hedge, no payers; it belongs inside Recharge v2, where it now is. If Lifafa is struck, I build **Recharge v2** and sell the data drops myself.

## 4. Track position under the pre-build reality

**Continuity, declared in writing.** Code public before Thursday 21:00 makes a from-scratch entry a false declaration that any judge can diff, and "re-implementing beside a public reference" is the same thing with a worse story; the rules require disclosed pre-existing work and substantive in-window work, and partner eligibility varies per partner (Mumbai Native, R2). All three of Lifafa's programs have Continuity lanes (Arkiv $4k, World [Cont] $2.5k, Hedera ~$1.5k floor, x402 $6.5k if open); Uniswap's $10k, which Continuity forfeits, was never in v2. Plan: v0 on 3–5 Nov (HL integration, commit-reveal, bot skeleton, on fixtures since the sandbox cannot reach testnets), tagged and disclosed; in the window ship more than half the product — the x402 unseal endpoint, the Agent Kit buyer, World tiers, Arkiv queries, the physical demo and the HyperEVM contract — with dated human commits and an AI-use statement. The finalist discount is real; a sealed envelope on the table discounts less than a dashboard. Keys are generated on-site, funded from faucets, never pasted into the orchestrator.
