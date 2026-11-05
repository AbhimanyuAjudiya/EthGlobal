# Demo script: the 4-minute pitch, the cutover rules and the Fri 06:00 swap gates

This is the finalist format: a 4-minute live demo plus 3 minutes of Q&A. The same running order serves the sponsor
booths, where you stop after minute three. The pitch order is fixed by DECISION §3 (Q-JUDGE-RECHARGE-3): **the mechanism
comes first, the eSIM second, and no price list appears before minute three.**

## The one sentence and the one image

Say this verbatim at 0:00, and use the same words in the README and the video:

> **Recharge: prove you're human and a sponsor pays for your first 300 MB of Mumbai data; after that you — or your
> agent — pay per 100 MB over x402, every bundle is an Arkiv entity that expires by itself, and anyone can gift data to
> an ENS name.**

Then the mechanism sentence: *Glassbox402 priced humans and agents differently; Recharge is the gate that proves which
is which, and sells them a good people want on day one.*

**The one image (DECISION §8.1).** A judge's iPhone on the big screen goes from **"No Service" to "LTE"** four seconds
after a payment lands on HashScan. The lock screen reads **"300 MB · from <sponsor> · because you're human."** Its
physical twin is the judge rubbing a paper scratch card and reading the same line and a 16-digit PIN.

## Roles on stage (declared aloud)

