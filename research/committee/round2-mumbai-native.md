# Round 2 — Member #4, Mumbai Native / Consumer

Three facts from this round's four searches move my positions. (1) eSIM wholesale is far below the VC's €2.50: MegaeSIM lists 1 GB/7 d at $1.14 with an instant sandbox and ≤1-business-day review, eSIM Reseller Panel ≈ $0.70 ([MegaeSIM](https://megaesim.com/esim-reseller/), [eSIM Reseller Panel](https://esimresellerpanel.com/pricing)); India-specific rates need confirming, but Airalo-parity retail ($4.50) implies a 60–75% gross margin, not 25–35%. (2) DoT had Google Play delist Airalo and Holafly in India in Jan 2024 for selling without permission; foreign roaming SIMs may be sold in India only for use abroad under the 2022 NOC regime, and TRAI's 2025–26 work covers export IoT, not tourists ([Medianama 2025](https://www.medianama.com/2025/07/223-trai-consultation-foreign-sim-esim-regulation-indian-policy-explained/), [Medianama 2026](https://www.medianama.com/2026/01/223-explained-trai-separate-regulation-framework-foreign-sim-cards-esim-cards/)). So: offshore entity, online sale, non-resident buyers, nothing sold on Indian soil. (3) ETHGlobal's Continuity rules require written disclosure of pre-existing work and substantive in-window work; "projects that only repackage something built before the hackathon won't place"; partner eligibility varies per partner ([rules](https://ethglobal.com/rules), [Mumbai prizes](https://ethglobal.com/events/mumbai/prizes)).

## 1. Answers to every question

### Recharge
- **Q-SEC-Recharge-1** — CONCEDE in part. No table sale, no USDC taken on Indian soil. An offshore entity sells online to non-residents roaming on a foreign profile, exactly Airalo's legal posture abroad; the Jan 2024 delistings mark the line (marketing to Indian residents), which we do not cross. Venue presence is a poster and printed zero-price vouchers, not a sale.
- **Q-SEC-Recharge-2** — REBUT by design. The LPA activation string returns only inside the x402 response to the paying signature, ECIES-encrypted to the payer's wallet key, single fetch; ENS carries a salted commitment whose salt never leaves the server. Agent spend is bounded in code: a user-set USDC/day cap on the Agent Kit wallet, a per-ICCID daily top-up cap server-side, nonce-bound signed reseller webhooks. Free tier at Orb level only; Device-level pays.
- **Q-VC-Recharge-1** — CONCEDE: prepared attendees will not switch, and we do not need them to. The sponsor-paid 300 MB is accepted by prepared and unprepared alike; paid top-ups come from card failures and from day-5 expiries of 7-day Airalo plans on 7–10 day trips. Planning ratios: 25% of foreigners claim, 20% of claimants buy.
- **Q-VC-Recharge-2** — CONCEDE: no organiser names, and Airalo/Saily partner codes are free. The organiser line is deleted; the payer is the sponsor's giveaway budget (field 6).
- **Q-JUDGE-RECHARGE-1** — No account exists today (3 Nov). Action: open MegaeSIM and eSIM Access in parallel today; buy 30 retail India profiles as fallback. Latency unmeasured; eSIM installs typically attach in 1–3 min; we measure Thursday night on three devices and keep a pre-installed second phone.
- **Q-JUDGE-RECHARGE-2** — CONCEDE: Arc was decorative. Dropped; Arkiv takes the third slot (Octroi's BTL quota becomes the plan's validity), ENS stays an unclaimed fourth.
- **Q-JUDGE-RECHARGE-3** — It reads as a merchant if minute one is a price list. Minute one is a sponsor's on-chain pool paying for the judge's bundle because her nullifier is new, her agent paying x402 per 100 MB, the plan living as an Arkiv entity that dies by protocol, and a gift to an ENS name.
- **Q-USER-RECHARGE-1** — Pay from Base USDC (x402 Base scheme, Coinbase facilitator) or Hedera; no bridge. Same-phone install through Apple's universal link (iOS 17.4+) and the Android LPA intent; QR only for a second device.
- **Q-USER-RECHARGE-2** — Cap and pause live on one sheet ("≤ $10/day · pause"). Trigger on plan expiry (deterministic) and on the usage webhook at 20% remaining; the screen prints "usage as of 14:02" so lag is visible, never hidden.
- **Q-OPS-RECHARGE-1** — None opened; the sandbox cannot. Humans open MegaeSIM + eSIM Access today; wholesale per search $0.70–1.14 per GB/7 d (regional; India `[verify]`).
- **Q-OPS-RECHARGE-2** — Unverifiable, so Arc is dropped entirely rather than swapped to Bridge Kit, which adds a rail nobody landing in Mumbai needs.
- **Q-OPS-RECHARGE-3** — Inventory is not code; disclosed. Under the pre-build reality the question is moot: we enter Continuity.

### Challan — withdrawn
- **Q-SEC-Challan-1** — CONCEDE. No PAN, no Form 26AS credit; s.206AA forces 20%; holding PANs makes us a regulated deductor. Fatal.
- **Q-SEC-Challan-2** — CONCEDE. Nothing; the product is a wallet licence, which Okto already wrote in-house.
- **Q-VC-Challan-1** — CONCEDE: nobody.
- **Q-VC-Challan-2** — CONCEDE: TAN, FIU VASP registration and Form 141 for 15 bps; converting the skim is itself a s.194S event.
- **Q-VC-Challan-3** — CONCEDE: never asked; no outreach was possible.
- **Q-JUDGE-CHALLAN-1** — No CA memo; the Security reading matches mine: probably invalid. Withdrawn.
- **Q-JUDGE-CHALLAN-2** — The wallet, which is why it is not a hackathon product.
- **Q-JUDGE-CHALLAN-3** — No.
- **Q-USER-CHALLAN-1** — Okto, not Arjun. CONCEDE.
- **Q-USER-CHALLAN-2** — They cannot; self-attestation turns "compliant" into a checkbox. CONCEDE.
- **Q-OPS-CHALLAN-1** — No residency credential reaches IDKit today; self-attestation is not a trust decision. CONCEDE.
- **Q-OPS-CHALLAN-2** — A signed operator rate; moot.

### Udhaar — withdrawn
- **Q-SEC-Udhaar-1** — CONCEDE. No API proves a UPI payment to a third party; zkTLS is structural, not 36 h; the platform eats disputes.
- **Q-SEC-Udhaar-2** — CONCEDE. None; s.3(c) describes the settler's act.
- **Q-VC-Udhaar-1** — CONCEDE. No authorised person, no opinion.
- **Q-JUDGE-UDHAAR-1** — "A standing tab with a stranger instead of per-transaction escrow." Not enough. CONCEDE.
- **Q-JUDGE-UDHAAR-2** — There is no stage answer. CONCEDE.
- **Q-USER-UDHAAR-1** — Unmeasured; a stranger settler is 60–120 s and "no settler" is a failed chai. CONCEDE.
- **Q-USER-UDHAAR-2** — If UPI One World opens to tourists this winter, the residual is "earn USDC as a settler", i.e. hawala. CONCEDE.
- **Q-OPS-UDHAAR-1 / Q-OPS-UDHAAR-2** — Moot; withdrawn.

The lesson I carry forward: every payments idea in this deck with an Indian payee dies on FEMA, s.194S or FIU. Recharge is the one where the payee is offshore and the good is digital, which is why it alone survived the Security lens.

## 2. v2 — Recharge, hybrid with Octroi's quota engine

**1. Name + one-liner.** Recharge: a 402 gate for mobile data. Verified humans get a sponsor-funded bundle that expires by protocol; agents and everyone else pay per 100 MB over x402; anyone can gift data to an ENS name. The mechanism is Octroi's human-lane/paid-lane with Arkiv BTL as the clock (credit member #3), wearing a consumer skin people in the hall use on day 1 and day 4.

**2. User & pain.** Lena, 29, lands at BOM at 02:40 with no data; the Jio counter wants passport, visa, photo and a local reference; her card fails 3DS on airport Wi-Fi; she holds USDC on Base and an Orb-verified World ID. Second user: Arjun, devrel at a Mumbai sponsor, who ordered 2,000 hoodies at $25 and watched 300 swag-farmers take them. "1 GB on us, one per human" reaches 2,000 verified humans for a quarter of that and opens his app once each. Third: Rahul gifting 1 GB at 3 a.m. to a teammate who went dark.

**3. Why now.** 10–12k attendees, half foreign, land 3–6 Nov already Orb-verified; Hedera's x402 testnet facilitators work; Arkiv wants a native-primitive flagship; the wholesale collapse means a crypto-native reseller can price at Airalo parity and keep most of it; the Devcon crowd is the only week of the year when 5,000 wallets want the same $4 good at once.

**4. Core mechanism.** Request for data → (a) IDKit proof at Orb level → quota entity in Arkiv keyed by nullifier + campaign, BTL = plan validity. If a sponsor campaign has budget, `DataDrop` on Hedera EVM (296) releases the wholesale fee to the service and emits `Claim(nullifierHash, campaign)`: one human, one claim, on-chain. (b) No proof or quota exhausted → HTTP 402 with x402 terms (USDC on Hedera for agents via Agent Kit, Base USDC for humans); facilitator verifies and settles; the service provisions through the reseller API and returns the encrypted LPA string. (c) Gifts: the sender pays naming an ENS; the resolved address owns a quota entity and claims with a signature. (d) The agent (HCS-14 identity, daily USDC cap) tops up on expiry or the 20% webhook. Receipts to an HCS topic. Onchain: Hedera settlement, `DataDrop`, HCS; Arkiv quotas; ENS reads. Offchain: provisioning, webhooks, PWA.

**5. Sponsor map.** *Hedera — x402 ($6.5k).* Remove: no paid lane, no agent, no metering; a static checkout. *World — IDKit ($2.5k; Agent Pass only if documented by Thursday).* Remove: every free profile costs ~$1.50 wholesale, so a sponsor-funded tier is a sybil farm and unfundable; this is a real trust decision with money behind it. *Arkiv — from scratch or continuity ($4k) + Swarm ($500).* Remove: Postgres and cron, the Octroi lesson; BTL is the plan's validity, read on every request. ENS unclaimed: gifting by name.

**6. Revenue (the VC's method).** Assumptions: wholesale $1.14–2.50 per GB/7 d (India `[verify]`); retail $4.50; conferences monthly in base, fortnightly in high; organisers excluded; agent and gift willingness-to-pay zero (the VC's assumption, kept); the payer is sponsor giveaway budget, which at crypto events runs $5–25 per attendee in swag `[verify]`. Data-drop pricing: $4.00 per claimed GB plus a $1,500 campaign fee, capped at 2,000 claims: revenue $9.5k, margin ≈ $6.5k per drop. **Low** (month 6): retail 150 plans/week × $3 + one drop a quarter ≈ **$950/week**. **Base**: one conference a month × two drops ($13k margin) + retail 400/week × $3 ≈ **$4.2k/week**. **High**: two conferences a month × three drops ($39k) + retail 1,500/week × $3 ≈ **$13.5k/week**. Diaspora Jio top-ups through Reloadly are real and in sandbox ([Reloadly India](https://operators.reloadly.com/jio-airtel-vodafone-bsnl-india-airtime-api/), [docs](https://docs.reloadly.com/airtime/top-ups/top-up)) but Indian airtime commissions run ≈1% ([A1Topup](https://a1topup.com/commission/api)): a feature, not revenue. First three payers: one Mumbai sponsor data drop this week ($7.5k, 2,000 claims; the sales meeting is Thursday); a hacker house buying 200 GB; foreigners buying top-ups from Friday. Honest: base misses $10k; high reaches it on one lever we can test Thursday. If no sponsor signs by Saturday, this is a $1–2k/week retail business and the committee should know that.

**7. Scope (≤85 ph).** Contracts 8 (`DataDrop` + tests); backend 34 (x402 Hedera + Base 8, reseller adapter + inventory 8, Arkiv quotas 5, agent + webhooks 8, ENS 3, encrypted delivery 2); PWA 14; sponsor wiring 14; demo prep 8 → **78 ph**; Reloadly (5 ph) only if ahead at Sat 09:00. Live: a judge's phone, World verify, sponsor-pool claim on HashScan, the Arkiv entity with a visible countdown, universal-link install, LTE; the agent paying x402 for 100 MB; a gift to an ENS name. Mocked: usage telemetry if the webhook lags; inventory fulfilment if the API is not live; HCS-14 minimal. Degradation: reseller → inventory; Arkiv → Postgres mirror (lose the prize, keep the product); judges who cannot World-verify in India → foreigners can, team phones as backup; Hedera facilitator → self-run; Base x402 always works. **The image:** a judge's iPhone goes from "No Service" to LTE in the hall and the lock screen reads "300 MB · from Arkiv · because you're human." **The signature:** the Indian paper recharge coupon — foil scratch panel, 16-digit PIN in Chivo Mono, Devanagari numerals in Anek Devanagari, FreeCharge orange; every plan and gift is a coupon, and we print real scratch cards and hand them to judges. No gradients, no glass, no Inter.

**8. Prior art.** GSpot (Lisbon 2023), GeSIM, topizzy, ETH-ernet; Silent.link and Bitrefill (crypto eSIM/recharge since 2021); Octroi and Glassbox402 for human/agent pricing. New: a sponsor-funded human lane with on-chain one-per-human claims, a protocol-expiring quota, agent metering, gift-by-name, sold offshore.

**9. Biggest risk & mitigation.** The sponsor lever: if no drop sells, the model is commodity retail. Mitigation: three asks on Thursday with a one-page offer; retail and inventory keep the demo alive regardless. Legal: nothing sold in India, no Indian payee, no Indian marketing.

**10. UI/UX references.** Saily, Airalo, Paytm recharge, Apple's eSIM sheet, 2000s paper recharge coupons.

**11. Self-score.** T6 (x402 on two chains, agent loop, Arkiv quotas, encrypted provisioning) · O7 (funded human lane + protocol-expiring data is new) · P9 (usable Friday) · U8 (verify, tap, LTE) · W8 (the phone lights up; the card scratches).

## 3. Vote
1. **Dhwani** — the only finalist-shaped demo; my condition: answer Ramesh's rupee question honestly (pilot outside India or with an offshore payee), because an Indian merchant holding USDC is Udhaar's problem in a nicer box. 2. **Octroi** — survives security, degrades gracefully, best sponsor hedge; its mechanism now lives inside my v2. 3. **Asli** — buyers are in the building; paying earners in data instead of USDC would cure its cash-out problem. If mine is struck I build Dhwani: same persona, same week, and I would lend it Recharge's offshore-payee lesson.

## 4. Track position under the pre-build reality
**Continuity.** If code is public before Thursday 21:00, from-scratch is a false declaration judges can diff. ETHGlobal's rules allow Continuity when pre-existing work is disclosed in writing and the in-window work is substantive; "repackaging" does not place. Plan: publish v0 (x402 + reseller skeleton, PWA shell) 3–5 Nov with README and CHANGELOG; ship ≥60% of the feature set in the window — the World gate, `DataDrop`, Arkiv quotas, the agent, gifting, the scratch-card run — with dated commits by humans. Partner eligibility varies per partner, so confirm with Hedera, World and Arkiv reps at kickoff; Arkiv continuity ($4k) is no smaller than from-scratch, World [Cont] IDKit is $2.5k, and Hedera continuity (~$1.5k) is the floor if x402 excludes us. The finalist discount is real; the WOW is physical, which is what the continuity finalists (Void Tactics, Happy Hour) also had.
