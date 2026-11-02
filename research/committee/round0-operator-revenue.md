# Round 0 — Member #2, Operator / Revenue

**Lens:** ≥ US$10,000/week within months, ≤5 people, someone pays on day 1. Speed-to-cash: per-trade fees > launch-fee share (hit-driven) > B2B take-rate (lumpy) > subscriptions/payroll (slow).

**Evidence caveat.** Network policy blocked every outbound host (api.llama.fi etc.) and the shared WebSearch budget was exhausted before my queries ran. Comparable-revenue figures are **recalled (cutoff mid-2026), marked ⚠**, with the URL to verify before R2; prior-art greps on the 18,693-row showcase CSV are authoritative.

**Position: From-scratch.** Revenue cares about the 90 days after the event, not the track; the from-scratch tiers are the big ones (Uniswap $10k, Hedera $6.5k, World $5k, Arkiv $4k, Arc $3k) and finalists are judged on from-scratch wow. Continuity's only gift (a head start) we can take legally elsewhere: **sales and distribution are not "work on the project."** Before 5 Nov 21:00 IST: 3 LOIs or pre-orders, a waitlist, faucets, accounts, FEEDBACK.md/schema skeletons. Code starts at kickoff.

---

## Proposal 1 — CallSheet: sealed, executable trading calls (per-fill fee)

**1. Name + one-liner.** CallSheet — a Telegram desk where a caller posts a *sealed* call (asset, entry, stop, target) that followers mirror non-custodially in one atomic batch at reveal; exits are advanced orders; followers pay per fill and the caller is paid from it.

**2. User & pain.** *Caller:* a signals operator (5k–50k Telegram members) selling ₹3–5k/month "VIP" access, front-run by his own members. *Follower:* a phone-bound retail trader who sees "LONG X at 1.20, SL 1.10" 40 seconds late, pays a 1% bot fee anyway, with no stop. Moment: the call drops; the follower wants the caller's price and a stop that exists.

**3. Why now.** Definitive's track is literally "advanced orders for social & agent apps"; builder codes and Axiom proved a *fee-per-fill front end* is crypto's fastest revenue model; sealed ordering is cheap (Shutter, drand tlock); India runs the largest Telegram-signals economy and Devcon week is the pool.

**4. Core mechanism.** (a) Caller signs a call and publishes only its hash + body timelock-encrypted to reveal block T (Shutter if confirmed, else drand tlock). (b) Followers' USDC sits in their own session-key vaults; at T **one batch tx swaps through a Uniswap v4 pool whose hook enforces a uniform fill price, takes 0.75% in `afterSwap` and splits it caller/protocol on-chain**. (c) Every follower's stop/TP/TWAP exit is placed via **Definitive Flash API**. (d) Callers register with **World ID** (humans) or **Agent Pass** (AI callers), so leaderboards can't be sybil-farmed. Novelty: the call *is* the order and the revenue instrument, and nobody — caller or us — can trade ahead of followers. Onchain: vaults, hook, fee split, commitment, World proof. Off-chain: Telegram bot, encryption relay, indexer.

**5. Sponsor map (3 programs).**

| Partner / track | Role | What breaks if removed |
|---|---|---|
| **Definitive** — Flash API $3.5k | All exit logic (stop, TP, TWAP) | No risk management; own keeper + router is weeks of work |
| **Uniswap Foundation** — Build with Uniswap $10k (v4 hook, Unichain Sepolia 1301) | Atomic batch entry, uniform price, on-chain fee split | Followers fill one-by-one at different prices; fee becomes an IOU; front-running returns |
| **World** — Agent Pass app $5k / IDKit $2.5k | One human = one caller; agents via Agent Pass | Leaderboards farmable by burners; track records worthless |

Stretch (uncounted): Shutter sealed calls, ENS names.

**6. Revenue arithmetic.** Fee 0.75% per mirrored fill (industry norm 0.5–1%). **$10k/wk ÷ 0.0075 = $1.33M mirrored volume/wk = $190k/day.** Volume model: 20 active callers × 50 funded followers × $150 average fill × 1.3 fills/day ≈ $195k/day → **~1,000 funded followers**, i.e. 2–4% conversion of three 15k-member groups. Upside (not in base case): 10% perf fee on follower profit (70/30 caller/us); $0.5–5 unseal fees (20% ours). Comparables ⚠: Trojan (1% TG bot) >$100M cumulative fees by early 2025 — https://defillama.com/protocol/trojan ; Banana Gun ≈$38–40M fees in 2024 — https://defillama.com/protocol/banana-gun ; Axiom (~10 people) >$100M revenue within ~6 months of its Jan-2025 launch, >$1M/day at peak — https://defillama.com/protocol/axiom ; Hyperliquid builder codes (cap 0.1% perps / 1% spot) let front ends like pvp.trade earn $M-scale fees in 2025 — https://hyperliquid.gitbook.io/hyperliquid-docs/trading/builder-codes . Target = **~1% of Axiom's peak day**. First three payers: (1) a Mumbai/Bengaluru signals operator with 20k+ members (replaces his paid group); (2) a Dubai discretionary trader with a $50–100/mo, 2k-member Discord; (3) an agent-trading team from this hackathon publishing via Agent Pass. The *follower* pays per fill — zero sales cycle.

