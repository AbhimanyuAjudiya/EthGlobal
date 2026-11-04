# On-site runbook: Wed 4 → Sun 8 Nov 2026 (the human team)

This is the day-by-day checklist from DECISION §6.7, ops-demo §7 and BUILD-PLAN §6, written as commands. Kaolin is
retired: wherever the committee text says Kaolin, read **Arkiv rabdi, chain 7794095** (INTERFACES A-23). All times are
IST.

**Roles (five).** Integrations · Provisioning/Agent · Product/PWA · Design/Producer · Sponsor/Sales (= Founder). Names:
**TBD by human (Founder, Wed 10:00)**.

**The one rule.** No key, seed phrase, access code or signing key ever enters an AI context, a chat, a commit, a log or
this repository. Keys are generated on the team's own machines. Every secret goes into the VPS environment or the
password manager, never into a file that git tracks. `.env` is git-ignored. Check that with `git check-ignore .env`
before writing into it.

---

## 0. Once per machine (Wed morning)

```sh
git clone <repo> && cd EthGlobal && git checkout claude/ethglobal-mumbai-build
bash scripts/check-tools.sh                       # node 22, pnpm 10, forge/anvil/cast 1.5.1, solc 0.8.30
pnpm install                                      # see README "Dependencies": the 3-day release-age gate
pnpm --filter @ethglobal/contracts run deps       # forge-std + OpenZeppelin into packages/contracts/lib
pnpm -r run build
pnpm e2e                                          # MODE=local, ≈ 25 s, must print "all steps passed"
cp .env.example .env && git check-ignore .env     # MODE=local by default; live values only on the VPS
```

### Key generation (on-site, on the team's machines)

```sh
# EVM keys into Foundry keystores (prompted passwords; never --private-key on a command line)
cast wallet new                                    # prints a fresh key ONCE: import it, then clear the terminal
cast wallet import deployer  --interactive         # Hedera EVM 296 + Base Sepolia deployer (cold owner later)
cast wallet import attestor  --interactive         # DataDrop.claim, the API's ATTESTOR_PRIVATE_KEY
cast wallet import relayer   --interactive         # the self-run facilitator (RELAYER_PRIVATE_KEY)
cast wallet import treasury  --interactive         # the SEPARATE refund wallet (A-31), ≤ TREASURY_MAX_USD6_PER_DAY
cast wallet import sponsor   --interactive         # the demo sponsor wallet ("Recharge (demo sponsor)")
cast wallet list

# 32-byte server secrets (VPS env only)
openssl rand -hex 32   # → OCTROI_SECRET (prefix 0x)
openssl rand -hex 32   # → SERVER_SEAL_KEY (prefix 0x)
openssl rand -hex 32   # → INVENTORY_SEAL_KEY
openssl rand -hex 24   # → ESIMACCESS_WEBHOOK_TOKEN, PRINT_TOKEN
```

Hedera accounts (portal.hedera.com, **ECDSA**): three accounts for API/HCS, agent and treasury, plus payout. Fund them
with HBAR, **associate each with USDC `0.0.429274`**, and mint test USDC at faucet.circle.com ("Hedera Testnet",
`0.0.x`). Their keys load with `PrivateKey.fromStringECDSA`; a key-type mismatch shows up as `INVALID_SIGNATURE`.
Arkiv: get an access key at hub.arkiv.network/access-keys, and fund the writer with **tGLM** from
hub.arkiv.network/faucet on **rabdi**. World: the Developer Portal app (`app_mode: external`), its **RP** (the signing
key is shown **once**: straight into the VPS secret store) and a **production** action `recharge-welcome` with
**unlimited** verifications (T-24).

### The VPS `.env` for `MODE=live` (names only; values from the password manager)

