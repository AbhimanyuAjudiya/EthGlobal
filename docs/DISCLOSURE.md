# Continuity disclosure

Recharge is entered in the **Continuity** track. This file is the written disclosure that DECISION §7.2–7.3 commits us
to: what existed before hacking opened (Thu 5 Nov 2026, 21:00 IST), what was deployed on sponsor testnets before then,
and how the AI orchestrator was used. It is kept current through Sunday. The dated in-window work is in
[`CHANGELOG.md`](CHANGELOG.md).

Every slot marked **TBD by human** names an owner and a time. No key, seed phrase, access code or signing key is ever
written here. Only public identifiers are: transaction ids, entity keys, contract addresses and hashes.

## The disclosure (README text, verbatim)

> **Continuity disclosure.** Recharge is entered in the Continuity track. **Before kickoff** (3–5 Nov 2026; tag
> `v0-prekickoff`, 5 Nov 20:59 IST): a local-first monorepo scaffold (tooling, design tokens, adapter interfaces with
> mocks); the x402 gateway and the Octroi quota engine running against Anvil and mocks; the reseller adapter; the PWA
> shell; `DataDrop.sol` with Foundry tests; and three hello-world integrations deployed by the team on 4 Nov — one
> Arkiv entity on the Arkiv rabdi testnet (chain 7794095)[^rabdi] (key `TBD by human (Integrations, Wed 14:00)`), one
> x402 payment settled on Hedera testnet (tx `TBD by human (Integrations, Wed 14:00)`) with `DataDrop` at
> `TBD by human (Integrations, Wed 14:00)` (one claim, tx `TBD by human (Integrations, Wed 14:00)`), one IDKit
> verification (action `recharge-welcome`, log hash `TBD by human (Integrations, Wed 14:00)`). A team-funded free
> welcome-bundle campaign ran from 4 Nov (`TBD by human (Founder, Thu 20:59)` claims by kickoff). Pre-bought eSIM
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

The tag is a human action: `git tag -s v0-prekickoff && git push origin v0-prekickoff` on Thu 5 Nov at 20:59 IST
(**TBD by human (Founder, Thu 20:59)**). Until then the table below describes the last pre-kickoff snapshot. At the tag,
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

The row for `v0-prekickoff` itself, and the wave-3 work after `e39897a` (web routes, the ops scripts, these documents,
the red-team fixes A-32…A-37), are filled at the tag: **TBD by human (Founder, Thu 20:59)**.

`MODE=local` proof at the snapshot: `bash scripts/e2e-local.sh` runs Anvil + `Deploy.s.sol` + the API + the demo seed +
the agent's `--once` pass + the I-0…I-18 flow in ≈ 23 s (see `README.md`, "Run it").

## 2. Pre-deployed artefacts (Wed 4 Nov 14:00 IST minimal pre-deploy, one round-trip per partner)

| Partner | Artefact | Value | Link | Owner · when |
|---|---|---|---|---|
| Arkiv | entity key of the one entitlement written and read on rabdi (7794095) | `TBD by human (Integrations, Wed 14:00)` | `https://rabdi.explorer.arkiv.network/entity/<key>` — TBD by human (Integrations, Wed 14:00) | Integrations · Wed 14:00 |
| Arkiv | writer address (`$creator` of every entity) | `TBD by human (Integrations, Wed 14:00)` | explorer address page | Integrations · Wed 14:00 |
| Hedera | x402 settlement transaction id (`0.0.x@s.n`), remote facilitator | `TBD by human (Integrations, Wed 14:00)` | `https://hashscan.io/testnet/transaction/<id>` — TBD by human (Integrations, Wed 14:00) | Integrations · Wed 14:00 |
| Hedera | facilitator used and its fee payer (`extra.feePayer`) | `TBD by human (Integrations, Wed 14:00)` | `/supported` response recorded in `fixtures/facilitator/` | Integrations · Wed 14:00 |
| Hedera EVM (296) | `DataDrop` address (`deploy/addresses.hedera_testnet.json`) | `TBD by human (Integrations, Wed 14:00)` | `https://hashscan.io/testnet/contract/<address>` | Integrations · Wed 14:00 |
| Hedera EVM (296) | deploy tx, `associateHts` tx, hello `createCampaign` tx | `TBD by human (Integrations, Wed 14:00)` | HashScan | Integrations · Wed 14:00 |
| Hedera EVM (296) | the one `claim` tx (`Claimed`, `paid == 500000`) | `TBD by human (Integrations, Wed 14:00)` | HashScan | Integrations · Wed 14:00 |
| Hedera | HCS topic id | `TBD by human (Integrations, Wed 14:00)` | `https://hashscan.io/testnet/topic/<0.0.x>` | Integrations · Wed 14:00 |
| Hedera | agent HCS-14 UAID (`uaid:aid:…`) | `TBD by human (Provisioning/Agent, Wed 14:00)` | — | Provisioning/Agent · Wed 14:00 |
| World | `app_id`, `rp_id`, action `recharge-welcome` (production, unlimited) | `TBD by human (Integrations, Wed 14:00)` | Developer Portal | Integrations · Wed 14:00 |
| World | the one IDKit 4 verification: `POST /api/v4/verify/{rp_id}` response `created_at` | `TBD by human (Integrations, Wed 14:00)` | — | Integrations · Wed 14:00 |
| World | sha256 of that server log line (the nullifier is hashed in the log, never stored in clear) | `TBD by human (Integrations, Wed 14:00)` | — | Integrations · Wed 14:00 |
| eSIM Access | one real order (order no.), refunded with `/esim/cancel` if unused | `TBD by human (Integrations, Wed 14:00)` | — | Integrations · Wed 14:00 |