**7. Hackathon-window scope.** Live: Telegram bot → sealed call → reveal → one batch swap on Unichain Sepolia through our hook, fee split visible; Definitive stop/TWAP executed for 2 followers (Definitive is likely mainnet-only → $5–20 real fills on Base, which their rule requires anyway); World ID caller registration on World Chain Sepolia; live leaderboard. Mocked: other chains; perf-fee accounting (off-chain); drand not Shutter unless confirmed; 3 scripted callers.

**8. Prior art (CSV: 68 copy-trade, 195 advanced-order, 83 TG-bot hits).** **KOLlateral** (Lisbon 26 finalist) scores calls after the fact; ours makes the call the executable, sealed order with on-chain fee enforcement (they are the record; we are the venue that pays the caller). **Shadow / CopyX** (HackMoney 26 / New Delhi) hide copy-trades with FHE/MPC; ours uses cheap timelock + atomic batch and adds exits, a fee rail and Telegram distribution. **vouch** (NY 26) follows ENS names on Hyperliquid, World-gated; no sealed calls, fees or exits. Also Cucumber Moped Bot, AgentAlpha, Peregrine. Web: Trojan, Banana Gun, Axiom, pvp.trade — none seal calls or pay callers on-chain.

**9. Biggest risk & mitigation.** "Another trading bot." Mitigation: the demo opens with the attack (bot front-runs followers), then the sealed batch kills it, fee split on-chain. Secondary: Definitive testnet support unknown — confirm 3 Nov; fallback is tiny mainnet fills.

**10. UI/UX references.** Axiom, GMGN, pvp.trade (Telegram-native), Hyperliquid order ticket, Trojan bot UX.

**11. Self-score.** T 8 (hook + timelock + session keys + order API) · O 7 (sealed batching new; copy-trading not) · P 8 (real payers day one) · U 7 (Telegram is the UI) · W 7 (front-run-then-defeat demo).

---

## Proposal 2 — Nilami: one human, one bid (CCA launchpad with fee-streaming hook)

**1. Name + one-liner.** Nilami (Hindi: auction) — tokens launch through a Uniswap Continuous Clearing Auction where each verified human gets one sealed bid, and the resulting v4 pool's hook streams 1% swap fees to creator, protocol and verified early bidders.

**2. User & pain.** *Creator:* a community, creator, or AI-agent project that wants a token but knows pump.fun/Clanker launches are sniped in block 1 by bots holding 60%+ of supply. *Bidder:* a human who wants a fair allocation at one clearing price without racing bots. Moment: launch second.

**3. Why now.** Uniswap Foundation lists CCA + v4 hooks as the stack to touch; World ID 4.0 / Agent Pass make "one human, one slot" and agent-launched tokens a 36-hour build; Clanker, Flaunch, Bags and Zora proved tiny teams earn eight figures from launch-fee share; Arkiv wants a flagship data use.

**4. Core mechanism.** (a) Creator (World ID human or Agent Pass agent) opens a CCA; (b) each World-verified wallet places one sealed bid (hash commit, reveal before clearing; Shutter if confirmed); (c) the CCA clears at a uniform price and proceeds seed a **v4 pool with `NilamiHook`**: 1% swap fee split 50% creator / 20% protocol / 30% to a 30-day dividend pool for the auction's verified bidders (pays humans to be early and hold); (d) every launch, bid, clear and fee epoch is an **Arkiv** entity; launch page, leaderboard and allocation audit are reads, not our database. Onchain: CCA, hook, splits, dividend claims, World proof. Off-chain: reveal relay, UI.

**5. Sponsor map.**

