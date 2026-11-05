# Build brief — `ops-demo` (wave 3)

**You are building:** the glue that proves the whole product in `MODE=local` and prepares the humans for the live week — `scripts/` (seed, the end-to-end harness, printing, schema generation, design-ban check, fixture recorder, the shared process harness), `fixtures/demo/*`, the hygiene documents every sponsor requires (`docs/DISCLOSURE.md`, `docs/DEMO-SCRIPT.md`, `docs/arkiv.schema.json`, `docs/ARKIV_FEEDBACK.md`, `docs/SWARM.md`, `docs/CHANGELOG.md`), the README skeleton with one section per sponsor, the CI additions, and the human on-site checklist by day. `docs/THREAT-MODEL.md` already exists (red team); you reference it and keep its companion paths real.

**Read first:** this brief; `docs/INTERFACES.md` §1.1 (keys, TTLs), §1.4 (entities), §6.3 (artefacts), §7 (HTTP contract), §10 (fixture catalogue), §11 (env), §14; `docs/ARCHITECTURE.md` §2 (flows you drive), §5, §7, §10; `docs/BUILD-PLAN.md` §4 (the integration test you own); `research/committee/DECISION.md` §4 (hygiene artefacts per sponsor and the Fri 06:00 gates), §6.5, §6.6, **§6.7 (the human checklist, reproduced in §7 below)**, §7.3 (the disclosure text, verbatim), §8.6 (video hooks); `research/sponsors.md` (Hedera, World, Arkiv, ENS requirements); `research/design-references.md` §3 (coupon print spec); `docs/ENVIRONMENT-CONSTRAINTS.md`; `docs/vendor/API-FACTS.md` (vendor facts; its "Known unknowns to verify on-site" list feeds §7) and INTERFACES §13 A-18…A-30; the scaffold `scripts/{dev-chain.sh,check-tools.sh}`, `.github/workflows/ci.yml`, `README.md`.

---

## 1. Files

```
scripts/lib/harness.ts            // startAnvil(), deployContracts(), startApi(env), startAgent(env), startWeb(), waitForPort(), stopAll(); reads deploy/addresses.anvil.json; shared by every script (ARCHITECTURE §8 rule 13)
scripts/lib/clients.ts            // api client (httpJson + schemas), viem clients for Anvil roles, a signer per anvilRole — test-only glue, no business logic
scripts/demo-seed.ts              // §2
scripts/e2e-local.sh              // §3 — the integration test; flags --web (adds Playwright), --keep (leave the stack up), --redteam (runs scripts/redteam/*)
scripts/e2e-flow.ts               // the TypeScript body of §3 steps 6–18 (called by e2e-local.sh; exits non-zero on the first failed assertion)
scripts/print-cards.ts            // §4
scripts/gen-arkiv-schema.ts       // z.toJSONSchema over the entity schemas → docs/arkiv.schema.json; `pnpm schema:check` diffs
scripts/check-forbidden.sh        // BUILD-PLAN §5.3 greps (v1 x402 names, @hashgraph/sdk, Kaolin, IDKit v2 paths, literal "USD Coin" outside protocol); exit 1 on a hit; CI job `forbidden`
scripts/check-design-bans.sh      // greps apps/web and packages/ui for the ban list (web.md §8); exit 1 on a hit; allow-list file scripts/design-bans.allow
scripts/record-fixture.ts         // humans, Wed: wraps fetch, runs one adapter call, appends redacted exchanges to fixtures/<path> with "source":"live"; redacts Authorization, RT-AccessCode, RT-Signature, rp_context.signature, WORLD_RP_SIGNING_KEY, the Arkiv access-key path segment, every LPA: string
scripts/dump-ledger.ts            // dumps every live entity + HCS message of the local stack to .e2e/ledger-dump.json for the red team's forbidden-pattern scan
scripts/redteam/README.md         // how the attack scripts in security/redteam/attacks map to `pnpm redteam` (the red team writes the scripts; you provide the runner)
scripts/redteam/run.ts            // runs every security/redteam/attacks/*.ts against the local stack; an attack that SUCCEEDS exits non-zero
fixtures/demo/campaign.json       // the demo sponsor campaign (off-chain fields) — "Recharge (demo sponsor)" unless a real sponsor funds one Thursday
fixtures/demo/entitlements.json   // three: a free Orb entitlement at 60 %, a paid one at 18 % (agent trigger), one with expiresIn 90 s (dies on screen)
fixtures/demo/gift.json           // one open gift to bob.eth (1 GB) + its PIN (local only)
fixtures/demo/cards.json          // ten campaign-funded cards: serial, pin (local only), mb
docs/DISCLOSURE.md                // §5.1
docs/DEMO-SCRIPT.md               // §5.2
docs/arkiv.schema.json            // generated
docs/ARKIV_FEEDBACK.md            // §5.3
docs/SWARM.md                     // §5.4
docs/CHANGELOG.md                 // §6 conventions + the v0 entries
README.md                         // §5.5 skeleton: one sentence, mechanism sentence, per-sponsor sections, prior art, continuity disclosure, revenue section placeholder
.github/workflows/ci.yml          // + jobs: e2e-local (anvil + api + agent + flow), playwright (--web), slither, abi:check, openapi:check, schema:check, design-bans, redteam (allowed to be `continue-on-error: false` once wave 3 lands)
package.json (root)               // scripts: demo:seed, e2e:local, e2e:web, print:cards, schema:gen, schema:check, check:design, redteam, record:fixture
```