`MODE=live CHAIN=296 RPC_URL=$HEDERA_TESTNET_RPC_URL HEDERA_TESTNET_RPC_URL=https://testnet.hashio.io/api`
`OCTROI_SECRET SERVER_SEAL_KEY ATTESTOR_PRIVATE_KEY RELAYER_PRIVATE_KEY PAYOUT_ADDRESS PAYOUT_HEDERA_ACCOUNT`
`TREASURY_PRIVATE_KEY TREASURY_HEDERA_ACCOUNT TREASURY_HEDERA_PRIVATE_KEY X402_FACILITATOR=remote`
`X402_FACILITATOR_URL_EVM X402_FACILITATOR_URL_HEDERA X402_NETWORKS=hedera:testnet,eip155:84532 X402_HEDERA_FEE_PAYER`
`RESELLER=esimaccess ESIMACCESS_ACCESS_CODE ESIMACCESS_WEBHOOK_TOKEN WORLD_APP_ID WORLD_RP_ID WORLD_RP_SIGNING_KEY`
`ARKIV_CHAIN_ID=7794095 ARKIV_ACCESS_KEY ARKIV_PRIVATE_KEY HEDERA_ACCOUNT_ID HEDERA_PRIVATE_KEY HCS_TOPIC_ID`
`ENS_RPC_URL SWARM_BEE_URL SWARM_POSTAGE_BATCH PRINT_TOKEN` plus the agent's `AGENT_*` (`services/agent/README.md`).
`env.ts` refuses to boot on an Anvil key, `LOG_LEVEL=debug`, Kaolin, `RESELLER=megaesim`, a missing `WORLD_RP_*` or any
`SEED_*` variable. That refusal is the check.

---

## Wed 4 Nov

**10:00 · Provisioning · the attach test (DECISION §1 switch trigger a).** Use the pre-bought profiles: three attempts
on a team iPhone (iOS 17.4+) and three on a team Android 13+. For each attempt, log the device, carrier (Jio/Airtel),
install start, "Searching…", LTE time and outcome. Take screenshots of the iOS and Android eSIM sheets for web.md's
`[screenshot Wed]` strings. The pass condition is a profile registering on Jio or Airtel within 10 minutes of install.

| # | Device | Profile source | Install → LTE (s) | Carrier | Pass? |
|---|---|---|---|---|---|
| 1–3 | iPhone (iOS ___) | TBD | TBD | TBD | TBD |
| 4–6 | Android (___) | TBD | TBD | TBD | TBD |

Also test the Apple universal link
`https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=<LPA>` on the iPhone, and the Android manual path
(API-FACTS unknown 10).

**12:00 · Integrations · sandbox order → LPA → install.** Run one eSIM Access order with the signed `RT-*` headers
(`locationCode: "IN"`), capture the real `ac`, `qrCodeUrl` and one full webhook body plus headers, install the profile
on a team phone, and run `/esim/cancel` if it is unused. MegaeSIM: if no API docs by 12:00, it stays a stub (A-28).

**14:00 · Integrations · the minimal pre-deploy, exactly one round-trip per partner (DECISION §7.2).**

1. Facilitators: pick the primary and the fallback, and record the Hedera fee payer.

   ```sh
   curl -s https://x402.org/facilitator/supported | tee /tmp/x402org-supported.json | jq '.kinds[] | {network, extra}'
   curl -s https://api.testnet.blocky402.com/supported | jq '.kinds[] | {network, extra}'
   # set X402_HEDERA_FEE_PAYER to the chosen facilitator's hedera:testnet extra.feePayer
   ```

2. Base Sepolia USDC domain (A-21):

   ```sh
   cast call 0x036CbD53842c5426634e7929541eC2318f3dCF7e "name()(string)" --rpc-url $BASE_SEPOLIA_RPC_URL     # "USDC"
   cast call 0x036CbD53842c5426634e7929541eC2318f3dCF7e "version()(string)" --rpc-url $BASE_SEPOLIA_RPC_URL  # "2"
   ```

3. `DataDrop` on Hedera EVM 296, using `deploy/chains.json` (296 → slug `hedera_testnet`, USDC facade
   `0x…068cDa` = HTS `0.0.429274`):

   ```sh
   cd packages/contracts
   export HEDERA_TESTNET_RPC_URL=https://testnet.hashio.io/api
   export PAYOUT_ADDRESS=<payout EVM address> ATTESTOR_ADDRESS=$(cast wallet address --account attestor) OWNER_ADDRESS=<cold owner>
   CHAIN=296 forge script script/Deploy.s.sol:Deploy --rpc-url hedera_testnet --broadcast --account deployer
   #   token mode: associateHts(usdc) runs in the same broadcast, then transferOwnership(OWNER_ADDRESS)
   #   if the HTS ERC-20 facade misbehaves: LEDGER_ONLY=true … (THREAT-MODEL §6.1 rule 5; say so in DISCLOSURE.md)
   CHAIN=296 pnpm deploy:txs                                              # fills txs in deploy/addresses.hedera_testnet.json
   DD=$(jq -r .dataDrop deploy/addresses.hedera_testnet.json)
   cast send $DD "acceptOwnership()" --account owner --rpc-url hedera_testnet   # the cold owner (RT-C-05)
   CHAIN=296 RPC_URL=$HEDERA_TESTNET_RPC_URL pnpm deploy:txs              # refresh owner/pendingOwner from the chain
   git add deploy/addresses.hedera_testnet.json                           # committed for live chains
   ```

   The same pattern works for any other chain in `deploy/chains.json`
   (`CHAIN=<id> forge script … --rpc-url <slug> --broadcast --account deployer`, then `CHAIN=<id> pnpm deploy:txs`).
   Base Sepolia is `CHAIN=84532 … --rpc-url base_sepolia`.

