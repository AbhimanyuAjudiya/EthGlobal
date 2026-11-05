# `@ethglobal/agent` — the Recharge top-up agent

> **When your plan drops below 20 % or expires, your agent buys 100 MB for $0.40 on Hedera, up to $10 a day.**

Every tick (60 s live, 5 s local, ±10 % jitter, one key at a time) the agent:

1. **reads the entitlement** — live: straight from Arkiv through the octroi stores over an `ArkivLedger` pinned to
   `AGENT_LEDGER_WRITER` (R2; T-79). Local: the in-memory ledger lives inside the API process, so the same three reads
   go through `GET /me/:key`, `GET /agent/policy/:key`, `GET /me/:key/receipts`;
2. applies the policy **in code** — `shouldTopUp` from `@ethglobal/octroi` with today's spend (UTC day) and the step
   price computed from `/plans`;
3. buys one step: `GET /esim/topup` → 402 → `fetchWithPayment` (the one 402 loop, `@ethglobal/protocol/x402`) with a
   signer that only accepts allow-listed terms → retry with `PAYMENT-SIGNATURE` → 200 + `PAYMENT-RESPONSE`;
4. writes an HCS `agent-topup` receipt carrying `sha256(key)` and its **HCS-14 UAID** (`consensus.submit(topic, …)`);
5. phrases a notification from numbers only (fixed template; an LLM only if `LLM_PROVIDER=anthropic`).

The agent never writes to the ledger (the API records the receipt from the `X-Agent-Uaid` header) and never imports
`services/api`.

## Run it

```sh
pnpm --filter @ethglobal/agent build
pnpm --filter @ethglobal/agent start -- --once            # one pass, exit 0 (2 if a tick threw, 1 bad config)
pnpm --filter @ethglobal/agent start -- --once --dry-run  # decides and journals "would-buy", signs nothing
pnpm --filter @ethglobal/agent start -- --key <entitlementKey>   # loop on one key
pnpm --filter @ethglobal/agent dev                         # tsx, reads ../../.env
```

Local (`MODE=local`, with `pnpm dev:chain` and the API running):

```sh
AGENT_API_URL=http://127.0.0.1:8787
AGENT_WATCH_KEYS=<entitlementKey>                       # local mode has no "policies by owner" API route
AGENT_PAYTO_ALLOWLIST=eip155:31337|<MockUSDC3009 from deploy/addresses.anvil.json>|<payout = Anvil #1>
AGENT_EVM_RPC_URL=http://127.0.0.1:8545                 # default
# AGENT_EVM_PRIVATE_KEY unset ⇒ Anvil #4: anvilKeys[anvilRoles.agent] from @ethglobal/adapters/testing (MODE=local only)
# AGENT_OWNER unset (local only; required live) ⇒ a policy is followed only if its owner is the entitlement's payer
```

State lives in `AGENT_STATE_DIR` (default `.agent/`, git-ignored): `uaid`, `journal.jsonl` (one line per decision —
the demo screen reads it), `spent.jsonl` (append-only own-spend journal: one line per settled purchase, filed under
its UTC day; `lastExpiryBought` is reduced from it; a pre-journal `state.json` is still read), `triggers/` (one record
per purchase trigger plus its short-lived `.lock`). Nothing there holds a key, a PIN, an LPA or an entitlement key in
clear (only `sha256(key)`).

### Several processes on one `AGENT_STATE_DIR` (RT-G-01..03)

Nothing relies on in-process ordering (`src/lock.ts`, `src/journal.ts`; local POSIX filesystem assumed, not NFS):

- **Per-trigger lock**: `open(triggers/<h>.lock, 'wx')` (O_EXCL) of a file holding `{pid, nonce, at}`, fsynced, then
  re-read to confirm the nonce is ours. Busy ⇒ retry ≤ 3 s, then fail closed (`trigger-in-flight`). A lock whose pid is
  gone or that is ≥ 10 s old is broken by renaming it aside and checking the moved content is the one judged stale
  (otherwise it is linked back); a holder re-checks the lock before it reports success.