| Partner / track | Role | What breaks if removed |
|---|---|---|
| **Uniswap Foundation** — Build with Uniswap $10k (CCA + v4 hook, Unichain Sepolia) | Launch mechanism and fee rail | No product: no price discovery, pool or revenue |
| **World** — Agent Pass app $5k / IDKit $2.5k | One-human-one-bid; agent creators | Snipers and sybils take the auction; "fair" becomes meaningless |
| **Arkiv** — Build from scratch $4k (+Swarm bonus) | Queryable launch/bid/fee ledger; schema + feedback files | Allocation audit reverts to a trusted Postgres (honestly replaceable) |

Alternative third: ENS subnames (`$ticker.nilami.eth`); stretch: Shutter sealed bids.

**6. Revenue arithmetic.** Protocol take = **20 bps of secondary swap volume** + **0.5% of each CCA raise**. $10k/wk: 15 launches × $20k raised = $300k → $1.5k; remaining $8.5k ÷ 0.002 = **$4.25M/wk secondary ≈ $610k/day across live tokens.** Comparables ⚠: Clanker (2 people at its Nov-2024 launch) charges 1% on its Uniswap pools, did $2–10M/day in early weeks and ~$30–40M cumulative fees by late 2025 — https://defillama.com/protocol/clanker ; pump.fun 1% fee, ~$700M+ cumulative revenue — https://defillama.com/protocol/pump.fun ; Bags.fm peaked above $1M/day in fees, Aug 2025 — https://defillama.com/protocol/bags ; Flaunch (v4-hook launchpad) — https://flaunch.gg . We need **~10% of early-Clanker volume**: one or two tokens with legs. Honest shape: hit-driven; median week may be $1–2k until a hit. First three payers: (1) an Indian creator community (Hindi crypto-YouTuber scale) launching a fan token — raise fee from them, swap fees from traders; (2) an agent project launching via Agent Pass; (3) a Devcon-week community meme — traders pay from block 1.

**7. Hackathon-window scope.** Live on Unichain Sepolia: open a CCA, 20 World-verified audience phones bid, sealed bids revealed, clearing, pool seeded, swaps through the hook with fee split and dividend claim visible; Arkiv writes/reads power the launch page. Mocked: 30-day dividend compressed to minutes; hash commit-reveal instead of Shutter; creator analytics.

**8. Prior art (126 launchpad hits).** **CircEveryBid / BlindPool** (HackMoney 26): sealed-bid CCAs via ZK/FHE; no proof-of-human, fee hook or dividend. **r00t.fund** (Lisbon 26, Uniswap 3rd): CCA + v4 hook for land regeneration; ours is general-purpose, human-gated, revenue-shared. **world(dot)fun / FairStake** (Bangkok / ETHOnline 26): World-gated launches on bonding curves; no uniform-price CCA or on-chain fee economics. Also Vesta, Humanly, Proof-of-Human Drops. Web: Clanker, Flaunch, Doppler, Zora, Believe — none human-gated, none CCA.

**9. Biggest risk & mitigation.** "Casino" judgement + saturation (three CCA projects exist). Mitigation: position as *creator/agent launches* with fair price discovery and a bidder dividend; demo with the room's phones; sign one real creator before kickoff. Regulatory: Indian traders bear 30% VDA tax + 1% TDS; product is global, non-custodial.

**10. UI/UX references.** Clanker, Flaunch, Zora, Believe, pump.fun, Uniswap CCA UI.

**11. Self-score.** T 8 (CCA + hook + sealed bids + Arkiv) · O 6 (CCA and human-gating exist; combination + dividend is new) · P 8 · U 8 (bid from a phone) · W 8 (live clearing on the big screen).

---

## Proposal 3 — Asli: pay only for real humans (verified-conversion acquisition network)

**1. Name + one-liner.** Asli (Hindi: genuine) — protocols escrow USDC and pay a fixed price per *verified unique human* who completes an on-chain action; bots cost zero, every conversion is an auditable Arkiv record, Asli takes 20%.

**2. User & pain.** *Buyer:* a devrel/growth lead at a new chain or app (every sponsor here) paying $15k prize pools and five-figure Galxe/Layer3 campaigns for 50–80% farmed wallets. Moment: campaign ends, Dune shows 40,000 "users" and 300 real ones. *Earner:* an Indian student/dev who would try a testnet for $5–10 but is drowned out by farms.

**3. Why now.** Devcon + ETHGlobal week puts ~80 sponsors with UA budgets in one building; World ID 4.0 (Orb, Document, Device) makes "unique human" cheap to verify in India; Arc gives earners USDC-gas payouts with no ETH.