4. The hello campaign and one claim on 296 (a `Claimed` with `paid == 500000` on HashScan):

   ```sh
   USDC=0x0000000000000000000000000000000000068cDa
   SPONSOR=$(cast wallet address --account sponsor)
   ID=$(cast call $DD "scopedCampaignId(address,uint64)(bytes32)" $SPONSOR 1 --rpc-url hedera_testnet)
   cast send $USDC "approve(address,uint256)" $DD 10000000 --account sponsor --rpc-url hedera_testnet
   cast send $DD "createCampaign(bytes32,uint128,uint96,uint32,uint64)" $ID 10000000 500000 100 $(( $(date +%s) + 14*86400 )) \
     --account sponsor --rpc-url hedera_testnet
   cast send $DD "claim(bytes32,bytes32)" $ID $(cast keccak "hello-claim-$(date +%s)") --account attestor --rpc-url hedera_testnet
   ```

5. The API in `MODE=live` on the VPS (the `.env` above), then one x402 402 → pay → 200 on Hedera through the remote
   facilitator, paid from a team Hedera account. Confirm the payload `{ transaction }` and whether `PAYMENT-RESPONSE`
   carries `transaction` or `transactionId`. Then one Arkiv entity written and read on rabdi (the entitlement of that
   purchase), with its explorer URL. Then one IDKit 4 verification: `/world/rp-context` → World App →
   `POST /api/v4/verify/{rp_id}`.

6. Write every hash and key into `docs/DISCLOSURE.md` §2 and the latencies into `docs/ARKIV_FEEDBACK.md` §4
   (`curl -s https://<vps>/metrics.json | jq .ledger_ms`). Put the HCS-14 vector into `fixtures/hcs/`. Run `pnpm test`
   so that every recorded fixture (`"source": "live"`) passes. When a recording contradicts API-FACTS, the recording
   wins, the adapter gets fixed, and a finding is filed.

**The fixtures to record (the 12 rows of `packages/adapters/README.md` "Record on Wednesday").** The recorder
`scripts/record-fixture.ts` (ops-demo §1) is **not written yet**. Until it lands, record with the commands below and
redact by hand: `Authorization`, `RT-AccessCode`, `RT-Signature`, `rp_context.signature`, the Arkiv access-key path
segment, and every `LPA:` string (→ `LPA:1$redacted$…`). Every recorded file gets `"source": "live"` and
`"recordedAt"`.

| # | Fixture(s) | How |
|---|---|---|
| 1 | `fixtures/facilitator/x402org/*.json` | `curl https://x402.org/facilitator/supported`; one Base Sepolia payment through `RemoteFacilitator` |
| 2 | `fixtures/facilitator/hedera/*.json` | the one `hedera:testnet` payment (step 5); mirror `GET /api/v1/transactions/{id}` |
| 3 | `fixtures/world/verify-*.json`, `world/contract-suite.json` | the real IDKit 4 proof for `WORLD_RP_ID` (step 5) |
| 4 | `fixtures/reseller/esimaccess/{plans,order,query*,order-duplicate,topup,errors,balance,cancel,contract-suite}.json` | the console account; one real order + top-up (+ `/esim/cancel`) |
| 5 | `fixtures/reseller/esimaccess/webhook-*.json` | `/webhook/save` to a capture URL with `?token=` |
| 6 | `fixtures/arkiv/{create,get,query,update,expired}.json` | `ARKIV_ACCESS_KEY` + tGLM; one entity's create/get/select/update, and one observed expiring |
| 7 | `fixtures/hcs/{mirror-messages,submit-receipt}.json` | one receipt to `HCS_TOPIC_ID`; `curl $HEDERA_MIRROR_URL/api/v1/topics/$HCS_TOPIC_ID/messages` |
| 8 | `fixtures/hcs/hcs14-vector.json` | register the agent UAID (`services/agent`, `AGENT_HEDERA_ACCOUNT_ID`) |
| 9 | `fixtures/ens/*.json` | `ENS_RPC_URL`; `eth_call` exchanges for a demo name |
| 10 | `fixtures/swarm/*.json` | `SWARM_BEE_URL`, `SWARM_POSTAGE_BATCH`; one upload and download |
| 11 | `fixtures/eip3009/domains.json` | the `cast call … name()/version()` of step 2, per chain |
| 12 | `fixtures/reseller/megaesim/order.json` | only if the vendor supplies docs on-site |

