# Demo script: the one submission video (record Fri 6 Nov, submit by Sat 7 Nov 08:00 IST)

One video serves ETHGlobal, Hedera, World and Arkiv. Submissions close **Sat 7 Nov 2026 09:00 IST**, no late entries.

- **Length.** Target **3:30**. ETHGlobal asks for 2–4 min; Hedera allows at most 5:00. Never over 4:00.
- **Format.** 1920 × 1080, 30 fps, laptop screen capture (ETHGlobal: ≥ 720p, not shot on a phone). The phone appears
  only as a mirrored window inside the laptop frame. No music. Founder narrates, one take per shot, plain voice.
- **Rails.** Everything below runs on the live deploy: `https://app.recharge.ajudiya.com`, API
  `https://api.recharge.ajudiya.com`, testnets only (Hedera testnet, Base Sepolia, Arkiv rabdi 7794095). The
  `TESTNET · test USDC · not a sale` strip stays in frame on every money screen.
- **Order.** Mechanism first, eSIM second, no price list. Amounts appear only inside a 402 or a pay sheet.
- **⏳ = not true yet.** Two shots depend on things that have not happened at the time of writing. Each has its fallback
  shot written next to it; record the fallback if the live version is not ready by the time you reach that shot, and
  say the fallback narration, not the live one.

Say this at 0:00, the same words as the README:

> Recharge: prove you're human and a sponsor pays for your first 300 MB of Mumbai data; after that you, or your agent,
> pay per 100 MB over x402, every bundle is an Arkiv entity that expires by itself, and anyone can gift data to an ENS
> name.

## Shot list (3:30)

