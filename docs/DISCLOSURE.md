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
> Arkiv entity on the Arkiv rabdi testnet (chain 7794095)[^rabdi] (key `TODO(20:59): Arkiv entity key`), one
> x402 payment settled on Hedera testnet (tx `TODO(20:59): hedera:testnet settlement tx id 0.0.x@s.n`) with `DataDrop` at
> `TODO(20:59): DataDrop address on 296` (one claim, tx `TODO(20:59): Claimed tx hash`), one IDKit
> verification (action `recharge-welcome`, log hash `TODO(20:59): sha256 of the verify log line`). A team-funded free
> welcome-bundle campaign ran from 4 Nov (`TODO(20:59): claim count` claims by kickoff). Pre-bought eSIM
> inventory, reseller accounts and faucet claims are listed below. **During the window** (dated commits in
> `CHANGELOG.md`): credential-tiered sponsor pools on Hedera EVM, expiring Arkiv entitlements and the three reads that
> depend on them, the Hedera Agent Kit top-up agent with an HCS-14 identity and HCS receipts, gifts to ENS names, the
> scratch-card run, the design pass, live provisioning on three devices. **AI use:** an AI orchestrator wrote most of
> the pre-kickoff code under human direction and review, with a red-team pass; in-window commits are authored by the
> named team members with AI assistance for tests, fixtures and documentation. Keys were generated on-site and never
> entered an AI context.

[^rabdi]: The committee text (DECISION §7.3) says "one Arkiv entity on Kaolin". Kaolin (chain 60138453025) was retired
    in May 2026. The Arkiv SDK `@arkiv-network/sdk@1.0.1` defaults to **rabdi** (chain 7794095; explorer
    `rabdi.explorer.arkiv.network`), and `services/api/src/env.ts` refuses the Kaolin chain id. This is the only change
    to the verbatim text. See INTERFACES §13, row **A-23** (`docs/INTERFACES.md`, "A-23 | Arkiv Kaolin…").

## 1. Pre-kickoff code (what exists at `v0-prekickoff`)

The tag is a human action: `git tag -s v0-prekickoff && git push origin v0-prekickoff` on Thu 5 Nov 2026 at 20:59 IST
(**`TODO(20:59): tagged commit hash`**). Until then the table below describes the last pre-kickoff snapshot. At the tag,
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