- **Claim** (under the lock): read the record; take it only if missing or provably dead (stale `claimed`, `signed`
  past `validBefore`; an unreadable record is in flight until it is 120 s old by mtime). Records are written
  temp → fsync → rename → fsync(dir) and carry the claimant's nonce (`by`).
- **Signed marker**: `markSigned` (under the lock) refuses unless this instance still holds the `claimed` record, and
  is fsynced before the payload leaves — `TermsGuard` only marks a payload paid after it returns, so a lost claim
  means the payload is never sent. `releaseTrigger` removes only our own unsigned claim.
- **Own spend**: one fsynced O_APPEND line per purchase (concurrent appends never lose a line), reduced on read; a
  purchase is never evicted by one on another day. If the newest purchase on file is more than 60 s in the future
  the clock stepped back and the tick skips `clock-behind`.

## Caps and where each one is enforced

| Cap                                                                                         | Where                                                                                                                               | Test                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `maxUsd6PerDay` (UTC day): `spent + step ≤ cap`                                             | `shouldTopUp` (octroi); `spent = max(ledger receipts, the agent's own spent.jsonl)` so receipt lag cannot buy twice — `src/tick.ts` | `tick.test.ts` 24 h loop; `regression/T-30-agent-cap.test.ts` |
| `thresholdMb` (buy at `remaining ≤ threshold`)                                              | `shouldTopUp`                                                                                                                       | `tick.test.ts` 20 % / 21 %                                    |
| `stepMb` (100–300)                                                                          | `topUpPolicySchema` + `shouldTopUp`; the signed amount is `priceUsd6(stepMb, 100, /plans price)`                                    | T-56 "value signed"                                           |
| `paused`                                                                                    | `shouldTopUp` (first check)                                                                                                         | `tick.test.ts`, T-30                                          |
| expiry once per `expiresAt`                                                                 | `shouldTopUp(lastExpiryBought)`; pinned locally **and** sent as `X-Agent-Expiry-Bought`                                             | `tick.test.ts` (O13)                                          |
| `AGENT_PAYTO_ALLOWLIST` `(network, asset, payTo[, feePayer])`                               | `TermsGuard.choose` — `src/buyer.ts`                                                                                                | `regression/T-56-tampered-402.test.ts`                        |
| amount = agent-computed price, exactly                                                      | `TermsGuard.termsField`                                                                                                             | T-56                                                          |
| `AGENT_MAX_USD6_PER_STEP`                                                                   | `Buyer.buy` (before any request) and `TermsGuard`                                                                                   | T-56                                                          |
| EIP-712 domain = token's `readDomain()` and `USDC_EIP712_DOMAIN`                            | `EvmPayer.refusal`                                                                                                                  | `payers-evm.test.ts`, T-56                                    |
| Hedera: fee payer pinned, `maxTimeoutSeconds ≤ 180`, built tx = exactly the agreed two legs | `HederaPayer.refusal` / `#check`                                                                                                    | `payers-hedera.test.ts`                                       |
| wallet balance (≈ one day's cap)                                                            | both payers' `sign()` refuse when `balance < value`                                                                                 | `regression/T-44-agent-receipts.test.ts`                      |
| one signature per trigger (retry, restart, two processes)                                   | `TermsGuard` (once per buy), `.agent/triggers/` claim under an O_EXCL lock + fsynced "signed until validBefore", `inFlight`         | `regression/T-57-retry-double-pay.test.ts`, T-30              |

Prompt-injected strings in the ledger change nothing: the decision path (`tick`, `buyer`, `payers`, `loop`, `reads`)
imports no notifier, LLM or `Inference` module (semgrep `recharge-agent-decision-path-imports-inference` is clean);
the model, if any, receives `NOTIFY_INSTRUCTION + JSON.stringify(NotificationFacts)` (numbers and one enum), gets no
tools, and its output is cut to 140 plain characters and only shown (`regression/T-55-injection-canary.test.ts`).

## Where Hedera lives in the code

- `src/payers/hedera.ts` — `HederaPayer` (alias `HederaAgentKitSigner`): the x402 `hedera:testnet` / `hedera:mainnet`
  exact payload — network, HTS token and `Client` (`createHederaClient`) come from the allow-list's `hedera:*` entry;
  one Hedera network per agent (two is a boot error; none ⇒ no Hedera payer, HCS only) —
  `{ transaction }` from `@x402/hedera/exact/client` (`createClientHederaSigner` + `ExactHederaScheme`), checked with
  `inspectHederaTransaction` before it leaves (fee payer = `extra.feePayer`, one token, two legs, no HBAR, no other ops).
  `AgentKitWallet` / `AgentKitConsensusLog`: the **Hedera Agent Kit 4.2.0** (`HederaAgentAPI` + core account/token/
  consensus plugins, `AgentMode.AUTONOMOUS`) driven by code — `run(ASSOCIATE_TOKEN_TOOL)` once at boot if the mirror
  shows no USDC association, `run(SUBMIT_TOPIC_MESSAGE_TOOL)` for the HCS receipt. No framework toolkit, no tool list
  for a model, no transfer tool (T-84, `regression/T-84-no-llm-tools.test.ts`). Loaded only by a dynamic import in
  the live branch of `src/deps.ts`; never imported in local mode.
- `src/receipts.ts` — the HCS `agent-topup` message (`encodeHcsMessage`, ≤ 1024 bytes, `sha256(key)`, UAID).
- `src/identity.ts` — the HCS-14 UAID: `hcs14Uaid` from `@ethglobal/adapters/live` (conformance-tested in
  `test/identity.test.ts` against a vector recorded from `@hashgraphonline/standards-sdk@0.1.192` `createUaid`), persisted
  to `.agent/uaid`, sent as `X-Agent-Uaid`. `nativeId = <allow-listed hedera network>:<AGENT_HEDERA_ACCOUNT_ID>`
  (`hedera:testnet` when the allow-list names no Hedera entry); in local mode `hedera:testnet:0.0.0`.

HCS-14 skills are integers (A-29) and empty in v0. Human-readable capabilities: _x402 buyer of 100 MB eSIM top-ups;
policy-capped; Hedera USDC (testnet `0.0.429274` or mainnet `0.0.456858`, per the allow-list); HCS receipts._

## Honest mocks

- **Simulated usage** in local mode and in tests (the mock reseller's usage clock); label it on screen.
- **HCS-14 registration minimal**: the UAID is self-issued and computed, not registered in an HCS-14 registry.
- **EVM fallback labelled**: live, the EVM payer pays Base Sepolia only when `AGENT_EVM_PRIVATE_KEY` is set; Hedera is
  preferred whenever the 402 offers an acceptable `hedera:*` entry (the allow-listed network and token).
- Local HCS receipts go to an in-process `MockConsensusLog` (topic `0.0.1001`).

## Tests

`pnpm --filter @ethglobal/agent test` (vitest; `coverage` for the v8 report, thresholds 90 %).

| File                                                                                                                                                                                            | Covers                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `test/tick.test.ts`                                                                                                                                                                             | brief §7 tick names: one step at 20 %, not at 21 %, expiry once per `expiresAt`, 24 h random-usage loop under the cap (crosses one UTC midnight), pause, no policy / wrong owner, dry run, HCS receipt with UAID per purchase, 402 with no acceptable entry (logged field), settlement pending ⇒ no receipt                                                           |
| `test/buyer.test.ts`, `test/payers-evm.test.ts`, `test/payers-hedera.test.ts`, `test/identity.test.ts`, `test/notify.test.ts`, `test/config.test.ts`, `test/loop.test.ts`, `test/state.test.ts` | brief §7 names for each module                                                                                                                                                                                                                                                                                                                                        |
| `test/regression/T-30-agent-cap.test.ts`                                                                                                                                                        | red team AG1 (races, two processes, receipt lag, $8.90 + 300 MB, paused, dry run on both payers)                                                                                                                                                                                                                                                                      |
| `test/regression/T-56-tampered-402.test.ts`                                                                                                                                                     | AG2, every row of the table                                                                                                                                                                                                                                                                                                                                           |
| `test/regression/T-57-retry-double-pay.test.ts`                                                                                                                                                 | AG3 (dropped 200, 502 resend of the same payload, kill/restart, byte-identical Hedera resend)                                                                                                                                                                                                                                                                         |
| `test/regression/T-55-injection-canary.test.ts`                                                                                                                                                 | AG4 (also the brief's `injection.test.ts`)                                                                                                                                                                                                                                                                                                                            |
| `test/regression/T-79-forged-policy.test.ts`                                                                                                                                                    | AG5 (writer-aware `InMemoryLedger.asWriter`)                                                                                                                                                                                                                                                                                                                          |
| `test/regression/T-84-no-llm-tools.test.ts`                                                                                                                                                     | AG6                                                                                                                                                                                                                                                                                                                                                                   |
| `test/regression/T-77-agent-identity.test.ts`, `T-44-agent-receipts.test.ts`                                                                                                                    | AG7, AG8                                                                                                                                                                                                                                                                                                                                                              |
| `test/lock.test.ts`, `test/redteam/rt-agent.test.ts`, `test/regression/T-63-no-test-mnemonic.test.ts`                                                                                           | the O_EXCL lock (stale/dead-pid breaking, restore on lost release), claim ownership on `markSigned`/release, concurrent own-spend appends, torn lines, legacy `state.json`, `clock-behind`; red team wave 2 (two real processes racing 300 triggers / 40 purchases each, clock step, squatted policy); no test mnemonic in `src`                                      |
| `test/integration/local-anvil.test.ts`                                                                                                                                                          | the CLI (`main(['--once'])`, real fetch over TCP, API-backed reads, Anvil #4) against a server speaking the §7 contract that settles on a fresh Anvil with the deployed `MockUSDC3009`: payout +400 000, `AuthorizationUsed` on-chain, HCS message with the UAID, `/me` shows +100 MB; zero purchases above threshold and under `--dry-run`. Skipped without Foundry. |

`test/fake-api.ts` is the Hono fixture (agent brief §6). **TODO(api): point at services/api** — when
`services/api` serves `/plans`, `/me/:key`, `/me/:key/receipts`, `/agent/policy/:key` and `/esim/topup`, swap the one
`const app = createFakeApi(...).app` line in the integration test for the API's `createApp(...)`.

## Decisions that differ from the brief (and why)

- **Env booleans**: INTERFACES §8 has `z.coerce.boolean()`, which makes the documented `AGENT_DRY_RUN=0` _true_; the
  schema parses `1|true|yes` / `0|false|no|''` instead.
- **Threshold idempotency key** is `key:threshold:<mbTotal>` (every settled top-up changes `mbTotal`), not
  `floor(remaining / threshold)`, which would block a legitimate later crossing that lands in an already-used bucket.
  Expiry stays `key:expiry:<expiresAt>`.
- **Local reads go through the API** (`ApiReads`): the in-memory ledger is inside the API process. Live reads are the
  ledger (`LedgerReads` over `ArkivLedger`, read-only client, writer pinned).
- **Live requires the Hedera wallet** (`AGENT_HEDERA_*`): it is both the preferred payer and the HCS submitter.
- **Config additions**: `AGENT_LEDGER_WRITER` (T-79, required live), `AGENT_EVM_RPC_URL`, `AGENT_STATE_DIR`,
  `AGENT_LLM_MODEL` + `ANTHROPIC_API_KEY` (required with `LLM_PROVIDER=anthropic`; no default model id), `ARKIV_CHAIN_ID`,
  `ARKIV_RPC_URL`, `ARKIV_ACCESS_KEY`, `ARKIV_BLOCK_TIME_MS`.
- **Notification template** uses the facts only: `+100 MB · paid by your agent · $0.40 of $10.00 today · 300 MB left`
  (`NotificationFacts` carries no per-purchase price or clock time, and adding keys would widen what an LLM sees).
- `src/notify/` and `src/notifier.ts` hold all phrasing so the decision path stays import-clean for semgrep.

## Dependencies (for the human team)

`pnpm install` is blocked by `minimumReleaseAge` (T-65) for already-pinned young versions; this package was verified
with links into `services/agent/node_modules` (scratchpad `link-agent.sh`), nothing in the repo's security config was
changed. `package.json` declares the catalog versions; `pnpm-lock.yaml` has **no entry for `@ethglobal/agent` yet** —
run `pnpm install` once the gate admits the lockfile. New third-party dependencies: `@hashgraph/hedera-agent-kit@4.2.0`
(published 28 Oct, gate-compliant), `@x402/hedera@2.29.0` and `@hiero-ledger/sdk@2.90.1` (the same copies
`@ethglobal/adapters` already uses; the Agent Kit's peer must resolve to that one SDK copy — `pnpm why @hiero-ledger/sdk`
must show one), `pino`, and dev-only `hono`, `@hono/node-server`.

## On-site checklist to run it live

1. **Hedera account for the agent** (Portal, ECDSA): set `AGENT_HEDERA_ACCOUNT_ID` / `AGENT_HEDERA_PRIVATE_KEY`
   (`PrivateKey.fromStringECDSA`). Fund it with HBAR (fees) and ≈ one day's cap of USDC on the allow-listed network —
   testnet `0.0.429274` from the Circle faucet, or mainnet `0.0.456858` (the boot-time association runs
   automatically for the allow-listed token; the faucet needs it associated first — start the agent once with
   `--once --dry-run`, then fund).
2. **HCS topic**: create one per deployment (`TopicCreateTransaction`, ideally with the agent's key as submit key) and
   set `HCS_TOPIC_ID` (shared with the API). Verify on HashScan that `agent-topup` messages appear.
3. **Allow-list** from the live `/plans` (`paid.accepts`), pinned at install: `hedera:testnet|0.0.429274|<PAYOUT_HEDERA_ACCOUNT>|<facilitator fee payer from /supported, x402.org 0.0.9185802>`
   — or, on mainnet, `hedera:mainnet|0.0.456858|<PAYOUT_HEDERA_ACCOUNT>|<facilitator fee payer>` (the entry's
   network picks the Hedera `Client`, the mirror default `https://mainnet.mirrornode.hedera.com` and the UAID
   `nativeId`; HashScan: `https://hashscan.io/mainnet`). One Hedera network per agent: listing both `hedera:testnet`
   and `hedera:mainnet` is refused at boot. Optionally add
   `eip155:84532|0x036CbD53842c5426634e7929541eC2318f3dCF7e|<PAYOUT_ADDRESS>` with a funded Base Sepolia
   `AGENT_EVM_PRIVATE_KEY` + `AGENT_EVM_RPC_URL`.
4. **Arkiv**: `ARKIV_CHAIN_ID=7794095`, `ARKIV_RPC_URL`, `ARKIV_ACCESS_KEY`, and `AGENT_LEDGER_WRITER` = the API's
   `ARKIV_PRIVATE_KEY` address (the agent needs no Arkiv key; it only reads).
5. **Policy owner** (required live, RT-G-04): `AGENT_OWNER` = the wallet that signs this user's `PUT /agent/policy`;
   any policy owned by someone else is skipped `not-mine`. A public Anvil/Hardhat default account (anyone holds its key)
   is refused as the owner in live. **Keys to watch**: `AGENT_WATCH_KEYS`, or every policy
   naming `AGENT_OWNER` (bounded to 50).
6. **UAID**: printed at boot and in `.agent/uaid`; copy it into the README/demo. HCS-14 registry registration is not
   done in v0 — if the team wants it, register this UAID in an HCS-14 registry on-site (standards-sdk) and set
   `AGENT_UAID` to the registered form.
7. `[verify Wed]`: the Agent Kit `SUBMIT_TOPIC_MESSAGE_TOOL` output shape (we parse `raw.transactionId` /
   `raw.topicSequenceNumber`, else the tx id from the text; sequence `0` ⇒ `hcsSequence` omitted), and the facilitator's
   `PAYMENT-RESPONSE.transaction` (`0.0.x@s.n`).
8. Optional LLM phrasing: `LLM_PROVIDER=anthropic`, `AGENT_LLM_MODEL=claude-opus-5-5` (recommended; thinking is adaptive on this model and the phraser requests `effort: "low"`), `ANTHROPIC_API_KEY`. A `refusal` or `max_tokens` stop reason makes the phraser throw and the fixed template is shown instead, so no server-side model fallback is configured.