| Role | Who | Says on stage |
|---|---|---|
| Presenter | Founder | the sentence, the mechanism, the close |
| Driver (laptop: `/plan`, HashScan, Arkiv explorer) | Product/PWA | nothing; drives the tabs |
| Phones (judge's phone helper, pre-installed fallback phone) | Provisioning/Agent | the install hand-off and the cutover call |
| **The sponsor** | Integrations, **declared as a teammate playing the sponsor** ("<name> is our teammate; today they play the sponsor") | nothing; funded the campaign |

Each name is **TBD by human (Founder, Sat 09:00)**. No role on stage is presented as a third party unless it is one.

## Pre-staged before the judges sit down

1. **Tab 1: HashScan**, filtered to the `DataDrop` contract on 296, with the latest `Claimed` event open.
2. **Tab 2: Arkiv explorer** (`rabdi.explorer.arkiv.network`), showing the demo entitlement entity with its expiry
   (key `ent:…`).
3. **Tab 3: `/plan/<key>`** of the pre-installed phone's plan (the cutover target).
4. **Tab 4: `/sponsor/<id>`**, the dashboard (claims count, HMAC'd keys, budget bar).
5. **Tab 5: HashScan HCS topic** (`hashscan.io/testnet/topic/<0.0.x>`), where the receipts land.
6. Phones: the judge-facing phone with eSIM capability and no Recharge profile, and **the pre-installed fallback
   phone** already showing LTE on a Recharge profile. Both are charged.
7. Paper: **three scratch cards per judge**, campaign-funded and redeemable, printed by `pnpm print:cards`.
8. A Hedera testnet wallet that a judge or a non-team attendee can tap, funded with test USDC (see minute 2).

## Running order (4:00)

| Time | Beat | What is on screen | Live step and its fallback |
|---|---|---|---|
| 0:00–0:20 | The sentence, then the mechanism sentence. | The coupon on `/`: **300 MB** and "N of 2,000 sponsor bundles left · <sponsor>". | — |
| 0:20–1:10 | **Proof → money.** "World checks you're one human. Your nullifier is new, so the sponsor's pool pays: 50 cents in USDC moves on Hedera, for you." The judge taps "I'm human". | `/verify` → World App → `/plan/<key>`; Tab 1 shows the new `Claimed` (`paid 500000`). | Live: IDKit 4 on the judge's phone. Fallback: a team pre-verified phone, then the labelled simulator (see "honest labels"). |
| 1:10–1:50 | **Entitlement that dies by protocol.** "This plan is not in our database. It is an Arkiv entity with `expiresIn` = seven days. When it expires, nobody runs a cron job." | Tab 2: the entity, its expiry, the `$creator` filter; `/plan` "Why it expires by itself". | Point at the 90-second entitlement on the sponsor dashboard dying on screen (seeded with the local seed hook in rehearsal, a real short campaign live). |
| 1:50–2:30 | **The eSIM, second.** Install the profile on the judge's phone. | `/install`: the OS's own words, "No Service" → "Searching…" → "LTE · Jio". | **90-second rule** (below): at 90 s without LTE, switch to the pre-installed phone and say so. |
| 2:30–3:00 | **A human pays on Hedera.** "Your 300 MB is running out. Add 100 MB: 40 cents, over x402, settled on Hedera." A judge or an attendee taps the payment. | `/pay`: the eight-state sheet → "Paid · Final"; Tab 5 shows the HCS `settle` receipt. | If the payer is a team wallet, **say it aloud**: "this is our team's testnet wallet; you're tapping it". |
| 3:00–3:30 | **Your agent pays while you sleep.** "At 20 % left, or at expiry, your agent buys 100 MB on Hedera, under a cap you signed: $10 a day." | `/agent`: the policy as a sentence; the receipt row "+100 MB · paid by your agent" with the HCS-14 UAID; HashScan for the agent's settlement. | The trigger is **expiry or a real reseller webhook**. Simulated usage is labelled "simulated usage". |
| 3:30–3:50 | **Gift to a name.** "Send 1 GB to `rahul.eth`. If Rahul never claims it, the USDC comes back." Hand each judge their three scratch cards. | `/gift`: `rahul.eth → 0x…` resolving live, then the boarding-pass PIN. | The judge scratches a card and redeems it on `/card/<serial>`. |
| 3:50–4:00 | Close: "Proof or pay. A sponsor pays for humans, agents pay their own way, and the ledger forgets on schedule." This is the first time a price is spoken; the ask follows. | `/sponsor/<id>`: "N claims · $X of $1,000". | — |

## Cutover rules (DECISION §6.6, degradation)

Say each cutover aloud. Never cut over silently.

| Trigger | Cut over to | Words on stage |
|---|---|---|
| Live install has no LTE after **90 s** | the pre-installed phone | "Carrier activation can take a few minutes; here is the same profile installed this morning." |
| World cloud verifier down, or the judge cannot verify in India | a foreign judge with an Orb ID → a team pre-verified phone → the labelled simulator | "This is a simulated World ID; the live verification log is in our README." |
| Remote facilitator down | the self-run facilitator (`/facilitator/settle`; allowed by the track) | "We're settling through our own facilitator; same chain, same transaction." |
| Hedera unreachable | Base Sepolia settlement; keep HCS if reachable | "Hedera testnet is not answering; this payment settles on Base Sepolia." |
| Arkiv down | the Postgres mirror behind the same `Ledger` port, with the "ledger degraded" banner visible | "The banner says it: Arkiv is degraded, and we're on our mirror." |
| Reseller down | pre-bought inventory | the on-screen label "inventory profile" |
| Agent Kit wallet fails | the EVM-scheme agent on Base Sepolia, labelled | "Today the agent pays from its Base wallet." |

## Honest labels, word for word (DECISION §6.6)

These strings appear on screen and in the README exactly like this:

- **"simulated usage"**: usage telemetry when the reseller's usage API lags.
- **"inventory profile"**: fulfilment from pre-bought inventory when a live order fails.
- **"HCS-14 registration minimal"**: the UAID is self-issued and computed, not registered in an HCS-14 registry.
- **"IDKit humans only"**: AgentKit discount mode is absent unless the beta lands.
- **"Recharge (demo sponsor)"**: the demo sponsor, unless a real sponsor funds a testnet campaign on Thursday.
- **The Hedera human payment** is made by a judge or a non-team attendee with a Hedera testnet wallet. Otherwise it is
  made by a team wallet operated by the judge's tap, and this is **said aloud**.

## Fri 6 Nov 06:00 IST swap gates (DECISION §4, last column)

The gate decides which partner programs are selected. The selection is confirmed at the **Sat 18:00 partner-selection
freeze**. Owner: Sponsor lead with Integrations. Record each verdict in `CHANGELOG.md` at 06:05.

| Partner | Pass test by Fri 06:00 | Check | Fallbacks, in order |
|---|---|---|---|
| **Hedera** | one **in-window** 402 → pay → 200 settled on Hedera testnet, and one **in-window** `Claimed` event | the HashScan links for both, timestamped after Thu 21:00 IST | remote facilitator fails → self-run `/verify` + `/settle`; HTS ERC-20 facade misbehaves → `DataDrop` in `LEDGER_ONLY` with native HTS transfers; Hedera JSON-RPC/relay unreachable → Base Sepolia for all settlement, keep HCS if reachable, **swap the slot to ENS** at Sat 18:00 |
| **World** | one **in-window** cloud verification from a **non-team** device (a foreign attendee with an Orb ID) | the API log line `event: decision` (`kind: serve-free`) plus the `claim.tx` line for a non-team device after 21:00 (nullifier hashed, never in clear) | team pre-verified phones (Selfie Check works in India) plus a labelled simulator on stage; the prize is kept because the Wednesday logs exist. No AgentKit beta by Thu 21:00 → Agent Pass is not claimed |
| **Arkiv** | an **in-window** write + attribute query on **rabdi 7794095** (the committee text says Kaolin; A-23), and one entity **observed expiring** | the explorer link of an entity written after 21:00, and a `GET /me/<key>` → 410 after its `expiresAt` | the Postgres mirror behind the same `Ledger` interface with the visible "ledger degraded" banner; **swap the slot to ENS** at Sat 18:00 |
| ENS | integrated, unclaimed; becomes the third program only through a swap above | `rahul.eth` resolves through `EnsResolver` on the live RPC | n/a |

## The Q&A card (3:00)

| They ask | We answer (short) |
|---|---|
| "Silent.link has sold crypto eSIMs since 2021." | Silent.link has no human lane, no on-ledger entitlement, no agent metering and no gifting by name. We are not a crypto eSIM shop. We are a proof-or-pay gate that happens to sell a good people want on day one. |
| "GSpot did eSIM + ZK-KYC at Lisbon 2023." | GSpot gated access. It had no metering, no agent and no free tier with sponsor money behind the nullifier. |
| "Glassbox402 already priced humans and agents differently." | Yes, and that is our mechanism sentence. Recharge is the gate that proves which is which. |
| "The conference badge already does one-per-attendee." | The airport moment comes before the badge. A badge cannot verify an action, and the sponsor also buys pre-arrival distribution. Device-level gets **no smaller gift**: it gets the paid lane at the human price. The free bundle is for non-residents with Orb/Document credentials. |
| "Isn't the only Hedera payment you paying yourselves?" | No. A human pays on Hedera in this demo, the sponsor pool pays out on Hedera EVM for every free claim, and the agent's trigger is expiry or a real webhook, not a cron job. We asked Hedera devrel to fund a campaign from their own account (answer: TBD by human (Founder, Thu 21:30)). |
| "Does a 60-second cached `/me` read count as reading from Arkiv?" | Every write, every window boundary, the agent's remaining-MB read, the gift claim by namehash and the sponsor dashboard query Arkiv live. Only the hot `/me` poll is cached, for 60 s, and `decide()` never reads the cache. We asked Arkiv devrel the same question at kickoff (answer: TBD by human (Founder, Thu 21:30)). |
| "Who wrote this?" | See the Continuity disclosure: an AI orchestrator wrote most of the pre-kickoff code under our direction, with a red-team pass. In-window commits are ours, dated in `CHANGELOG.md`. |
| "What if the attestor key leaks?" | The drain bound is $50/hour for the demo campaign ($100 worst burst at an hour edge). `setAttestor` plus pause takes under 5 minutes, and we drilled it on Friday (T-01). |

## Rehearsal checklist (Sat 09:00–13:00, Sat 23:00 ×2, Sun 06:30)

- [ ] Three-device rehearsal with every cutover triggered once on purpose.
- [ ] 4:00 on a stopwatch, twice in a row, with the Q&A card.
- [ ] The honest labels visible exactly as written above.
- [ ] Each tab reloads in under 2 s on venue Wi-Fi and on cellular.
- [ ] Three scratch cards per judge, redeemed once each in rehearsal from a separate print run (never the judges' cards).