The known unknowns of API-FACTS ("Known unknowns to verify on-site Wed 4 Nov", 11 items + 2 additions) are the
acceptance list for this block. Tick each one in the PR that lands the recordings. That includes the transient-storage
check: does Hedera's EVM accept `ReentrancyGuardTransient`? If not, swap to the storage guard.

**16:00 · Founder · the team-funded free pre-arrival campaign goes live** (Telegram post, poster PDF, zero price).

**18:00 · GATE (Integrations + Founder).** Attach test (a) and legal memo (b) → stay on Recharge or switch to Dhwani
(DECISION §1). Record the verdict in `CHANGELOG.md` under `[Unreleased]`.

**19:00 · Design · copy review; scratch-card artwork to the printer for a proof** (spot colour matched to `#117878`):

```sh
pnpm print:cards -- --count 10          # proof: 11-page PDF (10 coupons + 1 keyline) in out/, fake PINs, real QR codes
pdfinfo out/cards-*-proof.pdf | grep Pages
```

**Evening.** The Founder confirms Thursday's meetings. Integrations rehearses the Thursday-night handshake on the
pre-deployed rails.

## Thu 5 Nov

**09:00 · Design · print 200 scratch cards** (Dhanteras closes printers Friday). The live cards are campaign-funded
from the sponsor's own wallet. Create them on the VPS with the sponsor's funded campaign; the local `X-Seed-Card-Campaign`
hook does not exist in live. Then:

```sh
pnpm print:cards -- --input /secure/cards.json      # needs apps/web /print/cards; asserts N + 1 pages; manifest has no PINs
shred -u /secure/cards.json out/cards-*.pdf         # after the printer has the file
```

**10:00–17:00 · Founder · ≥ 5 sponsor meetings:** the drop and the free testnet pilot (E1 at 18:00).

**12:00 · (only if switched) the Dhwani hardware gate.**

**14:00 · Integrations · dry run of the full loop on the VPS in `MODE=live`, pipes only:**

```sh
API_URL=https://<vps> RPC_URL=$HEDERA_TESTNET_RPC_URL services/api/node_modules/.bin/tsx services/api/scripts/e2e-flow.ts
# live counterpart of BUILD-PLAN §4 minus the seed hooks: expect the seed-hook steps to be refused, everything else green
```

**18:00 · Founder · E1 verdict → the README "Revenue" wording.**

**20:59 · Founder · tag and snapshot:**

```sh
bash scripts/prekickoff-inventory.sh HEAD --tests     # paste into docs/DISCLOSURE.md §1 (clean checkout)
git add docs/DISCLOSURE.md docs/CHANGELOG.md && git commit -m "Pre-kickoff snapshot"
git tag -s v0-prekickoff -m "Recharge pre-kickoff (Continuity base)" && git push origin v0-prekickoff
```

**21:00 · kickoff.** Ask the check-in questions of DECISION §7.4 to ETHGlobal staff and to Hedera, World and Arkiv
devrel (`DISCLOSURE.md` §5), and write the answers into the README by Fri 06:00. Generate the **in-window keys
on-site** for the attestor, relayer and treasury (and Arkiv, and the World RP if rotated). Then rotate:

```sh
cast send $DD "setAttestor(address)" $(cast wallet address --account attestor2) --account owner --rpc-url hedera_testnet
```

Retire the old keys. **Handshake sprint 21:00–02:00:** each rail gets one in-window round-trip (production campaign,
claim, provision, Arkiv entity, Hedera settlement by a human). Add a `CHANGELOG.md` line for each.

