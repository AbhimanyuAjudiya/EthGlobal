# Continuity disclosure

Recharge is entered in the **Continuity** track. This file is the written disclosure that DECISION §7.2–7.3 commits us
to: what existed before hacking opened (Thu 5 Nov 2026, 21:00 IST), what was deployed on sponsor testnets before then,
and how the AI orchestrator was used. It is kept current through Sunday. The dated in-window work is in
[`CHANGELOG.md`](CHANGELOG.md).

Every slot marked `TODO(20:59): …` is filled in one pass at the tag (Thu 5 Nov 2026, 20:59 IST; `grep -n 'TODO(20:59)'`
lists them all). Every slot still left to a human names that owner and a time after kickoff. No key, seed phrase, access
code or signing key is ever written here. Only public identifiers are: transaction ids, entity keys, contract addresses
and hashes.

## The disclosure (README text, verbatim)

> **Continuity disclosure.** Recharge is entered in the Continuity track. **Before kickoff** (3–5 Nov 2026; tag
> `v0-prekickoff`, 5 Nov 20:59 IST): a local-first monorepo scaffold (tooling, design tokens, adapter interfaces with
> mocks); the x402 gateway and the Octroi quota engine running against Anvil and mocks; the reseller adapter; the PWA
> shell; `DataDrop.sol` with Foundry tests; and three hello-world integrations deployed by the team on 4 Nov — one
> Arkiv entity on the Arkiv rabdi testnet (chain 7794095)[^rabdi] (key `0xb9429fbd706f46a55d16788d9446f147f9d65b9ef005b7f463bae9caadb2abb1`), one
> x402 payment settled on Hedera testnet (tx `0.0.9185802@1793882124.642565779`) with `DataDrop` at
> `0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6` (one claim, tx `0xec5f963f2bacf55c8c408d4d699650197f19077dbfa209b723039ad75f886c53`), one IDKit
> verification (action `recharge-welcome`, log hash `09396c147bb69ba45d104b52941234157b7c591a662ff43385aa61347b3779b0`). A team-funded free
> welcome-bundle campaign ran from 4 Nov (1 claim by kickoff). Pre-bought eSIM
> inventory, reseller accounts and faucet claims are listed below. **During the window** (dated commits in `CHANGELOG.md`; `git log v0-prekickoff..HEAD`): the live deployment at
> app.recharge.ajudiya.com on AWS (testnet rails), the EVM wallet layer (RainbowKit/wagmi, WalletConnect on phones),
> human Hedera payments with HashPack over WalletConnect (HIP-820), the one-tap mobile verify flow, the landing hub
> and walkthrough, the submission material (LICENSE, `arkiv/`, `docs/QUALIFICATION.md`, the demo script) and
> dependency/lint gate fixes. The sponsor pools, the expiring Arkiv entitlements, the top-up agent with its HCS-14
> identity and HCS receipts, gifts to ENS names and the scratch-card run were built and exercised on testnet
> **before** kickoff (5 Nov afternoon, §2 below); in the window they were deployed live, not rewritten. **AI use:** an AI orchestrator wrote most of
> the pre-kickoff code under human direction and review, with a red-team pass; in-window commits are authored by the
> named team members with AI assistance for tests, fixtures and documentation. Keys were generated on-site and never
> entered an AI context.

[^rabdi]: The committee text (DECISION §7.3) says "one Arkiv entity on Kaolin". Kaolin (chain 60138453025) was retired
    in May 2026. The Arkiv SDK `@arkiv-network/sdk@1.0.1` defaults to **rabdi** (chain 7794095; explorer
    `rabdi.explorer.arkiv.network`), and `services/api/src/env.ts` refuses the Kaolin chain id. This is the only change
    to the verbatim text. See INTERFACES §13, row **A-23** (`docs/INTERFACES.md`, "A-23 | Arkiv Kaolin…").

## 1. Pre-kickoff code (what exists at `v0-prekickoff`)

The tag is a human action: `git tag -s v0-prekickoff && git push origin v0-prekickoff` on Thu 5 Nov 2026 at 20:59 IST
(**tagged commit `380ff32`**, committed 20:20:57 IST; the annotated, unsigned tag object was created at 21:16 IST, after kickoff, because the scheduled tag step fired late; no commit lies between `380ff32` and the tag). Until then the table below describes the last pre-kickoff snapshot. At the tag,
regenerate it on a clean checkout with `bash scripts/prekickoff-inventory.sh v0-prekickoff --tests` and paste the output
here.