## 2. `scripts/demo-seed.ts` — the state every demo and test starts from

Idempotent (`--reset` wipes `.e2e/` and re-seeds). Against a running local stack:
1. **Chain:** from `anvilRoles.sponsor` approve `MockUSDC3009` and `DataDrop.createCampaign(id, budget = 1_000_000_000 (1,000 USDC), pricePerClaim = 500_000, claimsPerHour = 120, expiresAt = now + 14 d)`; `id = keccak256(sponsor ‖ 'Recharge (demo sponsor)' ‖ 'seed')`. Print the tx hashes.
2. **Ledger campaign:** `POST /sponsor` with a `SponsorLogin` signature by the sponsor role; `campaign.json` fields (`bundleMb { orb: 300, document: 150, device: 0 }`, `wholesaleUsd6PerGb: 1_140_000`, `idResaleUsd6: 500_000`, `validityDays: 7`, `planId: 'in-300mb-7d'`). Save the returned `auditKey` to `.e2e/audit-key.txt` (local only).
3. **Entitlements (through the API, never by writing the ledger directly):** (a) free Orb claim with `fixtureProof('orb', signal, 'demo-human-1')` → key saved; then a signed mock webhook advancing usage to 60 %; (b) a paid `/esim/provision` by `anvilRoles.human` (demo wallet) with 300 MB, webhook to 82 % used (18 % remaining — the agent's trigger), `PUT /agent/policy { maxUsd6PerDay: 10_000_000, thresholdMb: 60, stepMb: 100, paused: false, topUpOnExpiry: true, expiryLeadS: 1800 }` signed by the human; (c) a free Document claim whose campaign-independent validity is overridden to **90 s** via a seed-only API switch `X-Seed-Validity-S: 90` accepted only when `MODE=local` (document this clearly as a seed hook; it must not exist in live). Save all three keys to `.e2e/keys.json` and print them with the `/plan/<key>` URLs.
4. **Gift:** `POST /gift { name: 'bob.eth', mb: 1000 }` paid by the human → save `giftId`, `serial`, `pin` (local only) to `.e2e/gift.json`.
5. **Cards:** ten `POST /sponsor/:id/cards` … **no such route exists** — cards are seeded by a `MODE=local`-only maintenance route? No: keep the API surface fixed. Cards are created by the seed through the **gift path funded by campaign**: a local-only seed hook `X-Seed-Card-Campaign: <id>` on `POST /gift` that creates `kind:'card', fundedBy:'campaign'` gifts without payment (again `MODE=local` only; the live card run is a human script on Thursday using the sponsor's own funds). Save `cards.json` (serial, pin, mb) for `print-cards.ts`.
6. Write `fixtures/demo/*.json` from what was created (so Playwright and the web mock can rely on the same data) and `.e2e/state.json` with addresses, keys, tx hashes.

## 3. `scripts/e2e-local.sh` — the integration test that proves the whole flow (BUILD-PLAN §4)

Exit non-zero on the first failure; print a one-line PASS/FAIL per step; total target **< 60 s** for steps 1–18 (web steps excluded).
1. `scripts/check-tools.sh`; `pnpm -r build` (skippable with `--no-build`).
2. `startAnvil()` (chain 31337, 1 s blocks) → `deployContracts()` → assert `deploy/addresses.anvil.json` exists and `pnpm --filter @ethglobal/contracts abi:check` passes.
3. `startApi({ MODE: 'local', X402_FACILITATOR: 'self', RESELLER: 'mock', …anvil roles })` → `GET /healthz` ok with `chainId 31337`.
4. `demo-seed.ts --reset`.
5. `startAgent({ AGENT_ONCE: 1, AGENT_WATCH_KEYS: <paid key> })` later at step 12.
6. **Challenge:** `POST /challenge` → nonce MAC-valid; `POST /world/rp-context` → `rpContextSchema`, `expires_at − created_at = 300`; the ledger dump shows **no** nonce entity yet.
7. **Claim:** fresh Orb proof → 201; assert `sealedLpa` present, `claimTx` is a real Anvil receipt with a `Claimed` log, `MockUSDC3009.balanceOf(payout)` += 500 000, entitlement entity exists with `expiresAt ≈ now + 7 d`, HCS mock sequence = previous + 1, `openLpa` with the session secret yields `LPA:1$local.test$…`.
8. **Replay:** same proof again → 409; `Claimed` count unchanged.
9. **Read R1:** `GET /me/:key` → `cached: false`; again → `cached: true`; never contains `sealedLpa`.
10. **402:** `GET /esim/topup?key&mb=100` → 402; `PAYMENT-REQUIRED` decodes; `accepts[0].network == eip155:31337`, `amount == '400000'` (the body contains no `maxAmountRequired`), `accepts[0].extra.name == 'USD Coin'`, `version == '2'`; no ledger write.
11. **Human top-up:** sign EIP-3009 with the human role → 200; `PAYMENT-RESPONSE.success`; the tx hash exists on Anvil and moved 400 000 to `payout`; `mbTotal` += 100; `expiresAt` extended; HCS += 1.
12. **Agent:** run the agent once on the paid key (18 % remaining) → exactly one purchase; `/me` shows `mbTotal` += 100; HCS has an `agent-topup` message with a `uaid:` string; `.agent/journal.jsonl` has one `buy`. Run again → zero purchases (threshold no longer met).
13. **Webhook:** `MockReseller.signedWebhook` → 204 and `mbUsed` updated; invalid HMAC → 401; replay → 409; skew 301 s → 401.
14. **Gift:** `/gift` to `bob.eth` → 402 → pay → 201 with a 16-digit Verhoeff-valid PIN; claim by `GiftClaim` signature from `anvilRoles.payout`?? no — `bob.eth` → Anvil #1 (payout role is also bob in the mock records; use the mock resolver's address and its key) → 201 `giftent:` entitlement; gift state `claimed`.
15. **Card:** `GET /card/:serial` twice → unchanged; `POST /card/redeem` with a seeded PIN → 201 and a second `Claimed` log on the campaign.
16. **Sponsor:** `GET /sponsor/:id` with a `SponsorLogin` → claims list contains only HMAC'd keys (no value equals the fixture nullifier), chain counters match, `expiring` includes the 90-s entitlement.
17. **Expiry:** wait for the 90-s entitlement (or advance via the API's local-only `X-Seed-Clock-Advance-Ms` hook on `/me`? — **no clock hooks on reads**; simply `sleep` until `expiresAt` passes, ≈ 90 s total from seed; the harness runs this step in parallel from the start) → `GET /me/<key>` → 410; the ledger dump no longer lists it.
18. **Reclaim:** a second gift seeded with `claimBy = now + 5 s` (seed hook `X-Seed-Claim-Window-S: 5`, local only) → after 6 s `POST /gift/reclaim` → 200, `MockTreasury.refunds()` has one entry, receipt `gift-reclaim` with a tx; a second reclaim → 409.
19. `dump-ledger.ts` → `.e2e/ledger-dump.json`; grep with `security/redteam/tools/forbidden-patterns.txt` (if present) for `LPA:`, the fixture nullifier, any 16-digit PIN, `PAYMENT-SIGNATURE` values → zero hits. Capture API and agent logs to `.e2e/*.log` and grep the same.
20. `--web`: `startWeb()` → Playwright suite (`apps/web/e2e`). `--redteam`: `scripts/redteam/run.ts`.
21. `stopAll()` unless `--keep`; print the summary table and the elapsed time.

## 4. `scripts/print-cards.ts`

Reads `.e2e/cards.json` (or `--input`), starts the web app if needed, opens `/print/cards?token=<PRINT_TOKEN>` with the PINs supplied to the route through a server-side temp file (`PRINT_CARDS_FILE`, never a public route), renders with Playwright `page.pdf({ preferCSSPageSize: true, printBackground: true })` to `out/cards-<date>.pdf` (N coupon pages + 1 keyline page), asserts the page count, and writes `out/cards-<date>.manifest.json` (serial → mb, **no PINs**). The PDF is a secret: `out/` is git-ignored and the script prints a reminder. Dry run `--count 100` with fake PINs for the Wednesday printer proof.

## 5. Documents (write them; placeholders are allowed only where this brief says `TBD by human`)

### 5.1 `docs/DISCLOSURE.md`
Starts with DECISION §7.3's paragraph **verbatim except one correction**: "one Arkiv entity on Kaolin" reads "one Arkiv entity on the Arkiv rabdi testnet (chain 7794095)" — Kaolin was retired in May 2026 (INTERFACES A-23); a footnote under the block says so and links the A-23 row (the `…` placeholders for the Wednesday hashes are marked `TBD by human (Wed 14:00)`), then tables: pre-kickoff code (packages with commit ranges and the `v0-prekickoff` tag), pre-deployed artefacts (Arkiv entity key on rabdi + `rabdi.explorer.arkiv.network` link, Hedera x402 settlement tx id `0.0.x@s.n` + HashScan link, `DataDrop` address + claim tx on Hedera EVM 296, IDKit 4 verification — `rp_id`, action, `POST /api/v4/verify` response `created_at` and a hash of the log line — `TBD by human`), accounts and inventory (reseller accounts, pre-bought profiles count, faucet claims), AI-use statement (from §7.3), the eligibility answers table (§7.4 questions with `TBD by human (Thu 21:30)`), and a "What changed in the window" pointer to `CHANGELOG.md`.

### 5.2 `docs/DEMO-SCRIPT.md`
Pitch order per DECISION §3 Table A Q-JUDGE-RECHARGE-3 (mechanism first; eSIM second; no price list before minute three); the one image (§8.1); the live steps and their pre-staged tabs (HashScan `Claimed`, Arkiv explorer entity, `/plan`), the 90-second cutover rule to the pre-installed phone, the human Hedera payment by a judge/attendee (said aloud if a team wallet), the agent trigger (expiry or real webhook; "simulated usage" label), the three scratch cards per judge, the Q&A card (prior art: Silent.link, GSpot, Glassbox402; the badge objection; "paid ourselves"; the cache question), the declared teammate roles, and the exact words of every honest-mock label from DECISION §6.6.

### 5.3 `docs/ARKIV_FEEDBACK.md`
Sections: what we built on Arkiv (entity types table from ARCHITECTURE §5.1 with `expiresIn` per type); the **division of truth** sentence (reseller = usage, Arkiv = entitlement, webhook reconciles); the three load-bearing reads with their acceptance tests (`me.test.ts R1`, `tick.test.ts R2`, `gift.test.ts R3`) and the reclaim's absence read; the 60-second cache question for devrel (verbatim DECISION §7.4); **latency table** `TBD by human (Wed 14:00)` with columns op · p50 · p95 · n from `/metrics.json` after the pre-deploy; rabdi block time measured (nominal 2 s) and the expiry rounding note (`expiresIn` seconds → `ExpirationTime.fromSeconds` in whole 2-s blocks, rounded up; 182.5-day maximum; T-35, A-24); SDK feedback bullets (what was awkward: attributes typing, query syntax, update semantics, expiry visibility) — write the ones you hit in `MODE=local` design now, humans add live ones.

### 5.4 `docs/SWARM.md`
What each platform stores (Arkiv: entitlement metadata + `sealedRef`; Swarm: the sealed LPA ciphertext; nothing readable without the buyer's session key), the entity key ↔ Swarm reference pair (`TBD by human` after the first live claim; the local pair from `e2e-local` printed as the format example), the Bee API calls used, the postage batch, and why the blob is public-safe (XChaCha20-Poly1305 to an X25519 key held only by the buyer).

### 5.5 `README.md` skeleton
First line: the one sentence (DECISION §1) verbatim; second: the mechanism sentence; then "How it works" (the flows in five lines), **one section per sponsor** with: what is load-bearing, file paths ("Where Hedera lives in the code": `services/api/src/routes/esim.ts`, `services/api/src/chain.ts`, `packages/contracts/src/DataDrop.sol`, `services/agent/src/payers/hedera.ts`; World: `services/api/src/middleware/octroi.ts`, `packages/octroi/src/decide.ts`, `apps/web/app/verify`; Arkiv: `packages/adapters/src/live/arkiv-ledger.ts`, `packages/octroi/src/store/*`, `docs/arkiv.schema.json`, `docs/ARKIV_FEEDBACK.md`, `docs/SWARM.md`; ENS: `packages/adapters/src/live/ens-resolver.ts`, `services/api/src/routes/gift.ts`), addresses/tx hashes/entity keys/HCS topic/UAID (`TBD by human`), and a video timestamp placeholder; "Prior art" (Silent.link/Bitrefill: no human lane, no on-ledger entitlement, no agent metering, no gifting by name; GSpot; Glassbox402 — the mechanism sentence answers it); "Measured" (attach latency on three devices, Arkiv latency — `TBD`); "Honestly mocked in the demo" (DECISION §6.6 list verbatim); the Continuity disclosure (link to `DISCLOSURE.md`); "Revenue" placeholder whose wording is decided by E1 at Thu 18:00 (DECISION §5.4); how to run (`MODE=local` in five commands; `MODE=live` env list).

## 6. `docs/CHANGELOG.md` conventions

Keep-a-Changelog layout; one `## [v0-prekickoff] — 2026-11-05 20:59 IST` section listing every package with a one-line scope and the authoring note "orchestrator under human direction; red-team pass"; from kickoff, one `## [YYYY-MM-DD]` section per day with `HH:MM IST · <author> · <package> · <what>` lines and the commit hash; every in-window sponsor integration line names the sponsor; the ≥ 70 %-in-window rule per sponsor is evidenced by a final table "pre-kickoff vs in-window lines per sponsor path" generated by `git diff --stat v0-prekickoff..HEAD -- <paths>` at submission.

## 7. Human on-site checklist by day (DECISION §6.7, five roles: Integrations · Provisioning/Agent · Product/PWA · Design/Producer · Sponsor/Sales = Founder)

**Tue 3 Nov (today)** — Founder: commission the legal memo (due Wed 18:00); sponsor one-pager; ≥ 5 devrel meeting requests for Thursday; name the five roles and the ALSA-capable teammate. Integrations: open the **eSIM Access** console account (primary; `accessCode` from console.esimaccess.com/developer; top up balance) and ask MegaeSIM for API docs (no public docs exist — if none by Wed 12:00, it stays a stub, A-28); buy 30 India profiles for the inventory fallback (+5 retail Airalo/Saily as the deepest fallback); record the India wholesale price (E0) into `README.md`; create 3 Hedera testnet **ECDSA** accounts on portal.hedera.com with HBAR, associate each with USDC `0.0.429274`, mint test USDC at faucet.circle.com ("Hedera Testnet"); get an Arkiv access key (hub.arkiv.network/access-keys) and tGLM (hub.arkiv.network/faucet) on **rabdi** — Kaolin is retired; Base Sepolia ETH + Circle USDC; register the World developer-portal app (`app_mode: external`), its **RP** (`rp_id`; the signing key is shown once — straight into the server secret store, never into a chat or an AI context) and a **production** action `recharge-welcome` (**unlimited** uses — T-24); apply for AgentKit beta (World's docs have no "Agent Pass"; ask what the prize text means). Provisioning: confirm an iPhone (iOS 17.4+) and an Android 13+ with eSIM; buy the Dhwani hardware hedge. Design: brief the Hindi/Marathi copy reviewer; order card stock. All: read `docs/THREAT-MODEL.md`.

**Wed 4 Nov** — 10:00 attach test ×3 per device with pre-bought profiles (latency logged; screenshots of the iOS and Android eSIM sheets for `web.md`'s `[screenshot Wed]` strings). 12:00 sandbox order → LPA → install. **14:00 minimal pre-deploy** with the live adapters and `scripts/record-fixture.ts` (the 11 "known unknowns" at the end of `docs/vendor/API-FACTS.md` are the checklist): `curl https://x402.org/facilitator/supported` (and Blocky402's) to pick primary + fallback and record the Hedera fee payer; one Arkiv entity written and read on **rabdi** (7794095); one x402 402→pay→200 on Hedera testnet via the remote facilitator (fixtures recorded: payload `{ transaction }`, `transaction` vs `transactionId` in `PAYMENT-RESPONSE`); `cast call 0x036C… "name()"` on Base Sepolia returns `"USDC"`; one IDKit 4 verification (`/world/rp-context` → World App → `POST /api/v4/verify/{rp_id}`); one real eSIM Access order with the signed `RT-*` headers (capture the real `ac`, `qrCodeUrl`, and one full webhook body + headers; `/esim/cancel` to refund); `DataDrop` deployed on Hedera testnet (`CHAIN=296 forge script …`, `associateHts`, hello campaign, one claim) — hashes into `DISCLOSURE.md`, latency into `ARKIV_FEEDBACK.md`, HCS-14 vector into `fixtures/hcs/`. 16:00 team-funded free pre-arrival campaign live (Telegram post, poster PDF, zero price). **18:00 GATE** — attach test + memo → stay on Recharge or switch to Dhwani (DECISION §1). 19:00 copy review; scratch-card artwork to the printer for a proof (spot colour matched to `#117878`). Evening: Founder confirms Thursday meetings; Integrations rehearses the Thursday-night handshake on the pre-deployed rails.

**Thu 5 Nov** — 09:00 print 200 scratch cards (`print-cards.ts` with real campaign-funded cards; Dhanteras closes printers Friday). 10:00–17:00 sponsor meetings (≥ 5): the drop and the free testnet pilot (E1 at 18:00). 12:00 (only if switched) Dhwani hardware gate. 14:00 dry run of the full loop on the VPS in `MODE=live` against the pre-deployed rails — pipes only. 18:00 E1 verdict → README revenue wording. **20:59 tag `v0-prekickoff`**; snapshot `DISCLOSURE.md`. **21:00 kickoff** — check-in questions to ETHGlobal staff and to Hedera/World/Arkiv devrel (DECISION §7.4), answers into the README by Fri 06:00; attestor/relayer/treasury keys generated on-site; handshake sprint 21:00–02:00: each rail one in-window round-trip (production campaign, claim, provision, Arkiv entity, Hedera settlement by a human).

**Fri 6 Nov (Dhanteras)** — **06:00 swap gate** per sponsor (DECISION §4 table, last column). 06:00–14:00 credential tiering live, Arkiv entitlements and the three reads live, agent live on Hedera. 14:00–20:00 gift/ENS live, sponsor dashboard, webhooks; Security owner runs the key-compromise drill (`setAttestor` + pause in < 5 min, T-01). 20:00 first full live loop on three devices. Design pass starts; Producer drafts per-sponsor README sections; film B-roll (airport/hall "No Service → LTE", scratch, agent notification) — nothing is sold to anyone.

**Sat 7 Nov** — 09:00 scope freeze (AgentKit discount mode, Reloadly only if ahead); 09:00–13:00 three-device rehearsal with cutover rules; 13:00–18:00 design pass complete (dark/light, Hindi), scratch-card redeem flow, print QA; **18:00 partner selection locked** in the dashboard; 18:00–23:00 video ≤ 3:00 (the three hooks, DECISION §8.6), X post, README/CHANGELOG/DISCLOSURE, `arkiv.schema.json`, `ARKIV_FEEDBACK.md` (with Wednesday's numbers), `SWARM.md`; 23:00 pitch dry run ×2 (4 min + the Q&A card).

**Sun 8 Nov (Diwali)** — 06:00 README freeze; 06:30 final rehearsal on venue Wi-Fi and on cellular; 07:30 submission form (three partners, video, repo, live URL, Continuity disclosure); **08:00 submit** (one hour of buffer before 09:00); judging prep: pre-installed phone charged, three scratch cards per judge, HashScan and Arkiv explorer tabs pinned, the teammate who plays the sponsor named as such.

## 8. CI additions (`.github/workflows/ci.yml`)

Keep the existing `checks` job. Add: `e2e-local` (foundry toolchain + `scripts/e2e-local.sh --no-build` after `pnpm -r build`; artefacts `.e2e/*.log`, `ledger-dump.json`), `playwright` (`e2e-local.sh --web`, uploads screenshots on failure; Chromium only), `slither` (`pip install slither-analyzer==0.11.6`; `--fail-medium`), `artefacts` (`abi:check`, `openapi:check`, `schema:check`, `forge snapshot --check`), `design-bans` (`scripts/check-design-bans.sh`), `redteam` (`e2e-local.sh --redteam`; non-blocking until the red team marks it blocking). All with `MODE=local`; no secrets.

## 9. Dependencies on other workstreams

| Needs | From | Until it lands |
|---|---|---|
| contracts (`Deploy.s.sol`, `abi/*`, `addresses.anvil.json`) | wave 1 | — |
| api in `MODE=local` incl. the `MODE=local`-only seed hooks (`X-Seed-Validity-S`, `X-Seed-Claim-Window-S`, `X-Seed-Card-Campaign`) | api (wave 2) — **request them explicitly**; they are refused in live by `env.ts` | seed through the public routes only (no 90-s entity, no cards) and mark steps 15/17/18 pending |
| agent `--once` | agent (wave 2) | step 12 pending |
| web routes and `/print/cards` | web (parallel wave 3) | `--web` and `print-cards.ts` pending; everything else runs |
| `security/redteam/attacks/*.ts`, `tools/forbidden-patterns.txt`, `tools/slither.config.json` | red team | runner exists; step 19 uses a built-in minimal pattern list until theirs lands |

## 10. Acceptance tests

- `scripts/e2e-local.sh` passes end to end in CI in **< 60 s** for steps 1–18 (web excluded) and prints the summary; a deliberately broken assertion (`E2E_FAULT=step7`) makes it exit non-zero (test of the test).
- `demo-seed.ts --reset` twice yields the same `/plans.campaign.id` and three `/plan` URLs; all three keys answer `GET /me/:key` 200.
- `gen-arkiv-schema.ts` output validates every `fixtures/demo/*.json` payload and every entity in `.e2e/ledger-dump.json` against `docs/arkiv.schema.json` (a vitest in `scripts/test/schema.test.ts`); `schema:check` fails when a protocol schema changes without regeneration.
- `print-cards.ts --count 10` produces an 11-page PDF; the manifest has no PINs; `out/` is git-ignored.
- `check-design-bans.sh` fails on a planted `backdrop-filter` and on `oklch(0.6 0.2 270)` and passes on the shipped tree.
- `record-fixture.ts` against a local `fixtureFetch` round trip writes a file that `fixtureFetch` can replay; `LPA:` strings are redacted.
- Every document in §5 exists; `DISCLOSURE.md` contains the §7.3 paragraph verbatim; a markdown-lint pass; every `TBD by human` carries an owner and a time.

## 11. Definition of done

- `pnpm e2e:local` green locally and in CI; `pnpm e2e:web` green once web lands; `pnpm redteam` runs and reports.
- The README skeleton, `DISCLOSURE.md`, `DEMO-SCRIPT.md`, `ARKIV_FEEDBACK.md`, `SWARM.md`, `CHANGELOG.md` committed; `arkiv.schema.json` generated; CI jobs added and green.
- `docs/BUILD-PLAN.md` §4's assertion list is implemented one-to-one in `e2e-flow.ts` (a reviewer ticks them).
- The Wednesday recording procedure is written in `packages/adapters/README.md` → "Record on Wednesday" and in §7 above, with the exact `record-fixture.ts` commands per adapter.

## 12. The three most likely bugs — avoid them

1. **Seeding by writing the ledger directly.** Every seeded object must go through the API (or through `DataDrop` from the sponsor's wallet) so the seed exercises the real paths and the ledger carries only what the API writes; the only exceptions are the three `MODE=local` seed hooks, which must be refused in live (`env.ts`) and documented as such.
2. **Flaky timing.** Anvil mines every second; the 90-s expiry and the 5-s reclaim window are wall-clock. Start the long waits at seed time and poll with deadlines (`waitFor(pred, { timeoutMs, everyMs })`) rather than fixed sleeps; never assert "within 60 s" without measuring and printing the elapsed time.
3. **Leaking secrets through the demo plumbing.** PINs, the audit key and opened LPAs live in `.e2e/` (git-ignored) and the print manifest has no PINs; the ledger dump and the logs are grepped for forbidden patterns on every run; the `fixtures/demo/*.json` committed to the repo carry **no** PINs (`cards.json` in `fixtures/` lists serials and MB only; PINs stay in `.e2e/cards.json`).