DataDrop on 296 uses token mode with HTS USDC `0.0.429274` unless the HTS ERC-20 facade misbehaves. In that case it uses
`LEDGER_ONLY` (THREAT-MODEL §6.1 rule 5). Mode chosen: `TBD by human (Integrations, Wed 14:00)`.

## 3. Accounts, inventory and faucet claims

| Item | Detail | Owner · when |
|---|---|---|
| eSIM Access console account | account e-mail domain only; prepaid balance in USD | TBD by human (Integrations, Wed 12:00) |
| MegaeSIM | API docs received? (if not by Wed 12:00 it stays a stub, A-28) | TBD by human (Integrations, Wed 12:00) |
| Pre-bought inventory | 30 India profiles (sealed in `fixtures/inventory.enc`, git-ignored) + 5 retail Airalo/Saily profiles | TBD by human (Integrations, Wed 10:00) |
| Hedera testnet accounts | 3 ECDSA accounts (API/HCS, agent, treasury) + payout; account ids only | TBD by human (Integrations, Wed 14:00) |
| Faucet claims | HBAR (portal.hedera.com), test USDC (faucet.circle.com, "Hedera Testnet"), tGLM (hub.arkiv.network/faucet), Base Sepolia ETH | TBD by human (Integrations, Wed 14:00) |
| World Developer Portal | app (`app_mode: external`), RP, production action | TBD by human (Integrations, Wed 14:00) |
| AgentKit beta | applied? granted? (Agent Pass is claimed only if granted by Thu 21:00) | TBD by human (Founder, Thu 21:00) |
| Free pre-arrival campaign | team-funded, zero price, from Wed 16:00; claim count at kickoff | TBD by human (Founder, Thu 20:59) |

## 4. AI use

From DECISION §7.3, unchanged: *an AI orchestrator wrote most of the pre-kickoff code under human direction and
review, with a red-team pass; in-window commits are authored by the named team members with AI assistance for tests,
fixtures and documentation. Keys were generated on-site and never entered an AI context.*

Concretely, before kickoff: the orchestrator and its builder agents wrote `packages/*`, `services/*`, `apps/*`,
`scripts/*` and the documents under `docs/`. A separate red-team agent wrote `security/redteam/**` and every
`test/attack/**`/`test/redteam/**` file (findings RT-C-01…07 fixed, RT-O-01…09 being fixed). The human team chose the
idea, ratified the committee decision, directed the waves, and does every on-site, key-holding and vendor-facing action
in `docs/ONSITE-RUNBOOK.md`. The AI never had network access to a vendor or testnet (`docs/ENVIRONMENT-CONSTRAINTS.md`).

## 5. Eligibility answers (DECISION §7.4; asked at kickoff, answered here and in the README by Fri 06:00)

| Asked of | Question | Answer |
|---|---|---|
| ETHGlobal staff | "Our repository was created on 3 Nov with documented pre-existing work and a dated tag; is it an eligible Continuity base?" (if no → DECISION §7.5) | TBD by human (Founder, Thu 21:30) |
| Hedera devrel | "We have had an x402 endpoint settling on Hedera testnet and a pool contract on Hedera EVM since 4 Nov. Are Continuity entries eligible for the x402 track, or only for the Continuity prize? Would you fund a 100-claim testnet campaign from your account this weekend?" | TBD by human (Founder, Thu 21:30) |
| World devrel | "Is [Cont] Best IDKit Use Case the right submission for us, and may we also be considered for Best Use of IDKit? Can we get AgentKit beta access before Saturday?" | TBD by human (Founder, Thu 21:30) |
| Arkiv devrel | "Continuity ($4k) or from-scratch ($3k/$1k): which lane do you want a project with one pre-kickoff entity in? Does a 60-second cached read on the hot path count as reading from Arkiv when every window boundary and the agent query live? Swarm gateway access for the bonus?" | TBD by human (Founder, Thu 21:30) |
| ENS (only if a swap becomes likely) | "Which Mumbai track fits gifting-by-name and sponsor subnames?" | TBD by human (Founder, Fri 06:00) |

## 6. What changed in the window

See [`CHANGELOG.md`](CHANGELOG.md): one dated section per day from Thu 5 Nov 21:00 IST. Each line has the time, the
author, the package, the sponsor and the commit hash. At submission, the final table there ("pre-kickoff vs in-window
lines per sponsor path") is generated with `git diff --stat v0-prekickoff..HEAD -- <paths>`. It is the evidence for the
≥ 70 %-in-window rule per integration (DECISION §7.2 constraint 2).
