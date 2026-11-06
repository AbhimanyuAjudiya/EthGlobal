# Demo script v4: one campaign, two humans, one agent (record Sat 7 Nov before 07:30 IST, submit by 08:00 IST)

One video for ETHGlobal, Hedera, World and ENS. Submissions close **Sat 7 Nov 2026 09:00 IST**, no late entries.
Target **3:50**, never over 4:00 (ETHGlobal 2–4 min; Hedera ≤ 5:00). 1920 × 1080, 30 fps, laptop screen capture at
125 % zoom, light theme, one window, no extensions in the toolbar. The phones appear as mirrored windows (iPhone
Mirroring / QuickTime) or a second camera cut in. Narrate plainly, one take per shot, cut between shots. Never show an
`.env*`, a private key, a HashPack seed or a pass link you will not revoke afterwards.

Everything runs on the live deploy: `https://recharge.ajudiya.com` → `app.recharge.ajudiya.com`, API
`api.recharge.ajudiya.com`, Hedera testnet, Sepolia (ENS), Arkiv rabdi. The `TESTNET · test USDC · not a sale` rail
stays in frame on money screens.

## Two facts that shape the flow

1. **A plan claimed from a console campaign has no agent.** Console campaigns are ticketed event packages, and the API
   refuses top-ups and auto top-ups on event packages by design (a sponsored event bundle is not a wallet). The agent
   shot therefore runs on **your own plan**, the one whose Auto top-up policy was signed by wallet `0x0418…AB10`. The
   live agent buys only under policies owned by that wallet, so MetaMask must be on it for shot 7.
2. **The agent buys when the plan is at or under its threshold** (the sentence on the Auto top-up page says the number)
   or within 30 min of expiry, on its next tick (every 60 s on live). The agent's Hedera account `0.0.11320978` holds
   8.8 test USDC tonight, enough for two $4.00 top-ups. If the plan still has more data than the threshold, the live buy
   cannot happen on camera: use the fallback in shot 7.

## Before you press record (20 minutes)

1. `https://api.recharge.ajudiya.com/healthz` says `"ok":true,"mode":"live"`; `/plans` names the campaign. Open each
   once so the cache is warm.
2. MetaMask: **Account 4 `0x2D…746C`** on Hedera Testnet with ≥ 3 USDC (`0.0.429274`) and HBAR (has 19.4 USDC / 38
   HBAR). The second account **`0x0418…AB10`** present in the same MetaMask for shot 7.
3. Your phone: World App, Orb or Document verified. Friend's phone: World App installed, **not** verified (device level).
   Both can open a link you send them (WhatsApp to yourself and to the friend).
4. Laptop tabs, pre-opened and reloaded, in this order: the app at `/sponsor`; HashScan DataDrop events
   `https://hashscan.io/testnet/contract/0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6` → Events; HashScan topic
   `https://hashscan.io/testnet/topic/0.0.11322448`; Sepolia Etherscan `re-charge.eth` registry
   `https://sepolia.etherscan.io/address/0x297320862052B1d0e069502c0D5DE12841E2EA41`; the Arkiv explorer page of the
   writer `0xC3358be9F35fDF5C8e1922be7376980C93734d3c`; the GitHub README (repo public).
