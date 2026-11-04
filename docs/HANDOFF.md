# Recharge — handoff summary (4 Nov 2026, cloud session → local)

**Product:** Recharge — prove you're human and a sponsor pays for your first 300 MB of Mumbai data; after that you, or your agent, pay per 100 MB over x402, every bundle is an Arkiv entity that expires by itself, and anyone can gift data to an ENS name.
**Hackathon:** ETHGlobal Mumbai, 6–8 Nov 2026. Entry: **Continuity, declared** (`docs/DISCLOSURE.md`). Partner programs: **Hedera** (x402 on Hedera $6.5k; Continuity floor), **World** ([Cont] Best IDKit Use Case; Best Use of IDKit if open), **Arkiv** (Continuity or from-scratch + Swarm bonus). ENS integrated, unclaimed (swap-in at the Sat 18:00 freeze if a rail fails).
**Branch / PR:** `claude/ethglobal-mumbai-build` → https://github.com/AbhimanyuAjudiya/EthGlobal/pull/1

## How the decision was made
`research/` holds the sponsor brief, winners analysis (149 finalists / 16 events), market research (13 gaps), design foundations and category references; `research/committee/` holds the 10-member, 3-round debate (12 ideas → 3 v2s → Recharge), `DECISION.md` (every critic question resolved, revenue honesty, runner-up Dhwani behind the Wed 18:00 gate) and `RATIFICATION.md`.

## What is built (all in `MODE=local` on Anvil; live adapters are real code against documented APIs with fixtures)
| Package | What | Tests |
|---|---|---|
| `packages/contracts` | `DataDrop` sponsor pools (scoped ids, hourly cap, pause, refund, LEDGER_ONLY, HTS association), `MockUSDC3009` (EIP-3009, configurable domain), deploy script with chain guards | 210 Foundry (fuzz + invariants), slither clean, gate CLEARED |
| `packages/protocol` | zod schemas, units, ids, x402 v2 codec (conformant with `@x402/core` 2.29.0), typed-data, PIN, HTTP client, errors | 330 |
| `packages/crypto` | sealed LPA delivery, HMAC, webhook signatures | 30 |
| `packages/eip3009` | typed data, recover, calldata, relayer; Circle vectors | 68 |
| `packages/octroi` | proof-or-pay engine: credential-tiered sizing, challenges, claim locks, settlement markers, CAS stores, top-up policy, gift reclaim | 412 (100% coverage) |
| `packages/adapters` | ports + mocks + live: Arkiv (rabdi), World v4 verify, x402 facilitators (remote + self-run), eSIM Access, inventory, HCS, ENS, Swarm, treasury | 322 |
| `packages/ui` | Coupon, ScratchCard, MbMeter, BoardingPass, OnchainAction (8 states), Receipt, PrintSheet…; design-ban CI grep | 172 |
| `services/api` | all INTERFACES §7 routes, x402 + octroi middleware, OpenAPI from zod, sponsor cards minting | 388 |
| `services/agent` | Hedera Agent Kit / EVM payer, HCS receipts with UAID, file locks, spend journal | 180 |
| `apps/web` | PWA + sponsor console + print route; nonce CSP; hi/mr; offline shell | 50 unit + 42 Playwright |
| `apps/video` | Remotion: 4 shorts + judge video from real PWA captures (`marketing/videos/renders/index.json`) | 24 |
| `scripts/` | demo-seed, demo, e2e-local (seed → agent → flow I-0…I-18 → log scan, ~22 s), print-cards, record-fixture, refresh-lockfile | 94 |

Run it: `bash scripts/e2e-local.sh` · `pnpm demo -- --web` · `pnpm redteam` · see `README.md`, `docs/ONSITE-RUNBOOK.md`, `docs/DEMO-SCRIPT.md`, `docs/BUILD-PLAN.md`, `docs/INTERFACES.md` (§13 amendments A-1…A-43).

## Security
Threat model: `docs/THREAT-MODEL.md` (86 threats). Red team ran after every wave: 65 findings filed (`security/redteam/findings/INDEX.md`); 36 verified by an independent re-attack, 12 web findings fixed, 10 reopened by variants and being fixed now (RT-O-01 High: `/me` cache keyed by ledger index; RT-O-03, RT-O-08, RT-A-05, RT-A-07, RT-A-08, RT-A-09, RT-G-04, RT-P-08, RT-P-12), RT-P-04 acknowledged (lockfile), RT-W-05 half open (Anvil CORS). Gates: `security/redteam/run-wave.sh {1,2,wave3-ops,wave3-web,all}`.

## Known limits (say them out loud)
- No testnet or vendor host was reachable from the build sandbox: every live adapter is untested against the real service until the Wednesday pre-deploy; 12 fixtures to record (`packages/adapters/README.md`).
- `pnpm install --frozen-lockfile` fails until ~14:00 IST Thu 5 Nov (3-day `minimumReleaseAge`); then run `bash scripts/refresh-lockfile.sh` and commit the lockfile.
- Android cannot install an eSIM from a web page (copy-code + Settings path); iOS universal link may need a second tap.
- Revenue: base ≈ $2.4k/week, not $10k; the testable hinge is a sponsor data-drop sale (E1 Thu 18:00).

## Human checklist (today → Sunday): `docs/ONSITE-RUNBOOK.md`; decision gates in `research/committee/DECISION.md` §6.7 and §4.