**4. Core mechanism.** Advertiser deploys a campaign escrow in **Arc Studio** (USDC, per-conversion price, cap, action spec, expiry; unspent refunds automatically). Earner proves personhood with **World ID** (IDKit, verified server-side, nullifier stored on-chain: one human converts once per campaign), performs the action (e.g., deploy on Whitechain Sepolia, first tx in a World mini app); our verifier confirms it from chain data and releases escrow; the conversion (campaign, nullifier hash, tx hash, price) is written to **Arkiv**, which advertisers query directly instead of trusting our dashboard. Novelty: CPA with proof-of-personhood and refund-by-default escrow — the advertiser's fraud downside is zero. Onchain: escrow (Arc), nullifier registry, payouts. Off-chain: verifier, dashboards.

**5. Sponsor map.**

| Partner / track | Role | What breaks if removed |
|---|---|---|
| **World** — Best Use of IDKit $2.5k (+ Agent Pass $5k if agents buy campaigns) | Uniqueness per campaign | Collapses into Galxe: farmable, unpayable |
| **Arc (Circle)** — Advanced Stablecoin Logic $3k / Arc Studio app $3k | Per-conversion escrow release, refund-on-expiry, USDC-gas payouts | Earners need ETH for gas; escrow rebuilt elsewhere; USDC settlement lost |
| **Arkiv** — Build from scratch $4k | Public, queryable attribution ledger | Advertisers must trust our database — Galxe's exact trust problem |

Alternative third: Chainlink CRE ($1.5k) verifying off-chain actions (GitHub/Discord) and writing the state change.

**6. Revenue arithmetic.** Take **20% of campaign spend + $0.05 per payout**. **$10k/wk ⇒ ~$50k/wk advertiser spend ⇒ 5 campaigns × 1,000 verified conversions × $10, or 10 × $5k.** Pipeline: 13 Mumbai partners already pay $15k prize pools to reach builders; "$10 per verified developer deploy" is the same budget line with measurable ROI. Comparables ⚠: Galxe (campaign fees, >10M users) — https://www.galxe.com ; Layer3 ($15M raised 2024) — https://layer3.xyz ; Intract (Bengaluru quest platform, tens of millions of Indian users) — https://www.intract.io ; Indian fintech CPA networks pay ₹200–800 per verified KYC signup — https://earnkaro.com . Our $5–25 per conversion undercuts the ~$20–100 effective CAC of farmed airdrops. First three payers: (1) a new-chain sponsor here (Arkiv / Whitechain / 0G devrel) buying verified-developer deploys — LOI before kickoff; (2) a World mini-app studio buying verified first transactions; (3) an Indian exchange/fintech buying KYC-ready signups at ₹300. Deals are $5–20k; two a week clears the bar.

**7. Hackathon-window scope.** Live: campaign created in Arc Studio on Arc testnet (5042002); earner verifies with World ID on a phone, deploys on Whitechain Sepolia, USDC released on Arc in seconds; dashboard queries Arkiv live; a repeat attempt is blocked by nullifier; expired campaign refunds. Mocked: off-chain actions (GitHub/Discord), fraud scoring beyond uniqueness, fiat invoicing.

**8. Prior art (43 quest/CPA + 11 sybil-rewards hits).** **CPA** (Superhack 2023): protocol sets a max bid per onboarded user; no personhood, escrow refund or audit ledger. **Refer** (Superhack, 3 prizes): Worldcoin-gated referral campaigns; referral not conversion, no per-action escrow. **Distro** (NY 26 finalist): brands fund USDC pools, World-ID clippers paid per view; ours pays per *on-chain conversion* with refund-by-default and a public ledger. Also Swagly, Adquire, ZoneGo, HAT, Accrue. Web: Galxe, Layer3, Intract, QuestN — none refund fraud or expose a public attribution ledger.

**9. Biggest risk & mitigation.** Medium originality; Orb scarcity in India could throttle earners. Mitigation: accept Document (NFC passport) and Device credentials at tiered prices ("Orb-level humans at a premium"); demo on sponsors' own testnets so the buyer sees their logo.

**10. UI/UX references.** Layer3, Galxe, Intract (earner side); Whop, PartnerStack, Impact.com (advertiser side).

**11. Self-score.** T 6 (escrow + verifier + IDKit + Arkiv) · O 6 · P 9 (buyers in the room, cash day 1) · U 8 · W 6 (a payout, not fireworks).

---

## Operator's ranking

Speed to $10k/week: **CallSheet (fee per fill) > Asli (Devcon-week deals, lumpy) > Nilami (hit-driven)**; by finalist odds, swap the last two. The Telegram-signals operator is the shared distribution channel for all three. Even if the ⚠ figures are off by 3×, CallSheet clears the bar at 1% of one Axiom-peak day.
