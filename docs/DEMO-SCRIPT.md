# Demo script v3: the one submission video (record Sat 7 Nov before 07:30 IST, submit by 08:00 IST)

One video serves ETHGlobal, Hedera, World and Arkiv. Submissions close **Sat 7 Nov 2026 09:00 IST**, no late entries.

- **Length.** Target **3:30**, never over 4:00 (ETHGlobal asks 2–4 min; Hedera allows 5:00).
- **Format.** 1920 × 1080, 30 fps, laptop screen capture at 125 % browser zoom, light theme, one window, no other tabs
  in the strip, no extensions in the toolbar. The phone appears only as a mirrored window inside the laptop frame
  (iPhone Mirroring or QuickTime → New Movie Recording → iPhone), Do Not Disturb on. No music. You narrate, one take
  per shot, plain voice. Never `cat` an `.env*`; never show a private key or the HashPack seed.
- **Rails.** Everything runs on the live deploy: landing `https://recharge.ajudiya.com`, app
  `https://app.recharge.ajudiya.com`, API `https://api.recharge.ajudiya.com`, testnets only (Hedera testnet, Base
  Sepolia, Arkiv rabdi). The `TESTNET · test USDC · not a sale` strip stays in frame on every money screen.
- **⏳ = decide just before the shot.** Two shots depend on live state (a second Orb-verified human; the agent's live
  top-up). Each has its fallback written beside it; use the fallback narration with the fallback shot, never the live
  one.

Say this at 0:00, the same words as the README:

> Recharge: prove you're human and a sponsor pays for your first 300 MB of Mumbai data; after that you, or your agent,
> pay per gigabyte over x402, every bundle is an Arkiv entity that expires by itself, and anyone can gift data to an ENS
> name.

## Before you press record (10 minutes)

1. `https://api.recharge.ajudiya.com/healthz` says `"mode":"live"` and `"degraded":false`;
   `https://api.recharge.ajudiya.com/plans` names the campaign (`"campaign":{…"remainingClaims":…}`); if it is `null`,
   stop and ask: the free path has no bundle to show.
2. Your own phone has World App, already used to claim on Thursday (that gives the honest "already claimed" path). If a
   second person with an **Orb-verified** World ID is near, keep them for shot 4; otherwise skip it.
3. HashPack on the phone: testnet account with **≥ 5 test USDC (`0.0.429274`) and some HBAR**, token associated; do one
   top-up off camera first so the pairing is known-good.
4. The laptop browser holds a plan: open `app.recharge.ajudiya.com/plan` and confirm a plan row is there (Thursday's
   claim); note its key for `/pay`.
5. Pre-open and reload once, in this order, in tabs you will switch to: HashScan `DataDrop` events
   `https://hashscan.io/testnet/contract/0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6` → Events; HashScan topic
   `https://hashscan.io/testnet/topic/0.0.11322448`; the in-window agent settlement
   `https://hashscan.io/testnet/transaction/0.0.9185802@1793925870.465901542`; the Arkiv explorer page of the writer
   `0xC3358be9F35fDF5C8e1922be7376980C93734d3c` on rabdi; the README's Continuity disclosure section on GitHub (repo public).
6. Terminal: light theme, 16 pt, the two commands below pasted into a scratch file so you paste, not type.

```bash
curl -si -X POST https://api.recharge.ajudiya.com/gift -H 'content-type: application/json' -d '{"name":"re-charge.eth","mb":1000}' | head -12
```

The second command is the `arkiv_query` block from [`arkiv/README.md`](../arkiv/README.md), unchanged.

## Shot list (3:30)