Snapshot: `e39897a` (Wed 04 Nov 2026 09:10 UTC = 14:40 IST), 47 commits since `111fc18` (Tue 3 Nov 04:33 UTC). The
test counts were measured on a clean tree at `e39897a` with `vitest run` and `forge test`, Wed 4 Nov 09:16 UTC.

| Path | What it is (pre-kickoff scope) | First → last commit | Commits | Tracked files | TS/Sol lines | Tests at `e39897a` |
|---|---|---|---|---|---|---|
| `packages/protocol` | zod wire and ledger schemas, x402 v2 header codec and 402 loop, units, ids, error codes, EIP-712 types, PIN format | `598daa5` → `e39897a` | 10 | 31 | 3 464 | 321 passed |
| `packages/crypto` | sha256/keccak/HMAC, XChaCha20-Poly1305 seal/open to X25519, webhook MAC, `hashToField` | `598daa5` → `aef2eaf` | 6 | 11 | 681 | 30 passed |
| `packages/eip3009` | EIP-712/3009 typed data, `domainFromRequirements`, digest/recover, calldata, relayer | `22a97b7` → `e39897a` | 8 | 21 | 1 122 | 68 passed |
| `packages/octroi` | the quota engine: `decide`, tiers, sizing, keys, challenge, top-up and reclaim rules, ledger stores | `1b379f9` → `e39897a` | 3 | 56 | 5 856 | 320 passed + 27 open red-team findings (`_RTFINDING`, RT-O-01…09) |
| `packages/adapters` | ports, deterministic mocks, live adapters over recorded/authored fixtures (Arkiv, World IDKit 4, x402 facilitators, eSIM Access, inventory, HCS, ENS, Swarm, treasuries) | `a3514fd` → `e39897a` | 6 | 91 | 11 105 | 310 passed, 14 skipped |
| `packages/contracts` | `DataDrop.sol`, `EIP3009Token`/`MockUSDC3009`, `Deploy.s.sol`, invariants, vectors | `9c967ee` → `1b379f9` | 9 | 49 | 6 399 | 185 passed (forge, 19 suites) |
| `packages/ui` | design tokens, components (Coupon, ScratchCard, MbMeter, OnchainAction, PrintSheet…) | `a3514fd` → `d71ea7b` | 8 | 43 | 3 028 | 172 passed |
| `services/api` | Hono API: every route of INTERFACES §7, self-run facilitator, MODE=local seed hooks | `a3514fd` → `e39897a` | 2 | 105 | 10 279 | 248 passed |
| `services/agent` | the top-up agent (`recharge-agent --once`), EVM and Hedera payers, HCS-14 UAID | `e39897a` → `e39897a` | 1 | 45 | 5 705 | 137 passed |
| `apps/web` | the PWA shell and the component gallery (`/ui`, `/ui/print`) | `9c967ee` → `d71ea7b` | 4 | 15 | 937 | — |
| `apps/video` | Remotion compositions for the judge and social videos | `8dd6843` → `d71ea7b` | 6 | 59 | 3 653 | — |
| `scripts` | dev chain, tool check, the e2e harness | `a3514fd` → `e39897a` | 4 | 3 | 0 (bash) | — |
| `security` | threat model tooling, red-team attack scripts and findings | `8901817` → `e39897a` | 9 | 34 | 0 | — |
| `docs`, `research` | architecture, interfaces, build plan, briefs, vendor facts; committee research | `a639544` → `1b379f9` / `568b4bb` | 11 / 24 | 13 / 33 | 0 | — |