| t (mm:ss) | Screen / URL | Exact clicks | What must be visible | Narration (≤ 2 sentences) |
|---|---|---|---|---|
| 00:00 | `app.recharge.ajudiya.com` (landing hub) | none; cursor still | "Everything Recharge does", the tiles Get free data · Buy data · Send data to an ENS name · Agent autopay · Sponsor a data drop; URL bar | The one sentence above, verbatim. |
| 00:15 | same | hover "Get free data", then click it | the line "A sponsor pays once World ID confirms you're one human, by Orb or document." | World tells us you are one human. A sponsor's pool on Hedera pays for that human's first 300 MB, once. |
| 00:25 | `/verify` + mirrored phone (World App) | "Scan with World App" → scan on the **founder's** phone → approve in World App | "Checking · 2 s", then **"This World ID claimed its bundle already."** with "Open that plan" and "Pay for more" | This is my World ID, and it claimed its bundle on Thursday. The same human cannot claim twice; the only way forward is to pay. |
| 00:45 | `/verify` + a second mirrored phone (a non-team **Orb**-verified person, if one is available) | "Scan with World App" → approve | "Checking", then the plan: **Orb · 300 MB free**; the tier line "Device · no free bundle" visible on the tier table | A different Orb-verified human gets 300 MB free. A Device-level ID gets no free bundle and pays the human price. **If no second Orb holder:** skip this shot and say "The successful claim from Thursday is the plan you are about to see." |
| 01:00 | HashScan testnet, `DataDrop` [`0x2d4d…c9E6`](https://hashscan.io/testnet/contract/0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6), Events tab | open the newest `Claimed` row | `Claimed(id, claimKey, paid 500000, hour)`; URL shows `testnet` | Every free claim is a `Claimed` event on Hedera EVM, with 0.50 USDC paid from the sponsor's pool. The claim key is a hash; the nullifier never leaves our server. |
| 01:10 | ⏳ `/install/<key>` on the mirrored phone (eSIM) | "Install eSIM" → iOS cellular-plan sheet | the OS sheet, then the status bar going from "No Service" to an LTE carrier | ⏳ Live: "The bundle is a real eSIM; this is the phone installing it." **Fallback (no eSIM Access deposit yet):** show `/plan/<key>` with status `pending-profile` and say "The eSIM order is waiting on our reseller deposit, so this plan shows pending-profile; the entitlement itself is live." |
| 01:20 | Terminal (light theme, 16 pt) | run `curl -si -X POST https://api.recharge.ajudiya.com/gift -H 'content-type: application/json' -d '{"name":"re-charge.eth","mb":100}' \| head -20` | `HTTP/1.1 402` and `PAYMENT-REQUIRED` with `hedera:testnet`, asset `0.0.429274`, `400000`, payTo `0.0.11322453`, feePayer `0.0.9185802` | Past the free bundle, every paid route answers HTTP 402 with x402 terms. This one asks for 0.40 HTS USDC on Hedera testnet, and the facilitator pays the network fee. |
| 01:35 | `/pay?key=<plan key>` | "Add 100 MB" → "Pay on Hedera with HashPack" → **"Pay with HashPack"** → WalletConnect QR | the pay sheet rows Network · Asset (HTS USDC) · Amount · Pay to · Fee payer; "Worst case: if settlement fails you pay nothing." | A human tops up on Hedera from HashPack. HashPack signs this one transfer. |
| 01:45 | mirrored phone (HashPack) | scan the QR in HashPack → approve the transfer | the HashPack approval screen with 0.40 USDC and the payTo account | I approve it on the phone. |
| 01:55 | `/pay` result | wait for settle; click the HashScan link | "+100 MB · settled · … total" and the HashScan link | The facilitator settled it on Hedera and the plan grew by 100 MB. |
| 02:05 | HashScan testnet transaction page (from the link) | scroll slowly once | the transaction id, **SUCCESS**, the USDC transfer to `0.0.11322453`, consensus time **after kickoff**; URL bar showing `hashscan.io/testnet/transaction/…` | This is the settlement on HashScan, recorded today. **If the HashPack payment fails on camera:** open [`0.0.9185802@1793882124.642565779`](https://hashscan.io/testnet/transaction/0.0.9185802@1793882124.642565779) and say "This is our earlier settlement of the same flow, made before kickoff on Thursday 5 Nov." |
| 02:15 | `/pay` → "Choose a wallet" | click "Choose a wallet" | the RainbowKit picker; Base Sepolia USDC as the second rail | The same 402 also accepts Base Sepolia USDC, through any EVM wallet. Hedera pays top-ups; new plans are bought on Base. |
| 02:22 | `/agent` (AgentSheet) | none; then click "Pause" and "Resume" once | "When your plan drops below 20 % or expires, your agent buys 100 MB for … on Hedera, up to … a day"; "Daily cap"; "Spent today … of …" | You can hand top-ups to an agent. It buys 100 MB at 20 % left or at expiry, under a daily cap you sign, and the cap is enforced in code, not by a model. |
| 02:35 | ⏳ HashScan topic [`0.0.11322448`](https://hashscan.io/testnet/topic/0.0.11322448) + agent's HashScan tx | open the newest message, then its transaction | ⏳ Live: an `agent-topup` message carrying the HCS-14 UAID `uaid:aid:q4Yx…`, and the agent's settled Hedera tx after kickoff | ⏳ Live: "The agent, `recharge-agent`, paid this top-up on Hedera by itself, using Hedera Agent Kit, and wrote the receipt to our HCS topic with its HCS-14 identity." **Fallback (no in-window agent top-up yet):** show the topic's existing messages, then the terminal `tail -n 5 "$AGENT_STATE_DIR/journal.jsonl"` on the agent host, and say "The agent's first top-up fires when a live plan runs low; here is its decision journal, and its identity is a self-issued HCS-14 UAID, not yet registered." |
| 02:50 | Terminal: the `arkiv_query` from [`arkiv/README.md`](../arkiv/README.md) | paste and run it | entity `0xcfca33d1…c55e7`, `type: entitlement`, `kind: free`, `tier: orb`, `expiresAt` 7 days out | The plan is not in our database. It is an Arkiv entity on rabdi with an expiry, and when that passes the entity is gone and nobody runs a cron job. |
| 03:02 | `rabdi.explorer.arkiv.network/address/0xC335…4d3c` | open the entity | the writer address and the entity with its expiry block | Every entitlement, gift and receipt is written by this one address; the agent and the gift claim read them back from Arkiv. |
| 03:08 | `/gift` | type `re-charge.eth` in "ENS name" | "re-charge.eth resolves · the address is printed on the pass" | You can gift data to an ENS name; if nobody claims it, the USDC comes back. |
| 03:14 | `/sponsor` (sponsor pool) | none | the campaign, claims count and budget bar (DataDrop on Hedera EVM) | Sponsors fund the free pool in USDC with a budget and an hourly cap. |
| 03:19 | README, "Continuity disclosure" section | scroll to it | the disclosure block with the tag `v0-prekickoff` | Honestly: the product — gateway, quota engine, sponsor pools, the top-up agent, gifting, Arkiv and the first testnet payments — was built before kickoff and is tagged `v0-prekickoff`; in the window we took it live on AWS, added the wallet layer, HashPack payments, the mobile flow and the submission material, dated in CHANGELOG.md. |
| 03:27 | landing hub | none | `app.recharge.ajudiya.com` in the URL bar | Proof or pay: a sponsor pays for humans, agents pay their own way, and the ledger forgets on schedule. |

End at 03:30.

## Recording checklist

1. Browser at **125 % zoom**, one window, 1920 × 1080; close every other tab; light theme; no extensions in the toolbar.
2. Terminal in a light theme at 16 pt; type the long commands ahead of time and paste them; nothing secret on screen (never `cat` an `.env*`).
3. HashPack testnet account funded with **≥ 2 test USDC (`0.0.429274`) and HBAR**, and associated with the token; test one top-up before recording.
4. A live plan key on this browser (from Thursday's Orb claim) so `/pay` and `/agent` open on a real plan.
5. A Base Sepolia wallet in the browser with a little test USDC, only so the RainbowKit picker shows a connected wallet.
6. **Phone mirroring:** iPhone Mirroring (macOS) or QuickTime → New Movie Recording → iPhone, placed at the right of the frame for World App and HashPack; Do Not Disturb on, no notifications in frame.
7. Pre-open the HashScan `DataDrop` events page, the topic `0.0.11322448` page and the Arkiv explorer in tabs; reload each once so they render fast.
8. Before recording check `https://api.recharge.ajudiya.com/healthz` says `"mode":"live"` and `"degraded":false`; if the ledger is degraded, keep the banner in frame and say so.
9. For each ⏳ shot, decide live or fallback just before recording it, and use the matching narration; never present a fallback as live.
10. **If over 4:00, cut in this order:** the second World ID shot (00:45), "Choose a wallet" (02:15), the Arkiv explorer (03:02), the sponsor page (03:14). Never cut the 402, the HashPack payment, the HashScan page or the disclosure line.

## Which shots satisfy which prize requirement

| Prize requirement | Shots |
|---|---|
| **Hedera (a)** an x402 endpoint that settles on Hedera | 01:20 (402 with `hedera:testnet` terms), 01:35–02:05 (paid and settled) |
| **Hedera (b)** an agent completes a paid request with no human | ⏳ 02:35 (agent top-up + HCS receipt); fallback is the journal, which does **not** fully meet (b); 02:22 shows the policy it obeys |
| **Hedera (c)** README with setup, flow and a Hedera tx id | not a video shot; README "Hedera" section and artefact table (pointed at 03:19) |
| **Hedera (d)** video ≤ 5 min with a payment settling and a HashScan link on screen | the whole video (3:30); 01:55 link + 02:05 HashScan page; extras: 01:00 DataDrop on Hedera EVM, 02:22 spending cap, 02:35 HCS audit log + HCS-14 UAID |
| **World** full journey: request → proof → validated → protected action | 00:25–00:45 (IDKit proof, backend check, free bundle issued, `Claimed` at 01:00) |
| **World** denied path, no action | 00:25 (a World ID that already claimed is refused; nothing is paid out). The Agent Pass deny path runs only against the labelled simulator, so it is not in this video |
| **Arkiv** writes on the current testnet and a user-visible feature reads them | 02:50 (`arkiv_query` against rabdi), 03:02 (writer + entity), 01:10 fallback (`/plan` read from Arkiv) |
| **ETHGlobal** 2–4 min, ≥ 720p, not on a phone, pre-existing work disclosed | 3:30 laptop capture at 1080p; 03:19 disclosure line; 02:05 fallback narration names the pre-kickoff tx as pre-kickoff |