| t | Screen / URL | Exact clicks | What must be visible | Say (≤ 2 sentences) |
|---|---|---|---|---|
| 00:00 | `recharge.ajudiya.com` | none; cursor still, then click **Get started** at 00:12 | the hero line, the phone frame with the home screen, the receipt card | The one sentence above, verbatim. |
| 00:14 | app Home (laptop: sidebar + two columns) | none | "Land in India. Be online in two minutes.", the card **300 MB** "free · N of 20 left", quick actions Prove I'm human · Pay instead · Scratch card · Organizers | World tells us you are one human. A sponsor's pool on Hedera pays that human's first 300 MB, once. |
| 00:26 | click **Prove I'm human** → `/verify` | none, then **Scan with World App** | Stepper 1 Prove · 2 Issue · 3 Install; "Prove you're one human"; "World checks you're one human. We get a code that can't be traced to you."; **What you get**: Orb 300 MB free · Document 150 MB free · Device no free bundle | The backend signs the request, World App answers, the backend verifies the proof before anything is issued. The tier table is the honest rule: Orb and document get the bundle, a device-only ID pays. |
| 00:40 | mirrored phone: World App | scan the QR, approve | the app shows **"This World ID claimed its bundle already."** with **Open that plan** and **Pay for more** | This is my World ID; it claimed on Thursday. The same human cannot claim twice, so the only way forward is to pay. |
| 00:52 ⏳ | a second phone, Orb-verified person | Scan with World App → approve | the Issuing rows turning on: Verified · Sponsor paid `0x…` ↗ · Written to Arkiv, then the plan card with 300 MB | A different Orb-verified human gets 300 MB free; the sponsor pool just paid 0.50 USDC on Hedera for them. **Fallback (nobody available):** skip; at 01:02 say "This is the plan Thursday's claim produced." |
| 01:02 | **Open that plan** → `/plan/<key>` | scroll once to Details | the balance card (MB left, meter, "usage as of HH:MM", status pill); quick actions Install · Add data · Gift · Receipts; Details rows **Expires** (absolute date), **From** (sponsor), **Network**, **Arkiv key** (mono, copy), the three receipt rows | The plan is not in our database: it is an Arkiv entity with an expiry; when that passes it is gone and nobody runs a cron job. The sponsor is named like a donor on a plaque. |
| 01:16 | HashScan `DataDrop` → Events | open the newest `Claimed` row | `Claimed(id, claimKey, paid 500000, hour)`, URL shows `testnet` | Every free claim is a `Claimed` event on Hedera EVM, 0.50 USDC from the sponsor's pool; the claim key is a hash, the nullifier never leaves our server. |
| 01:26 | Terminal | paste the `curl … /gift` command | `HTTP/2 402` and the `payment-required` header | Past the free bundle every paid route answers HTTP 402 with x402 terms. Gifts settle in USDC on Base Sepolia; top-ups, next, settle on Hedera. |
| 01:38 | `/pay?key=<key>` (from the plan's **Add data**) | tap the **1 GB · 7 days · $4.00** chip; in **Pay from** pick the Hedera chip | the Review rows: Data 1 GB · Valid 7 days · From · **Network fee $0.00 — paid by the facilitator** · Worst case with the approval countdown; the card **Pay on Hedera with HashPack** | A human tops up from HashPack. The 402 is the review you see: amount, network, fee payer, and the worst case in plain words. |
| 01:50 | **Pay with HashPack** → QR; mirrored phone: HashPack | scan, approve the 4.00 USDC transfer | HashPack's approval sheet with 4 USDC and the payTo account `0.0.11322453` | HashPack signs this one transfer. |
| 02:02 | `/pay` result | wait for Final; click the HashScan link in the hash row | "Paid · Final", the hash with copy and HashScan | The facilitator settled it on Hedera and the plan grew by 1 GB. |
| 02:10 | HashScan transaction page | scroll slowly once | transaction id, **SUCCESS**, the USDC transfer, consensus time today, `hashscan.io/testnet/transaction/…` in the URL bar | This is the settlement, recorded now. **If the HashPack payment fails on camera:** open the in-window tx `0.0.9185802@1793925870.465901542` and say "This is the same flow settled earlier today by our agent." |
| 02:20 | sidebar **Auto top-up** → `/agent` | none; then tap the **$20** cap chip and the **Pause** switch once | the policy sentence "When your plan has less than 60 MB remaining or nears expiry, your agent buys 1 GB for $4.00 on … up to $8.00 a day"; the cap chips $4 · $8 · $20; **Spending history — read from Arkiv** | You can hand top-ups to an agent. It buys at 60 MB left or at expiry under a daily cap you sign, and the cap is enforced in code, not by a model. |
| 02:34 ⏳ | HashScan topic `0.0.11322448` | open the newest `agent-topup` message, then its transaction | the message carrying the HCS-14 UAID `uaid:…`; the agent's settled Hedera tx | The agent paid this top-up on Hedera by itself with Hedera Agent Kit and wrote the receipt to our HCS topic under its HCS-14 identity: self-issued, not yet registered. **Fallback:** the same words over the topic page showing sequence 7 (settle) and 8 (`agent-topup`) from this morning's run. |
| 02:48 | `/agent` → **How this is read** | tap the row | the sheet with the `arkiv_query` | The spending history is read back from Arkiv, not from our database. |
| 02:54 | Terminal | paste the `arkiv_query` block, run | the entitlement entity: `type entitlement`, `kind free`, `tier orb`, `expiresAt` seven days out | Here is that plan as the ledger sees it, with its expiry block. |
| 03:04 | Arkiv explorer, writer `0xC335…4d3c` | open the newest entity | the writer address and the entity | One address writes every entitlement, gift and receipt; the agent and the gift claim read them back. |
| 03:10 | sidebar **Gift** → `/gift` | type `re-charge.eth` | the resolution line; the size chip **1 GB $4.00**; the reclaim rule sentence | You can gift data to an ENS name; if nobody claims it by the date shown, the USDC comes back to you. |
| 03:17 | sidebar **Organizers** → `/sponsor`, open the campaign | none; scroll once | "N claims" hero, budget bar, claims-per-hour line, the claims table with HMAC'd keys | Sponsors fund the free pool in USDC with a budget and an hourly cap; event organizers issue private passes for their ticket holders. |
| 03:23 | GitHub README → "Continuity disclosure" | scroll to it | the disclosure block with the tag `v0-prekickoff` | Honestly: the product was built before kickoff and is tagged `v0-prekickoff`; in the window we took it live on AWS, added HashPack payments, the agent's live run, event passes and this interface, dated in CHANGELOG.md. |
| 03:28 | `recharge.ajudiya.com` | none | the hero | Proof or pay: a sponsor pays for humans, agents pay their own way, and the ledger forgets on schedule. |

End at 03:30. **If over 4:00, cut in this order:** 00:52 (second human), 03:04 (Arkiv explorer), 03:17 (sponsor), 02:48 (How this is read). Never cut the 402, the HashPack payment, the HashScan page or the disclosure line.

## Which shots satisfy which prize requirement

| Requirement | Shots |
|---|---|
| **Hedera (a)** an x402 endpoint settling on Hedera | 01:38–02:10: the top-up's Hedera terms (HTS USDC, facilitator fee payer), paid and settled, HashScan on screen |
| **Hedera (b)** an agent completes a paid request with no human | 02:34 (the `agent-topup` HCS message and its settlement from this morning's live run) + 02:20 (the policy it obeys, the cap) |
| **Hedera (c)** README with setup, flow and a Hedera tx id | not a shot; README "Hedera" section and the artefact table (pointed at 03:23) |
| **Hedera (d)** video ≤ 5 min with a settlement and a HashScan link | the whole video; 02:02 link, 02:10 page, 01:16 `Claimed` on Hedera EVM |
| **World** request → proof → server validation → protected action | 00:26–00:52 (backend-signed request, World App, verification, the issued bundle; 01:16 the on-chain effect) |
| **World** denied / alternative path, no action | 00:40 (a World ID that already claimed is refused; nothing is paid out) |
| **Arkiv** writes on the current testnet, a user-visible feature reads them | 01:02 (Arkiv key on the plan), 02:48 (spending history read from Arkiv), 02:54 (`arkiv_query`), 03:04 (writer + entity) |
| **ETHGlobal** 2–4 min, ≥ 720p, not on a phone, pre-existing work disclosed | 3:30 at 1080p; 03:23 the disclosure line; every fallback narration names the earlier run as earlier |
