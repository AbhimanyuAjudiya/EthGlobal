# Round 0 — Member #2, Operator / Revenue

**Lens:** credible path to ≥ US$10,000/week within months, ≤5 people, someone pays on day 1. I rank revenue models in this order of speed-to-cash: per-trade fees (fastest, lowest sales friction) > LP/launch fee share (explosive, hit-driven) > B2B campaign take-rate (lumpy, but buyers are literally in the room) > subscriptions/payroll (slow sales cycles, compliance drag). The three proposals below take one archetype each.

**Evidence caveat (read first).** This session's network policy blocked every outbound host (api.llama.fi, docs.uniswap.org, docs.definitive.fi, hyperliquid.gitbook.io, openrouter.ai, deel.com, docs.polymarket.com, prsindia.org, docs.arkiv.network, docs.shutter.network) and the shared WebSearch budget was exhausted before my queries ran. All comparable-revenue figures below are **recalled from memory (cutoff mid-2026) and marked ⚠**; the cited URLs are where the chair should verify them before R2. Prior-art greps against the 18,693-row showcase CSV were run and are authoritative.

**From-scratch vs Continuity position: From-scratch.** Revenue does not care which track the hackathon code was entered in; it cares about the 90 days after. The from-scratch tiers are also the big ones (Uniswap $10k, Hedera $6.5k, World $5k, Arkiv $4k, Arc $3k) and finalist judging weighs from-scratch wow. The one thing Continuity would buy us (a head start on the codebase) we can get legally elsewhere: **sales and distribution are not "work on the project."** Before 5 Nov 21:00 IST: 3 signed LOIs or paid pre-orders, a waitlist/Telegram, faucets claimed, accounts (World dev portal, Arc Studio, Arkiv, Definitive API key) provisioned, FEEDBACK.md/schema-file skeletons drafted. Code starts at kickoff.

---

## Proposal 1 — CallSheet: sealed, executable trading calls (per-fill fee)

**1. Name + one-liner.** CallSheet — a Telegram/web desk where a caller posts a *sealed* call (asset, entry, stop, target) that followers mirror non-custodially in one atomic batch at reveal; exits run as advanced orders; everyone pays a fee per fill and the caller gets paid from it.

**2. User & pain.** *Caller:* a mid-size signals operator (5k–50k Telegram members) who today sells ₹3–5k/month "VIP group" access and is front-run by his own members. *Follower:* a retail trader on a phone who sees "LONG X at 1.20, SL 1.10, TP 1.60" 40 seconds late, pays a 1% Telegram-bot fee anyway, and has no stop. Moment: the call drops; the follower wants the same price as the caller and a stop that actually exists.