The row for `v0-prekickoff` itself, and the wave-3 work after `e39897a` (web routes, the ops scripts, these documents,
the red-team fixes A-32…A-37), are filled at the tag: **`TODO(20:59): paste the prekickoff-inventory.sh output over the
table above`**.

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
| Arkiv | entity key of the one entitlement written and read on rabdi (7794095) | `TODO(20:59): Arkiv entity key` | `https://rabdi.explorer.arkiv.network/entity/<key>` — `TODO(20:59): fill <key>` | Integrations · by Thu 5 Nov 2026 20:59 IST (access key and tGLM faucet pending: captcha, human) |
| Arkiv | writer address (`$creator` of every entity) | `0xC3358be9F35fDF5C8e1922be7376980C93734d3c` | explorer address page | Integrations · Thu 5 Nov 2026 (done) |
| Hedera | x402 settlement transaction id (`0.0.x@s.n`), remote facilitator | `TODO(20:59): hedera:testnet settlement tx id` | `https://hashscan.io/testnet/transaction/<id>` — `TODO(20:59): fill <id>` | Integrations · by Thu 5 Nov 2026 20:59 IST |
| Hedera | facilitator used and its fee payer (`extra.feePayer`) | x402.org (`https://x402.org/facilitator`); `hedera:testnet` fee payer [`0.0.9185802`](https://hashscan.io/testnet/account/0.0.9185802); also serves `eip155:84532` | `/supported` recorded in `fixtures/facilitator/x402org/live-supported.json` (Thu 5 Nov 2026 08:39:51 UTC = 14:09 IST, `e195ebc`) | Integrations · Thu 5 Nov 2026 (done) |
| Hedera EVM (296) | `DataDrop` address (`deploy/addresses.hedera_testnet.json`) | `TODO(20:59): DataDrop address` (not yet deployed: blocked by RT-C-08) | `https://hashscan.io/testnet/contract/<address>` — `TODO(20:59): fill <address>` | Integrations · by Thu 5 Nov 2026 20:59 IST |
| Hedera EVM (296) | `DataDrop` roles at deploy: payout · attestor · owner (cold) | [`0x3eD751480185b0ca2F7C3B8394954211b3511B8B`](https://hashscan.io/testnet/account/0x3eD751480185b0ca2F7C3B8394954211b3511B8B) · [`0x69D0714a712B556bb950a7b4Bc3070c16b0dfc88`](https://hashscan.io/testnet/account/0x69D0714a712B556bb950a7b4Bc3070c16b0dfc88) · [`0x0fC84036F88E1C86744FE485bE6A8581eCaf0d6e`](https://hashscan.io/testnet/account/0x0fC84036F88E1C86744FE485bE6A8581eCaf0d6e) | HashScan | Integrations · Thu 5 Nov 2026 (keys generated on-site) |
| Hedera EVM (296) | deploy tx, `associateHts` tx, hello `createCampaign` tx | `TODO(20:59): deploy tx · associateHts tx · acceptOwnership tx (cold owner) · hello createCampaign tx` | HashScan | Integrations · by Thu 5 Nov 2026 20:59 IST |
| Hedera EVM (296) | the one `claim` tx (`Claimed`, `paid == 500000`) | `TODO(20:59): Claimed tx hash` | HashScan | Integrations · by Thu 5 Nov 2026 20:59 IST |
| Hedera | HCS topic id | [`0.0.11322448`](https://hashscan.io/testnet/topic/0.0.11322448) (memo "recharge receipts"; admin key = the API/HCS operator; created by `packages/adapters/scripts/hedera-setup.ts`, `e195ebc`) | `https://hashscan.io/testnet/topic/0.0.11322448` | Integrations · Thu 5 Nov 2026 (done) |
| Hedera | agent HCS-14 UAID (`uaid:aid:…`) | `TODO(20:59): uaid:aid:…;uid=0;registry=hedera;proto=x402;nativeId=hedera:testnet:0.0.11320978` (printed by `services/agent`) | — | Provisioning/Agent · by Thu 5 Nov 2026 20:59 IST |
| World | `app_id`, `rp_id`, action `recharge-welcome` (production, unlimited) | `TODO(20:59): app_id · rp_id` (action `recharge-welcome`) | Developer Portal | Integrations · by Thu 5 Nov 2026 20:59 IST (portal login pending, human) |
| World | the one IDKit 4 verification: `POST /api/v4/verify/{rp_id}` response `created_at` | `TODO(20:59): created_at of the first verification` | — | Integrations · by Thu 5 Nov 2026 20:59 IST |
| World | sha256 of that server log line (the nullifier is hashed in the log, never stored in clear) | `TODO(20:59): sha256 of the verify log line` | — | Integrations · by Thu 5 Nov 2026 20:59 IST |
| eSIM Access | one real order (order no.), refunded with `/esim/cancel` if unused | `TODO(20:59): order no. (and cancelled?)` | — | Integrations · by Thu 5 Nov 2026 20:59 IST (console login pending, human) |

DataDrop on 296 uses token mode with HTS USDC `0.0.429274` unless the HTS ERC-20 facade misbehaves. In that case it uses
`LEDGER_ONLY` (THREAT-MODEL §6.1 rule 5). Mode chosen: *token mode* (intended). The facade behaves: `decimals()` = 6
and `symbol()` = "USDC" through the relay on Thu 5 Nov 2026. Its reported EVM code is an EIP-7702 designator to the HTS
system contract `0x167`, which Foundry's local EVM cannot execute, so the 296 branch of `Deploy.s.sol` reverts before any
broadcast: finding [RT-C-08](../security/redteam/findings/RT-C-08.md), open, fix in progress. That is a simulation limit,
not a facade fault, so `LEDGER_ONLY` is not the fallback for it. `TODO(20:59): confirm the mode from the deploy tx's
ModeSet(bool ledgerOnly) event (expected ledgerOnly == false) and name the RT-C-08 fix taken (A or B)`.

## 3. Accounts, inventory and faucet claims

| Item | Detail | Owner · when |
|---|---|---|
| eSIM Access console account | `TODO(20:59): account e-mail domain; prepaid balance in USD` | Integrations · by Thu 5 Nov 2026 20:59 IST (console login pending, human) |
| MegaeSIM | `TODO(20:59): API docs received? (if not, it stays a stub, A-28)` | Integrations · by Thu 5 Nov 2026 20:59 IST |
| Pre-bought inventory | 30 India profiles (sealed in `fixtures/inventory.enc`, git-ignored) + 5 retail Airalo/Saily profiles — `TODO(20:59): India profiles on hand, and the attach-test result (3 attaches per device, 10-minute rule: the Recharge-vs-Dhwani gate)` | Integrations/Provisioning · by Thu 5 Nov 2026 20:59 IST |
| Hedera testnet accounts | 4 ECDSA accounts, all funded with test HBAR and associated with USDC `0.0.429274` (`packages/adapters/scripts/hedera-setup.ts`, `e195ebc`): API/HCS operator [`0.0.11320948`](https://hashscan.io/testnet/account/0.0.11320948) · agent [`0.0.11320978`](https://hashscan.io/testnet/account/0.0.11320978) · treasury [`0.0.11321020`](https://hashscan.io/testnet/account/0.0.11321020) · payout [`0.0.11322453`](https://hashscan.io/testnet/account/0.0.11322453) | Integrations · Thu 5 Nov 2026 (done) |
| Faucet claims | HBAR (portal.hedera.com): done for the 4 accounts above. Test USDC (faucet.circle.com, "Hedera Testnet" and "Base Sepolia"): the agent EVM address `0x27e2CA12f288a7d1c549C53Ca0E01E7cE2B32C25` holds test USDC on `hedera:testnet` and `eip155:84532`. tGLM (hub.arkiv.network/faucet) for the writer `0xC3358be9F35fDF5C8e1922be7376980C93734d3c`: `TODO(20:59): tGLM claimed? (captcha, human)`. Base Sepolia ETH: `TODO(20:59): claimed?` | Integrations · Thu 5 Nov 2026 (HBAR, USDC done) · by 20:59 IST (tGLM, ETH) |
| World Developer Portal | `TODO(20:59): app (app_mode: external), RP, production action recharge-welcome` (portal login pending, human) | Integrations · by Thu 5 Nov 2026 20:59 IST |
| AgentKit beta | applied? granted? (Agent Pass is claimed only if granted by Thu 5 Nov 2026 21:00 IST) | TBD by human (Founder, Thu 5 Nov 2026 21:00 IST) |
| Free pre-arrival campaign | team-funded, zero price, planned from Wed 4 Nov 2026 16:00 IST — `TODO(20:59): did it run (it needs DataDrop on 296, RT-C-08)? claim count at kickoff` | Founder · by Thu 5 Nov 2026 20:59 IST |

## 4. AI use

From DECISION §7.3, unchanged: *an AI orchestrator wrote most of the pre-kickoff code under human direction and
review, with a red-team pass; in-window commits are authored by the named team members with AI assistance for tests,
fixtures and documentation. Keys were generated on-site and never entered an AI context.*

Concretely, before kickoff: the orchestrator and its builder agents wrote `packages/*`, `services/*`, `apps/*`,
`scripts/*` and the documents under `docs/`. A separate red-team agent wrote `security/redteam/**` and every
`test/attack/**`/`test/redteam/**` file (findings RT-C-01…07 fixed, RT-O-01…09 being fixed). The human team chose the
idea, ratified the committee decision, directed the waves, and does every on-site, key-holding and vendor-facing action
in `docs/ONSITE-RUNBOOK.md`. The AI never had network access to a vendor or testnet (`docs/ENVIRONMENT-CONSTRAINTS.md`).

## 5. Eligibility answers (DECISION §7.4; asked at kickoff, answered here and in the README by Fri 6 Nov 2026 06:00 IST)

| Asked of | Question | Answer |
|---|---|---|
| ETHGlobal staff | "Our repository was created on 3 Nov with documented pre-existing work and a dated tag; is it an eligible Continuity base?" (if no → DECISION §7.5) | TBD by human (Founder, Thu 5 Nov 2026 21:30 IST) |
| Hedera devrel | "We have had an x402 endpoint settling on Hedera testnet and a pool contract on Hedera EVM since 4 Nov. Are Continuity entries eligible for the x402 track, or only for the Continuity prize? Would you fund a 100-claim testnet campaign from your account this weekend?" | TBD by human (Founder, Thu 5 Nov 2026 21:30 IST) |
| World devrel | "Is [Cont] Best IDKit Use Case the right submission for us, and may we also be considered for Best Use of IDKit? Can we get AgentKit beta access before Saturday?" | TBD by human (Founder, Thu 5 Nov 2026 21:30 IST) |
| Arkiv devrel | "Continuity ($4k) or from-scratch ($3k/$1k): which lane do you want a project with one pre-kickoff entity in? Does a 60-second cached read on the hot path count as reading from Arkiv when every window boundary and the agent query live? Swarm gateway access for the bonus?" | TBD by human (Founder, Thu 5 Nov 2026 21:30 IST) |
| ENS (only if a swap becomes likely) | "Which Mumbai track fits gifting-by-name and sponsor subnames?" | TBD by human (Founder, Fri 6 Nov 2026 06:00 IST) |

## 6. What changed in the window

See [`CHANGELOG.md`](CHANGELOG.md): one dated section per day from Thu 5 Nov 2026 21:00 IST. Each line has the time,
the author, the package, the sponsor and the commit hash. At submission, the final table there ("pre-kickoff vs
in-window lines per sponsor path") is generated with `git diff --stat v0-prekickoff..HEAD -- <paths>`. It is the
evidence for the ≥ 70 %-in-window rule per integration (DECISION §7.2 constraint 2).