Since `e39897a`, as of `ca7e1fd` (Thu 5 Nov 2026 14:28 IST): 27 commits — red-team waves 2 and 3 (API, agent, PWA,
ops/repo) and their fixes, the closing audit, the local macOS toolchain (`bcc245b`, `137c7f3`, `a190e7c`), the
`pnpm-lock.yaml` refresh under `minimumReleaseAge: 4320` (`4595e14`, Thu 5 Nov 14:16 IST, RT-P-04), the Hedera on-site
setup script and the live x402.org `/supported` fixture (`e195ebc`), and finding RT-C-08 (`dd37379`). Red-team status at
that commit: all waves green at the last run; open finding RT-C-08 (see §2); three `deps-check` findings (`ws` and
`zod` advisories, `@hashgraph/sdk` as a banned transitive) await the human's decision on the override shape. The
per-finding status is `security/redteam/findings/INDEX.md`.

As of `2e21ea6` (Thu 5 Nov 2026 18:07 IST), the last commit before the tag: RT-A-15 (Arkiv u64 columns, `85f3f69`,
verified) and RT-A-16 (the x402.org `/supported` shape, `bc645d6`, fixed; `MODE=live` boots against it, chain 296,
`degraded: false`), the network-parametric API and live adapters (`9143a75`), the VPS bootstrap (`295f439`),
`engines.node >= 22.12` (`42bf691`), the narrowed RT-P-04 importer check (`3152a62`), the Hedera exact scheme on
`POST /gift` (`633cdcc`) and the mirror-node fixtures (`2e21ea6`). RT-C-08 is verified (fix A, §2). Red-team reruns
on `3152a62`: wave 2 (API, agent, e2e I-0…I-18) green; wave 3 ops 79 ✓ / 0 ✗, web 131 ✓ / 0 ✗; the only red check
on the branch is `deps-check` (the lockfile regeneration is scheduled for Fri 6 Nov 2026 04:41 IST).

Inventory at `2e21ea6`: `bash scripts/prekickoff-inventory.sh HEAD --tests`, run Thu 5 Nov 2026 18:16 IST on a clean
worktree of that commit (dependencies from the lockfile, packages built, `packages/contracts/lib` = the pinned
`forge install`). The script labels `%cd` as UTC but prints the machine's zone, here IST: 18:07 IST = 12:37 UTC. The
row for the tag itself is regenerated at `v0-prekickoff` if that commit differs from `2e21ea6`.

Snapshot: `2e21ea6` (Thu 05 Nov 2026 18:07 UTC), 103 commits since `111fc18`.

| Path | First → last commit | Commits | Tracked files | TS/Sol lines | Tests |
|---|---|---|---|---|---|
| `packages/protocol` | `598daa5` → `9143a75` | 17 | 32 | 3689 | 334 passed (334) |
| `packages/crypto` | `598daa5` → `137c7f3` | 7 | 11 | 690 | 31 passed (31) |
| `packages/eip3009` | `22a97b7` → `e39897a` | 8 | 21 | 1122 | 68 passed (68) |
| `packages/octroi` | `1b379f9` → `5a272c5` | 10 | 65 | 7769 | 418 passed (418) |
| `packages/adapters` | `a3514fd` → `9143a75` | 15 | 92 | 11905 | 332 passed \| 14 skipped (346) |
| `packages/contracts` | `9c967ee` → `bc645d6` | 16 | 62 | 7018 | 213 |
| `packages/ui` | `a3514fd` → `30d4413` | 13 | 49 | 3305 | 173 passed (173) |
| `services/api` | `a3514fd` → `633cdcc` | 16 | 133 | 15168 | 1 failed \| 453 passed (454) |
| `services/agent` | `e39897a` → `bc645d6` | 10 | 54 | 7394 | 190 passed (190) |
| `apps/web` | `9c967ee` → `4159fcf` | 19 | 183 | 11525 | — |
| `apps/video` | `8dd6843` → `69ad131` | 11 | 52 | 3057 | — |
| `scripts` | `a3514fd` → `30d4413` | 15 | 33 | 4027 | — |
| `security` | `8901817` → `3152a62` | 33 | 86 | 0 | — |
| `docs` | `a639544` → `ab94753` | 31 | 21 | 0 | — |
| `research` | `a639544` → `568b4bb` | 24 | 33 | 0 | — |