5. **Dry run of shot 7 off camera, once:** open `/plan`, open your own plan (not tonight's test plans), then Auto
   top-up with MetaMask on `0x0418…AB10`. If the switch reads Pause = on, turn it off and sign; within ~90 s a row should
   appear under "Spending history — read from Arkiv" and the HCS topic gets `settle` + `agent-topup` messages. If it
   does, **pause it again** (sign) so the live shot can repeat it. If nothing happens in 2 min, the plan is above its
   threshold: use the fallback narration in shot 7 and do not promise a live buy.
6. Terminal: light theme, 16 pt, this pasted in a scratch file (shot 8 only if time allows):

```bash
curl -si -X POST https://api.recharge.ajudiya.com/gift -H 'content-type: application/json' -d '{"name":"re-charge.eth","mb":1000}' | head -12
```

## Shot list (3:50)

| t | Screen | Exact clicks | What must be visible | Say (≤ 2 sentences) |
|---|---|---|---|---|
| 00:00 | `recharge.ajudiya.com` | none; **Get started** at 00:10 | hero line, phone frame | Recharge: prove you are human and a sponsor pays for your first data in Mumbai; after that you, or your agent, pay per gigabyte over x402 on Hedera, every bundle is an Arkiv entity that expires by itself, and every campaign has an ENS name. |
| 00:14 | sidebar **Organizers** → **Create a campaign** | 1 · Event: name `ETHGlobal Mumbai judges`, destination India; 2 · Package: **India 1 GB · 7 days** chip; 3 · Dates: starts now, ends today +6 h; 4 · Budget: paid per claim `1.20` (the floor), claims cap `2`, claims per hour `2`, budget fills itself `2.40` | the line `2 claims × $1.20 = $2.40 USDC`; the funding card "USDC associated · balance $19.40"; the pill **Create campaign · $2.40 USDC** | A sponsor funds a pool in test USDC on Hedera: price per claim, a cap of two humans, an hourly limit. All three are enforced by the DataDrop contract, not by our server. |
| 00:45 | press **Create campaign** → MetaMask twice | approve USDC, then create | the proof panel: approve tx ↗, create tx ↗, the audit key shown once; the campaign page opens: **0 claims · $0.00 of $2.40 · 2 cap** | Two transactions on Hedera EVM. The API only registers what the chain already holds, and in the background it registers the campaign's ENS name on Sepolia. |
| 01:05 | campaign page → **Attendee data passes** | type `judge-1` ⏎ `judge-2` → **Sign to issue or recover passes** → MetaMask signature | two rows **Issued** and two **Copy private link** buttons | Event campaigns are private: one pass per ticket holder, issued by the organizer's signature. I send one link to myself and one to Ravi, who has World App but has never verified. |
| 01:20 | send the links (WhatsApp, off camera, 2 s) | — | — | — |
| 01:22 | **Friend's phone** | opens link 2 → **Scan with World App** → World App | the verify screen: "Prove you're one human", **What you get**: Orb 1 GB free · Document … free · **Device · no free bundle**; World App cannot provide an Orb or Document credential; the app issues nothing | The credential level is the pricing. A device-only World ID gets no sponsored bundle, and nothing was paid out of the pool. |
| 01:45 | **Your phone** | opens link 1 → **Scan with World App** → approve in World App | the Issuing rows turning on: **Verified · Sponsor paid ↗ · Written to Arkiv**, then the plan card **1 GB** with **Install eSIM · 2 min** | The backend verifies the World proof, pays 1.20 USDC from the campaign on Hedera, writes the plan to Arkiv with its expiry, and orders the eSIM. |
| 02:05 | laptop: campaign page, reload | scroll once | **1 claim · $1.20 of $2.40**; the pass table: `judge-1` **Reserved**, `judge-2` Issued; the Claims table with one HMAC'd key; the ENS row `ethglobal-mumbai-judges.re-charge.eth` | One of two claims used, the other pass still open. The claim key is a hash; the World nullifier never leaves the server. |
| 02:18 | HashScan DataDrop → Events | open the newest `Claimed` | `Claimed(id, claimKey, 1200000, hour)` | Here is that claim on Hedera EVM: 1.20 USDC out of the sponsor's pool. |
| 02:28 | sidebar **Plan** → your own plan → **Auto top-up** (MetaMask on `0x0418…AB10`) | tap the **$4** chip is already on; turn **Pause** off → sign | the sentence "When your plan has less than N MB remaining or nears expiry, your agent buys 1 GB for $4.00 on Hedera testnet, up to $4.00 a day"; **Spending history — read from Arkiv** | This is my own plan, not the event bundle. I hand top-ups to an agent under a daily cap I sign; the cap is enforced in code, not by a model. |
| 02:45 | same page, wait (cut the wait) | none | a new row **+1 GB · agent uaid:… · $4.00** with a HashScan link; click it | Within a minute the agent found the plan under its threshold, paid 4 USDC from its own Hedera account over x402, and the facilitator settled it. **Fallback (no row within 2 min):** open the HashScan topic, show sequence 7 (`settle`) and 8 (`agent-topup`) and say "this is the same flow the agent ran by itself on Friday morning." |
| 03:00 | HashScan topic `0.0.11322448` | open the newest `agent-topup` message | the JSON with `"t":"agent-topup"`, `"uaid":"uaid:aid:…"`, `"usd6":"400000"`, `"reason":"threshold"` | The agent wrote its receipt to our HCS topic under its HCS-14 identity, self-issued. |
| 03:10 | Auto top-up → **How this is read** | tap the row | the sheet with the `arkiv_query` | The spending history is read straight from the Arkiv node by the browser, not from our database. |
| 03:18 | Sepolia Etherscan, the registry `0x2973…EA41` | open the newest tx | the `register` call for `ethglobal-mumbai-judges` | Every campaign gets an ENSv2 name under re-charge.eth from our own subname registry: expiring, non-transferable, with a Permissioned Resolver the sponsor can edit only for avatar, description and X handle. |
| 03:26 | `app.recharge.ajudiya.com/c/ethglobal-mumbai-judges` | none | the sponsor's branding resolved from the name and the "private pass link" notice | A traveller can type the name; the browser resolves it on Sepolia with plain viem and sees it is a ticketed event. |
| 03:34 | GitHub README | scroll to the stack table | Hedera, World, Arkiv, ENS rows | World for the human, Hedera for the money and the agent, Arkiv for the plans that forget themselves, ENS for the names. Recharge's core predates this week; this week it went live on AWS with HashPack payments, event passes and this interface, dated in the changelog. |
| 03:44 | `recharge.ajudiya.com` | none | the hero | Proof or pay: a sponsor pays for humans, agents pay their own way, and the ledger forgets on schedule. |

End at 03:50. **If over 4:00, cut in this order:** 03:10 (How this is read), 03:26 (`/c/` page), 02:18 (Claimed event),
01:20 (the send). Never cut the friend's refusal, your claim, the agent row or HashScan, or the disclosure sentence.

## If something misbehaves

- "The chain is not answering" on create or on passes: the Hedera relay blinked; press the same button again, nothing
  was duplicated. The create flow resumes from its saved draft.
- Friend's World App refuses before a proof exists (no credential): film the World App message and the campaign page
  still at **0 claims**; that is the refusal the World prize asks for.
- Your World ID says "This World ID claimed its bundle already": you are on the wrong campaign link; use the pass link,
  not Home.
- The ENS row has not appeared by 02:05: it lands within about two minutes of creation; show it at 03:18 instead.
- The agent did not buy: use the fallback at 02:45 and do not say it bought.

## Which shots satisfy which prize requirement

| Requirement | Shots |
|---|---|
| Hedera (a) x402 endpoint settling on Hedera | 02:45–03:00: the agent's top-up paid in HTS USDC, settled, HashScan on screen |
| Hedera (b) an agent completes a paid request with no human | 02:28–03:00 (live) or the Friday run (fallback), plus the policy it obeys |
| Hedera (c) README with setup, flow, a Hedera tx id | 03:34 |
| Hedera (d) video ≤ 5 min with a settlement and HashScan | whole video; 02:18 and 02:45 |
| World: request → proof → server validation → protected action | 01:45–02:18 |
| World: alternative path with no action | 01:22 (device-level World ID, nothing issued, pool untouched) |
| ENS: ENSv2 central, functional, live, open source | 00:45 (registration), 02:05 (name on the page), 03:18 (registry tx), 03:26 (resolution) |
| Arkiv: writes, user-visible reads | 01:45 (Written to Arkiv), 02:45 (history read from Arkiv), 03:10 (query) |
| ETHGlobal: 2–4 min, ≥ 720p, prior work disclosed | 3:50 at 1080p; the sentence at 03:34 |