## Fri 6 Nov (Dhanteras)

**06:00 · Sponsor lead · the swap gate per sponsor** (`DEMO-SCRIPT.md`, "Fri 6 Nov 06:00 IST swap gates"):

| Sponsor | Check | Command / evidence |
|---|---|---|
| Hedera | an in-window 402 → pay → 200 on Hedera testnet **and** an in-window `Claimed` | HashScan links timestamped after Thu 21:00; `curl $HEDERA_MIRROR_URL/api/v1/contracts/$DD/results/logs?order=desc&limit=5` |
| World | an in-window cloud verification from a **non-team** device | the API log `event: decision` (`serve-free`) for that claim after 21:00 (nullifier hashed) |
| Arkiv | an in-window write + attribute query on rabdi **and** one entity observed expiring | explorer link; `curl -s -o /dev/null -w '%{http_code}' https://<vps>/me/<short-lived key>` = 410 after `expiresAt` |

A failed gate takes the fallback listed in `DEMO-SCRIPT.md`, and the partner slot swap is decided now and confirmed
Sat 18:00.

**06:00–14:00** credential tiering live, Arkiv entitlements and the three reads live, agent live on Hedera:

```sh
cd services/agent && MODE=live AGENT_HEDERA_ACCOUNT_ID=… AGENT_HEDERA_PRIVATE_KEY=… AGENT_LEDGER_WRITER=<API Arkiv writer> \
  AGENT_PAYTO_ALLOWLIST='hedera:testnet|0.0.429274|<payout 0.0.x>|<feePayer>' pnpm start -- --once --dry-run   # then without --dry-run
```

**14:00–20:00** gift/ENS live (`rahul.eth` on the live resolver), the sponsor dashboard, webhooks. **The Security owner
runs the key-compromise drill** (T-01, under 5 minutes): `pause(id, true)` from the attestor, `setAttestor(new)` from the
owner, unpause from the sponsor. Write down the timings.

**20:00** the first full live loop on three devices. Design pass starts. The Producer drafts the per-sponsor README
sections. Film B-roll (airport/hall "No Service → LTE", scratch, agent notification). Nothing is sold to anyone.

## Sat 7 Nov

- **09:00** scope freeze (AgentKit discount mode, Reloadly only if ahead).
- **09:00–13:00** three-device rehearsal with every cutover rule of `DEMO-SCRIPT.md` triggered once.
- **13:00–18:00** design pass complete (dark/light, Hindi), scratch-card redeem flow, print QA.
- **18:00 · Founder · partner selection locked in the Hacker Dashboard:** three programs (default Hedera, World, Arkiv;
  ENS replaces any that failed its gate). Write the selection and the reason into `CHANGELOG.md`.
- **18:00–23:00** video ≤ 3:00 (the three hooks, DECISION §8.6; renders in `marketing/videos/renders`), the X post,
  README/CHANGELOG/DISCLOSURE, `pnpm schema:check`, `ARKIV_FEEDBACK.md` (with Wednesday's numbers), `SWARM.md` (the live
  entity key ↔ Swarm reference pair).
- **23:00** pitch dry run ×2 (4:00 + the Q&A card).

## Sun 8 Nov (Diwali)

- **06:00** README freeze. Run `pnpm audit` on a clean checkout, then generate the "pre-kickoff vs in-window" table at
  the end of `CHANGELOG.md`.
- **06:30** final rehearsal on venue Wi-Fi and on cellular.
- **07:30 · Founder · the submission form:**

| Field | Value |
|---|---|
| Project name | Recharge |
| One sentence | the README's first line, verbatim |
| Track | Continuity, with a link to `docs/DISCLOSURE.md` |
| Partner programs (3) | as locked Sat 18:00 |
| Per partner: how it is used + code links | the README's per-sponsor section anchors |
| Repository | the repo URL at the submission commit |
| Live URL | `https://<vps>` (`MODE=live`) |
| Video | the ≤ 3:00 cut (YouTube/Loom link) |
| Team members and roles | the five roles, the teammate who plays the sponsor named as such |
| AI use | the README "AI use" paragraph |

- **08:00 submit**, with one hour of buffer before 09:00.
- **Judging prep:** pre-installed phone charged, three scratch cards per judge, HashScan and Arkiv explorer tabs
  pinned, the teammate who plays the sponsor named as such.
