# DECISION — ETHGlobal Mumbai 2026 (Round 3, member #10c, Synthesizer)

**Date:** Tue 3 Nov 2026 (hacking opens Thu 5 Nov 21:00 IST; submission Sun 8 Nov 09:00 IST). **Status:** binding on ratification by the Chair. **Inputs:** every file in `research/committee/`, `research/sponsors.md`, `research/winners.md` §4, `research/ideation.md` §0–2 and §6, `research/design-foundations.md`, `docs/ENVIRONMENT-CONSTRAINTS.md`, and the scaffold already in the repo (`packages/adapters`, `packages/contracts`, `packages/ui`, `services/api`, `apps/web`). No web searches were spent: every fact below is a Round-1/2/3 verified finding, cited by member and file. Record of positions: first-choice votes Dhwani 2 (Mumbai Native, Sponsor Stacker), Recharge 2 (Judge's Eye, Operator/Revenue); Critic re-score (#10b) → Recharge × Octroi; Devil's Advocate (#10a) → Dhwani v2 with two dated reversal conditions. The Chair's honesty requirement is met in §5: **no base case reaches the founder's $10,000/week bar.**

---

## 1. The decision

**We build Recharge** (the Recharge × Octroi hybrid of `round2-mumbai-native.md` §2 and `round2-sponsor-stacker.md` §4, with the Sponsor Stacker's security design and the Mumbai Native's product scope), under the name **Recharge**; "Octroi" is the name of the proof-or-pay quota engine inside it.

**The one sentence** (repeated verbatim in README, video and pitch):

> **Recharge: prove you're human and a sponsor pays for your first 300 MB of Mumbai data; after that you — or your agent — pay per 100 MB over x402, every bundle is an Arkiv entity that expires by itself, and anyone can gift data to an ENS name.**

Mechanism sentence that follows it everywhere (answers Q-JUDGE-OCTROI-1): *Glassbox402 priced humans and agents differently; Recharge is the gate that proves which is which, and sells them a good people want on day one.*

**Partner programs (3):** Hedera (x402 on Hedera + Continuity), World (IDKit; [Cont] Best IDKit Use Case; Agent Pass only if AgentKit beta lands), Arkiv (Continuity or from-scratch + Swarm bonus). ENS integrated, unclaimed. Arc dropped (decorative — Q-JUDGE-RECHARGE-2). Hedera "No Solidity" forgone: `DataDrop.sol` is Solidity on Hedera EVM (§4).

**Entry track:** Continuity, declared in writing, with minimal real integrations on each sponsor's testnet deployed by the human team **before** kickoff (§7).

**Runner-up: Dhwani v2** (`round2-judges-eye.md` §2), the stablecoin soundbox.

**The switch trigger — Wed 4 Nov 2026, 18:00 IST. Owner: Integrations lead (a) and Founder (b).** The committee switches to Dhwani v2 if **either**:

- **(a) No India-usable eSIM profile attaches.** Across three attempts each on a team iPhone (iOS 17.4+) and a team Android, no profile from any source — MegaeSIM sandbox, eSIM Access, or a retail-bought fallback profile — registers on Jio or Airtel within 10 minutes of install. Then the hero moment ("No Service → LTE") cannot exist and the product fails Practicality by construction.
- **(b) The legal memo says the free bundle itself is unlawful.** The one-page Indian telecom/FEMA memo commissioned today concludes that a zero-price, online delivery of a foreign roaming eSIM to a non-resident who is physically in India cannot be structured lawfully. (A memo that only forbids *sales* on Indian soil does not trigger the switch: the committee has already deleted those — §3 Table A, Q-SEC-Recharge-1.)

**Hedge bought regardless (today, ≈₹6–9k, Lamington Road or same-day delivery):** Pi Zero 2 W or Pi 4, ReSpeaker 2-Mics HAT, USB microphone, USB sound card, powered speaker. This removes the Dhanteras-courier dependency the Devil's Advocate priced at 0.30 (`round3-devils-advocate.md` §1(3)). If the switch fires, Dhwani's own hardware gate (box speaks a composed amount from the voice bank; ≥80% chirp decode at 20 cm / 70 dB over 20 trials) runs at **Thu 5 Nov 12:00 IST**; if that also fails, Dhwani proceeds in Plan C (laptop as the box, chirp on video), because a voice demo without hardware still beats an eSIM demo without a network. The shared v0 modules (§6) make the switch survivable: design system, Arkiv adapter, EIP-3009 verification/relay, deploy harness and hygiene templates are common to both products.

**Lifafa is not the runner-up for this hackathon.** It is recorded (§5, §10) as the committee's post-event revenue alternative, with its own dated test, because the Devil's Advocate's Round-3 attacks (`round3-devils-advocate.md` §3) break its mechanism — the mandatory public fill leaks the sealed call — and because its pre-build would be 100% non-sponsor code, the worst Continuity fit on the table.

---

## 2. Why (committee reasoning, ten points)

1. **It is the only v2 that is never last on any lens, and it has the highest P(ship).** Ops P(all three sponsor rails real and demoable) 0.60 against Dhwani's 0.50 (0.45 if the Pi must be on the table) and Lifafa's 0.55 (0.47 with Hyperliquid testnet). — #10b, `round3-rescore.md` §2(e), §5, §6.
2. **It satisfies both halves of the dual mandate better than either alternative.** Prize EV ≈ $3.24k is within $460 of Dhwani's $3.7k, while P(≥$10k/week by month 9) is 10% against Dhwani's 6%; the Chair's instruction was the best *combined* outcome with the most credible, *testable* path to the bar. — #10b, `round3-rescore.md` §4; Chair's note, `ROUND3-BRIEF.md`.
3. **Its revenue hinge is the only one that can be tested inside the window.** A sponsor either pays ~$7.5k for a humans-only, pre-arrival, branded data drop or does not; the buyer is in the building on Thursday. Dhwani's hinge (a PSP or organiser contract by Q1 2027) cannot resolve this week; Lifafa's (signed LOIs from Hyperliquid signal groups) has been asked for twice and not delivered. — #2 `round2-operator-revenue.md` §1 (Q-VC-CallSheet-3); #4 `round2-mumbai-native.md` §2 field 6; #10b `round3-rescore.md` §2(b).
4. **It has the broadest support in the committee.** Two proposers converged on the same hybrid independently (#3 and #4, Round 2), and the other two proposers voted it first (#1 `round2-judges-eye.md` §3; #2 `round2-operator-revenue.md` §3). Dhwani's support is equally wide but its two first-choice votes come with conditions the Devil's Advocate turned into gates.
5. **It needs no hardware.** Dhwani's finalist shape (P(top-10) 10%) rests on a Pi with working audio by Wednesday in Dhanteras week; without it the Judge's own number falls to ~6% and the WOW to a QR with a recording. — #9 `round1-ops-feasibility.md` §2; #10a `round3-devils-advocate.md` §1(3); #10b `round3-rescore.md` §4 sensitivities.
6. **Its legal perimeter can be closed by deletion, not by a partner that does not exist.** Sold online by an offshore entity to non-residents, Recharge survives the hostile crypto-twitter audit (#5 `round1-security.md` (C)); the Devil's Advocate's contradiction (sales to buyers standing in BKC) is removed by striking Devcon-week sales and the mainnet paid lane from the demo (§3 Table A). Dhwani's India mode needs an FIU-registered off-ramp partner nobody has named (#1 `round2-judges-eye.md`, Q-VC-Dhwani-3).
7. **Users want it on day 1 and day 4.** Desire 8, the highest in the deck with Dhwani; the only idea the Power User would open twice unpaid; the VC's highest P(≥$1 in 30 days) at 60%. — #8 `round1-power-user.md` #10; #6 `round1-vc-skeptic.md` (B).
8. **Each sponsor's newest primitive is the mechanism, not storage.** Hedera's x402 track text verbatim (pay-per-call data endpoint, Agent Kit buyer, HCS-14 identity, HCS receipts); World ID credential level as *pricing* with sponsor money released by the nullifier; Arkiv `expiresIn` as the plan's validity clock with three load-bearing reads. — #3 `round0-sponsor-stacker.md` P1, `round2-sponsor-stacker.md` §4; #7 `round1-veteran-judge.md` #7 (Arkiv 30%: "the only proposal using a native primitive as mechanism").
9. **It is the only honest Continuity story.** Attendees land 3–5 Nov; a team-funded free welcome bundle can have real verified-human users before 20:59 Thursday, so the "existing project" is a four-day-old product with users, not a repo. — #3 `round2-sponsor-stacker.md` §6; #10b `round3-rescore.md` §2(c).
10. **The orchestrator can build most of it where it is.** The sandbox cannot reach any testnet or sponsor API (`docs/ENVIRONMENT-CONSTRAINTS.md`), but an x402 gateway, a quota engine, a reseller adapter written against documented APIs with fixtures, `DataDrop.sol` on Anvil and a PWA are exactly what runs end-to-end in `MODE=local`; the in-window delta is live wiring, product features and design, not invention. Dhwani's core — audio on a Pi — cannot be validated in the sandbox at all. — #9 `round1-ops-feasibility.md` §1 pre-build policy; the scaffold's `packages/adapters/README.md`.

**What the committee gives up, knowingly:** Dhwani's finalist shape (~3 points of P(top-10), ~$460 of EV) and the clip of a box that talks; Lifafa's 20% revenue ceiling (which the Devil's Advocate's leak attack roughly halves); the Arc, 0G, Uniswap and Definitive pools; the Hedera No-Solidity $2k; and a WOW that is a phone lighting up and a scratch card rather than a talking box. — #10b `round3-rescore.md` §6; #10a `round3-devils-advocate.md` §5.

---

## 3. Every question, resolved

Resolution codes: **Accepted fix** (the answer is adopted and is now a build requirement; the module or gate that enforces it is named), **Open risk — owner** (not closable before kickoff; the owner, the date and the test are named), **Rejected** (the committee does not accept the claim or the critique). Proposer answers are quoted or summarised from the Round-2 files; critic views from Round 1; DA = Devil's Advocate, Round 3; RS = Critic re-score, Round 3.

### Table A — Recharge (chosen; Round-1 ids from `round1-security.md`, `round1-vc-skeptic.md`, `round1-veteran-judge.md`, `round1-power-user.md`, `round1-ops-feasibility.md`)

| ID | Question (short) | Proposer's answer (#4 `round2-mumbai-native.md`; #3 `round2-sponsor-stacker.md`) | Critic / DA view | Committee resolution |
|---|---|---|---|---|
| Q-SEC-Recharge-1 | Will any sale or USDC payment physically happen in India, under which authorisation? | #4: concede in part — no table sale, no USDC on Indian soil; offshore entity sells online to non-residents (Airalo's posture abroad; Jan-2024 delisting marks the line); venue presence is a poster and zero-price vouchers. #3 contradicted this with "stand sales in Base USDC". | Security R1: High · Structural in-country, 36h if sold online offshore. DA §2(1a): a buyer standing in BKC, for a profile used in Mumbai, is a sale in India whatever the server's domicile — delete Devcon-week revenue and the live paid-lane demo, or stop claiming the perimeter is closed. RS: delete "stand sales". | **Accepted fix, as amended by the DA.** Zero sales during Devcon week: no stand, no mainnet checkout reachable from India, no Indian marketing. Welcome bundles are zero-price promotional gifts to non-residents from the offshore entity. The paid lane is demonstrated on **testnet** (test USDC — not a sale). Devcon-week revenue is struck from the model (§5). Mainnet sales open only outside India and after the memo. **Open risk — Founder:** the memo (commissioned today, due Wed 18:00) is also switch trigger (b). |
| Q-SEC-Recharge-2 | How is the activation code delivered so only the paying wallet installs it; what caps agent spend? | LPA string returned only inside the x402 response, ECIES-encrypted to the payer's wallet key, single fetch; salted commitment on ENS; user-set USDC/day cap on the Agent Kit wallet; per-ICCID daily cap; nonce-bound signed reseller webhooks; free tier Orb-only (#4) / credential-tiered (#3). | Security R1: Med · 36h. DA §2(1c): browser wallets expose no encryption key (`eth_getEncryptionPublicKey` deprecated) — what ships is a PWA session key, fine but not what was promised. RS: FIXED. | **Accepted fix, as amended.** The PWA generates an ephemeral X25519 keypair per purchase; its public key rides in the x402 payload (`extra.sessionPubKey`, bound to the payment nonce); the LPA string is sealed to it (`packages/crypto/sealed-lpa.ts`, XChaCha20-Poly1305) and is fetchable once. Caps live in code (`TopUpPolicy`), not in the LLM. Webhooks: HMAC + timestamp + nonce, 5-minute replay window. Tests in §6.5. |
| Q-VC-Recharge-1 | What share of attendees switch from an Airalo profile installed at home, and why? | Concede: prepared attendees will not switch and need not; the sponsor-paid 300 MB is accepted by prepared and unprepared alike; paid top-ups come from card failures and day-5 expiries of 7-day plans; planning ratios 25% of foreigners claim, 20% of claimants buy. | VC R1 realism 3: "the attendee whose card fails 3DS already has Airalo". RS: the sponsor buys reach, not sybil-resistance. | **Accepted (concession).** Retail is modelled at 50–300 plans/week (§5), never 400–1,500. The free bundle is the acquisition channel. The 25%/20% ratios are the first thing the team-funded pre-kickoff campaign measures (evidence E2, §5). |
| Q-VC-Recharge-2 | Name conference organisers who will pay $2.50/attendee; what did Airalo/Saily quote them? | Concede: no names; the organiser line is deleted; the payer is the sponsor's event-marketing/giveaway budget (one Mumbai sponsor data drop at $7.5k for 2,000 claims; sales meeting Thursday). | VC R1: organisers get Airalo/Saily partner codes free. RS: testable in one meeting; sides with #3's $2k base. DA §2(2): the two proposers' bases differ 2×; with drops = 0 the business is $0.2–1.2k/week retail. | **Open risk — Founder/Operator. This is the hinge.** Base adopted at $2.0–2.4k/week (12 drops a year, not 24). Test: ≥3 asks on Thursday (E1), one signed drop by 30 Nov (E3). If E1 fails, the pitch and README downgrade the revenue thesis before submission. |
| Q-JUDGE-RECHARGE-1 | Is a reseller account approved; what is the measured activation latency on stage? | None exists on 3 Nov; open MegaeSIM (instant sandbox) and eSIM Access today; buy 30 retail India profiles as fallback; installs typically attach in 1–3 min; measure Thursday night on three devices; keep a pre-installed second phone. | Judge R1: "no reseller account by 4 Nov → dead". DA §2(3): the single point of failure is the profile attaching to an Indian network on stage; roaming profiles can take minutes to register; eSIM Access is self-serve but India wholesale is unpublished. | **Accepted fix + gate.** Accounts opened today (owner: Integrations lead). The attach test is **switch trigger (a), Wed 18:00**, not a Thursday-night measurement. Latency measured Wed/Thu on three devices and printed in the README. On stage: a pre-installed second phone carries "No Service → LTE"; the live steps are the World verification, the `Claimed` event on HashScan and the Arkiv entity; one live install is attempted with a 90-second cutover rule. |
| Q-JUDGE-RECHARGE-2 | What breaks if Arc is removed, given settlement is on Hedera? | Concede: Arc was decorative; dropped; Arkiv takes the third slot (Octroi's BTL quota becomes the plan's validity). | Judge R1: Arc 12%, decorative. | **Accepted.** Arc removed. Partner set: Hedera, World, Arkiv; ENS integrated, unclaimed. |
| Q-JUDGE-RECHARGE-3 | Does an eSIM kiosk read to finalist judges as a crypto project or a merchant? | It reads as a merchant if minute one is a price list; minute one is a sponsor's pool paying for the judge's bundle because her nullifier is new, her agent paying x402 per 100 MB, the plan living as an Arkiv entity that dies by protocol, and a gift to an ENS name. | RS: FIXED. DA §2(6) quote-tweet: "Silent.link has sold crypto eSIMs since 2021…". | **Accepted fix.** Pitch order is fixed: mechanism first (proof-or-pay with money behind the nullifier), eSIM second; the README's first sentence is the mechanism sentence; the prior-art section answers Silent.link (no human lane, no on-ledger entitlement, no agent metering, no gifting by name). No price list appears before minute three. |
| Q-USER-RECHARGE-1 | Which chains can a landing foreigner pay from; is same-phone install a universal link / direct install rather than a QR she cannot scan? | Base USDC (x402 Base scheme, Coinbase facilitator) or Hedera USDC; no bridge; Apple's eSIM universal link (iOS 17.4+) and the Android LPA intent; QR only for a second device. | Power User R1: desire 8 if so. | **Accepted fix.** `accepts[]` = [Base Sepolia USDC, Hedera testnet USDC] in the demo; mainnet later = Base USDC and Hedera USDC. PWA `/install` uses the Apple universal link and the Android `LPA:` intent; QR is the second-device fallback. |
| Q-USER-RECHARGE-2 | Agent permission UX (cap, revoke); does the top-up fire before the user runs dry given usage-API lag? | Cap and pause on one sheet ("≤ $10/day · pause"); triggers on plan expiry (deterministic) and on the usage webhook at 20% remaining; the screen prints "usage as of 14:02" so lag is visible. | Power User R1 asks. DA §2(4): Hedera judge will see "your own agent buying from your own endpoint on a mocked usage trigger". | **Accepted fix.** `TopUpPolicy{maxUsdPerDay, thresholdMb, stepMb, paused}` on one sheet, enforced in code. The demo's agent trigger is plan-expiry or a real usage webhook; if the reseller's usage API lags, the simulated usage clock is labelled "simulated usage" on screen (honest mock, §6.6). |
| Q-OPS-RECHARGE-1 | Which reseller account was opened today, ETA, India wholesale price? | None opened (the sandbox cannot); humans open MegaeSIM + eSIM Access today; wholesale $0.70–1.14 per GB/7 d regional, India `[verify]`. | Ops R1: P(fail) 0.50 → pre-bought inventory. DA: self-serve "in minutes", India price unpublished. | **Open risk — Integrations lead, today EOD.** Both accounts opened; the India catalogue price is recorded in the README. The bundle-size rule `bundleMb = min(tierMax, floor(0.8 × $0.50 / wholesaleUsdPerMb))` is set from the real India price — this is how the top-tier farm-EV problem (DA §2(1c)) is closed in code. |
| Q-OPS-RECHARGE-2 | What exactly is Arc's "marketplace discovery API"; if unverifiable by Tue, which Arc prize? | Unverifiable, so Arc is dropped entirely rather than swapped to Bridge Kit, which adds a rail nobody landing in Mumbai needs. | Ops R1: 0.50 unverified. | **Accepted.** Same as Q-JUDGE-RECHARGE-2. |
| Q-OPS-RECHARGE-3 | Does pre-buying 30 India eSIM profiles count as project work under from-scratch rules? | Inventory is not code; disclosed; moot under the pre-build reality because we enter Continuity. | Ops R1: inventory is not code — disclose it. | **Accepted.** Continuity entry; inventory, accounts and faucet claims are listed in `docs/DISCLOSURE.md` (§7). |

### Table B — Octroi (chosen, as the quota engine; Round-1 ids as above; proposer #3 `round2-sponsor-stacker.md` §1)

| ID | Question (short) | Proposer's answer | Critic / DA view | Committee resolution |
|---|---|---|---|---|
| Q-SEC-Octroi-1 | How is an Agent Pass credential bound to a request (nonce, audience, expiry); replay window? | Rebut with design: challenge bound to {audience, path, nonce, exp ≤ 120 s}; agent answers via `agentkit.fetch`; the consumed nonce becomes an Arkiv entity with `expiresIn: 120`; IDKit proofs carry `signal = keccak(nonce ‖ audience)`, verified once. Replay window zero after use, ≤120 s unused. | Security R1: Med · 36h. RS: FIXED. | **Accepted fix.** `packages/octroi/challenge.ts`; the nonce cache is written to Arkiv *and* held in memory, and the check fails closed if the ledger is unreachable (a Kaolin hiccup can never permit a replay). Replay test in §6.5. |
| Q-SEC-Octroi-2 | Portability or unlinkability — which? | Concede: unlinkability. Quota key = HMAC(provider secret, nullifier); per-provider pseudonyms only; "portable quota" dropped. (#4's variant emits the raw nullifier on-chain.) | Security R1: pick one. RS: #3 unlinkable FIXED; #4's raw nullifier restates the tracker. | **Accepted fix (the #3 design).** `DataDrop.claim` records `claimKey = keccak256(campaignId ‖ HMAC(secret, nullifierHash))`, never the raw nullifier. The sponsor's audit list is the HMAC'd list, verifiable with a per-campaign audit key the sponsor holds. |
| Q-VC-Octroi-1 | List ten live x402 sellers with >$1k/month real revenue who would pay $299/month. | Concede: cannot name ten; x402 sellers have ~zero non-wash revenue; v2 moves the toll onto a good with a day-one payer. | VC R1: realism 2. | **Accepted (concession).** Octroi is not sold as middleware; no SaaS line exists in the model (§5). |
| Q-VC-Octroi-2 | Why does a faucet/RPC operator pay $1k/month when Turnstile + Pay-Per-Crawl cost $0? | Rebut in part (bot management is a paid category), concede the buyer (faucets and RPC free tiers are cost centres). | VC R1 as asked. | **Accepted (concession).** No API-provider customers in the model. |
| Q-JUDGE-OCTROI-1 | The one README sentence separating this from Glassbox402's human/agent pricing? | "Glassbox402 prices humans and agents differently once it knows who they are; Octroi is the gate that proves it — a human-backed agent passes free on an AgentKit challenge, an anonymous one pays x402, and every quota window expires on Arkiv by itself." | Judge R1 asked for it. | **Accepted.** Adopted as the mechanism sentence in §1 (Recharge wording). |
| Q-JUDGE-OCTROI-2 | Does Agent Pass expose a credential an API can verify server-side today, or is the human lane mocked? | "Agent Pass" has no docs; **AgentKit** (beta) does proof-instead-of-payment and discount modes; the server side is what Octroi is; access needs a verified-World-ID developer — apply today; without beta by Thu 21:00 the agent lane is demoed with IDKit humans and labelled. | Ops R1: Agent Pass fails 0.60 → IDKit. RS: Agent Pass 8% only if beta lands. | **Open risk — Sponsor lead; apply today, decide Thu 21:00.** IDKit ($2.5k; [Cont] under Continuity) is the banked submission; Agent Pass ($5k) is claimed only if beta access lands; otherwise the agent lane runs on IDKit humans, labelled on screen and in the README. |
| Q-JUDGE-OCTROI-3 | Is anything physical or visible in the room? | Concede: nothing in Octroi; the hybrid's visible object is a phone lighting up. | Judge R1: W4 for middleware. | **Accepted, and extended.** The phone, plus printed scratch cards handed to judges (§8). |
| Q-USER-OCTROI-1 | Which real agents hold Hedera funds today; if first payers are Base-USDC agents, why is the paid lane on Hedera? | Concede the fact, rebut the design: `accepts[]` lists Base USDC and Hedera USDC/HBAR; payers pay where they hold; Hedera is one rail and the selected prize; the demo agent (Hedera Agent Kit) pays there. | Power User R1: Hedera is a prize, not a rail. DA §2(4): "the only Hedera settlement is your own agent buying from your own endpoint — we paid ourselves". | **Accepted fix + strengthening.** Hedera must settle a **human** purchase in the demo (a judge or non-team attendee paying x402 on Hedera testnet from a Hedera wallet), the sponsor pool `DataDrop` lives on Hedera EVM so sponsor USDC moves on Hedera for every human claim, and the agent's Hedera purchase is the third Hedera settlement, not the only one. Thursday's ask to Hedera devrel: fund a 100-claim testnet campaign from *their* account. |
| Q-USER-OCTROI-2 | What does the end-human see when a free API demands World ID; fallback when they refuse? | Concede: a face scan for a weather API is a bounce; v2 inverts it — the human gets something worth money (free data) for verifying; the fallback is always "pay the toll", never a block. | Power User R1: Octroi desire 3. | **Accepted fix.** The PWA's first screen offers both paths side by side: "Prove you're human → 300 MB free" and "Skip → pay $0.40 per 100 MB". Nobody is blocked. |
| Q-OPS-OCTROI-1 | Measured Kaolin query latency for attribute filters; is a per-request read viable; does a cached read count as "reading from Arkiv"? | Write-through, 60-second cached reads on the hot path, a real query at every window boundary and on dashboard/agent load; "must actually read" means load-bearing reads; measured Thursday night. | Ops R1: 0.35 → cache. RS: "we will ask about the 60-second cache". | **Accepted fix.** Three load-bearing reads are named and tested (§3 Table D, Arkiv row; §6.5). Latency is measured at the **Wednesday pre-deploy** (not Thursday night) and printed in `ARKIV_FEEDBACK.md`; the cache question is put to Arkiv devrel at kickoff. |
| Q-OPS-OCTROI-2 | If only AgentKit beta exists, which World track is the submission? | "Best Use of IDKit" ($2.5k) is banked; "Agent Pass" ($5k) only if AgentKit beta access lands by Thursday. | Ops R1 as asked. | **Accepted.** Under Continuity the primary World submission is **[Cont] Best IDKit Use Case** ($2.5k); at kickoff we ask whether the open IDKit track also admits Continuity entries. |

### Table C — Dhwani v2 (runner-up; proposer #1 `round2-judges-eye.md` §1; carried into the switch build only if the Wed 18:00 trigger fires)

| ID | Question (short) | Proposer's answer | Critic / DA view | Committee resolution |
|---|---|---|---|---|
| Q-SEC-Dhwani-1 | Where do receiving and relayer keys live; max float; `receiveWithAuthorization`? | Box holds one relayer key with a 5 USDC float; merchant's receiving key never touches the box; `receiveWithAuthorization` into `DhwaniSplitter`; speaks only after `status=1`; balance check; rate-limited `from`. | Security R1: Med · 36h. RS: FIXED. | **Accepted fix.** The shared `packages/eip3009` module (§6) already implements receive-with-authorization digest building and signer recovery for the x402 exact scheme, so the switch build inherits it. |
| Q-SEC-Dhwani-2 | How is the fee enforced on-chain; who is the s.194S deductor when a resident merchant accepts VDA? | Fee via the splitter, on-chain; v2 charges no payment fee in India; non-resident payers create no 194S duty; resident payers would, so India mode routes every receipt to an FIU-registered off-ramp; CA memo pre-kickoff. | Security R1: High · Structural. RS: PARTIALLY FIXED (plausible, unmemo'd). | **Open risk — Founder (CA memo).** If switched: India mode is demo-only with a declared teammate merchant, no resident payers, pilots outside India. |
| Q-VC-Dhwani-1 | One data point supporting 10 foreign crypto payments per box per day. | Concede: none; 10/day was invented; 0.3/day adopted; revenue moved off that hinge. | VC R1 as asked. | **Accepted (concession).** |
| Q-VC-Dhwani-2 | Ramesh's legal USDC→INR path and all-in haircut vs UPI's 0% — why does he take it? | He never holds USDC; the FIU off-ramp pays INR in minutes at ≈2.2–3% all-in; he takes it against *no sale*, not against UPI; concede no resident payer will choose it; India is the launch stage, not the market. | VC R1 realism 2 → RS 3. DA §1(6): "a stablecoin he can't legally hold". | **Accepted as narrative; rejected as business.** India generates no revenue in any Dhwani case; the pitch must say so. |
| Q-VC-Dhwani-3 | Which entity, in which jurisdiction, holds merchant contracts and fees after the RedotPay probe? | An offshore (Singapore/UAE) hardware-and-software company that never custodies funds; off-ramp contracts sit with the FIU partner; India mode ships only with such a partner signed. | VC R1 as asked. | **Accepted.** Same entity decision serves Recharge (§5). |
| Q-JUDGE-DHWANI-1 | The 20-second answer to "how does the chaiwala get rupees, and is it legal after today's probe?" | "He doesn't touch crypto. The tourist's dollars land at a registered Indian exchange that pays rupees to his bank in minutes and deducts TDS like any exchange. This week's probe is the opposite flow." | RS: FIXED (told, not demoed). | **Accepted fix**, with the demo merchant declared a teammate and the paying customers (events, PSPs) named in the pitch. |
| Q-JUDGE-DHWANI-2 | Cutover rule if the live chirp fails twice; decode rate at venue noise? | One live chirp; no decode in 12 s → QR button, online mode, video carries the chirp; target ≥90% at 20 cm/70 dB; measured Wednesday; below 80% the chirp is demoted to video. | DA §1(3): the single point of failure is audio on hardware that does not exist yet; Plan C takes W10 to W5. | **Accepted fix + gate.** Hardware bought today as the committee's hedge; gate Thu 12:00 if switched (§1). |
| Q-JUDGE-DHWANI-3 | Does Anon-RPC cover Arc; does EF count a worker you run yourself? | Concede: a Pi cannot consume a browser-worker spec honestly; dropped; third sponsor becomes 0G "Agents with a Body", ENS the 3-hour fallback. | DA §1(4,5): "Agents with a Body" is from-scratch; "Keep Building on 0G" is meaningless for a project with no prior 0G; 0G is the sharp edge. | **Accepted (drop Anon-RPC). Open risk — 0G.** In the switch build the third sponsor defaults to **ENS** (subnames `ramesh.dhwani.eth`, text records as the box's config) unless 0G devrel confirms at kickoff that Continuity entrants may compete in Agents with a Body. |
| Q-USER-DHWANI-1 | Multi-chain EIP-681 or Arc only; if Arc-only, the bridge path and tap count? | Arc-only was wrong; v2 accepts USDC on Base, Arbitrum and Arc; the chirp packet carries a chain byte; demo: Arc with USDC gas and Base Sepolia with an ETH float. | RS: FIXED. DA §1(1a): this made Arc optional — the proposer's own degradation table shows the relay running on Base with an ETH float. | **Accepted with amendment.** Online acceptance is multi-chain; the **offline relay is Arc-only** (the box holds one asset, USDC); the Base-Sepolia ETH-float relay is deleted from the demo so "remove Arc → offline mode requires the box to hold ETH" is true again. |
| Q-USER-DHWANI-2 | Is the offline PWA a second wallet or a session key (7702/4337); how is it funded? | For the demo an embedded key — a trick; product path is an EIP-7702/4337 session key allowed to sign 3009 authorizations up to $50/day. | RS: RESTATED. DA §1(1b): the offline payer must be online first, in our app — a prepared-user feature. | **Open risk — narrative (Practicality 7, not 9).** Pitch wording: "payer offline at the moment of payment, like UPI Lite X". |
| Q-USER-DHWANI-3 | Measured chirp duration and decode rate at ~70 dB? | Unmeasured; 103 bytes at ggwave audible Fast ≈ 7–13 s; measured Wednesday on the Pi; printed whatever it is. | Power User R1 asked. | **Accepted fix (gate).** |
| Q-OPS-DHWANI-1 | Does Arc USDC expose `transferWithAuthorization` on 5042002; is permit+router acceptable? | Yes — Security verified EIP-3009 on Arc testnet USDC with a documented relayer flow; the fresh-account drain revert is handled by never draining to zero; permit+router acceptable as fallback. | Security R1 verified. | **Accepted.** |
| Q-OPS-DHWANI-2 | Anon-RPC is browser-only — which component consumes it; is a self-run relay honestly "producing anonymity"? | No component can consume it honestly; dropped. | Ops R1 as asked. | **Accepted.** |
| Q-OPS-DHWANI-3 | Who has shipped ALSA/I2S audio on a Pi; Plan-B box if the HAT fails? | Name one person by Tuesday; buy a ReSpeaker 2-Mics HAT plus USB mic and USB sound card Wednesday; Plan B Pi 4 + USB audio; Plan C laptop as the box with a Bluetooth speaker. | Ops R1: 0.30 fail. DA: Dhanteras kills couriers. | **Accepted fix, moved earlier.** Hardware bought **today** regardless of the switch; the ALSA-capable teammate is named today. |

### Table D — Devil's Advocate, Round 3, against Recharge × Octroi (`round3-devils-advocate.md` §2)

| DA item | The attack | Proposers' position (R2) | Committee resolution |
|---|---|---|---|
| §2(1)a — legal fix vs revenue line | Offshore/online/non-resident is the fix, yet both v2s book Devcon-week sales and a live paid x402 in the hall; a sale to a buyer standing in BKC for use in Mumbai is a sale in India. | #4 "foreigners buying top-ups from Friday"; #3 "stand sales in Base USDC". | **Accepted.** See Q-SEC-Recharge-1: no sales in India, no stand, testnet paid lane in the demo, Devcon-week revenue struck. Memo due Wed 18:00 (trigger b). |
| §2(1)b — the badge already solves the sponsor's problem; Indians get the smallest bundle | A single-use voucher on the attendee QR is one-per-attendee without World App; the data-drop premium buys sybil resistance the check-in desk already gives; tiering hands Orb-verified foreigners 500 MB and Device-level Indians 100 MB. | #4: the pain is swag-farmers; #3: credential tiers make farming EV-negative. | **Partly rejected, partly fixed; the residue is the Thursday test.** (i) The airport moment precedes the badge and the sponsor also buys pre-arrival distribution and an identity that persists across events; (ii) a badge cannot verify an *action* — v1 adds action-conditioned campaigns ("one bundle per verified human who deployed on your testnet": `Campaign.actionCheck`), which is the Devil's Advocate's own Asli-as-data-drops option (§4 of his file) absorbed into Recharge and the Thursday offer; (iii) nationality optics are removed by design: **Device-level gets no smaller gift — it gets the paid lane at the human price**; the free bundle is for non-residents with Orb/Document credentials (Indian residents have ₹300 Jio plans and cannot lawfully be sold foreign roaming data for use in India anyway); (iv) **Open risk — Founder:** a sponsor may still answer "the badge does this" on Thursday; that is precisely E1. |
| §2(1)c — ECIES-to-wallet-key is not implementable; top-tier farming is EV-positive | MetaMask's encryption RPCs are deprecated; Orb tier 500 MB ≈ $0.57 wholesale > $0.50 ID resale price. | #3's tier maths assumed Device 100 MB ≈ $0.25. | **Accepted.** Session-key sealing (Q-SEC-Recharge-2). Bundle sizing rule from the real wholesale price with a hard 300 MB ceiling at every tier (Q-OPS-Recharge-1); hourly claim caps per campaign and a sponsor pause key in `DataDrop` (RS top remaining attack); the published HMAC'd claim list. |
| §2(2) — weakest revenue claim | 24 drops a year with no sales team; 400 plans/week from a brand with no distribution; honest base $0.2–1.2k. | #4 base $4.2k; #3 base $2k. | **Accepted.** Base = 12 drops/yr + ~300 plans/wk ≈ $2.0–2.4k (§5). The committee adopts the lower proposer's number and names the hinge test. |
| §2(3) — single point of failure | The profile attaching to an Indian network on stage; "No Service → LTE" becomes a toggle on a pre-installed phone. | #4: pre-installed second phone. | **Accepted.** Wed 18:00 attach gate (trigger a); measured latency published; pre-installed phone carries the hero shot while the live steps are the verification, the HashScan `Claimed` event and the Arkiv entity; one live install attempted with a 90-second cutover. |
| §2(4) Hedera — "we paid ourselves; x402 is a from-scratch track" | Humans pay on Base; the only Hedera settlement is our agent buying from our endpoint on a mocked trigger. | #3: Hedera is one rail and the selected prize. | **Accepted fix + Open risk — Sponsor lead.** A human pays on Hedera in the demo; the sponsor pool settles on Hedera EVM per human claim; the agent trigger is expiry or a real webhook; the ask to Hedera devrel is to fund a testnet campaign from their account. Eligibility: pre-deploy (§7) makes Recharge an existing Hedera project at 21:00; the question is asked verbatim at kickoff; floor is the ~$1.5k Continuity lane; if Hedera devrel says Continuity entries are ineligible for every lane, the partner slot swaps to ENS at the Sat 18:00 form freeze. |
| §2(4) World — "a voucher does what your nullifier does; where is money behind the decision; why Device-level least" | — | #3: IDKit as pricing. | **Accepted fix.** The nullifier *releases sponsor USDC on-chain* (`DataDrop.claim`) — a trust decision with money behind it; credential level sets the gift size and the toll (verified humans and human-backed agents pay the human price); Device-level is not given less, it is priced as human. |
| §2(4) Arkiv — "`expiresIn` is a TTL; the reseller's SM-DP+ is the source of truth; which read decides anything?" | — | #3: three reads; #4: "read on every request". | **Accepted fix.** Division of truth stated in `ARKIV_FEEDBACK.md`: the reseller is the source of truth for *usage*, Arkiv for *entitlement* (what you are owed), reconciled by the webhook. Three load-bearing reads: (1) every `/esim/*` request reads the entitlement entity (60-s cache) and serves or returns 402; (2) the agent's remaining-MB read decides the purchase; (3) the gift claim reads the escrow entity keyed by namehash. Each has an acceptance test (§6.5). |
| §2(5) — Continuity risk: Hedera x402 is from-scratch; Hedera Continuity reads "existing Hedera project" | Under Continuity Hedera is worth ≤$1.5k, nearer $0.3k if read strictly. | #3/#4: ask devrel Thursday. | **Open risk — Sponsor lead.** Mitigated by the pre-deploy (an x402 endpoint settling on Hedera testnet and `DataDrop` on Hedera EVM exist before kickoff) and by the ENS swap rule above. |
| §2(6) — the quote-tweet | "Silent.link since 2021… face scan… gave Indians the smallest bundle… a cron job buying 100 MB from itself on Hedera testnet 'an agent'." | — | **Rejected as a reason not to build; accepted as the README's prior-art brief.** Each clause is answered above: human lane and on-ledger entitlement (Silent.link lacks both), Device tier priced as human (no "smallest bundle"), a human Hedera purchase and sponsor money on Hedera (not a cron job paying itself). |

### Table E — Devil's Advocate, Round 3, against Dhwani v2 (`round3-devils-advocate.md` §1; binding on the switch build)

| DA item | The attack | Committee resolution |
|---|---|---|
| §1(1)a Arc optional by the proposer's own text | The relay runs on Base with an ETH float in the degradation table. | **Accepted fix:** offline relay Arc-only; Base-Sepolia ETH-float relay deleted (Q-USER-DHWANI-1). |
| §1(1)b The offline payer must be online first, in our app | A prepared-user feature; Practicality behind the WOW is thin. | **Open risk — narrative.** P scored 7; pitch wording "offline at the moment of payment, like UPI Lite X". |
| §1(1)c The khata is a public revenue ledger for an informal merchant | Every receipt entity is queryable by anyone. | **Accepted fix (36h):** amounts encrypted in the payload; attributes carry only an HMAC merchant pseudonym, chain, tx hash and day bucket; the merchant holds the audit key and can share it with an accountant (selective disclosure keeps "verifiable export"). |
| §1(2) Weakest revenue claim ($120k vendor GMV through the box per event) | Vendor-side stablecoin GMV at a 10k event is $5–20k; base falls to ≈ $2.1k, ≈ $100 without the PSP. | **Accepted.** Dhwani's base is recorded as $1.0–2.1k/week, $100 without a PSP contract (§5). |
| §1(3) Single point of failure: audio on hardware that does not exist | Plan C takes W10 to W5. | **Accepted:** hardware bought today; gate Thu 12:00 if switched. |
| §1(4) Sponsor objections (Arc "where does USDC-as-gas change the product"; Arkiv "Postgres with `expiresIn`, aggregation is a declared mock"; 0G "a recording is not a body") | — | Arc: fixed by (1)a. Arkiv: multi-box aggregation must be live — three boxes (two may be the same firmware on laptops, labelled) and the khata query is the hero. 0G: **Open risk** → ENS is the default third sponsor (Table C, Q-JUDGE-DHWANI-3). |
| §1(5) Continuity: 0G "Agents with a Body" is from-scratch; "Keep Building on 0G" meaningless | Third sponsor worth ≤$3k at 0G's discretion. | **Accepted** → ENS default; Arc "bring your project to Arc" and Arkiv continuity are the two fitting lanes. |
| §1(6) The quote-tweet ("the chaiwala was a teammate") | — | **Accepted as a disclosure rule:** the demo merchant is declared a teammate on stage and in the video. |

### Table F — The continuity catch-22 (`round3-devils-advocate.md` §0) and the Chair's counter-proposal

| Item | Position | Committee resolution |
|---|---|---|
| DA §0: a project with zero pre-window sponsor usage is the opposite of what three continuity lanes describe ("move an existing **Hedera** project forward", "Keep Building on **0G**", Arkiv "existing projects"), and the from-scratch lanes are forfeited by the public pre-build; each sponsor prize rests on a discretionary call nobody priced per partner. | DA. | **Accepted as the diagnosis.** |
| Chair's counter-proposal: the pre-build includes minimal but real integrations with each chosen sponsor, deployed by humans to the sponsor testnets on 4–5 Nov, so the project is a genuine existing project on each sponsor's network at 21:00; the in-window delta is the substantive feature work. | Chair's note, `ROUND3-BRIEF.md`. | **Adopted, with four constraints (§7).** Assessment: it *strengthens* partner eligibility (the continuity lanes become literally true rather than discretionary, and nothing in the rules the DA quoted sets a minimum age for the existing project), *improves* P(ship) (the 2–3 h first-contact tax per rail moves out of the window — Ops' biggest lever; Sponsor Stacker's estimate 0.45 → 0.70), and is *neutral* for finalist perception (the Continuity discount is already priced; a 48-hour-old existing project is still 48 hours old, with or without the pre-deploy). It *weakens* nothing that was not already forfeited: the from-scratch lanes were lost the moment the pre-build went public. Constraints: (1) minimal means one real round-trip per sponsor, nothing more; (2) ≥70% of each integration's final code and 100% of the product mechanism tied to it ship in-window; (3) explicit disclosure with tx hashes and a dated tag; (4) the eligibility question is asked of each partner at kickoff and the answer recorded in the README. Fallback if ETHGlobal staff reject a 3-Nov repo as a Continuity base: archive the pre-build private and enter from-scratch with human-authored product code (DA's closing rule). |

### Table G — The Chair's cross-cutting questions A/B/C (each critic answered a different B and C; all are resolved here for the chosen idea)

| Q | Critic's position (R1) | Resolution |
|---|---|---|
| **A** From-scratch vs Continuity | All five critics said from-scratch when the pre-build was hypothetical (Security: unaudited contracts, no user funds; VC: spend 3–5 Nov on sales; Judge: a repo created this week is fake continuity; Power User: pre-window UX work that is not code; Ops: continuity unavailable, do the handshake sprint). All four proposers reversed to Continuity under the founder's pre-build order (R2). DA: the catch-22. | **Continuity, declared in writing, with the minimal pre-deploy (§7).** The critics' legitimate pre-window asks are all kept: LOIs/sales meetings (VC), copy and design brief and interviews (Power User), accounts/faucets/hardware/memo (Ops), threat model and test vectors (Security), disclosure in the README (Judge). Keys generated on-site, never in the orchestrator's context (Security B). |
| **B** Security: sandbox-built, human-deployed fragility (Hedera 8-dec native vs 18-dec JSON-RPC; HTS association; USDC 6-dec) | Recharge ranked low-risk (one self-run facilitator fallback). | **Accepted:** decimals pinned in tests (USDC 6; HBAR gas never priced in app code); HTS token association in the deploy script; `DataDrop` has a `LEDGER_ONLY` mode if the HTS ERC-20 facade misbehaves at the Wednesday pre-deploy (§6.3); deployer, attestor and relayer keys generated on-site from faucets. |
| **B** VC: paying customer within 30 days | Recharge 60% / 15% (≥$1 / ≥$2k): attendees pay Friday. | **Accepted, with the India-sales deletion:** the first dollar now comes from a sponsor pilot (E1/E2) or an online non-resident purchase outside India, not from a Friday stand. Dates in §5. |
| **B** Judge: demos that survive a noisy hall and flaky Wi-Fi | Recharge survives — the demo *is* the phone's own cellular data. | **Accepted:** pre-seeded state, pre-installed phone, tx hashes shown, nothing waits on an unseeded oracle. |
| **B** Power User: 100 real users during Devcon week | A venue table plus one sponsor-funded welcome bundle gets 100 installs in a morning. | **Accepted as the team-funded free pre-arrival campaign** (Telegram/poster, zero price, non-residents, no stand selling anything) — it doubles as Continuity evidence and as the measurement of the 25%/20% ratios. |
| **B** Ops: graceful degradation when one sponsor fails on-site | Recharge medium (reseller → inventory); Octroi graceful (Arkiv → cache, Agent Pass → IDKit, facilitator → self-run). | **Accepted:** the degradation table in §6.6 and the Fri 06:00 swap gate per sponsor in §4. |
| **C** Security: hostile crypto-twitter audit | Recharge survives if sold offshore/online. | **Accepted:** that is now the rule, not a hope. |
| **C** VC: prize bait with no business | Octroi named; Recharge "a Devcon-week cash experiment, not a company". | **Accepted as the honest framing.** The committee says so in §5 and lets Thursday's test decide whether it is a company. |
| **C** Judge: his vote | Dhwani — "nothing else clears 6%". | **Recorded as dissent (§10).** The re-score moved Recharge × Octroi to 7%, above the Judge's threshold. |
| **C** Power User: the dunk list | Octroi "x402 wrapper four thousand, with a face scan"; Recharge "cannot be called slop". | **Accepted:** Octroi is never shown as middleware; the consumer good is the surface; the design brief (§8) is the slop defence. |
| **C** Ops: the five-person split | Contracts lead, Integrations, Frontend/mobile, Backend/indexer, Producer. | **Adopted and adapted (§6.7):** Integrations, Provisioning/Agent, Product/PWA, Design/Producer, Sponsor/Sales (founder). |

### Table H — For the record: CallSheet/Lifafa (the committee's post-event revenue alternative; proposer #2 `round2-operator-revenue.md` §1)

Not the runner-up (see §1), but the Devil's Advocate's second reversal condition names it, so every Round-1 id is closed here. Proposer answers are Lifafa's re-venue; the committee's view is binding only if the post-event pivot in §5 is ever exercised.

| ID | Proposer's answer (R2) | Committee view |
|---|---|---|
| Q-SEC-CallSheet-1 (pre-positioning; "nobody can trade ahead") | Withdrawn; defused by venue (deep books only); caller's own fill within 60 s, public. | **Open — structural.** DA §3(1)a: the public fill reveals asset, side, size and entry before T; sealing becomes theatre. Any pivot must hide the caller address until T and downgrade "venue-verified" to "Lifafa-verified until T". |
| Q-SEC-CallSheet-2 (session-key scope; stolen key) | No vaults; HL agent wallet on a dedicated sub-account; "blast radius = that sub-account's margin". | **Rejected as stated.** RS §3(a): an HL agent wallet trades for the master and *every* sub-account; fix = a fresh dedicated master wallet per follower holding only the mirror budget, agent keys with expiry. |
| Q-SEC-CallSheet-3 (real USDC on a hot key in the hall) | $0; testnet; ≤$50 mainnet fallback on an on-site key. | Accepted. |
| Q-VC-CallSheet-1 (share of calls with Unichain liquidity; day-30 product) | Concede; day-30 product is HL perps. | Accepted. |
| Q-VC-CallSheet-2 (why pay per fill vs HL vaults / Bybit at 0%) | Builder code ≤10 bps (5 for verified humans); per-call opt-in in your own account. | Partially accepted; DA §3(1)c: fee on execution and paywall on information decouple at T; agents route their own orders. |
| Q-VC-CallSheet-3 (names, sizes, written commitments) | No names; three LOIs before 5 Nov 21:00 or the thesis is downgraded to "prize play". | **Open — the test.** Zero LOIs as of 3 Nov. |
| Q-JUDGE-CALLSHEET-1 (one screen, one coherent trade) | One venue: the lifafa card with HL fill ids. | Accepted. |
| Q-JUDGE-CALLSHEET-2 (pre-positioning) | Liquid universe; caller's fill inside the envelope. | See SEC-1: structural leak. |
| Q-JUDGE-CALLSHEET-3 (first 30 seconds not a Telegram message) | A physical shagun envelope with the hash printed, torn open after the reveal. | **Rejected as designed.** DA §3(3): a pre-printed hash means the call was fixed hours before the "live" seal — the device dramatises the insider problem. Must be printed live. |
| Q-USER-CALLSHEET-1 (where USDC lives; one chain; 3-tap onboarding) | Follower's own HL account; connect + `approveBuilderFee`. | Accepted. |
| Q-USER-CALLSHEET-2 (what the demo trades; pool depth) | BTC/ETH perps. | Accepted; DA §3(1)b: on deep books the 40-second pain largely disappears. |
| Q-OPS-CALLSHEET-1 (cross-chain disjoint) | Gone; everything on HL. | Accepted. |
| Q-OPS-CALLSHEET-2 (mainnet budget, key holder) | $0 testnet; ≤$50 mainnet, integrations lead. | Accepted. |
| Q-OPS-CALLSHEET-3 (third sponsor if Definitive is continuity-only) | Arkiv; Definitive and Uniswap out. | Accepted; DA §3(5): worst Continuity fit (pre-build is 100% non-sponsor code). |

---

## 4. Sponsor map

Three partner programs, each load-bearing along one user flow: **identity (World) → money (Hedera: sponsor pool and x402) → entitlement (Arkiv)**. Removing any one breaks the product, not a feature. Amounts from `research/sponsors.md`; probabilities from `round3-rescore.md` §2(c) (P(placed) given top-decile execution).

| Partner · tracks | Load-bearing use | What breaks without it | Hygiene artifacts (owner: Design/Producer, Sponsor lead) | Fri 6 Nov 06:00 IST gate: pass test → fallback |
|---|---|---|---|---|
| **Hedera** — AI Agents That Pay: x402 on Hedera ($3k/$2k/$1.5k); Continuity (~$1.5k) as floor. *No Solidity ($2k) forgone: `DataDrop.sol` is Solidity on Hedera EVM; the $200 of EV is not worth an HTS-only contortion of the pool.* | (1) `GET /esim/topup` and `/esim/provision` return 402 with `accepts[]` including Hedera testnet USDC; a **human** pays on Hedera in the demo; (2) the sponsor pool `DataDrop` on Hedera EVM (chain 296) pays the service per verified-human claim — sponsor USDC moves on Hedera for every free bundle; (3) the top-up agent is a Hedera Agent Kit wallet with an HCS-14 UAID; (4) every claim, settlement and gift writes a receipt to an HCS topic. | No on-chain one-human-one-claim with money behind it; agents need accounts and API keys; the paid lane is a static checkout; receipts have no neutral timestamp. | Live endpoint URL in README; HashScan links for a `Claimed` event, a human settlement and an agent settlement; HCS topic id; UAID; the README section "Where Hedera lives in the code" (`services/api/src/routes/esim.ts`, `packages/contracts/src/DataDrop.sol`, `services/agent`). | **Pass:** one in-window 402→pay→200 settled on Hedera testnet and one in-window `Claimed` event by 06:00. **Fallbacks, in order:** remote facilitator fails → self-run `/verify` + `/settle` (allowed by the track); HTS ERC-20 facade misbehaves → `DataDrop` in `LEDGER_ONLY` mode with native HTS transfers; Hedera JSON-RPC/relay unreachable → Base Sepolia for all settlement, keep HCS if reachable, and **swap the partner slot to ENS** at the Sat 18:00 submission-form freeze. |
| **World** — [Cont] Best IDKit Use Case ($2.5k) primary; Best Use of IDKit ($2.5k) if open to Continuity; Agent Pass ($5k) only if AgentKit beta lands. | Credential level is *pricing*: Orb/Document → free welcome bundle (size by rule), Device → paid lane at the human price; the nullifier is what releases sponsor USDC (`DataDrop.claim`); human-backed agents get the human price via AgentKit discount mode if beta lands. | The sponsor-funded tier is a $0.34-per-profile sybil farm and is unfundable; no per-human claim; agents and humans pay the same. | Developer-portal `app_id` and action `recharge-welcome`; server-side verification logs (hashed nullifiers, timestamps) in the README; the tier table; verification-level screenshots from a non-team phone. | **Pass:** one in-window cloud verification from a non-team device (a foreign attendee with an Orb ID) by 06:00. **Fallback:** team pre-verified phones (Selfie Check works in India) plus a labelled simulator for stage; the prize is kept because pre-deploy logs exist from Wednesday. If AgentKit beta has not landed by Thu 21:00, Agent Pass is not claimed. |
| **Arkiv** — Continuity ($4k) or Build from scratch ($3k/$1k), whichever Arkiv devrel directs at kickoff; + Swarm bonus ($500). | Entitlements, receipts, gifts and challenge nonces are entities with `expiresIn` = the plan's validity (or 120 s for nonces); three load-bearing reads (every `/esim/*` request; the agent's remaining-MB read; the gift claim by namehash); the sponsor dashboard is a query, not our database. Sealed LPA blobs on Swarm, referenced from the entity. | Postgres and cron; expiry by scheduler, not by protocol; gifts and sponsor audits unverifiable by anyone but us. | `docs/arkiv.schema.json`, `docs/ARKIV_FEEDBACK.md` (with latency measured at the Wednesday pre-deploy and the 60-second-cache question), `docs/SWARM.md` (what each platform stores; entity key ↔ Swarm reference); entity keys and query strings in the README. | **Pass:** in-window write + attribute query on Kaolin (chain 60138453025) and one entity observed expiring by 06:00. **Fallback:** the Postgres mirror behind the same `Ledger` interface with a visible "ledger degraded" banner; swap the partner slot to ENS at Sat 18:00. |
| **ENS** — integrated, **unclaimed** (4th; becomes the third program only through a swap above) | Gift data to a name (`rahul.eth`), escrow entity keyed by namehash; later `recharge.eth` subnames for sponsors. | Gifting needs an address; sponsors lose a name. | Resolution code path in README. | n/a |

**Expected prize value under this map (re-score method, No-Solidity removed):** finalist 7% × $7.5k = $525; Hedera 20% × $2.2k = $440 (+ Continuity floor if x402 excludes Continuity entries, ≈ $450 × 0.3); World 25% × $2.5k + 8% × $5k = $1,025; Arkiv 30% × $3k + 30% × $500 = $1,050 → **≈ $3.0–3.2k**, with Ops P(all three rails real) ≈ **0.70** after the pre-deploy (0.60 before). The committee budgets for finalist + two placed sponsors; the third is optionality (`winners.md` §4.6).

**Submission mechanics:** three partner programs selected in the dashboard by Sat 7 Nov 18:00 IST; swap decisions are made at the Fri 06:00 gate and confirmed at the Sat 18:00 freeze; one video ≤ 3:00 serves all three; README has one section per sponsor with file paths, addresses, tx hashes and a video timestamp (`winners.md` §4.6 point 4).

---

## 5. Revenue model

**The honest sentence first: no finalist on this committee's table reaches US$10,000/week in its base case, and Recharge does not either.** Recharge's base is ≈ $2.4k/week at month 6; its high case clears the bar only on a lever the team can test on Thursday and prove or falsify by 30 November. The committee chose it because that lever is the *most testable* path to the bar, not because the base case is adequate.

### 5.1 Re-derived low / base / high (month 6; the VC's method, the re-score's haircuts, the Devil's Advocate's deletions)

Assumptions: wholesale $0.70–1.14 per GB/7 d (regional, verified by #4; **India price recorded today** — if it is above $2.00/GB, the retail margin line falls by a third and the free bundle shrinks to ≤ 200 MB by the sizing rule); retail $4.50/GB → ≈ $3 margin per plan; a sponsor data drop priced at **$7.5k for up to 2,000 verified-human claims of 300 MB** (data cost ≈ 600 GB × $1.14 ≈ $0.7k, ops ≈ $0.3k → **≈ $6.5k net per drop**); organisers excluded (they get Airalo partner codes free — Q-VC-Recharge-2); agent and gift willingness-to-pay zero (the VC's assumption, kept); **Devcon-week revenue deleted** (Q-SEC-Recharge-1).

| Case | Sponsor drops | Retail | Weekly total | What has to be true |
|---|---|---|---|---|
| **Low** | 0 | 50–150 plans × $3 | **≈ $0.2–0.4k** | Sponsors prefer hoodies or badge vouchers; the brand has no distribution (the DA's §2(2) case). |
| **Base** | 12 per year ≈ $78k ≈ $1.5k/wk | 300 plans × $3 = $0.9k | **≈ $2.4k** (the Sponsor Stacker's $2k if retail is 150) | One crypto conference a month buys a drop; the free bundle converts 20% of claimants to a paid top-up within the week. |
| **High** | 36 per year (3 a month) ≈ $4.5k/wk | 1,000–1,200 plans × $3 ≈ $3–3.6k | **≈ $7.5–8k** | Three drops a month plus retail at Airalo-India scale for one segment. |
| **$10k/week** | ~52 per year, i.e. a sponsored event *every week*, or a standing "data included" contract with an organiser network / ticketing platform ≈ $6.5k/wk | 1,200 plans ≈ $3.6k | **$10k** | Round 1's cadence objection, restated by the re-score: weekly cadence or a white-label contract. |

**Hinge:** a sponsor pays ~$7.5k for a humans-only, pre-arrival, branded data drop in preference to $0 Airalo codes, badge vouchers or $25 hoodies — and does so at ≥ 1 event a month (base) or ≥ 3 (high). **P(≥ $10k/week by month 9): 10%** (`round3-rescore.md` §4). For comparison, the same method gives Dhwani v2 $0.1k / $1.0–2.1k / $5–6k and 6%, and Lifafa $0.6–0.9k / ≈ $2–3.5k (after the Devil's Advocate's capture and leak haircuts) / $15–20k and ≈ 10–12% (the re-score's 20% before those attacks).

### 5.2 First three customers

1. **One Mumbai sponsor data drop.** Thursday's asks, in order: Hedera devrel, World devrel, Arkiv devrel (our own partners — the logo goes on the lock-screen line "300 MB · from <sponsor> · because you're human" and on the scratch card), then two non-partner exhibitors. Two offers on one page: the drop ($7.5k, up to 2,000 claims, pre-arrival distribution on Telegram, claim list auditable with their key) and the **free pilot** (fund 100 testnet claims from your own account this weekend — which also answers the Hedera judge's "you paid yourselves").
2. **A Devcon side-event host or hacker house** buying 200 × 1 GB gift codes ($800), paid online by a non-resident entity, delivered as scratch cards addressed to ENS names.
3. **Non-resident retail top-ups from December**, bought online before or at arrival (the airport moment), $4.50/GB, outside India or after the memo clears online sales to non-residents.

### 5.3 Pre-kickoff actions that move the number (non-code; owner; due)

- Open MegaeSIM (instant sandbox) and eSIM Access accounts; buy 30–50 India profiles as fallback inventory; record the India wholesale price — Integrations lead, **today**.
- Commission the one-page Indian telecom/FEMA memo (free bundle to non-residents in India; online sales to non-residents; the offshore entity) — Founder, today; **due Wed 18:00** (switch trigger b).
- Write the one-page sponsor offer + order form + pilot option; book ≥ 5 Thursday meetings — Founder/Sponsor lead, today and Wed.
- Launch the **team-funded free pre-arrival campaign** (300 MB, Orb/Document, zero price, no stand, no Indian marketing; a Telegram post in attendee channels and a poster) on Wed afternoon — it is the Continuity evidence, the distribution test and the 25%/20% measurement at once; cost ≤ $100.
- Decide the offshore entity (Singapore or UAE) and set up a USDC receiving wallet and invoice template for post-event sales — Founder, Thu.
- Print 200 scratch cards on Thursday morning (Dhanteras closes printers Friday) — Design/Producer.

### 5.4 Evidence by date (what would prove — or falsify — the path to $10k/week)

| Id | Date (IST) | Evidence that proves the path | If absent |
|---|---|---|---|
| E0 | Tue 3 Nov, EOD | India wholesale ≤ $1.50/GB in at least one reseller catalogue. | Margin line cut by a third; free bundle ≤ 200 MB; logged in README, not a trigger. |
| E1 | **Thu 5 Nov, 18:00** | From ≥ 3 asks, ≥ 1 verbal yes with a named budget owner for a paid drop at any event in Q4 2026–Q1 2027, or a sponsor-funded pilot from the sponsor's own account. | README and pitch downgrade the revenue thesis to "retail eSIM; sponsor drops unproven" before submission. |
| E2 | Sun 8 Nov, 09:00 | ≥ 300 verified-human claims of the free pre-arrival bundle; claim rate per 1,000 impressions recorded. | Distribution thesis weak; the Telegram channel is not a channel. |
| E3 | **Sun 30 Nov** | One signed order ≥ $5k for a drop at an event on or before 28 Feb 2027. | **The sponsor-drop thesis is falsified** (see pivot rule). |
| E4 | Sun 31 Jan 2027 | ≥ 3 drops booked for H1 2027 (≥ $20k total) and retail ≥ 300 plans/week over the trailing four weeks. | Base case unproven; stay a retail business or pivot. |
| E5 | Mon 31 May 2027 (month 7) | Drops ≥ 3/month, **or** a standing "data included" contract with one organiser network or ticketing platform, **or** retail ≥ 1,000 plans/week. | The $10k/week path is falsified for this product. |

**Pivot rule (post-event, recorded now so nobody relitigates it later):** if E3 fails and retail is below 100 plans/week, the team re-opens the revenue question with the committee's ranked alternatives: (i) **Lifafa with the dedicated-wallet fix and the live-printed envelope**, only if ≥ 1 signed LOI from a Hyperliquid-perps group of ≥ 3k members exists by then (the Operator's own test); (ii) **action-conditioned devrel campaigns** sold to chains as a standing rail (the Devil's Advocate's Asli-as-data-drops, §4 of his file — already in Recharge's v1 roadmap as `Campaign.actionCheck`); (iii) continue Recharge as a retail eSIM business and stop claiming the bar.

---

## 6. Scope — `v0` pre-build (orchestrator, now) vs in-window human deliverables

### 6.1 The split

| Layer | Who, when | Content | Rule |
|---|---|---|---|
| **`v0` core** | Orchestrator with parallel builder agents and a red team, **Tue 3 Nov → Thu 5 Nov 12:00 IST**, entirely in `MODE=local` (Anvil 31337 + in-memory/fixture adapters; no network) | Everything in §6.2–6.3: quota engine, x402 gateway, reseller adapter, contracts with tests, PWA, agent loop, design system, hygiene templates, threat model, demo seed. Live adapters are **real code written against the documented APIs and unit-tested on recorded fixtures**; they are never called from the sandbox (`docs/ENVIRONMENT-CONSTRAINTS.md`). | Tagged `v0-prekickoff` at Thu 20:59 IST; disclosed in `docs/DISCLOSURE.md`. |
| **Human pre-kickoff** | The 5-person team, Wed 4 – Thu 5 Nov daytime (≈ 16 ph) | Accounts, faucets, keys (on-site, never pasted into an AI context), the **minimal pre-deploy** of one real round-trip per sponsor (§7), the attach test, the memo, the sponsor meetings, the hardware hedge, scratch-card print, the free pre-arrival campaign. | Non-code work plus one hello-world per rail; recorded with tx hashes. |
| **In-window** | The team, Thu 21:00 → Sun 09:00 (≈ 58 ph of ~125 available) | Every sponsor integration's substantive feature work, deploys, live provisioning, the agent on Hedera, gifts, the sponsor dashboard, the design pass, the video, README/CHANGELOG, rehearsals. | ≥ 70% of each sponsor integration's final code and 100% of the product mechanism tied to it, with dated human commits. |

### 6.2 Module list and interfaces (extends the scaffold already in the repo)

The scaffold's `@ethglobal/adapters` already defines `Ledger` (Arkiv-shaped: `put/get/query`, `expiresIn`), `Personhood` (IDKit success result, cloud verifier), `PaymentRail` (x402 v2 `PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`, EIP-3009 authorization payload), `Inference`, `NameResolver`, with deterministic mocks and `createAdapters('local' | 'live')`. `v0` adds the packages below; `createAdapters('live')` stops throwing.

```
packages/adapters   (+) Reseller, ConsensusLog interfaces; Ledger.update(); mocks: MockReseller, MockConsensusLog
                    (+) live/: ArkivLedger (@arkiv-network/sdk, Kaolin 60138453025; annotations → attributes),
                        WorldCloudPersonhood (POST developer.worldcoin.org/api/v2/verify/{app_id}),
                        RemoteFacilitator (x402.org or hedera-dev facilitator: /verify, /settle; schemes exact-evm + hedera),
                        SelfRunFacilitator (packages/eip3009 + viem relayer; the Hedera-track fallback),
                        EsimAccessReseller, MegaEsimReseller (documented REST + HMAC webhooks),
                        HcsLog (@hashgraph/sdk topic submit/read; HCS-14 UAID helper),
                        EnsResolver (viem getEnsAddress/getEnsText; mainnet read, Sepolia fallback)
packages/eip3009    (new) EIP-712 digests, signer recovery, calldata encoders, Relayer — shared by x402 exact scheme and (if switched) Dhwani's offline relay
packages/octroi     (new) pure logic: Campaign, Entitlement, quotaKey, sizeBundle, challenge/consumeChallenge, decide(), TopUpPolicy/shouldTopUp
packages/crypto     (new) sealLpa/openLpa (X25519 + HKDF + XChaCha20-Poly1305 via @noble), hmacKey, verifyWebhookSignature
packages/contracts  (+) src/DataDrop.sol, src/MockUSDC3009.sol, test/DataDrop.t.sol, test/MockUSDC3009.t.sol, script/Deploy.s.sol (+ addresses.<chain>.json)
services/api        (+) routes: /plans, /challenge, /claim, /esim/provision, /esim/topup, /gift, /gift/claim, /card/:pin, /webhooks/reseller, /me/:key, /sponsor/:id ; middleware octroi() and x402()
services/agent      (new) the top-up agent: ledger read → shouldTopUp → fetch → 402 → sign → retry → HCS receipt
apps/web            (+) PWA: / , /verify, /plan/[key], /pay, /install, /gift, /agent, /sponsor, /card/[pin], /print/cards ; data-type="bazaar"
packages/ui         (+) components: ScratchCard, Coupon, MbMeter, BoardingPass, UsageAsOf, OnchainAction (state machine exists); print.css
scripts/            (+) demo-seed.ts (campaign + 3 entitlements + 1 gift), e2e-local.sh (full loop on Anvil), print-cards.ts (Playwright → PDF)
fixtures/           recorded responses: reseller catalogue/order/usage/webhook, World verifier, both facilitators, Arkiv, HCS mirror
docs/               DISCLOSURE.md, THREAT-MODEL.md, DEMO-SCRIPT.md, arkiv.schema.json, ARKIV_FEEDBACK.md, SWARM.md, CHANGELOG.md
```

**Adapter additions (`packages/adapters/src/types.ts`):**

```ts
export interface EsimPlan { id: string; country: 'IN'; dataMb: number; validityDays: number; wholesaleUsd: number }
export interface EsimProfile { iccid: string; lpa: string /* LPA:1$<smdp>$<matchingId> */; planId: string;
  status: 'ready' | 'installed' | 'active' | 'expired' }
export interface EsimUsage { iccid: string; usedMb: number; totalMb: number; asOf: number /* ms */ }
export interface Reseller {
  plans(country: 'IN'): Promise<EsimPlan[]>;
  order(planId: string): Promise<EsimProfile>;                 // one profile per order
  topUp(iccid: string, mb: number): Promise<{ orderId: string }>;
  usage(iccid: string): Promise<EsimUsage>;
  verifyWebhook(rawBody: string, signature: string, timestamp: number): boolean;
}
export interface ConsensusLog {                                  // modelled on HCS
  submit(topic: string, message: string): Promise<{ sequence: number; consensusAt: number; txId: string }>;
  read(topic: string, fromSequence?: number): Promise<Array<{ sequence: number; message: string; consensusAt: number }>>;
}
export interface Ledger { /* existing put/get/query, plus: */
  update(key: string, patch: { payload?: string; annotations?: Annotations }, expiresIn?: number): Promise<LedgerPutResult>; }
// Adapters bundle gains `reseller: Reseller` and `consensus: ConsensusLog`.
```

**Quota engine (`packages/octroi`):**

```ts
export type Tier = 'orb' | 'document' | 'device' | 'none';
export interface Campaign {
  id: Hex; sponsor: Address; name: string;
  bundleMb: { orb: number; document: number; device: 0 };       // device tier gets no gift: it pays the human price
  pricePerClaimUsd6: bigint; maxClaims: number; claimsPerHour: number;
  validityDays: number; wholesaleUsdPerGb: number; idResaleUsd: number /* 0.50 */;
  paused: boolean; expiresAt: number;
  actionCheck?: (claimKey: Hex) => Promise<boolean>;             // v1: action-conditioned campaigns
}
export interface Entitlement {
  key: string;      // 'ent:'+HMAC(secret,nullifierHash) | 'paid:'+payer+nonce | 'gift:'+namehash
  campaignId?: Hex; tier: Tier; mbTotal: number; mbUsed: number; usageAsOf: number;
  iccid?: string; expiresAt: number;
}
export function quotaKey(secret: Uint8Array, nullifierHash: Hex): Hex;                       // HMAC-SHA256
export function sizeBundle(c: Campaign, tier: Tier): number;
//   = min(c.bundleMb[tier], floor(0.8 * c.idResaleUsd / (c.wholesaleUsdPerGb / 1024)), 300)  — farming is EV-negative by construction
export interface Challenge { nonce: Hex; audience: string; path: string; exp: number; signal: Hex /* keccak(nonce‖audience) */ }
export function challenge(audience: string, path: string, now: number): Challenge;            // exp = now + 120 s
export function consumeChallenge(ledger: Ledger, cache: Set<string>, c: Challenge, now: number):
  Promise<'ok' | 'replayed' | 'expired' | 'unavailable'>;                                     // 'unavailable' is treated as deny (fail-closed)
export type Decision =
  | { kind: 'serve-free'; entitlement: Entitlement; claimKey: Hex }
  | { kind: 'serve-paid'; entitlement: Entitlement; settlement: SettleResult }
  | { kind: 'payment-required'; body: PaymentRequired }
  | { kind: 'deny'; reason: 'replay' | 'paused' | 'cap' | 'budget' | 'invalid-proof' | 'invalid-payment' | 'expired' };
export interface OctroiDeps { ledger: Ledger; personhood: Personhood; payments: PaymentRail; secret: Uint8Array;
  now: () => number; priceUsd6PerStep: bigint; stepMb: number; payTo: Address;
  accepts: Array<{ network: string; asset: string }> }           // demo: eip155:84532 USDC, hedera:testnet USDC; local: eip155:31337 MockUSDC
export function decide(req: { proof?: PersonhoodProof; payment?: PaymentPayload; challenge?: Challenge; mb: number;
  resource: PaymentResource; campaign?: Campaign; sessionPubKey?: Hex }, deps: OctroiDeps): Promise<Decision>;
export interface TopUpPolicy { maxUsdPerDay: number; thresholdMb: number; stepMb: number; paused: boolean; topUpOnExpiry: boolean }
export function shouldTopUp(e: Entitlement, p: TopUpPolicy, spentTodayUsd: number, now: number):
  { buy: false; reason: 'ok' | 'paused' | 'cap' } | { buy: true; mb: number; reason: 'threshold' | 'expiry' };
```

**EIP-3009 (`packages/eip3009`)** — shared by the x402 exact scheme (facilitator submits `transferWithAuthorization`) and, if the switch fires, by Dhwani's offline relay (`receiveWithAuthorization` into the splitter):

```ts
export interface Authorization3009 { from: Address; to: Address; value: bigint; validAfter: bigint; validBefore: bigint; nonce: Hex }
export function domain(token: Address, chainId: number, name?: string, version?: string): TypedDataDomain; // Circle USDC: "USD Coin", "2"
export function digestTransferWithAuthorization(d: TypedDataDomain, a: Authorization3009): Hex;
export function digestReceiveWithAuthorization(d: TypedDataDomain, a: Authorization3009): Hex;
export function recoverSigner(digest: Hex, signature: Hex): Address;
export function encodeTransferWithAuthorization(a: Authorization3009, signature: Hex): Hex;   // calldata
export function encodeReceiveWithAuthorization(a: Authorization3009, signature: Hex): Hex;
export interface Relayer { submit(token: Address, data: Hex): Promise<{ hash: Hex; status: 'success' | 'reverted' }> }
```

**Sealed delivery (`packages/crypto`):** `sealLpa(lpa, recipientPubKey, aad)` / `openLpa(sealed, secretKey, aad)` with `aad = paymentNonce ‖ entitlementKey`; `hmacKey`; `verifyWebhookSignature(secret, rawBody, signature, timestamp, now, windowSec = 300)`.

**API contract (`services/api`)** — all gated routes run `octroi()`; the proof path and the pay path are the same handler with a different `Decision`:

| Route | In | Out | Side effects (local mock / live) |
|---|---|---|---|
| `GET /plans` | — | plans, prices, `accepts[]` | none |
| `POST /challenge` | audience, path | `{nonce, exp, signal}` | nonce entity `expiresIn: 120` |
| `POST /claim` | IDKit proof, campaignId, challenge, sessionPubKey | `{entitlementKey, sealedLpa, expiresAt, claimTx}` | `personhood.verify` → `sizeBundle` → `DataDrop.claim(id, claimKey)` by the attestor key → `reseller.order` → entitlement entity (`expiresIn = validityDays`) → HCS receipt |
| `GET /esim/provision?mb=` | payment or 402 | sealed LPA | settle → order → entity → HCS |
| `GET /esim/topup?key=&mb=100` | payment or 402 | new `mbTotal`, `expiresAt` | settle → `reseller.topUp` → `ledger.update` → HCS |
| `POST /gift` | payment or 402, ENS name | PIN (16 digits) + boarding-pass card | `names.resolve` → escrow entity `gift:<namehash>` (`expiresIn` = claim window) |
| `POST /gift/claim` | name + signature by the resolved address, or PIN | entitlement | escrow → entitlement; HCS |
| `GET /card/:pin` | PIN | entitlement | scratch-card redeem (same path as gift PIN) |
| `POST /webhooks/reseller` | HMAC-signed usage/status | 204 | `verifyWebhookSignature` → `ledger.update(usage)`; 5-minute replay window |
| `GET /me/:key` | — | entitlement, `usageAsOf` | **Arkiv read** (60-s cache) |
| `GET /sponsor/:id` | — | claims, spend, HMAC'd claim list | **Arkiv query** + chain events |

**Agent (`services/agent`):** every 60 s (5 s local): `ledger.get(entitlementKey)` (**Arkiv read**) → `shouldTopUp` → `GET /esim/topup` → on 402 build the EIP-3009 authorization for the matching `accepts[]` entry and sign (local: an Anvil key against `MockUSDC3009`; live: the Hedera Agent Kit wallet for the Hedera scheme, a Base Sepolia key for the EVM scheme) → retry with `PAYMENT-SIGNATURE` → `consensus.submit(topic, receipt)` carrying the HCS-14 UAID. The LLM, if any, only phrases notifications; it never sizes or approves a purchase (Security's prompt-injection rule).

**PWA x402 client (`apps/web/lib/pay402.ts`):** on 402, decode `PAYMENT-REQUIRED`, pick the `accepts[]` entry for the connected wallet's chain, generate the session keypair, build the authorization (`nonce = random32`, `validBefore = now + 300`, `to = payTo`), sign `TransferWithAuthorization` typed data, attach `extra.sessionPubKey`, retry; on success, `openLpa` and hand the LPA string to `/install` (Apple universal link `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=<LPA>` on iOS 17.4+, the `LPA:` intent on Android, QR for a second device).

### 6.3 Contracts

```solidity
// packages/contracts/src/DataDrop.sol — sponsor pools; one claim per (campaign, claimKey); hourly cap; pause; refund
pragma solidity ^0.8.30;
interface IDataDrop {
    struct Campaign { address sponsor; uint128 budget; uint128 spent; uint96 pricePerClaim; uint32 claimsPerHour; uint64 expiresAt; bool paused; }
    event CampaignCreated(bytes32 indexed id, address indexed sponsor, uint128 budget, uint96 pricePerClaim, uint32 claimsPerHour, uint64 expiresAt);
    event Claimed(bytes32 indexed id, bytes32 indexed claimKey, uint96 paid, uint64 hourBucket);
    event Paused(bytes32 indexed id, bool paused, address by);
    event Refunded(bytes32 indexed id, uint128 amount);
    event AttestorSet(address attestor);
    error AlreadyClaimed(); error CampaignPaused(); error CampaignExpired(); error HourlyCap(); error BudgetExhausted();
    error NotAttestor(); error NotSponsor(); error NotRefundable();
    function createCampaign(bytes32 id, uint128 budget, uint96 pricePerClaim, uint32 claimsPerHour, uint64 expiresAt) external; // pulls USDC from sponsor (token mode)
    function claim(bytes32 id, bytes32 claimKey) external;        // onlyAttestor; claimKey = keccak256(id ‖ HMAC(nullifier)); pays pricePerClaim to payout
    function pause(bytes32 id, bool paused) external;             // sponsor may pause/unpause; attestor may pause, never unpause
    function refund(bytes32 id) external;                         // sponsor; after expiresAt, or paused ≥ 24 h
    function setAttestor(address attestor) external;              // owner
    function claimed(bytes32 id, bytes32 claimKey) external view returns (bool);
    function campaigns(bytes32 id) external view returns (Campaign memory);
}
// constructor(IERC20 usdc, address payout, address attestor, address owner)
//   usdc == address(0)  ⇒ LEDGER_ONLY mode: createCampaign/claim record state and emit events, move no tokens (sponsor funds move natively on HTS).
//   On Hedera (chainid 296/295) an owner-only associateHts(address token) calls the HTS precompile so the contract can hold HTS USDC; tested at the Wed pre-deploy.
```

`MockUSDC3009.sol`: 6-decimal ERC-20 implementing EIP-3009 `transferWithAuthorization` / `receiveWithAuthorization` with EIP-712 domain `("USD Coin", "2")`, so local x402 settlement and the shared `eip3009` package are exercised against Circle's exact digest layout. `Deploy.s.sol` deploys both on Anvil, `DataDrop` only on live chains (USDC address from `deploy/chains.json` extended with `usdc` per chain; Hedera testnet USDC is HTS `0.0.429274`), and writes `deploy/addresses.<slug>.json`.

### 6.4 Local mode vs live adapters

| Dependency | `MODE=local` (CI, red team, orchestrator) | `MODE=live` (humans, on-site) | Status of the live adapter in `v0` |
|---|---|---|---|
| Chain / USDC | Anvil 31337 + `MockUSDC3009` | Base Sepolia USDC (EIP-3009), Hedera testnet USDC (HTS) | real (viem); untested against RPC until Wed |
| Sponsor pool | `DataDrop` on Anvil, token mode | `DataDrop` on Hedera testnet (token or LEDGER_ONLY) | real; deploy script human-run |
| x402 facilitator | `MockPaymentRail` (scaffold) + `SelfRunFacilitator` on Anvil | `RemoteFacilitator` (x402.org / hedera-dev) with `SelfRunFacilitator` fallback | real; Hedera scheme payload shape from fixtures recorded Wed |
| World ID | `MockPersonhood` + fixture proofs | `WorldCloudPersonhood` (cloud verifier) | real |
| Arkiv | `InMemoryLedger` with expiry clock (+ `update`) | `ArkivLedger` on Kaolin | real; latency measured Wed |
| Reseller | `MockReseller`: deterministic `LPA:1$local.test$<id>`, usage advances on a clock, webhook simulator | `EsimAccessReseller` / `MegaEsimReseller`; inventory file as fallback source | real against docs; India catalogue unknown until today |
| HCS / HCS-14 | `MockConsensusLog` (append-only, sequence numbers) | `HcsLog` via `@hashgraph/sdk`; UAID registered once | real |
| ENS | `MockNameResolver` fixtures (`alice.eth`, `bob.eth`) | `EnsResolver` (mainnet read) | real |
| Agent wallet | Anvil key | Hedera Agent Kit wallet (+ Base Sepolia key for the EVM scheme) | real; first contact Thu night |
| Wallet in PWA | dev panel "demo wallet" (Anvil account) | injected wallet on Base Sepolia; Hedera wallet (HashPack) for the human Hedera payment | real |

### 6.5 Acceptance tests per module (all run in CI under `MODE=local`; the right-hand column is the human live check)

| Module | Must pass before `v0-prekickoff` | Live check (who, when) |
|---|---|---|
| `packages/octroi` | `sizeBundle`: 300 MB cap; shrinks with wholesale (at $2.50/GB → ≤ 160 MB); device → 0. `quotaKey` deterministic, never reveals the nullifier. `challenge/consumeChallenge`: second use → `replayed`; after 121 s → `expired`; ledger throwing → `unavailable` ⇒ deny. `decide`: valid Orb proof + budget → `serve-free`; same nullifier twice → `deny: replay`; paused → `deny`; hourly cap at N+1; no proof, no payment → `payment-required` with both `accepts[]`; valid payment → `serve-paid`; wrong amount → `deny: invalid-payment`. `shouldTopUp`: threshold, expiry, cap, paused; never exceeds `maxUsdPerDay`. Property test: no sequence of requests grants more MB than budget allows. | — |
| `packages/eip3009` | Digests match Circle's reference vectors (recorded in fixtures); `recoverSigner` round-trips a viem signature; `receiveWithAuthorization` calldata executes on `MockUSDC3009` only when `msg.sender == to`. | Base Sepolia USDC `transferWithAuthorization` relayed once (Integrations, Wed). |
| `packages/crypto` | `openLpa(sealLpa(x))` = x; wrong key fails; wrong AAD fails; webhook signature rejects skew > 300 s and replays. | — |
| `packages/contracts` | `DataDrop.t.sol`: create pulls budget; claim once; `AlreadyClaimed` on repeat; hourly cap across a bucket boundary (`vm.warp`); paused blocks; attestor-only; `BudgetExhausted` leaves the remainder refundable; refund only after expiry or 24 h pause; LEDGER_ONLY moves no tokens; fuzz `pricePerClaim ≤ budget`; 6-decimal arithmetic; gas snapshot. `MockUSDC3009.t.sol`: valid auth transfers; replayed nonce reverts; expired reverts; wrong signer reverts. Slither clean (no high/medium). | Deploy to Hedera testnet; `associateHts`; one `Claimed` event on HashScan (Integrations, Wed 14:00). |
| `services/api` | Supertest flow on Anvil: `/challenge` → `/claim` (fixture Orb proof) → entitlement entity exists with `expiresAt` = now + validity → `/me/:key` reads it back (and from cache within 60 s) → `/esim/topup` returns 402 with `PAYMENT-REQUIRED` → signed payment → 200, `mbTotal` increased, HCS receipt sequence +1 → `/webhooks/reseller` with valid HMAC updates `mbUsed`; invalid HMAC → 401; replay → 409 → `/gift` → PIN → `/gift/claim` by signature → entitlement; `/sponsor/:id` lists HMAC'd claims only. `e2e-local.sh` runs the whole loop headless in < 60 s. | Same flow against live rails in the Thu 21:00–02:00 handshake sprint (all leads). |
| `services/agent` | With a simulated usage clock: buys exactly one step at 20% remaining; buys on expiry when `topUpOnExpiry`; never exceeds the daily cap; pause stops it; every purchase produces an HCS receipt with the UAID; a malicious notification string in the entitlement payload changes nothing (injection test). | Agent Kit wallet pays on Hedera testnet once; HashScan link (Provisioning/Agent lead, Fri AM). |
| `apps/web` | Playwright: both first-screen paths render; `/pay` completes the 402 round-trip with the demo wallet; `/install` renders the universal link and the Android intent with the opened LPA; `/plan/[key]` shows the MB meter and "usage as of HH:MM"; `/agent` sheet persists the policy; `/sponsor` creates/funds/pauses a campaign; `/card/[pin]` redeems; dark and light screenshots; no horizontal scroll at 360 px; Hindi strings render with `lang="hi"`. Lighthouse PWA installable. | Three real devices, Sat 09:00 rehearsal. |
| `packages/ui` | Token test (exists); print sheet renders 100 cards to PDF with PINs in Chivo Mono and no clipping. | Printer proof Wed evening; print run Thu 09:00. |
| Live adapters | Each parses its recorded fixtures and maps errors to `AdapterError`; contract tests assert request shapes (paths, headers, bodies) against the documented API. | Wed pre-deploy: one round-trip each (Arkiv entity write+read; x402 settle on Hedera; cloud verification). |
| Red team (`docs/THREAT-MODEL.md`) | Attack scripts for: nullifier replay, challenge replay, webhook replay/spoof, LPA interception (second fetch), agent cap bypass, hourly-cap race, paused-campaign claim, prompt injection via payload strings, decimals confusion (6 vs 18), key-rotation (`setAttestor`). All fail. | Sponsor-pool key compromise drill: attestor rotation + pause in < 5 min (Security owner, Fri). |

### 6.6 Hour budget, critical path, honest mocks, degradation

**In-window budget (≈ 58 ph of ~125 available; cap 85):** Integrations/live wiring (Hedera x402 human + agent settlement, `DataDrop` production campaigns, HCS, World cloud verify, Arkiv Kaolin) 14 · Provisioning (live orders, universal link on three devices, inventory fallback) 8 · Agent (Agent Kit wallet, HCS-14, policy loop live, webhooks) 8 · Product features (tiering by credential, gift/ENS live, scratch-card redeem, sponsor dashboard reads) 10 · Design pass (PWA screens, coupon, dark/light, Hindi copy, print QA) 8 · Producer (README per sponsor, DISCLOSURE, CHANGELOG, video ≤ 3 min, X post, pitch rehearsal, judge logistics, submission form) 10. Pre-kickoff human: ≈ 16 ph (accounts, keys, pre-deploy round-trips, attach test, cards, meetings).

**Critical path (software, ≈ 20 wall-clock hours):** Thu 21:00 flip the VPS to the in-window branch and `MODE=live` (0.5 h) → production `DataDrop` campaign deployed and funded on Hedera testnet, pre-rehearsed Wednesday (1.5 h) → IDKit claim → entitlement on Kaolin → live reseller order → sealed LPA → install on a team phone (3 h) → **Fri 06:00 gate** → agent live with Agent Kit + HCS-14 (4 h) → gift/ENS live (2 h) → sponsor dashboard reads (2 h) → Sat 09:00 three-device rehearsal (2 h) → design pass in parallel → Sat 18:00 partner selection locked → video (3 h) → Sun 06:00 README freeze → 08:00 submit.

**Honestly mocked in the demo (labelled on screen and in the README):** usage telemetry when the reseller usage API lags ("simulated usage"); fulfilment from pre-bought inventory if a live order fails ("inventory profile"); HCS-14 registration minimal; AgentKit discount mode absent unless beta lands ("IDKit humans only"); the demo sponsor is "Recharge (demo sponsor)" unless a real sponsor funds a testnet campaign on Thursday; the Hedera human payment is made by a judge or a non-team attendee with a Hedera testnet wallet, else by a team wallet operated by the judge's tap, said aloud.

**Degradation (product keeps working; prize may be lost):** remote facilitator down → self-run; Hedera unreachable → Base-only settlement, ENS swap; Arkiv down → Postgres mirror + "ledger degraded" banner, ENS swap; World cloud verifier down or judge cannot verify in India → foreign judges with Orb IDs, team phones, labelled simulator; reseller down → inventory; live install stalls → pre-installed phone after 90 s; Agent Kit wallet fails → EVM-scheme agent on Base Sepolia, labelled.

### 6.7 Human team checklist by day (five roles: Integrations · Provisioning/Agent · Product/PWA · Design/Producer · Sponsor/Sales = Founder). Note: 4 Nov 2026 is a Wednesday; the brief's "Tue 4" is read as "the day after today".

**Tue 3 Nov (today, after ratification)** — Founder: commission the legal memo (due Wed 18:00); write the sponsor one-pager; message ≥ 5 devrels for Thursday slots; name the five roles and the ALSA-capable teammate. Integrations: open MegaeSIM + eSIM Access; buy 30 India profiles (plus 5 retail Airalo/Saily India profiles as the deepest fallback); record India wholesale (E0); create Hedera testnet ECDSA accounts ×3 with HBAR and testnet USDC association; claim Kaolin ETH and Base Sepolia ETH; register the World developer-portal app and action `recharge-welcome`; apply for AgentKit beta. Provisioning: confirm an iPhone (iOS 17.4+) and an Android 13+ with eSIM are in the team; buy the Dhwani hardware hedge. Design: brief the Hindi/Marathi copy reviewer; order card stock. All: read `docs/THREAT-MODEL.md` when the orchestrator posts it.

**Wed 4 Nov** — 10:00 attach test ×3 per device with the pre-bought profiles (latency logged). 12:00 sandbox order → LPA → install (if the API is live). 14:00 **minimal pre-deploy** with the orchestrator's live adapters: one Arkiv entity written and read on Kaolin; one x402 402→pay→200 settled on Hedera testnet via the remote facilitator (fixtures recorded); one IDKit cloud verification; `DataDrop` deployed on Hedera testnet with a hello campaign and one claim — tx hashes into `DISCLOSURE.md`. 16:00 the team-funded free pre-arrival campaign goes live (Telegram post; poster PDF; zero price). **18:00 GATE** — attach test + memo → stay on Recharge or switch to Dhwani (§1). 19:00 copy review; scratch-card artwork to the printer for a proof. Evening: Founder confirms Thursday meetings; Integrations rehearses the Thursday-night handshake on the pre-deployed rails.

**Thu 5 Nov** — 09:00 print 200 scratch cards (Dhanteras closes printers Friday). 10:00–17:00 sponsor meetings (≥ 5): the drop and the free testnet pilot (E1 at 18:00). 12:00 (only if switched) Dhwani hardware gate. 14:00 dry run of the full loop on the VPS in `MODE=live` against the pre-deployed rails — no product features, just the pipes. 18:00 E1 verdict → README revenue section wording decided. 20:59 tag `v0-prekickoff`; snapshot `DISCLOSURE.md`. **21:00 kickoff** — check-in questions to ETHGlobal staff and to Hedera/World/Arkiv devrel (§7.4); keys for the in-window attestor/relayer generated on-site; handshake sprint 21:00–02:00: each rail one in-window round-trip (production campaign, claim, provision, Arkiv entity, Hedera settlement by a human).

**Fri 6 Nov (Dhanteras)** — **06:00 swap gate** per sponsor (§4). 06:00–14:00 credential tiering, Arkiv entitlements and the three reads, agent live on Hedera. 14:00–20:00 gift/ENS, sponsor dashboard, webhooks; Security owner runs the key-compromise drill. 20:00 first full live loop on three devices. Design pass starts; Producer drafts the per-sponsor README sections; film B-roll (airport/hall "No Service → LTE", scratch, agent notification) — nothing is sold to anyone.

**Sat 7 Nov** — 09:00 scope freeze (AgentKit discount mode, Reloadly diaspora top-ups only if ahead); 09:00–13:00 three-device rehearsal with cutover rules; 13:00–18:00 design pass complete (dark/light, Hindi), scratch-card redeem flow, print QA; **18:00 partner selection locked** in the dashboard; 18:00–23:00 video ≤ 3:00 (the three hooks, §8.6), X post, README/CHANGELOG/DISCLOSURE, `arkiv.schema.json`, `ARKIV_FEEDBACK.md` (with Wed's latency numbers), `SWARM.md`; 23:00 pitch dry run ×2 (4 min + the Q&A card).

**Sun 8 Nov (Diwali)** — 06:00 README freeze; 06:30 final rehearsal on venue Wi-Fi and on cellular; 07:30 submission form (three partners, video, repo, live URL, Continuity disclosure); **08:00 submit** (one hour of buffer before 09:00); then judging prep: pre-installed phone charged, three scratch cards per judge, HashScan and Arkiv explorer tabs pinned, the teammate who plays the sponsor named as such.

---

## 7. Entry strategy

### 7.1 Recommendation
**Continuity, declared in writing, with the minimal pre-deploy.** Code exists publicly before kickoff by the founder's order; a from-scratch declaration would be false and diff-able (#1, #2, #3, #4, Round 2), and "re-implementing beside a public reference" is the violation the AI policy names with a worse story (#3 `round2-sponsor-stacker.md` §6: ≈ 0.65 × EV plus CT exposure). Continuity's cost — a WOW/Originality discount — is already in the re-score's 7%.

### 7.2 The pre-deploy, with constraints (resolves `round3-devils-advocate.md` §0 and the Chair's counter-proposal)
On Wed 4 Nov the humans deploy, with on-site keys, exactly one real round-trip per partner: one Arkiv entity written and read on Kaolin; one x402 payment settled on Hedera testnet plus `DataDrop` with a hello campaign and one claim on Hedera EVM; one IDKit cloud verification for action `recharge-welcome`. Constraints: (1) nothing beyond one round-trip per partner; (2) ≥ 70% of each integration's final code and 100% of the product mechanism tied to it (tiering, expiring entitlements and their three reads, the agent, HCS receipts, gifts, the dashboard) ship in-window; (3) `DISCLOSURE.md` lists every pre-kickoff tx hash and entity key and the repo is tagged `v0-prekickoff` at 20:59; (4) each partner's eligibility question is asked at kickoff and the answer is written into the README. Effect: the continuity lanes ("move an existing Hedera project forward", Arkiv "existing projects", World [Cont]) become literally true; the first-contact tax moves out of the window; finalist perception is unchanged.

### 7.3 README disclosure text (verbatim, kept current through Sunday)
> **Continuity disclosure.** Recharge is entered in the Continuity track. **Before kickoff** (3–5 Nov 2026; tag `v0-prekickoff`, 5 Nov 20:59 IST): a local-first monorepo scaffold (tooling, design tokens, adapter interfaces with mocks); the x402 gateway and the Octroi quota engine running against Anvil and mocks; the reseller adapter; the PWA shell; `DataDrop.sol` with Foundry tests; and three hello-world integrations deployed by the team on 4 Nov — one Arkiv entity on Kaolin (key `…`), one x402 payment settled on Hedera testnet (tx `…`) with `DataDrop` at `0x…` (one claim, tx `…`), one IDKit verification (action `recharge-welcome`, log hash `…`). A team-funded free welcome-bundle campaign ran from 4 Nov (`N` claims by kickoff). Pre-bought eSIM inventory, reseller accounts and faucet claims are listed below. **During the window** (dated commits in `CHANGELOG.md`): credential-tiered sponsor pools on Hedera EVM, expiring Arkiv entitlements and the three reads that depend on them, the Hedera Agent Kit top-up agent with an HCS-14 identity and HCS receipts, gifts to ENS names, the scratch-card run, the design pass, live provisioning on three devices. **AI use:** an AI orchestrator wrote most of the pre-kickoff code under human direction and review, with a red-team pass; in-window commits are authored by the named team members with AI assistance for tests, fixtures and documentation. Keys were generated on-site and never entered an AI context.

### 7.4 Questions to ask at kickoff (answers recorded in the README by Fri 06:00)
- **ETHGlobal staff:** "Our repository was created on 3 Nov with documented pre-existing work and a dated tag; is it an eligible Continuity base?" If no → §7.5.
- **Hedera devrel:** "We have had an x402 endpoint settling on Hedera testnet and a pool contract on Hedera EVM since 4 Nov. Are Continuity entries eligible for the x402 track, or only for the Continuity prize? Would you fund a 100-claim testnet campaign from your account this weekend?"
- **World devrel:** "Is [Cont] Best IDKit Use Case the right submission for us, and may we also be considered for Best Use of IDKit? Can we get AgentKit beta access before Saturday?"
- **Arkiv devrel:** "Continuity ($4k) or from-scratch ($3k/$1k) — which lane do you want a project with one pre-kickoff entity in? Does a 60-second cached read on the hot path count as reading from Arkiv when every window boundary and the agent query live? Swarm gateway access for the bonus?"
- **ENS (if a swap becomes likely):** "Which Mumbai track fits gifting-by-name and sponsor subnames?"

### 7.5 If the Continuity base is rejected
Archive the pre-build private, keep only design documents, the threat model and test vectors, and enter from-scratch with human-authored product code; the orchestrator's role becomes tests, fixtures and docs (Ops R1 pre-build policy). All three candidates lose EV equally; the decision does not change.

---

## 8. Design brief

### 8.1 The one image
A judge's iPhone on the big screen goes from **"No Service" to "LTE"** four seconds after a payment lands on HashScan, and the lock screen reads **"300 MB · from <sponsor> · because you're human."** The physical twin: the judge rubs a paper scratch card and reads the same line and a 16-digit PIN.

### 8.2 The signature (what no model would pick)
**The 2000s Indian paper recharge coupon.** Every plan and every gift is a coupon: a foil scratch panel, a 16-digit PIN in Chivo Mono, Devanagari numerals in Anek Devanagari, "usage as of 14:02" printed on every balance, three-line receipts (you / sponsor / network fee). We print real cards and hand them to judges; the redeem screen is the coupon turned digital. Gifts are boarding-pass cards addressed to an ENS name. The agent's permission is one sheet: "≤ $10/day · pause". No gradients, no glass, no Inter, no emoji, no confetti, no raw `0x…` without a copy affordance (`design-foundations.md` §1 ban list is enforced by a CI grep on `backdrop-filter`, hue 260–300 accents and the banned families).

### 8.3 Type (from `design-foundations.md` §3, pairing C "Bazaar")
**Anek Devanagari** (Ek Type, Mumbai; variable `wdth 75–125, wght 100–800`; Latin + Devanagari; `tnum`, `zero`, ₹; `HIN`/`MAR` locl) for display *and* text: `wdth 110 / wght 700` for the MB number and headlines, `wdth 100 / wght 400–500` for body. **Chivo Mono** for PINs, ICCIDs, hashes and amounts in receipts. **Baloo 2** only for the printed "rub here" on the scratch panel. `lang="hi"` on Hindi strings; numerals stay Latin, formatted `en-IN`; Devanagari line-height ≥ 1.6, 14 px floor. The scaffold already ships this pairing as `data-type="bazaar"` in `packages/ui/fonts.css`; `v0` makes it the default on `<html>`.

### 8.4 Colour (from `design-foundations.md` §4)
Warm paper neutrals (OKLCH hue 70–80) in both modes; **one accent: oxide teal 195** — `--accent` `oklch(0.52 0.085 195)` ≈ `#117878` light, `oklch(0.78 0.11 195)` ≈ `#4fcdcd` dark, with dark text on the light accent as Hyperliquid does. Semantic hues stay reserved: positive 150 (data added), negative 25 (payment failed), warning 75–85 (usage ≥ 80%). **The proposers' "FreeCharge orange" is rejected as a UI accent**: orange (hue ≈ 55–70) sits inside the 40° exclusion band around the warning hue and near negative, which breaks the accent-window rule and would make every "low data" warning look like a button. The printed card is warm paper stock, oxide-teal ink and silver scratch latex, so the physical and digital objects are one brand. Both proposers' dissent on orange is recorded in §10.

### 8.5 Five best-in-class references for this exact category (crypto-paid connectivity with verified-human onboarding and agent top-up), one thing to borrow from each
1. **Saily** (the cleanest eSIM install flow in 2026 roundups): the compatibility check before anything else and a single hero number per screen. Borrow: the install sheet sequence and the one-number plan card.
2. **Airalo, October 2025 redesign:** device compatibility verified *before* money is requested; a connection check *after* install. Borrow: the pre-flight check in Review and the post-install troubleshooter ("Data Roaming on?").
3. **Apple's iOS eSIM activation sheet** (Settings → Cellular → Add eSIM; the `esimsetup.apple.com` universal link on iOS 17.4+): the system UI our flow hands off to. Borrow: never fight the system — tell the user exactly what the sheet will ask, in the order it asks.
4. **Revolut eSIM:** the plan as a card in a wallet with a drained meter and a precise timestamp. Borrow: "usage as of HH:MM" and the meter that never animates on data ticks.
5. **The Indian prepaid recharge idiom — Paytm/FreeCharge recharge flow (2010–2016) and the paper coupon (`*123*PIN#`):** the cultural object the whole product wears. Borrow: the PIN redeem flow and the coupon as the brand.
Supporting references: **Stripe Dashboard** (the test/live rail and Radar) for the sponsor console; **Family** for the agent permission sheet (progressive disclosure; an animation that stops abruptly is a bug); **Silent.link** as the caution — the crypto incumbent's screen does five things, ours does one.

### 8.6 The three strongest hook moments for short social videos (1080 × 1920, ≤ 20 s each)
1. **"No Service → LTE."** Arrivals hall at BOM, a phone showing *No Service*; thumb taps "I'm human"; the World check; four seconds later *LTE* and the lock-screen line. Caption: "Landed in Mumbai with no data. Proved I'm one human. A sponsor paid."
2. **"Scratch."** Macro, ASMR: a coin scrapes silver latex off a paper card → "300 MB · you are human" and a 16-digit PIN in Chivo Mono → cut to the phone redeeming → the meter fills. Caption: "The 2004 recharge coupon, except the PIN is a World ID."
3. **"Your agent paid while you slept."** 03:12, the meter at 18%; a HashScan transaction lands — $0.40 USDC from an agent carrying an HCS-14 id; "+100 MB · paid by your agent." Alternate cut: a push at 3 a.m. — "vitalik.eth sent you 1 GB." Caption: "An AI agent bought me 100 MB on Hedera for 40 cents because my plan hit 20%."

### 8.7 Screens (one dominant element each)
`/` two paths, one question ("Landing without data?"); `/verify` the World sheet; `/plan/[key]` the MB number at 2× everything else, "usage as of", one teal button carrying the amount ("Add 100 MB · $0.40"); `/pay` the Review → Confirm in wallet → Sending (hash immediately) → Final sequence from `design-foundations.md` §6, never a bare spinner; `/install` the hand-off checklist; `/gift` a boarding pass addressed to a name; `/agent` one sheet, two controls; `/sponsor` a table that is the product (claims, spend, pause), no KPI-card row; `/card/[pin]` the coupon.

---

## 9. Go / No-go risks (top five; owner · trigger · fallback)

| # | Risk | Owner | Trigger (date, IST) | Fallback |
|---|---|---|---|---|
| 1 | **No India profile attaches** (reseller, catalogue or network) — the hero moment cannot exist. | Integrations lead | Wed 4 Nov 18:00: 3 attempts per device, 10-minute rule, all sources. | **Switch to Dhwani v2** (hardware already bought); if Dhwani's gate also fails Thu 12:00, Dhwani Plan C. Stage-day variant: install stalls > 90 s → pre-installed phone. |
| 2 | **Legal perimeter** — the free bundle to non-residents in India cannot be structured; or counsel forbids online sales to non-residents. | Founder | Wed 4 Nov 18:00: memo delivered. | Free bundle forbidden → switch to Dhwani. Only sales forbidden → already deleted; testnet paid lane; mainnet sales outside India only. |
| 3 | **Sponsor-pool oracle** — our attestor key releases sponsor money; compromise drains live campaigns (Security's top remaining attack; Asli's Q-SEC-2 reborn). | Security owner (Integrations) | Any anomalous claim rate; drill Fri 6 Nov. | Hourly caps per campaign in the contract, sponsor pause key, attestor rotation (`setAttestor`), published HMAC'd claim list, keys on-site; blast radius = one campaign's remaining budget for one hour. |
| 4 | **Hedera eligibility and the "paid ourselves" read** — x402 track may exclude Continuity; our own agent may be the only Hedera payer. | Sponsor lead | Thu 5 Nov 21:30 (devrel answer); Fri 06:00 gate. | Human Hedera payment in the demo; sponsor pool on Hedera EVM; the pre-deploy makes it an existing Hedera project; floor ~$1.5k Continuity; if ineligible for every lane → swap the slot to ENS at Sat 18:00. |
| 5 | **Continuity base rejected by ETHGlobal staff** (a 3-Nov repo is not an "existing project"). | Design/Producer (check-in) | Thu 5 Nov 21:00 check-in. | Archive the pre-build private; enter from-scratch with human-authored product code; same decision, lower EV for every candidate. |

Watch list (not no-go): World verification impossible for Indian judges (foreign judges hold Orb IDs; team phones; labelled simulator); Kaolin faucet/latency (claim today; Postgres mirror); AgentKit beta absent (IDKit only, Agent Pass not claimed); Dhanteras printers (print Thu 09:00); **E1 fails Thursday** — not a build risk but a disclosure duty: the README's revenue section is downgraded before submission; venue Wi-Fi (the demo is the phone's own cellular data; tx hashes pre-staged).

---

## 10. Dissent (stated fairly, unresolved)

- **The Devil's Advocate (#10a)** holds that Dhwani v2 survives attack best: a physical object a judge's phone makes talk, revenue disclosed honestly, no custody, no sale on Indian soil, and the two best-fitting continuity lanes; and that Recharge's legal fix and revenue line contradicted each other while its badge problem remains untested. The committee has adopted his deletions and his gates, but he would build Dhwani unless the Pi fails Wednesday. His sharpest sentence cuts both ways and is recorded: "a 12% finalist shot is being allowed to stand in for a business" — the committee's answer is that a 10% revenue shot with a Thursday test is still a thin business, and we say so in §5.
- **Mumbai Native (#4) and Sponsor Stacker (#3)** voted Dhwani first (`round2-mumbai-native.md` §3, `round2-sponsor-stacker.md` §5), each with conditions (an honest answer to the merchant's rupee question; ENS as the 3-hour fallback). Both built the hybrid the committee chose; neither ranked it above Dhwani as a finalist play.
- **The Veteran Judge (#7)** voted Dhwani in Round 1 ("nothing else clears 6% on my finalist estimate; the rest are sponsor plays"). The re-score lifted Recharge × Octroi to 7% on the strength of the fixes; the Judge's original view that the finalist slate rewards objects on tables stands.
- **The VC (#6)** calls Recharge "a Devcon-week cash experiment, not a company", rates Asli higher on P(first dollar in 30 days) (40%/25% at ≥ $1/≥ $2k, against Recharge's 60%/15%), and would have spent 3–5 Nov on sales rather than scaffolds. The committee's E1–E5 schedule is the concession to this view; the deletion of Devcon-week sales lowers the 60% figure, which the committee accepts.
- **The Operator (#2)** maintains that Lifafa is the only idea on the table built on a fee instrument the research proves (Hyperliquid builder codes), that caller rev-share is a real supply-side wedge, and that the committee is choosing a 10% revenue shot over a 20% one. The committee's reply is the Devil's Advocate's §3 (the public fill leaks the sealed call; the paywall and the fee decouple at T; the worst Continuity fit) and the re-score's custody correction; Lifafa remains the recorded post-event alternative with its own LOI test (§5.4).
- **The Power User (#8)** warns that the Octroi engine's "face scan for a free tier" bounce survives for anyone who refuses World ID, and that x402 + World + ENS is the modal 2026 stack; the committee's mitigation (the paid lane at the human price, the consumer good as the only surface) reduces but does not remove the objection.
- **The Security Red-Teamer (#5)** notes that the sponsor-pool release remains a self-attestation by our key — structural, bounded by caps and rotation, not removed; and that the Hedera decimals and HTS-association quirks are untested until a human touches the chain on Wednesday.
- **Design:** both proposers wanted FreeCharge orange; the committee chose oxide teal for the reasons in §8.4. **Hedera "No Solidity":** the Sponsor Stacker's zero-Solidity design would have kept the $2k pool in play; the committee traded it for a contract the orchestrator can test on Anvil today.
- **Within the chosen idea, one unresolved disagreement** remains between its two authors — the Mumbai Native's raw on-chain nullifier and Orb-only free tier versus the Sponsor Stacker's HMAC keys and credential tiers. The committee adopted the Sponsor Stacker's security design and the Mumbai Native's product scope; the Mumbai Native's objection that Orb-only is simpler to explain on stage is noted and overruled in favour of unlinkability.

---

*Ratification: the Chair. On ratification the orchestrator starts `v0` (§6.2–6.5) immediately; the human checklist (§6.7) starts today; the first gate is Wed 4 Nov 18:00 IST.*
