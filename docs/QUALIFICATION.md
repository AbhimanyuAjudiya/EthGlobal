# Prize qualification checklist (checked 2026-11-06 ~05:10 IST)

Live checks run from this machine: `GET api.recharge.ajudiya.com/healthz` → `{"ok":true,"mode":"live","chainId":296,"degraded":false}`;
`POST /gift {"name":"re-charge.eth","mb":100}` → **402** with `PAYMENT-REQUIRED` (`hedera:testnet`, asset `0.0.429274`,
400000, payTo `0.0.11322453`, feePayer `0.0.9185802`); mirror node confirms tx `0.0.9185802@1793882124.642565779` SUCCESS
(0.40 USDC `0.0.11320978` → `0.0.11322453`, consensus 2026-11-05 12:35 UTC = **18:05 IST, before kickoff**); HCS topic
`0.0.11322448` holds 4 messages (claim, 2× gift, 1 untyped), **no `agent-topup`**; `api.github.com/repos/AbhimanyuAjudiya/EthGlobal` → **404 (repo private)**.

## 1. Hedera — AI Agents That Pay: x402 on Hedera ($6,500)

| Requirement | Evidence | Status | Smallest fix |
|---|---|---|---|
| ≥1 x402 endpoint settling on Hedera via listed/self-run facilitator | `services/api/src/accepts.ts:111-112`, `middleware/x402.ts:65,87`; live 402 on `POST /gift` (above); facilitator x402.org (`DISCLOSURE.md:151`); settled tx [`0.0.9185802@1793882124.642565779`](https://hashscan.io/testnet/transaction/0.0.9185802@1793882124.642565779) | ✅ | — |
| Agent finds endpoint, completes ≥1 paid request, no human | Agent loop + Agent Kit payer `services/agent/src/payers/hedera.ts:14`, `tick.ts`; API URL from `AGENT_API_URL` (`config.ts:45`). The settled tx was a `POST /gift` paid from the agent's wallet, but the agent service has no gift path, so it was not the autonomous loop; no live `agent-topup` on HCS | ⚠️ | Run `recharge-agent --once` against the live API on a paid plan; paste the Hedera tx id + HCS seq into README |
| Public GitHub repo | GitHub API 404 | ❌ | Make `AbhimanyuAjudiya/EthGlobal` public (check no secrets first: `.env*` are git-ignored) |
| README: setup, architecture, payment flow, ≥1 Hedera tx id | Setup `README.md:48-87`, architecture `:30-46`; 5-step Hedera payment flow (setup → 402 → pay → settle → HCS receipt) `README.md:103-113`; artefact table `:115-126` with DataDrop, USDC, facilitator, settled tx `0.0.9185802@1793882124.642565779` (labelled pre-kickoff), HCS topic (receipt seq 3), UAID | ✅ (2026-11-06) | Fill the "Autonomous agent top-up (in-window)" row `:125` after the agent run |
| Demo video ≤5 min, payment settling, HashScan link | `README.md:11` "Video: TBD" | ❌ | Record; show 402 → pay → HashScan tx page |
| Extra: spending controls | daily cap `packages/octroi/src/topup.ts:11` (`maxUsd6PerDay`), payTo/asset/feePayer allow-list `services/agent/src/config.ts:78-124`, human checkpoint (Agent Pass, `routes/claim.ts:146-148`) | ✅ | (HITL is per-policy, not "above an amount"; say so) |
| Extra: agent identity HCS-14 / ERC-8004 | UAID `services/agent/src/identity.ts`, `packages/adapters/src/live/hcs14.ts`; value `DISCLOSURE.md:157` — self-issued, **not registered** | ⚠️ | Say "self-issued UAID" on screen, or register it if time |
| Extra: HCS topic as audit log of agent spend | `services/agent/src/receipts.ts:38` (`t: agent-topup`); topic [`0.0.11322448`](https://hashscan.io/testnet/topic/0.0.11322448) has no agent-topup yet | ⚠️ | Same agent run as row 2 produces it |
| Extra: multi-agent negotiation (A2A/ACP) | none | ❌ | Skip |
| Extra: settle in HTS USDC | `0.0.429274` in live 402 and in the mirror record | ✅ | — |
| Extra: Scheduled Transactions | none | ❌ | Skip |
| Extra: Hedera Agent Kit / MCP | `@hashgraph/hedera-agent-kit@4.2.0`, `AgentMode.AUTONOMOUS` (`payers/hedera.ts:8-20`) | ✅ | — |
| Continuity eligibility for this track | Devrel question unanswered (`DISCLOSURE.md:206`); settlement tx is pre-kickoff | ⚠️ | Ask Hedera booth; an in-window settlement (row 2) removes the doubt |

## 2. World — World ID Agent Pass ($5,000)

| Requirement | Evidence | Status | Smallest fix |
|---|---|---|---|
| Official Agent Pass (auth.world.org) | Device grant against auth.world.org discovery (`docs/WORLD_AGENT_PASS.md` §2, `fixtures/world/agent-pass-discovery.json`); `services/api/src/world-agent-pass.ts:735-744`. Live: **off** (`WORLD_AGENT_PASS_CLIENT_ID` unset, §1:30); never run against a real IdP | ⚠️ | Register a client (below) and set 3 env vars on the VPS |
| Full journey request → completion → validated → protected action | `WORLD_AGENT_PASS.md` §3; `403 pass_required` before any 402 `routes/claim.ts:148`; agent `services/agent/src/pass.ts:19-36`; PWA `apps/web/components/AgentSheet.tsx`; e2e I-21 against labelled `LocalIdp` simulator only | ⚠️ | Same; until then demo `MODE=local` + `simulated` and label it |
| Denied / expired / cancelled path, no action | §3 "Unsuccessful paths"; e2e I-21 deny → 403, expire → 403; tests `services/api/test/agent-pass.test.ts` | ✅ (sim) | — |
| Secure backend validation | RS256 only `world-agent-pass.ts:293`, `auth_time` `:310`, replay `:485`, atomic arm `:492`; secrets server-side (§4 table) | ✅ | — |
| Integration debrief | `WORLD_AGENT_PASS.md` §7 items 11 (time to first success: ~50 min to the simulator run, no real-IdP success: `invalid_login`, `account_not_eligible`) and 12 (one improvement: self-serve sandbox client registration) | ✅ (2026-11-06) | — |

**What the "mocked proofs" note changes:** the sandbox no longer needs the TestFlight sandbox World App or hour-long
identity issuance (`WORLD_AGENT_PASS.md:51-53`, §7 item 7) — fake identities complete the flow. It does **not** remove
client registration: the API is the confidential OIDC client and needs a portal client id + secret. **To turn it on:**
get a client registered (`client_secret_post`, any https redirect URI) — the founder's sign-in returned
`account_not_eligible`, so try another Google account or ask the World booth — then on the VPS set
`WORLD_AGENT_PASS_ISSUER=https://sandbox.auth.world.org` (if sandbox), `WORLD_AGENT_PASS_CLIENT_ID`,
`WORLD_AGENT_PASS_CLIENT_SECRET`, restart the API (§6 step 4). No code change; live refuses only `simulated` and non-https issuers.

## 3. ENS — Best Use of ENSv2 ($7,000)

| Requirement | Evidence | Status | Smallest fix |
|---|---|---|---|
| Built on ENSv2 (mainnet or Sepolia) | `packages/adapters/src/live/ens-resolver.ts:2-3,50,57`: viem `getEnsAddress`/`getEnsText` via Universal Resolver on mainnet (Sepolia fallback). That is plain resolution, works the same on v1; nothing ENSv2-specific | ❌ | See below |
| ENSv2 features central | None used (no registry, subname registry, EAC, permissioned resolver, aliasing). Gifting by name is central to the app, ENSv2 is not | ❌ | See below |
| Functional, no hard-coded values | Resolves any name before the 402 (`routes/gift.ts`, `flows/gift.ts`); demo target `re-charge.eth` → `0x2Dd7…746C` (founder-registered; url record not verified here) | ✅ | — |
| Live demo + open source | app live; repo private | ❌ | Make repo public |

**Honest verdict:** not ENSv2 today; README already says "ENS integrated but not claimed" (`README.md:11,153`). Smallest
central feature: **own subname registry under `re-charge.eth` on ENSv2 Sepolia** — each gift mints
`<serial>.re-charge.eth` whose owner is the escrow/recipient, so the gift *is* the name. Estimate ~4-6 h (contract call +
API hook + one screen), contingent on ENSv2 Sepolia contracts being usable (ask the ENS booth). Also costs one of three partner picks.

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
| Partner-prize eligibility for Continuity varies by event and partner (`info/details`, `/rules`) | Only Arkiv publishes Continuity prizes (Existing Projects $4k + Swarm $500); Hedera/World/ENS silent; devrel questions TBD `DISCLOSURE.md:206-209` | ⚠️ | Ask Hedera, World, ENS booths in writing |
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
4. Pick 3 partners: Hedera, World, Arkiv, ENS is four; ENS is ❌ on ENSv2 unless you build the subname registry (~4-6 h).
5. Run `recharge-agent --once` on live (Hedera) → in-window settlement + `agent-topup` HCS message; paste ids in README `:105-110` ($6.5k).
6. Record one 2-4 min video with a HashScan tab (Hedera hard requirement, $6.5k).
7. Ask Hedera, World (and ENS) booths whether Continuity entries are eligible (`DISCLOSURE.md:206-209`).
8. Get an Agent Pass client (other Google account / World booth), set 3 env vars, restart, demo approve + deny live; add "time to first success" + "one improvement" to `WORLD_AGENT_PASS.md` §7 ($5k).
9. Create `arkiv/` (schema, friction, reach, why-arkiv, how-you-use-arkiv, swarm); README Arkiv: writer address, one runnable query, pre-vs-in-window diff ($4.5k).
10. ~~Fix `README.md:213` tag time; set `openapi.json` `servers` to the live API URL~~ done 2026-11-06 (`servers` = `https://api.recharge.ajudiya.com` in `MODE=live`, `services/api/src/app.ts`; live after the next redeploy).