**3. Why now.** Social/agent trading is a 2026 sponsor theme (Definitive's entire track is "advanced orders for social & agent apps"); Hyperliquid builder codes and Axiom proved that a *fee-per-fill front end* is the fastest revenue model in crypto; sealed/commit-reveal ordering is cheap now (Shutter API, drand tlock). India has the largest Telegram-signals economy on earth and the Devcon crowd is the exact caller/follower pool.

**4. Core mechanism.** (a) Caller signs a call and publishes only its hash + encrypted body (timelock-encrypted to reveal block T; Shutter if confirmed, drand tlock otherwise). (b) Followers' USDC sits in their own session-key vaults; at T the body decrypts and **one batch tx swaps through a Uniswap v4 pool whose hook enforces uniform fill price, takes 0.75% in `afterSwap`, and splits it caller/protocol on-chain**. (c) Stops/take-profits/TWAP exits for every follower are placed through **Definitive Flash API** as advanced orders. (d) Callers register with **World ID** (humans) or **World ID Agent Pass** (AI callers) so leaderboards cannot be sybil-farmed. Novel part: the call *is* the order and the revenue instrument, and nobody — not the caller, not us — can trade ahead of the followers. Onchain: vaults, hook, fee split, reveal commitment, World proof. Off-chain: Telegram bot, encryption relay, leaderboard indexer.

**5. Sponsor map (3 programs).**

| Partner / track | Role | What breaks if removed |
|---|---|---|
| **Definitive** — Flash API $3.5k | All exit logic (stop, TP, TWAP) across chains | No risk management at all; we'd need our own keeper + router (weeks). Core promise ("a stop that exists") dies |
| **Uniswap Foundation** — Build with Uniswap $10k (v4 hook + Unichain Sepolia 1301) | Atomic batch entry, uniform price, on-chain 0.75% fee split | Followers fill one-by-one at different prices; fee becomes an off-chain IOU; front-running returns |
| **World** — Agent Pass app $5k / IDKit $2.5k | One human = one caller identity; agents via Agent Pass | Leaderboards are farmable by burner accounts; track records worthless |

Stretch, uncounted: Shutter sealed calls (if confirmed), ENS `alice.callsheet.eth`.

**6. Revenue arithmetic.** Fee 0.75% per mirrored fill (industry: Trojan/BONKbot/Photon 1%, Banana Gun 0.5–1%, Axiom ~0.75–1%). **$10k/wk ÷ 0.0075 = $1.33M mirrored volume/wk = $190k/day.** Volume model: 20 active callers × 50 funded followers × $150 average fill × 1.3 fills/day ≈ $195k/day → **~1,000 funded followers**, i.e. 2–4% conversion of three 15k-member groups. Upside lanes, not in the base case: 10% performance fee on realised follower profit (70/30 caller/us) and $0.5–5 "unseal" fees (20% to us). Comparables ⚠: Trojan (Solana TG bot, 1%) >$100M cumulative fees by early 2025 — https://defillama.com/protocol/trojan ; Banana Gun ≈$38–40M fees in 2024 — https://defillama.com/protocol/banana-gun ; Axiom (web terminal, ~10 people) >$100M cumulative revenue within ~6 months of its Jan-2025 launch, >$1M/day at peak — https://defillama.com/protocol/axiom ; Hyperliquid builder codes cap at 0.1% perps / 1% spot and single front ends (pvp.trade, Dexari, Based) earned $M-scale builder fees in 2025 — https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes . Our target is **~1% of Axiom's peak day**. First three payers: (1) a Mumbai/Bengaluru signals operator with 20k+ members (replaces his paid group; earns the caller share from day 1); (2) a Dubai discretionary trader running a $50–100/mo Discord (2k members); (3) an agent-trading team (one of this hackathon's own) publishing calls via Agent Pass. The *follower* pays per fill — zero sales cycle.

**7. Hackathon-window scope.** Live: Telegram bot → sealed call → reveal → one batch swap on Unichain Sepolia through our hook with visible fee split; Definitive stop/TWAP placed and executed for 2 followers (Definitive is mainnet-only as far as known, so this leg uses $5–20 real fills on Base — their rule requires onchain execution anyway); World ID caller registration verified on World Chain Sepolia; live leaderboard. Mocked/faked: multi-chain beyond Base/Unichain; performance-fee accounting (shown in UI, computed off-chain); timelock via drand rather than Shutter unless confirmed; 3 scripted callers.

**8. Prior art (CSV grep: 68 copy-trade, 195 advanced-order, 83 TG-bot hits).** Closest: **KOLlateral** (Lisbon 26 finalist) — scores influencer calls after the fact against DEX history; ours makes the call the executable, sealed order with on-chain fee enforcement (they are the record, we are the venue that pays the caller). **Shadow / CopyX** (HackMoney 26 / New Delhi) — privacy copy-trading via FHE/MPC to stop MEV; ours uses cheap timelock + atomic batch, adds advanced-order exits and a fee rail, and targets Telegram distribution. **vouch** (NY 26) — follow ENS names on Hyperliquid, World-gated; no sealed calls, no fee model, no exits. Also: Cucumber Moped Bot (Prague, TG limit orders), AgentAlpha (ETHOnline 26, paid signals on Hedera), Peregrine (Lisbon 26). Web: Trojan, Banana Gun, Axiom, pvp.trade — none seal calls or pay callers on-chain.

**9. Biggest risk & mitigation.** Veteran-judge smell: "another trading bot." Mitigation: the 4-minute demo opens with the attack (bot sees the call, front-runs followers) then shows the sealed batch killing it, with fee split visible on-chain. Secondary: Definitive testnet support unknown — confirm on Discord 3 Nov; fallback is tiny mainnet fills.

**10. UI/UX references.** Axiom (terminal density), GMGN (mobile), pvp.trade (Telegram-group-native trading), Hyperliquid (order ticket), Trojan (bot command UX).

**11. Self-score.** T 8 (hook + timelock + session keys + external order API) · O 7 (sealed-call batching is new; copy-trading is not) · P 8 (works day one, real payers) · U 7 (Telegram is the UI) · W 7 (live front-run-then-defeat demo).

---

## Proposal 2 — Nilami: one human, one bid (CCA launchpad with fee-streaming hook)

**1. Name + one-liner.** Nilami (Hindi: auction) — tokens launch through a Uniswap Continuous Clearing Auction where each verified human gets exactly one bid slot, bids are sealed until clearing, and the resulting v4 pool's hook streams 1% swap fees to creator, protocol and the verified early bidders.

**2. User & pain.** *Creator:* a community, creator, or AI-agent project that wants a token but knows pump.fun/Clanker launches are sniped in block 1 by bots holding 60%+ of supply. *Bidder:* a human who wants a fair allocation at one clearing price without racing bots. Moment: launch second.

**3. Why now.** Uniswap Foundation explicitly lists CCA + v4 hooks as the 2026 stack to touch; World ID 4.0 / Agent Pass make "one human, one slot" and "agent-launched tokens" a 36-hour build; Clanker, Flaunch, Bags and Zora proved tiny teams earn eight figures from launch-fee share; Arkiv is a new sponsor hungry for a flagship data use.

**4. Core mechanism.** (a) Creator (World ID human or Agent Pass agent) opens a CCA; (b) each World-verified wallet may place one sealed bid (hash commit, reveal before clearing; Shutter if confirmed); (c) CCA clears at a uniform price and proceeds seed a **v4 pool with our `NilamiHook`**: 1% swap fee split 50% creator / 20% protocol / 30% to a 30-day dividend pool for the auction's verified bidders (humans are paid to be early and to hold); (d) every launch, bid, clear and fee epoch is written to **Arkiv** as queryable entities so the launch page, leaderboard and "who got allocated" audit are reads, not our database. Onchain: CCA, hook, splits, dividend claims, World proof. Off-chain: reveal relay, UI.

**5. Sponsor map.**

| Partner / track | Role | What breaks if removed |
|---|---|---|
| **Uniswap Foundation** — Build with Uniswap $10k (CCA + v4 hook, Unichain Sepolia) | The launch mechanism and the fee rail | There is no product: no price discovery, no pool, no revenue |
| **World** — Agent Pass app $5k / IDKit $2.5k | One-human-one-bid; agent creators | Snipers and sybils take the auction; the "fair" claim and the bidder dividend are meaningless |
| **Arkiv** — Build from scratch $4k (+Swarm bonus) | Queryable launch/bid/fee ledger; schema + feedback files in repo | Allocation audit and leaderboards revert to a trusted Postgres; weaker trust story (replaceable, honestly) |

Alternative third: ENS (`$ticker.nilami.eth` subnames as canonical registry). Stretch: Shutter sealed bids.

**6. Revenue arithmetic.** Protocol take = **20 bps of secondary swap volume** on launched tokens + **0.5% of each CCA raise**. $10k/wk: 15 launches × $20k raised = $300k → $1.5k; remaining $8.5k ÷ 0.002 = **$4.25M/wk secondary volume ≈ $610k/day across all live tokens.** Comparables ⚠: Clanker (2 people at launch, Nov 2024) charges 1% on its Uniswap pools, did $2–10M/day across its tokens in early weeks and ~$30–40M cumulative fees by late 2025 — https://defillama.com/protocol/clanker ; pump.fun 1% fee, ~$700M+ cumulative revenue — https://defillama.com/protocol/pump.fun ; Bags.fm peaked above $1M/day in fees in Aug 2025 — https://defillama.com/protocol/bags ; Flaunch (v4-hook launchpad on Base) — https://flaunch.gg . Our requirement is **~10% of early-Clanker volume**, i.e. one or two tokens with legs. Honest shape: hit-driven, high variance; median week could be $1–2k until a hit. First three payers: (1) an Indian creator community (Hindi crypto YouTuber scale) launching a fan token — they pay the raise fee, traders pay the swap fee; (2) an AI-agent project launching its agent token via Agent Pass; (3) a Devcon-week community meme — payers are traders from block 1.

**7. Hackathon-window scope.** Live on Unichain Sepolia: open a CCA, 20 World-verified wallets bid (audience phones), sealed bids revealed, clearing, pool seeded, swaps through the hook with fee split and dividend claim visible; Arkiv writes and reads powering the launch page. Mocked: 30-day dividend compressed to minutes; Shutter replaced by hash commit-reveal; creator-side analytics.

**8. Prior art (126 launchpad hits).** Closest: **CircEveryBid / BlindPool** (HackMoney 26) — privacy-preserving CCAs with ZK/FHE sealed bids; no proof-of-human, no fee-streaming hook, no dividend. **r00t.fund** (Lisbon 26, Uniswap 3rd) — CCA + v4 hook pointed at land regeneration; ours is general-purpose, human-gated and revenue-shared. **world(dot)fun / FairStake** (Bangkok / ETHOnline 26) — pump.fun or fair launch gated by World ID; bonding curves, no uniform-price CCA, no on-chain fee economics. Also Vesta (ETHOnline 26, CCA launch strategy), Humanly (Cannes 26), Proof-of-Human Drops (NY 26). Web: Clanker, Flaunch, Doppler, Zora, Believe — none human-gated, none CCA.

**9. Biggest risk & mitigation.** "Casino" judgement + saturation (Originality is contested: three CCA projects already). Mitigation: position as *creator/agent token launches* with fair price discovery and a bidder dividend, and demo with the room's phones; sign one real creator before kickoff. Regulatory: Indian traders bear 30% VDA tax + 1% TDS; product is global and non-custodial.

**10. UI/UX references.** Clanker, Flaunch, Zora, Believe, pump.fun, Uniswap's CCA bidding UI.

**11. Self-score.** T 8 (CCA + hook + sealed bids + Arkiv) · O 6 (CCA and human-gating each exist; the combination plus dividend is new) · P 8 · U 8 (bid from a phone) · W 8 (live auction clearing on the big screen).

---

## Proposal 3 — Asli: pay only for real humans (verified-conversion acquisition network)

**1. Name + one-liner.** Asli (Hindi: genuine) — protocols escrow USDC and pay a fixed price per *verified unique human* who completes a specified on-chain action; sybils and bots cost zero, every conversion is an auditable Arkiv record, and Asli takes 20%.

**2. User & pain.** *Buyer:* a devrel/growth lead at a new chain or app (every sponsor at this event) who pays $15k prize pools and five-figure Galxe/Layer3 campaigns and gets 50–80% farmed wallets. Moment: campaign ends, Dune shows 40,000 "users" and 300 real ones. *Earner:* an Indian student/dev who will try a testnet for $5–10 but is drowned out by farms.

**3. Why now.** Devcon + ETHGlobal week puts ~80 sponsors with UA budgets in one building; World ID 4.0 (Orb, Document, Device credentials) finally makes "unique human" cheap to verify in India; Arc makes USDC-gas payouts trivial for earners with no ETH; Arkiv wants a flagship "queryable records" use.

**4. Core mechanism.** Advertiser deploys a campaign escrow in **Arc Studio** (USDC, per-conversion price, cap, action spec, expiry; unspent refunds automatically). Earner proves personhood with **World ID** (IDKit, verified server-side + nullifier stored on-chain so one human can convert once per campaign), performs the action (e.g., deploy a contract on Whitechain Sepolia, swap on Unichain Sepolia, first tx in a World mini app); our verifier confirms the action from chain data and triggers escrow release; the conversion (campaign, nullifier hash, tx hash, timestamp, price) is written to **Arkiv**, and advertisers audit by querying Arkiv directly rather than trusting our dashboard. Novel part: CPA with proof-of-personhood and refund-by-default escrow — the advertiser's downside for fraud is zero. Onchain: escrow logic (Arc), nullifier registry, payouts. Off-chain: verifier, dashboards.

**5. Sponsor map.**

| Partner / track | Role | What breaks if removed |
|---|---|---|
| **World** — Best Use of IDKit $2.5k (+ Agent Pass app $5k if agents can buy campaigns) | Uniqueness guarantee per campaign | Product collapses into Galxe: farmable, unpayable |
| **Arc (Circle)** — Advanced Stablecoin Logic $3k / Arc Studio DeFi app $3k | Escrow with per-conversion release, refund-on-expiry, USDC gas payouts | Earners need ETH for gas; escrow logic rebuilt elsewhere; loses USDC settlement requirement |
| **Arkiv** — Build from scratch $4k | Public, queryable attribution ledger advertisers audit | Advertisers must trust our database — the exact trust problem Galxe has |

Alternative third: Chainlink CRE (verify off-chain actions like GitHub/Discord and write the state change) — $1.5k.

**6. Revenue arithmetic.** Take rate **20% of campaign spend + $0.05 per payout**. **$10k/wk ⇒ ~$50k/wk advertiser spend ⇒ 5 campaigns × 1,000 verified conversions × $10, or 10 × $5k.** Pipeline math: 13 Mumbai partners already spend $15k each on prize pools to reach builders; "$10 per verified developer who deploys on your testnet" is the same budget line with measurable ROI. Comparables ⚠: Galxe (campaign fees, >10M users) — https://www.galxe.com ; Layer3 ($15M raised 2024) — https://layer3.xyz ; Intract (Bengaluru-based quest platform, tens of millions of Indian users, protocols pay per campaign) — https://www.intract.io ; Indian fintech CPA networks pay ₹200–800 per verified KYC signup — https://earnkaro.com . Our price per conversion ($5–25) undercuts the ~$20–100 effective CAC of farmed airdrops. First three payers: (1) a new-chain sponsor at this event (Arkiv / Whitechain / 0G devrel) — verified-developer deploys, signed as an LOI before kickoff; (2) a World mini-app studio buying verified first-transactions; (3) an Indian exchange or fintech app buying verified KYC-ready signups at ₹300. Lumpy but each deal is $5–20k; two deals a week clears the bar.

**7. Hackathon-window scope.** Live: advertiser creates campaign in Arc Studio on Arc testnet (5042002); earner verifies with World ID on phone, deploys on Whitechain Sepolia, verifier releases USDC on Arc within seconds; advertiser dashboard queries Arkiv live; a second human is blocked by nullifier; expired campaign refunds. Mocked: off-chain action types (GitHub/Discord), fraud scoring beyond uniqueness, fiat invoicing.

**8. Prior art (43 quest/CPA + 11 sybil-rewards hits).** Closest: **CPA** (Superhack 2023) — protocol sets max bid per onboarded user; no proof-of-personhood, no escrow refund, no audit ledger. **Refer** (Superhack, 3 prizes) — sybil-resistant referral campaigns with Worldcoin; referral not conversion, no per-action escrow. **Distro** (NY 26 finalist) — brands fund USDC pools, World-ID clippers paid per view; ours pays per *on-chain conversion* with refund-by-default and a public audit ledger. Also: Swagly (BA, ETHGlobal sponsor quests), Adquire (ETHIndia 23), ZoneGo (ETHOnline 26), HAT (Cannes 26), Accrue (NY 26 finalist). Web: Galxe, Layer3, Intract, QuestN — none refund fraud or expose a public attribution ledger.

**9. Biggest risk & mitigation.** Originality is medium and World ID coverage in India (Orb scarcity) could throttle earners. Mitigation: accept Document (NFC passport) and Device credentials with price tiers; pitch to buyers as "only pay for Orb-level humans at premium"; demo with sponsors' own testnets so the buyer sees their logo.

**10. UI/UX references.** Layer3, Galxe, Intract (earner side); Whop, PartnerStack, Impact.com (advertiser side).

**11. Self-score.** T 6 (escrow + verifier + IDKit + Arkiv; no deep crypto) · O 6 · P 9 (buyers in the room, cash day 1) · U 8 · W 6 (demo is a payout, not fireworks).

---

## Operator's ranking

By speed to $10k/week: **CallSheet (weeks, fee per fill) > Asli (first deals during Devcon week, lumpy) > Nilami (hit-driven)**. By finalist odds I'd invert Nilami and Asli. If the committee wants one product, CallSheet's callers are also Nilami's creators and Asli's advertisers — the Telegram-signals operator is the shared distribution channel. Verify the ⚠ figures at the DefiLlama URLs before R2; if the recalled numbers are off by 3×, CallSheet still clears the bar at 1% of a single Axiom-peak day.