`services/api`: 454 tests, 453 passed; the one failure is `test/listen.test.ts` (RT-P-01, "`src/index.ts` in
MODE=local listens on 127.0.0.1 only"), which boots the API as a child process and needs the Anvil `DataDrop` deploy
file (`DATADROP_ADDRESS`) that a fresh worktree without a local chain does not have; the fact log has the API suite
green on the integrated branch (`9143a75`). `packages/contracts`: the number is `forge test --summary` passed tests.
`MODE=local` end to end on the integrated branch: `scripts/e2e-local.sh` all steps passed in 20.8 s
(`run-20261105T102859Z`, at `295f439` minus the ops commits).

At the tag: inventory at `8b1151d`, same procedure, run Thu 5 Nov 2026 20:13 IST (the script prints IST under its UTC label). The tagged commit `380ff32` adds three commits after that run: `78a6b11` (EIP-6963 wallet picker; web suite 74 passed, 3 skipped), `e4a8f87` (RT-A-17 claim re-bind; API suite 473 passed) and `380ff32` (finding record).

Snapshot: `8b1151d` (Thu 05 Nov 2026 20:13 UTC), 107 commits since `111fc18`.

| Path | First → last commit | Commits | Tracked files | TS/Sol lines | Tests |
|---|---|---|---|---|---|
| `packages/protocol` | `598daa5` → `8c71246` | 18 | 32 | 3737 | 337 passed (337) |
| `packages/crypto` | `598daa5` → `137c7f3` | 7 | 11 | 690 | 31 passed (31) |
| `packages/eip3009` | `22a97b7` → `e39897a` | 8 | 21 | 1122 | 68 passed (68) |
| `packages/octroi` | `1b379f9` → `5a272c5` | 10 | 65 | 7769 | 418 passed (418) |
| `packages/adapters` | `a3514fd` → `9143a75` | 15 | 92 | 11905 | 332 passed \| 14 skipped (346) |
| `packages/contracts` | `9c967ee` → `bc645d6` | 16 | 62 | 7018 | 213 |
| `packages/ui` | `a3514fd` → `30d4413` | 13 | 49 | 3305 | 173 passed (173) |
| `services/api` | `a3514fd` → `8c71246` | 17 | 136 | 16479 | 469 passed (469) |
| `services/agent` | `e39897a` → `8c71246` | 11 | 56 | 7685 | 194 passed (194) |
| `apps/web` | `9c967ee` → `bae6ecc` | 21 | 185 | 11842 | — |
| `apps/video` | `8dd6843` → `69ad131` | 11 | 52 | 3057 | — |
| `scripts` | `a3514fd` → `8c71246` | 16 | 33 | 4027 | — |
| `security` | `8901817` → `bae6ecc` | 34 | 87 | 0 | — |
| `docs` | `a639544` → `8b1151d` | 34 | 22 | 0 | — |
| `research` | `a639544` → `568b4bb` | 24 | 33 | 0 | — |

`MODE=local` proof at the snapshot: `bash scripts/e2e-local.sh` runs Anvil + `Deploy.s.sol` + the API + the demo seed +
the agent's `--once` pass + the I-0…I-18 flow in ≈ 23 s (see `README.md`, "Run it").

## 2. Pre-deployed artefacts (the minimal pre-deploy, one round-trip per partner; planned Wed 4 Nov 14:00 IST, done Thu 5 Nov 2026)

Rails, as verified on Thu 5 Nov 2026: Hedera testnet is chain 296 (x402 network id `hedera:testnet`), JSON-RPC relay
`https://testnet.hashio.io/api`, mirror `https://testnet.mirrornode.hedera.com`, explorer `https://hashscan.io/testnet`.
USDC there is the HTS token [`0.0.429274`](https://hashscan.io/testnet/token/0.0.429274) with the EVM facade
`0x0000000000000000000000000000000000068cDa` (`decimals()` = 6, `symbol()` = "USDC", read through the relay that day).
Arkiv is the rabdi testnet, chain id 7794095. The x402 facilitator is x402.org (`eip155:84532` Base Sepolia and
`hedera:testnet`).

| Partner | Artefact | Value | Link | Owner · when |
|---|---|---|---|---|
| Arkiv | entity key of the one entity written and read on rabdi (7794095) through `ArkivLedger` (after RT-A-15, `85f3f69`): put 8.8 s, get 0.37 s, update 14.9 s (same key kept), query 0.68 s. Also that day: the first raw-SDK write `0x73d83f38374affec72322cf2f2630fe7f01ca1fe669238708e7d3eca79a7a9dd` (tx `0xcc06c726a5d87637b2dc312bd92fd4cfaf1a13c1205b047af1f2fc0a1d9c37b0`), which expired at block 244220 (180 s TTL) and is the "observed expiring" fixture candidate; and the API's own live gift write `0x80374f83458726f96ab6a44b14daf9ff6f435eca6bb9f82a56c1704acd627a01` (the x402 gift below) | `0xb9429fbd706f46a55d16788d9446f147f9d65b9ef005b7f463bae9caadb2abb1` | [rabdi.explorer.arkiv.network/entity/0xb9429fbd…](https://rabdi.explorer.arkiv.network/entity/0xb9429fbd706f46a55d16788d9446f147f9d65b9ef005b7f463bae9caadb2abb1) | Integrations · Thu 5 Nov 2026 (done; the access key was issued and 10 tGLM faucet-claimed by the human that day) |
| Arkiv | writer address (`$creator` of every entity) | `0xC3358be9F35fDF5C8e1922be7376980C93734d3c` | explorer address page | Integrations · Thu 5 Nov 2026 (done) |
| Hedera | x402 settlement transaction id (`0.0.x@s.n`), remote facilitator: `POST /gift` (to `re-charge.eth`, 100 MB, 0.40 USDC) 402 → pay → 201 on `hedera:testnet` through x402.org (gift-route Hedera support `633cdcc`); payer = the agent `0.0.11320978`, payTo `0.0.11322453`, 400000 units; gift id `0xd8462ad9f65393a428e5e22799eb4c0656d866623ef783325c6720feadf7cd0a` (serial `d8462ad9`), claim by 1794486944049 ms. The same loop settled first on `eip155:84532` (Base Sepolia): tx `0xaacb030e3e43bad867c0874dff3190bc1676c2c50a5ebea9e8eb5895d3b68488`, payer `0x27e2CA12f288a7d1c549C53Ca0E01E7cE2B32C25`, gift `0xfedc9a6c2e21fee3fca7a9b1ac12ada6347eed8136601393628cfd6442c4df12`; that payment's payTo was the local Anvil payout address (copied from the local env into the live one), corrected to `0x3eD751…` the same day, test USDC only | `0.0.9185802@1793882124.642565779` | [HashScan](https://hashscan.io/testnet/transaction/0.0.9185802@1793882124.642565779); the mirror-node record is the fixture committed in `2e21ea6` | Integrations · Thu 5 Nov 2026 (done) |
| Hedera | facilitator used and its fee payer (`extra.feePayer`) | x402.org (`https://x402.org/facilitator`); `hedera:testnet` fee payer [`0.0.9185802`](https://hashscan.io/testnet/account/0.0.9185802); also serves `eip155:84532` | `/supported` recorded in `fixtures/facilitator/x402org/live-supported.json` (Thu 5 Nov 2026 08:39:51 UTC = 14:09 IST, `e195ebc`) | Integrations · Thu 5 Nov 2026 (done) |
| Hedera EVM (296) | `DataDrop` address (`deploy/addresses.hedera_testnet.json`) | `0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6` (deployed Thu 5 Nov 2026 by `DeployHedera` with `--skip-simulation`: RT-C-08 fix A) | [HashScan](https://hashscan.io/testnet/contract/0x2d4d52989545FF0d0CD91D77A33f14063f57c9E6) | Integrations · Thu 5 Nov 2026 (done) |
| Hedera EVM (296) | `DataDrop` roles at deploy: payout · attestor · owner (cold) | [`0x3eD751480185b0ca2F7C3B8394954211b3511B8B`](https://hashscan.io/testnet/account/0x3eD751480185b0ca2F7C3B8394954211b3511B8B) · [`0x69D0714a712B556bb950a7b4Bc3070c16b0dfc88`](https://hashscan.io/testnet/account/0x69D0714a712B556bb950a7b4Bc3070c16b0dfc88) · [`0x0fC84036F88E1C86744FE485bE6A8581eCaf0d6e`](https://hashscan.io/testnet/account/0x0fC84036F88E1C86744FE485bE6A8581eCaf0d6e) (= `0.0.11323086`; ownership accepted, next row). The attestor is also the deployer and the sponsor of the hello campaign (= `0.0.11320948`) | HashScan | Integrations · Thu 5 Nov 2026 (keys generated on-site) |
| Hedera EVM (296) | deploy tx, `associateHts` tx, `transferOwnership` and `acceptOwnership` txs (cold owner), hello `createCampaign` tx, and the HTS transfer that funded the campaign | deploy `0x234ec50e7187d149fdd4d26b508c579273672f0a9c81553b45c862e61781304b` · `associateHts` `0x5b8ce6cd655ec1d2f79f4d61030b4f8f65b69c3a79a06d0c2b689b42672bfd7c` · `transferOwnership` `0x43c85694c28fd378caa35accc986055ea3978ceabdfa5388fee9b19955389ea9` · `acceptOwnership` `0x71e925ab99886b096b9e84f1310ccc56ba389d34d7053d841c807bb55545b4fc` · hello `createCampaign` `0x713c00b5cbab9b25fdd6d2b07cb228c21b2ee6cb5cb6d55bf86e7da57fdb8c82` (campaign id `0x69d0714a712b556bb950a7b4bc3070c16b0dfc88000000000000000000000001`, budget 10 USDC, 0.5 USDC per claim) · 10 USDC from the agent to the sponsor account `0.0.11320978@1793871829.024241529` | HashScan | Integrations · Thu 5 Nov 2026 (done) |
| Hedera EVM (296) | the one `claim` tx (`Claimed(bytes32,bytes32,uint96,uint64)`, topic0 `0x44b3916b…`, `paid == 500000`) | `0xec5f963f2bacf55c8c408d4d699650197f19077dbfa209b723039ad75f886c53` | [HashScan](https://hashscan.io/testnet/transaction/0xec5f963f2bacf55c8c408d4d699650197f19077dbfa209b723039ad75f886c53) | Integrations · Thu 5 Nov 2026 (done) |
| Hedera | HCS topic id | [`0.0.11322448`](https://hashscan.io/testnet/topic/0.0.11322448) (memo "recharge receipts"; admin key = the API/HCS operator; created by `packages/adapters/scripts/hedera-setup.ts`, `e195ebc`) | `https://hashscan.io/testnet/topic/0.0.11322448` | Integrations · Thu 5 Nov 2026 (done) |
| Hedera | agent HCS-14 UAID (`uaid:aid:…`) | `uaid:aid:q4YxqiHBaGpeMoD1gvzCVQ6k6WtBLutszq5Ked4Y23g5HvFeFU83agQ7UovrE8RWd;uid=0;registry=hedera;proto=x402;nativeId=hedera:testnet:0.0.11320978` (self-issued, not registered: `uaidInput('0.0.11320978')` → `hcs14Uaid`, `services/agent` at `2e21ea6`, computed offline from the built package) | — | Provisioning/Agent · Thu 5 Nov 2026 (done) |
| World | `app_id`, `rp_id`, action `recharge-welcome` (production, unlimited) | `app_0ae14be3407fed7a588138b15fc882b4` · `rp_8e967c09cdfc3fd9` (managed RP, production registered) · action `recharge-welcome` = `action_v4_bbae224138b562f7954361aaefe60603` · rp-context signer `0xA2B86AD1a4eE75533C06b67BCe5f1c07f66457d0` | Developer Portal | Integrations · Thu 5 Nov 2026 (done) |
| World | the one IDKit 4 verification: `POST /api/v4/verify/{rp_id}` response `created_at` | `2026-11-05T13:23:51Z` (18:53:51 IST; Orb credential, decision `serve-free`, free claim tx `0xc47edbd7…`) | — | Integrations · by Thu 5 Nov 2026 20:59 IST |
| World | sha256 of that server log line (the nullifier is hashed in the log, never stored in clear) | `09396c147bb69ba45d104b52941234157b7c591a662ff43385aa61347b3779b0` | — | Integrations · by Thu 5 Nov 2026 20:59 IST |
| eSIM Access | one real order (order no.), refunded with `/esim/cancel` if unused | no order placed: the console balance is $0.00 at 20:59 (minimum deposit $50, human decision pending) — not placed yet: the console account exists, its prepaid balance is $0.00 | — | Integrations · by Thu 5 Nov 2026 20:59 IST (human deposit pending) |

DataDrop on 296 uses token mode with HTS USDC `0.0.429274` unless the HTS ERC-20 facade misbehaves. In that case it uses
`LEDGER_ONLY` (THREAT-MODEL §6.1 rule 5). Mode chosen: *token mode* (confirmed Thu 5 Nov 2026). The facade behaves:
`decimals()` = 6 and `symbol()` = "USDC" through the relay on Thu 5 Nov 2026. Its reported EVM code is an EIP-7702
designator to the HTS system contract `0x167`, which Foundry's local EVM cannot execute, so the 296 branch of
`Deploy.s.sol` reverts before any broadcast: finding [RT-C-08](../security/redteam/findings/RT-C-08.md), verified.
That is a simulation limit, not a facade fault, so `LEDGER_ONLY` is not the fallback for it. Fix taken: **A**, the
`DeployHedera` script broadcast with `--skip-simulation` (deploy tx `0x234ec50e…`, above). Token mode is what is on
chain: the contract was associated with the HTS token (`associateHts`, above), the hello campaign's 10 USDC budget
moved on the ledger (`0.0.11320978@1793871829.024241529`) before `createCampaign`, and the one claim paid 500000 units.

## 3. Accounts, inventory and faucet claims

| Item | Detail | Owner · when |
|---|---|---|
| eSIM Access console account | created by the human on Thu 5 Nov 2026; API credentials and a webhook token issued (held in the local env, never written here); prepaid balance **$0.00**, so the order/attach test waits for a human deposit. console e-mail domain gmail.com; prepaid balance $0.00 at 20:59 (minimum deposit $50) | Integrations · by Thu 5 Nov 2026 20:59 IST (human deposit pending) |
| MegaeSIM | no API docs received; MegaeSIM stays a fixture-only stub (A-28) | Integrations · by Thu 5 Nov 2026 20:59 IST |
| Pre-bought inventory | 30 India profiles (sealed in `fixtures/inventory.enc`, git-ignored) + 5 retail Airalo/Saily profiles — 0 India profiles on hand (no deposit); the attach test was not run by 20:59, so the Recharge-vs-Dhwani gate (§3) stays open | Integrations/Provisioning · by Thu 5 Nov 2026 20:59 IST |
| Hedera testnet accounts | 4 ECDSA accounts, all funded with test HBAR and associated with USDC `0.0.429274` (`packages/adapters/scripts/hedera-setup.ts`, `e195ebc`): API/HCS operator [`0.0.11320948`](https://hashscan.io/testnet/account/0.0.11320948) · agent [`0.0.11320978`](https://hashscan.io/testnet/account/0.0.11320978) · treasury [`0.0.11321020`](https://hashscan.io/testnet/account/0.0.11321020) · payout [`0.0.11322453`](https://hashscan.io/testnet/account/0.0.11322453) | Integrations · Thu 5 Nov 2026 (done) |
| Faucet claims | HBAR (portal.hedera.com): done for the 4 accounts above. Test USDC (faucet.circle.com, "Hedera Testnet" and "Base Sepolia"): the agent EVM address `0x27e2CA12f288a7d1c549C53Ca0E01E7cE2B32C25` holds test USDC on `hedera:testnet` and `eip155:84532`. tGLM (hub.arkiv.network/faucet) for the writer `0xC3358be9F35fDF5C8e1922be7376980C93734d3c`: claimed by the human on Thu 5 Nov 2026, 10 tGLM. Base Sepolia ETH: Base Sepolia ETH not claimed and not needed: the facilitator pays gas, the agent's EIP-3009 payment `0xaacb030e…` settled with 0 ETH (not needed for the `eip155:84532` settlement in §2: the facilitator pays the gas) | Integrations · Thu 5 Nov 2026 (HBAR, USDC, tGLM done) · by 20:59 IST (ETH) |
| World Developer Portal | app `app_0ae14be3407fed7a588138b15fc882b4`, RP `rp_8e967c09cdfc3fd9` (managed; production registered), action `recharge-welcome` (`action_v4_bbae224138b562f7954361aaefe60603`); the first verification is still to be run (§2) | Integrations · Thu 5 Nov 2026 (done) |
| AgentKit beta | applied? granted? (Agent Pass is claimed only if granted by Thu 5 Nov 2026 21:00 IST) | TBD by human (Founder, Thu 21:00) |
| World ID Agent Pass | integrated (device grant, backend-validated; `docs/WORLD_AGENT_PASS.md`, simulated World IdP in local e2e); client registration TBD by human (Founder, Thu 21:30) | TBD by human (Founder, Thu 21:30) |
| Free pre-arrival campaign | team-funded, zero price to the traveller, planned from Wed 4 Nov 2026 16:00 IST — it ran as the hello campaign on Thu 5 Nov 2026 (after RT-C-08): id `0x69d0714a712b556bb950a7b4bc3070c16b0dfc88000000000000000000000001`, budget 10 USDC at 0.5 USDC per claim, sponsored by the attestor account (`createCampaign` tx in §2); **1 claim at kickoff** (`Claimed`, paid 500000, tx `0xec5f963f…`) | Founder · Thu 5 Nov 2026 (done) |

## 4. AI use

From DECISION §7.3, unchanged: *an AI orchestrator wrote most of the pre-kickoff code under human direction and
review, with a red-team pass; in-window commits are authored by the named team members with AI assistance for tests,
fixtures and documentation. Keys were generated on-site and never entered an AI context.*

Concretely, before kickoff: the orchestrator and its builder agents wrote `packages/*`, `services/*`, `apps/*`,
`scripts/*` and the documents under `docs/`. A separate red-team agent wrote `security/redteam/**` and every
`test/attack/**`/`test/redteam/**` file (findings RT-C-01…08, RT-O-01…09, RT-A-01…16, RT-G-01…05, RT-P-01…13 and
RT-W-01…12: all verified or fixed by Thu 5 Nov 2026 except RT-P-04 acknowledged, RT-P-09 fixing and RT-P-13 open;
RT-C-08, RT-A-15 and RT-A-16 were verified or fixed that day; `security/redteam/findings/INDEX.md`). The human team chose the
idea, ratified the committee decision, directed the waves, and does every on-site, key-holding and vendor-facing action
in `docs/ONSITE-RUNBOOK.md`. The AI never had network access to a vendor or testnet (`docs/ENVIRONMENT-CONSTRAINTS.md`).

## 5. Eligibility answers (DECISION §7.4; asked at kickoff, answered here and in the README by Fri 6 Nov 2026 06:00 IST)

| Asked of | Question | Answer |
|---|---|---|
| ETHGlobal staff | "Our repository was created on 3 Nov with documented pre-existing work and a dated tag; is it an eligible Continuity base?" (if no → DECISION §7.5) | TBD by human (Founder, Thu 21:30) |
| Hedera devrel | "We have had an x402 endpoint settling on Hedera testnet and a pool contract on Hedera EVM since 4 Nov. Are Continuity entries eligible for the x402 track, or only for the Continuity prize? Would you fund a 100-claim testnet campaign from your account this weekend?" | TBD by human (Founder, Thu 21:30) |
| World devrel | "Is [Cont] Best IDKit Use Case the right submission for us, and may we also be considered for Best Use of IDKit? Can we get AgentKit beta access before Saturday?" | TBD by human (Founder, Thu 21:30) |
| Arkiv devrel | "Continuity ($4k) or from-scratch ($3k/$1k): which lane do you want a project with one pre-kickoff entity in? Does a 60-second cached read on the hot path count as reading from Arkiv when every window boundary and the agent query live? Swarm gateway access for the bonus?" | TBD by human (Founder, Thu 21:30) |
| ENS (only if a swap becomes likely) | "Which Mumbai track fits gifting-by-name and sponsor subnames?" | TBD by human (Founder, Fri 06:00) |

## 6. What changed in the window

See [`CHANGELOG.md`](CHANGELOG.md): one dated section per day from Thu 5 Nov 2026 21:00 IST. Each line has the time,
the author, the package, the sponsor and the commit hash. At submission, the final table there ("pre-kickoff vs
in-window lines per sponsor path") is generated with `git diff --stat v0-prekickoff..HEAD -- <paths>`. It is the
evidence for the ≥ 70 %-in-window rule per integration (DECISION §7.2 constraint 2).
