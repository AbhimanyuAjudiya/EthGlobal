# Prize qualification checklist

## Current booth guidance — 6 November 2026

Recommended three partner selections: **World, Hedera, Arkiv**, subject to accepted Continuity status and each category's required evidence. The detailed historical checks below are timestamped evidence, not a fresh statement of deployment or qualification.

| Partner | Best-fit category | Remaining qualification boundary |
|---|---|---|
| World | [Cont] Best Use of IDKit — $2,500 pool | Show server-validated success and an alternative path, credential rationale and feedback. Agent Pass is a separate $2,500 Continuity category; client registration remains blocked. |
| Hedera | Built on Hedera (Continuity) — $1,500 pool | Show substantial in-window functionality, not only polish. Ask whether this entry can also compete in AI Agents That Pay (x402); that category requires an autonomous paid request, transaction evidence, public source and a video. |
| Arkiv | Build on Arkiv (existing projects) — $4,000 pool | New Mumbai work must write and expose a user-visible read. Provide the required schema, friction, reach, why-Arkiv and usage documents, writer address and query. Swarm bonus is $500 with a functioning integration. |
| ENS | Best Integration of ENSv2 into an Existing Project — $3,000 pool | Published rules require Ethereum mainnet. The existing Sepolia integration does not satisfy this category. |

Sources: [World](https://ethglobal.com/events/mumbai/prizes/world), [Hedera](https://ethglobal.com/events/mumbai/prizes/hedera), [Arkiv](https://ethglobal.com/events/mumbai/prizes/arkiv), [ENS](https://ethglobal.com/events/mumbai/prizes/ens), [submission rules](https://ethglobal.com/events/mumbai/info/details). Three partners maximum; several categories under one partner count as one selection. Deadline: 7 November 2026, 09:00 IST. eSIMAccess is the connectivity provider, not a prize qualification by itself.

The new ticket-gated event journey and eligible post-event cancellation work must be described as implementation in progress until deployed and demonstrated. Do not claim an official event ticketing integration: this release uses organizer-issued passes from confirmed ticket references.

## Earlier evidence checkpoint — 2026-11-06 ~05:10 IST

Live checks run from this machine: `GET api.recharge.ajudiya.com/healthz` → `{"ok":true,"mode":"live","chainId":296,"degraded":false}`;
`POST /gift {"name":"re-charge.eth","mb":100}` → **402** with `PAYMENT-REQUIRED` (`hedera:testnet`, asset `0.0.429274`,
400000, payTo `0.0.11322453`, feePayer `0.0.9185802`); mirror node confirms tx `0.0.9185802@1793882124.642565779` SUCCESS
(0.40 USDC `0.0.11320978` → `0.0.11322453`, consensus 2026-11-05 12:35 UTC = **18:05 IST, before kickoff**); HCS topic
`0.0.11322448` holds 4 messages (claim, 2× gift, 1 untyped), **no `agent-topup`**; `api.github.com/repos/AbhimanyuAjudiya/EthGlobal` → **404 (repo private)**.

## 1. Hedera — AI Agents That Pay: x402 on Hedera ($6,500)

| Requirement | Evidence | Status | Smallest fix |
|---|---|---|---|
| ≥1 x402 endpoint settling on Hedera via listed/self-run facilitator | `services/api/src/accepts.ts:111-112`, `middleware/x402.ts:65,87`; live 402 on `POST /gift` (above); facilitator x402.org (`DISCLOSURE.md:151`); settled tx [`0.0.9185802@1793882124.642565779`](https://hashscan.io/testnet/transaction/0.0.9185802@1793882124.642565779) | ✅ | — |
| Agent finds endpoint, completes ≥1 paid request, no human | Agent loop + Agent Kit payer `services/agent/src/payers/hedera.ts:14`, `tick.ts`; API URL from `AGENT_API_URL` (`config.ts:45`). The settled tx was a `POST /gift` paid from the agent's wallet, but the agent service has no gift path, so it was not the autonomous loop; no live `agent-topup` on HCS; **live in-window run Fri 6 Nov 06:14 IST:** settlement `0.0.9185802@1793925870.465901542`, HCS seq 7 (settle) + seq 8 (`agent-topup`, UAID) on `0.0.11322448` | ✅ | — |
| Public GitHub repo | GitHub API 404 | ❌ | Make `AbhimanyuAjudiya/EthGlobal` public (check no secrets first: `.env*` are git-ignored) |
| README: setup, architecture, payment flow, ≥1 Hedera tx id | Setup `README.md:48-87`, architecture `:30-46`; 5-step Hedera payment flow (setup → 402 → pay → settle → HCS receipt) `README.md:103-113`; artefact table `:115-126` with DataDrop, USDC, facilitator, settled tx `0.0.9185802@1793882124.642565779` (labelled pre-kickoff), HCS topic (receipt seq 3), UAID | ✅ (2026-11-06) | Fill the "Autonomous agent top-up (in-window)" row `:125` after the agent run |
| Demo video ≤5 min, payment settling, HashScan link | `README.md:11` "Video: TBD" | ❌ | Record; show 402 → pay → HashScan tx page |
| Extra: spending controls | daily cap `packages/octroi/src/topup.ts:11` (`maxUsd6PerDay`), payTo/asset/feePayer allow-list `services/agent/src/config.ts:78-124`, human checkpoint (Agent Pass, `routes/claim.ts:146-148`) | ✅ | (HITL is per-policy, not "above an amount"; say so) |
| Extra: agent identity HCS-14 / ERC-8004 | UAID `services/agent/src/identity.ts`, `packages/adapters/src/live/hcs14.ts`; value `DISCLOSURE.md:157` — self-issued, **not registered** | ⚠️ | Say "self-issued UAID" on screen, or register it if time |
| Extra: HCS topic as audit log of agent spend | `services/agent/src/receipts.ts:38` (`t: agent-topup`); topic [`0.0.11322448`](https://hashscan.io/testnet/topic/0.0.11322448) has no agent-topup yet; **live in-window run Fri 6 Nov 06:14 IST:** settlement `0.0.9185802@1793925870.465901542`, HCS seq 7 (settle) + seq 8 (`agent-topup`, UAID) on `0.0.11322448` | ✅ | — |
| Extra: multi-agent negotiation (A2A/ACP) | none | ❌ | Skip |
| Extra: settle in HTS USDC | `0.0.429274` in live 402 and in the mirror record | ✅ | — |
| Extra: Scheduled Transactions | none | ❌ | Skip |
| Extra: Hedera Agent Kit / MCP | `@hashgraph/hedera-agent-kit@4.2.0`, `AgentMode.AUTONOMOUS` (`payers/hedera.ts:8-20`) | ✅ | — |
| Continuity eligibility for this track | Devrel question unanswered (`DISCLOSURE.md:206`); settlement tx is pre-kickoff | ⚠️ | Ask Hedera booth; an in-window settlement (row 2) removes the doubt |

## 2. World — IDKit and Agent Pass

**Update, 6 Nov:** the [official World prize page](https://ethglobal.com/events/mumbai/prizes/world)
lists separate IDKit and Agent Pass prizes, each with a Continuity category. Recharge's IDKit claim
flow does not depend on Agent Pass portal access. For an accepted Continuity entry, the relevant
IDKit category is **[Cont] Best Use of IDKit ($2,500; up to two $1,250 awards)**.

IDKit protects a scarce sponsor-funded data allocation: the backend verifies the credential and
binds it to the claim challenge before checking campaign eligibility and duplicate claims.
`apps/web/components/VerifySheet.tsx` uses `@worldcoin/idkit-core`, a backend-signed RP context,
and the document-legacy preset. `packages/adapters/src/live/world-personhood.ts` submits the
original result to `/api/v4/verify/{rp_id}` and checks action, environment and signal binding.
The campaign's accepted credential tier determines whether that person qualifies.

Submission evidence still needed: a recorded successful verification plus a cancellation,
unavailable credential or rejection path; explain why the chosen credential is sufficient;
include integration feedback. Existing automated tests are not a recording of live verification.

### Agent Pass: external registration blocker

The Continuity Agent Pass pool is **$2,500**; the separate from-scratch pool is **$5,000**.

| Requirement | Evidence | Status | Smallest fix |
|---|---|---|---|
| Official Agent Pass (auth.world.org) | Device grant against auth.world.org discovery (`docs/WORLD_AGENT_PASS.md` §2, `fixtures/world/agent-pass-discovery.json`); `services/api/src/world-agent-pass.ts:735-744`. Live: **off** (`WORLD_AGENT_PASS_CLIENT_ID` unset, §1:30); never run against a real IdP | ⚠️ | Register a client (below) and set 3 env vars on the VPS |
| Full journey request → completion → validated → protected action | `WORLD_AGENT_PASS.md` §3; `403 pass_required` before any 402 `routes/claim.ts:148`; agent `services/agent/src/pass.ts:19-36`; PWA `apps/web/components/AgentSheet.tsx`; e2e I-21 against labelled `LocalIdp` simulator only | ⚠️ | Same; until then demo `MODE=local` + `simulated` and label it |
| Denied / expired / cancelled path, no action | §3 "Unsuccessful paths"; e2e I-21 deny → 403, expire → 403; tests `services/api/test/agent-pass.test.ts` | ✅ (sim) | — |
| Secure backend validation | RS256 only `world-agent-pass.ts:293`, `auth_time` `:310`, replay `:485`, atomic arm `:492`; secrets server-side (§4 table) | ✅ | — |
| Integration debrief | `WORLD_AGENT_PASS.md` §7 items 11 (time to first success: ~50 min to the simulator run, no real-IdP success: `invalid_login`, `account_not_eligible`) and 12 (one improvement: self-serve sandbox client registration) | ✅ (2026-11-06) | — |

**Portal status, 6 Nov:** both production and sandbox returned `account_not_eligible`, as reported
by the founder. The supplied Discord exchange contains no confirmation of access being granted.
A read-only server check also confirms that the Agent Pass client id and secret are absent.
The prize page's mocked-proof note does not establish that client registration is optional, nor
that Recharge's local simulator qualifies as the official integration. Keep the local simulator
labelled and do not treat mock identities as production approval.

**To turn it on:** obtain a registered client from World (`client_secret_post` with the portal's
required HTTPS redirect URI), then on the VPS set
`WORLD_AGENT_PASS_ISSUER=https://sandbox.auth.world.org` (if sandbox), `WORLD_AGENT_PASS_CLIENT_ID`,
`WORLD_AGENT_PASS_CLIENT_SECRET`, restart the API (§6 step 4). No code change; live refuses only `simulated` and non-https issuers.

## 3. ENS — Best Use of ENSv2 ($7,000)

| Requirement | Evidence | Status | Smallest fix |
|---|---|---|---|
| Built on ENSv2 (mainnet or Sepolia) | **Live on Sepolia (ENSv2):** `re-charge.eth` registered through the v2 ETHRegistrar ([tx](https://sepolia.etherscan.io/tx/0xc12c8337b7d73a983a0de15003a4d7d5a524194fb7de151b217afcd56e6f1199)); our own `UserRegistry` proxy is its subregistry (`0x2973…EA41`); `spike.re-charge.eth` resolves with plain viem `getEnsText` through UniversalResolverV2 (`ens/SPIKE.md`, `ens/README.md`) | ✅ | — |
| ENSv2 features central | One ENSv2 name per sponsor campaign (`packages/adapters/src/live/ens-campaigns.ts`, `services/api/src/flows/ens.ts`): own subname registry, a `PermissionedResolver` per campaign via `VerifiableFactory`, expiring non-transferable names (role bitmap 0), per-key EAC for the sponsor (`grantSetterRoles` avatar/description/com.twitter; on-chain proof: avatar [ok](https://sepolia.etherscan.io/tx/0x062818ef47d3a7167752a82403b7423776475dd3c08d7d49e0c7705a425341df), url [reverts](https://sepolia.etherscan.io/tx/0xa60e08af0032cae8c99032c3d0069c317e4cba3bab00b43ab55683b7b71cbb5a)); claim by name at `/c/<slug>` and sponsor-signed branding (`apps/web/components/CampaignByName.tsx`, `EnsCampaign.tsx`). In code with tests; **pending deploy** (`ENS_ENABLED=true` on the API) and the first real campaign name | ⚠️ | Deploy with the ENS env, register one real campaign, paste its name and txs into `ens/README.md` |
| Functional, no hard-coded values | Names come from each campaign (slug = kebab-case of its name, unique on the UserRegistry); records written per campaign; `/c/<slug>` trusts a name only if `recharge.pool` is our DataDrop and it has not expired. Gift-to-name resolution unchanged (`routes/gift.ts`, `flows/gift.ts`) | ✅ | — |
| Live demo + open source | app live; ENS section ships with the next deploy; repo private | ❌ | Make repo public; deploy |

**Honest verdict (2026-11-06):** ENSv2 is now load-bearing for sponsors: each campaign's name is how travellers reach
it (`/c/<slug>`) and the sponsor's branding lives in the name, guarded by ENSv2 EAC. Live on Sepolia today: `re-charge.eth`,
its UserRegistry and `spike.re-charge.eth` (same call sequence as the API). Not yet live: the API job and the two web
screens, until deployed with `ENS_ENABLED=true`. **Correction from the current Mumbai prize page:** ENSv2 is now live
on mainnet, and the existing-project category requires mainnet. Sepolia alone does not qualify for that category.
Still costs one of three partner picks.

## 4. Arkiv (from https://ethglobal.com/events/mumbai/prizes, fetched 2026-11-06)

Six prizes; one Arkiv track prize per team. Fit: **Build on Arkiv (Existing Projects) $4k** (Continuity-only) + **Arkiv +
Swarm Bonus (Existing) $500**. "From Scratch" tracks require building from scratch at Mumbai — Recharge does not qualify.

| Requirement (Existing Projects) | Evidence | Status | Smallest fix |
|---|---|---|---|
| In ETHGlobal's Continuity batch | `DISCLOSURE.md:1-21` declares it; staff answer TBD `DISCLOSURE.md:205` | ⚠️ | Confirm with ETHGlobal staff |
| Arkiv work new from Mumbai; README separates pre vs added (only added judged) | `arkiv/before-after.md`: Arkiv code diff `v0-prekickoff..HEAD` is **empty**; all 13 live entities pre-kickoff; in-window = live API on AWS + the `arkiv/` docs | ⚠️ | Honest but thin: needs in-window Arkiv work (and the first in-window entity) to be judged on |
| Writes to current testnet; user-visible feature reads it | rabdi 7794095 writes (`DISCLOSURE.md:148`); reads R1 `/me/:key`, R3 gift claim (`ARKIV_FEEDBACK.md` §2). "Current testnet" = rabdi not verified | ⚠️ | Confirm rabdi is current with Arkiv booth |
| README lists writer wallet + one runnable query | Writer + link `README.md:163`; paste-able live `arkiv_query` (`AND`; the node now rejects `&&`) in `arkiv/README.md`, checked 2026-11-06 | ✅ (2026-11-06) | — |
| `/arkiv/schema.md`, `/arkiv/friction.md`, one file per criterion (reach, why-arkiv, how-you-use-arkiv) | `arkiv/README.md` (what/how), `arkiv/schema.md` (incl. RT-A-15 u64 note), `arkiv/friction.md` (latencies, RT-A-15/17, one improvement), `arkiv/before-after.md`; no `reach.md`, `why-arkiv.md` | ⚠️ | Add reach.md / why-arkiv.md if the track asks for them by name |
| Public repo, open-source license, AI-use disclosure | `LICENSE` (MIT, 2026 Abhimanyu Ajudiya), README `## License`; repo still private; AI use `README.md` "AI use" | ⚠️ | Make public |
| Swarm bonus: `/arkiv/swarm.md` (what/where, ref field, sample key+ref, postage batch, code, repro, demo timestamp, pre-event state) | `arkiv/swarm.md` (pointer to `docs/SWARM.md`; states no live key↔ref pair exists: the one live entitlement is `pending-profile`) | ⚠️ | Needs a real eSIM order → sealed LPA on Swarm → `sealedRef` |

## 5. ETHGlobal general — standard (non-Continuity) track vs Continuity

Sources fetched 2026-11-06 (paraphrased, not verbatim): `/events/mumbai/info/details`, `/events/mumbai/info/start`,
`/rules`, `/events/mumbai/prizes`. `/events/mumbai/faq` is a 404; the Continuity announcement on x.com
(status 2056399209767866682) returned 402 — **unverified, ask the ETHGlobal desk** for anything it would add.

| Rule (source) | Recharge status + evidence | | Action still needed |
|---|---|---|---|
| **Standard track:** all project work must start after official kickoff; no prior project-specific code, designs or assets; only public libraries/starter kits exempt (`info/details`, `info/start`, `/rules`) | Repo created 3 Nov; pre-kickoff code, contracts, deploys and txs (`DISCLOSURE.md` §1-2, `CHANGELOG.md:84-107`); tag `v0-prekickoff` → `380ff32` | ❌ | Recharge cannot qualify as a from-scratch project |
| **Standard track consequence:** pre-event projects may still enter but are **not eligible for partner prizes or the Finalist category** (`info/details`, `/rules`) | Same — so on the standard track Hedera, World, ENS and Arkiv prizes are all out | ❌ | Get onto an approved Continuity track, or accept no partner/finalist prizes |
| **Continuity tracks** ("Extend Open Source" / "Ship a Feature"): build on an existing codebase (open-source, or a private/commercial product); must document pre-existing work and add substantial new in-window features; new parts must stay open source (`info/start`, `/rules`) | Declared Continuity (`README.md:10,211-215`, `DISCLOSURE.md:1-21`); staff confirmation TBD (`DISCLOSURE.md:205`); in-window per-sponsor diff TBD (`CHANGELOG.md:138-143`); repo private | ⚠️ | Ask the desk "are we accepted into a Continuity track, which one?"; fill the diff table; make the repo public |
| Continuity purpose / how to join | Not stated on reachable pages (X post unreachable) | ⚠️ | unverified — ask the ETHGlobal desk |
| Partner-prize eligibility for Continuity varies by event and partner (`info/details`, `/rules`) | Arkiv publishes Existing Projects prizes; World explicitly lists Continuity prizes for both IDKit and Agent Pass. See the current partner pages for the other categories. | ⚠️ | Confirm the entry's Continuity status and each selected category's requirements |
| Disclose pre-existing work to ETHGlobal **in writing** and in the submission (repo history, video, description); undisclosed prior work or misrepresentation → DQ, prize revocation, ban (`/rules`) | Written disclosure in repo `DISCLOSURE.md`; tag time stated honestly in both `DISCLOSURE.md:40` and `README.md:229` (commit `380ff32` 20:20:57 IST, tag object 21:16 IST) | ⚠️ | Send `DISCLOSURE.md` to ETHGlobal staff in writing; paste its summary block in the submission description |
| Version control throughout; single big-commit repos presumed ineligible (`/rules`) | Full dated history, per-step commits (`git log`) | ✅ | — |
| Separate new vs reused work; proof of hackathon work (repo/Figma) (`info/details`) | `DISCLOSURE.md`, `CHANGELOG.md` in-window section mostly TBD (`:113-125`) | ⚠️ | Fill in-window CHANGELOG lines + diff table |
| AI use documented per file/asset (`info/details`; `/rules` silent) | `README.md:217-221` (general, not per file) | ⚠️ | Add a short per-area list (which dirs AI wrote) |
| **Deadline: Sat 7 Nov 2026, 09:00 IST, no late submissions** (`info/details`, `info/start`) | Re-planned: video Fri 21:00–23:30, partner lock Fri 18:00, submit Sat 08:00 (`README.md:11-12`, `docs/CHANGELOG.md`, `docs/ONSITE-RUNBOOK.md` "Fri 6 Nov evening → Sat 7 Nov 09:00") | ✅ plan (2026-11-06) | Do it; `marketing/videos/SCRIPTS.md` and `DEMO-SCRIPT.md` still carry Sat/Sun times |
| Required fields: title, description, repository link (`info/details`); project page / live-demo field not stated | Live app https://app.recharge.ajudiya.com (200), API healthz ok; repo private | ⚠️ | Make repo public; put live URL in description |
| Demo video optional but encouraged: **2-4 min**, ≥720p, not shot on a phone (`info/details`) | `README.md:11` TBD; Hedera requires a video (≤5 min) | ❌ | Record one 2-4 min screen capture that also satisfies Hedera (HashScan on screen) |
| Partner prizes: pick on last form step, **max 3**; several tracks of one partner = 1 (`info/details`); Swarm bonus doesn't use a pick (`/prizes`) | README claims Hedera, World, Arkiv (`README.md:10-11`); ENS would be a 4th | ⚠️ | Choose 3; for each write how you used the tool + feedback in the form |
| Team size: up to 5, each accepted and staked individually; solo OK (`info/start`) | Not recorded in repo | ⚠️ | Confirm every member is accepted + staked on the dashboard |
| Judging: Technicality, Originality, Practicality, Usability, WOW; finalists present 7 min (4 demo + 3 Q&A); partners judge from submitted materials, booth optional (`info/details`) | Finalist category closed to pre-existing projects unless Continuity rules allow | ⚠️ | Ask the desk whether Continuity entries may opt into Finalist |

## Founder to-do before submission (ranked by prize money at risk)

1. **Deadline is Sat 7 Nov 09:00 IST**, not Sun — the repo plan now has video Fri night, submit Sat 08:00; keep to it (everything, $22.5k).
2. Confirm in writing with the ETHGlobal desk that Recharge is on an approved Continuity track; on the standard track it gets **no** partner prizes (everything).
3. Make the repo public (`LICENSE` added 2026-11-06) — blocks Hedera, ENS, Arkiv and the Continuity "stay open source" rule.
4. Pick 3 partners: Hedera, World, Arkiv, ENS is four; ENS now has the ENSv2 subname registry built (Sepolia; pending deploy with `ENS_ENABLED=true`, see `ens/README.md`).
5. Run `recharge-agent --once` on live (Hedera) → in-window settlement + `agent-topup` HCS message; paste ids in README `:105-110` ($6.5k).
6. Record one 2-4 min video with a HashScan tab (Hedera hard requirement, $6.5k).
7. Ask Hedera, World (and ENS) booths whether Continuity entries are eligible (`DISCLOSURE.md:206-209`).
8. Prepare IDKit success/alternative-path evidence and feedback for the World Continuity category. Agent Pass remains a separate optional submission until World grants a client and the official flow can be demonstrated; do not represent the local simulator as live integration.
9. Create `arkiv/` (schema, friction, reach, why-arkiv, how-you-use-arkiv, swarm); README Arkiv: writer address, one runnable query, pre-vs-in-window diff ($4.5k).
10. ~~Fix `README.md:213` tag time; set `openapi.json` `servers` to the live API URL~~ done 2026-11-06 (`servers` = `https://api.recharge.ajudiya.com` in `MODE=live`, `services/api/src/app.ts`; live after the next redeploy).
