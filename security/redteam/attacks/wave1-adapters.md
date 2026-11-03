# Wave 1 attack script — `@ethglobal/adapters` (ports, mocks, `./live` with fixtures, `./testing`)

**Run the moment wave 1 lands.** Interface: `docs/INTERFACES.md` §3 (ports and factory), §3.3 (`live/` classes), §3.4 (testing helpers and the `describe*` contract suites), §10 (fixture catalogue). Threats: T-15, T-19, T-24, T-35…T-44, T-71 (treasury port), T-75 (facilitator), T-78 (Hedera scheme). Live adapters are tested **only** through `fixtureFetch` (INTERFACES §3.4: throws `FixtureMiss` on an unmatched request, so request shapes are asserted) — the sandbox cannot reach any sponsor host (`docs/ENVIRONMENT-CONSTRAINTS.md`). Say in the report which fixtures are `recordedAt: <Wed>` and which are reconstructions (`[verify Wed]`). Tests land in `packages/adapters/test/attack/*.attack.test.ts` (mocks, suites) and `packages/adapters/test/live/*.contract.test.ts`; hostile cases the red team adds to the shared `describe*` suites run against **every** implementation of a port.

```sh
pnpm --filter @ethglobal/adapters test -- --run --reporter=verbose
```

## L1 — Ledger expiry boundary, skewed clocks, `update` semantics (T-35)

Add to `describeLedger` so `InMemoryLedger` and `ArkivLedger` (fixture-backed) both run it:

```ts
it('an entity is dead at exactly expiresAt', async () => {
  const { ledger, clock } = await make(); const { key, expiresAt } = await ledger.put({ payload: 'x', expiresIn: 60 });
  expect(expiresAt).toBe(clock.now() + 60_000);
  clock.advance(59_999); expect(await ledger.get(key)).not.toBeNull();
  clock.advance(1);      expect(await ledger.get(key)).toBeNull();
});
it('update without expiresIn keeps the lifetime; with expiresIn resets it from now', async () => {
  const { ledger, clock } = await make(); const { key } = await ledger.put({ payload: 'a', expiresIn: 60 });
  clock.advance(30_000); const r1 = await ledger.update(key, { payload: 'b' }); expect(r1.expiresAt).toBe(clock.now() + 30_000);
  const r2 = await ledger.update(r1.key, { payload: 'c' }, 60); expect(r2.expiresAt).toBe(clock.now() + 60_000);
});
it('update on an expired or unknown key throws not_found and never resurrects', async () => {
  const { ledger, clock } = await make(); const { key } = await ledger.put({ payload: 'a', expiresIn: 1 }); clock.advance(1_001);
  await expect(ledger.update(key, { payload: 'z' }, 60)).rejects.toMatchObject({ code: 'not_found' }); expect(await ledger.get(key)).toBeNull();
});
it('expiresIn must be a positive integer (0, −1, 1.5, NaN rejected)', …);
```

Reader side (octroi's `EntitlementStore.getByKey`, `wave1-octroi.md` S): dead if **either** the ledger no longer returns it **or** `annotations.expiresAt < now`. Skew test: ledger clock at `T0`, server clock at `T0 + 60 s`; an entity with `expiresIn 90` and `annotations.expiresAt = T0 + 90 s` is alive to the store until the server clock passes `T0 + 90 s` (29 s before the ledger drops it) — assert the store's answer flips on the **earlier** of the two.

## L2 — `ArkivLedger` BTL conversion (T-35)

`new ArkivLedger({ client, blockTimeMs: 2000, now })`: `put({ expiresIn: 604_800 })` sends `btl = 302_400` blocks; `blockTimeMs: 2100` ⇒ `288_000` (rounded **up**, `Math.ceil`); `blockTimeMs ≤ 0` throws at construction; the returned `expiresAt` derives from the chain head in the fixture (`fixtures/arkiv/create.json`), not `Date.now()`; `impliedDriftSec` is logged via the injected logger. `update` maps to the SDK's update call and returns the **new** entity key (INTERFACES §3.1: "the returned key may differ; callers re-index by `ANN.key`") — assert the store re-queries by annotation afterwards (S-series). `fixtures/arkiv/expired.json`: `get` of an expired entity ⇒ `null`, not a throw. Kaolin's real block time is unknown until Wednesday: the test proves arithmetic, the report says so.

## L3 — Query semantics are AND-equality and bounded

`describeLedger`: `query({ annotations: { type: 'entitlement', key } })` matches only entities with **both**; numeric vs string annotation values are not coerced (`expiresAt: 1` ≠ `'1'`); `limit` honoured; a query with no annotations on a ledger of 10 000 entities does not time out (`InMemoryLedger`) — and the stores never issue one (grep `query({})` outside tests ⇒ finding).

## L4 — Key space (T-36; INTERFACES D-2)

`InMemoryLedger` keeps minting `ent_000001…` **by design** — entity keys are the ledger's. The attack is on anything that looks an entity up by **user-supplied** string:

```ts
it('stores look up logical keys by annotation, never by ledger.get(userInput)', async () => {
  const l = new InMemoryLedger(); const store = new EntitlementStore(l, () => T0);
  await store.create(entitlement({ key: 'ent:v1:' + 'a'.repeat(64) }));
  expect(await store.getByKey('ent_000001')).toBeNull();                          // an entity key is not a logical key
  expect((await store.getByKey('ent:v1:' + 'a'.repeat(64)))?.payload.key).toBe('ent:v1:' + 'a'.repeat(64));
});
it('two entities with the same logical key: the store treats the newest as truth and reports the duplicate', …);   // or create() throws key_exists — record which
it('logical keys are unguessable: ent:v1:<64 hex>, paid:<addr>:<0x32 bytes>, giftent:<0x32 bytes>; serials are the only short public ids', …);
```

`grep -rn "ledger.get(" packages/octroi/src services/api/src` — every hit must be on a key the service itself obtained from a `put`/`query`, never from a request. `/me/:key` with an entity key ⇒ 404 is a wave-2 test.

## L5 — Public-ledger content allow-list (T-37)

Build one of each entity through the **stores** (`EntitlementStore.create`, `GiftStore.create`, `CampaignStore.put`, `ReceiptStore.add`, `AgentPolicyStore.put`, `NonceStore.consume`) with worst-case inputs (a real-looking ICCID, a PIN, a nullifier in a `name` field, an LPA in `message`), dump `ledger.query({})` and `MockConsensusLog.messages(topic)` to JSON and run:

```sh
security/redteam/tools/scan.sh /tmp/ledger-dump.json /tmp/hcs-dump.json
```

Zero hits. Then by schema: every payload parses with its INTERFACES §1.4 schema; `entitlement` carries `iccidHash`/`iccidEnc` and never `iccid`; `gift` carries `pinKey` and never `pin`; `receipt` carries `entitlementKeyHash` and never the key; `campaign` has no `paused/budget/spent` (on-chain only); annotations ⊆ `ANN`. `docs/arkiv.schema.json` (generated by `scripts/gen-arkiv-schema.ts`) matches `pnpm gen:arkiv-schema --check`. A field outside the schema that reaches the ledger is High; a schema that *allows* `iccid` is High.

## L6 — `WorldCloudPersonhood` and the mock's two gaps (T-19, T-22, T-24, T-38)

`new WorldCloudPersonhood({ appId: 'app_test', fetch: fixtureFetch('world/verify-ok.json', { strictBody: true }) })`. Request: `POST https://developer.worldcoin.org/api/v2/verify/app_test`, body exactly `{ proof, merkle_root, nullifier_hash, verification_level, action, signal_hash }` with `signal_hash` = `hashToField(signal)` from `fixtures/world/hash-to-field-vectors.json` (if the vector file is a reconstruction, the report says "signal_hash unverified until Wed" — a mismatch fails every live verification).

| Fixture | Expected |
|---|---|
| `verify-ok.json` answering `verification_level: 'device'` while the request said `orb` | result `level: 'device'` (response wins — T-22) |
| `verify-max-verifications.json` (`400 max_verifications_reached`) | `AdapterError('personhood', 'already_verified')` ⇒ `replay` via `ADAPTER_CODE_MAP` |
| `verify-invalid-proof.json` | `AdapterError('personhood', 'invalid_proof')` |
| `verify-malformed.json` (200 without `success`) | `AdapterError('personhood', 'invalid_response')` — never success |
| timeout / network error | `AdapterError('personhood', 'unavailable')` |
| a second call, same nullifier, `verify-ok.json` | success — the engine dedups, not the adapter (O1) |

Mock: `new MockPersonhood({ expectSignal: true }).verify(fixtureProof('orb', sigA), { action, signal: sigB })` ⇒ `invalid_proof`; without `expectSignal` the scaffold behaviour; the `maxVerifications` option (THREAT-MODEL §7 item 6) — if absent, note it; `describePersonhood` gains the signal case so the live adapter is held to it too (a fixture proof with the wrong `signal_hash` ⇒ the verifier's `invalid_proof` fixture).

## L7 — Reseller responses, URLs, secrets (T-39)

Fixtures `fixtures/reseller/esimaccess/{plans,order,query,topup,usage,webhook-usage}.json`, `fixtures/reseller/megaesim/*.json`, plus hostile variants the red team adds under `fixtures/reseller/hostile/`:

| Hostile fixture | Expected |
|---|---|
| `order` with `lpa: "javascript:alert(1)"` / `"LPA:1$<img onerror=1>$x"` / `"LPA:1$a b$c"` | `AdapterError('reseller', 'invalid_response')` (`lpaSchema`) |
| `plans` with `data: "1GB"` or bytes | `dataMb` is `mbFromBytes(bytes)` or an explicit catalogue conversion — `1 GB → 1000`, never `1` or `1024` (D-5) |
| `plans` with `wholesaleUsd6: 0n` / negative / missing | rejected or flagged; O6's guard is the second line |
| `plans` name 10 kB / `<script>` | truncated to ≤ 64 chars at the boundary, stored as text |
| `usage` with `usedMb: -5` or `> totalMb`, `asOf` in **seconds** | `invalid_response`; seconds detected (`< 1e11`) and normalised or rejected — "usage as of 1970" is the symptom |
| `order` 200 twice for one idempotency key with different ICCIDs | first wins; second ⇒ `duplicate_order` (L8) |
| `query` returning a profile for a **different** ICCID than asked | `invalid_response` |

URLs: `encodeURIComponent(planId | iccid)` — a `planId` of `../admin?x=1` cannot change the path (assert via `FixtureMiss` details); API credentials go in headers (`RT-AccessCode`/signature for eSIM Access, `x-api-key` for MegaeSIM — whatever the fixture recorded), never in the query string; `JSON.stringify(err)` and `err.message` contain no credential (`scan.sh` the serialized error). `httpJson` timeout 10 s honoured.

## L8 — Webhook verdicts and idempotent orders (T-34, T-40)

`MockReseller.signedWebhook(events, now)` returns `{ body, headers: { 'x-recharge-signature', 'x-recharge-timestamp', 'x-recharge-event-id' } }`. `verifyWebhook(rawBody, headers, now)`:

| Case | Verdict |
|---|---|
| as signed | `{ ok: true, eventId }` |
| same again | `{ ok: false, reason: 'replay' }` (adapter-held cache; TTL 5 min) |
| `x-recharge-timestamp` ± 301 s | `skew` |
| timestamp in ms | `skew` or `bad_signature` — never `ok` |
| body re-serialised (`JSON.stringify(JSON.parse(body))` with a key swapped) | `bad_signature` |
| header missing / signature empty / non-hex | `missing_headers` / `bad_signature`; **never throws** (wrap in `expect(() => …).not.toThrow()`) |
| `parseWebhook(rawBody)` with `usedMb > totalMb` | throws `AdapterError('reseller','invalid_response')` |

`describeReseller` gains: `order(planId, { idempotencyKey: 'k' })` twice ⇒ same `orderId`/`iccid`, `orders()` length 1; two **concurrent** orders with one key ⇒ one profile; `topUp(iccid, 100, { idempotencyKey })` twice ⇒ one `totalMb` increment; `MockReseller` with `failNextOrder: true` throws once then succeeds (used by wave 2's `pending-profile` test). `FallbackReseller(primary, inventory)`: `order` falls back when the primary throws; `usage`/`topUp` **do not** (a top-up on an inventory profile the primary never issued must surface as an error, not silently succeed on the fallback). Live adapters send the vendor's idempotency header from the fixture.

## L9 — `InventoryReseller` (T-41)

`new InventoryReseller({ file: 'fixtures/inventory.enc', sealKey, now })` where the red team generates a test inventory with `scripts/inventory-seal.ts` (or the builder's tool) from `fixtures/inventory.example.json` (`LPA:1$local.test$…` only): `git check-ignore fixtures/inventory.enc` is true; `order()` marks a profile consumed **before** returning (simulate a crash after consume: the next `order` returns a different profile); two concurrent orders ⇒ two distinct profiles; the file never contains `LPA:` in clear (`scan.sh fixtures/`); a wrong `sealKey` fails at construction, not at first order on stage. A plaintext inventory committed anywhere ⇒ **High**.

## L10 — Facilitators (T-15, T-27, T-42, T-75, T-78)

`RemoteFacilitator({ url, fetch: fixtureFetch('facilitator/x402org/…'), allowedHosts: ['x402.org'], networks: ['eip155:84532'] })`:

- `settle-ok.json` ⇒ `{ success: true, transaction: <0x…64>, network: 'eip155:84532', payer }`; a response whose `network` differs from the request ⇒ `success: false, errorReason: 'network_mismatch'`; `success: true` without `transaction` (hostile fixture) ⇒ `errorReason: 'invalid_response'`; `verify-invalid.json` ⇒ `isValid: false`.
- Constructed with `url: 'http://attacker.example/'` ⇒ throws (allow-list); with `url` on an allowed host but a `networks` list not containing the payload's network ⇒ `invalidReason: 'unsupported_scheme'`.
- Hedera: `fixtures/facilitator/hedera/*.json` are `[verify Wed]`; a payload `{ signedTransaction, memo }` given to the **EVM** rail ⇒ `unsupported_scheme` (INTERFACES §3.1); `RoutingPaymentRail({ 'eip155:84532': evm, 'hedera:testnet': hedera })` routes by `accepted.network` and answers `unsupported_scheme` for an unknown network — never throws. T-78: a hostile `settle-ok` whose transfer lists another recipient must not become `success:true` once the mirror-node check exists (live-only; record as "not testable before Wed").

`SelfRunFacilitator({ publicClient, relayer, token, chainId, network, now, perFromRateLimit })` against Anvil (`scripts/dev-chain.sh`; vitest with a viem test client) or a transport stub:
- `verify`: recovered signer ≠ `from` ⇒ `invalid_signature`; `balanceOf(from) < value` ⇒ `insufficient_funds`; window codes as E5; `authorizationState` used ⇒ `nonce_already_used`.
- `settle`: waits for the receipt; `status: 'reverted'` ⇒ `success: false`; **front-run** (A15): the authorization already submitted by a third party ⇒ reads `authorizationState` + the `Transfer(from, payTo, value)` log ⇒ `success: true` with that tx hash (T-15). A `success: false` here is a Med finding.
- `perFromRateLimit`: the 11th settle from one `from` in a minute ⇒ `rate_limited`; the relayer simulates first (`createViemRelayer({ simulate: true })`, E4).
- `X402_FACILITATOR=self` is the local default (ARCHITECTURE §7): assert `scripts/e2e-local.sh` does **not** run with `mock` — the e2e must exercise EIP-3009 against `MockUSDC3009` (D-9).

`MockPaymentRail` accepts `signature: '0xabcdef'` by design; `describePaymentRail` passes a `signer` for rails that verify signatures and the suite must include "wrong signer ⇒ invalid" for those.

## L11 — `EnsResolver` normalisation and drift (T-43)

Pure part (no network): `normalize` via viem — `'rаhul.eth'` (Cyrillic а) ⇒ `AdapterError('names', 'invalid_name')`; `'alice​.eth'` ⇒ invalid; `'Alice.ETH '` ⇒ `alice.eth`; `'alice..eth'` ⇒ invalid. Fixture part: `fixtures/ens/resolve-null.json` ⇒ `null` (the API turns it into 404 **before** any 402); `text-avatar.json` ⇒ `getText(name,'avatar')`; mainnet RPC failure ⇒ fallback client; both failing ⇒ `AdapterError('names','unavailable')`, never an unhandled throw. `MockNameResolver` lower-cases only — acceptable for the mock, but `describeNameResolver` must carry the homoglyph case so the live adapter is held to it.

## L12 — `HcsLog` / `MockConsensusLog` (T-44)

`hcsMessageSchema.parse(JSON.parse(message))` for every message the API/agent would submit (build them with the schema, then mutate): a message > 1024 bytes ⇒ `encode()` throws before `submit`; `ent` is `sha256(entitlementKey)`; no `lpa`, `iccid`, `nullifier`, `pin` key anywhere (`scan.sh`); `read(topic, from)` returns strictly increasing `sequence`; `HcsLog` maps SDK/mirror errors to `AdapterError('consensus','unavailable')`; `hcs14Uaid(...)` reproduces `fixtures/hcs/hcs14-vector.json` (`[verify Wed]` — say so). `MockConsensusLog.messages(topic)` is the dump source for wave 2.

## L13 — Blob store (Swarm) (T-31)

`MemoryBlobStore.get(unknownRef)` ⇒ `null`; `put` returns a ref the API stores as `sealedRef`; the bytes are exactly `JSON(sealedBoxSchema)` — no ICCID, no entitlement key beside the box (the ref is public on the ledger); `SwarmBlobStore` with `fixtures/swarm/{upload,download}.json`: `POST /bzz` carries the postage batch header, a 413 maps to `AdapterError('blobs','too_large')`; download of a tampered body fails `sealedBoxSchema`.

## L14 — Treasury port (T-71)

`MockTreasury.refund({ network, to, usd6, memo })` returns a deterministic `tx` and appears in `refunds()`; `failNext` makes exactly the next call throw `AdapterError('treasury','unavailable')`; `balanceUsd6(network)` decreases by `usd6`; `RoutingTreasury` with an unknown network ⇒ `AdapterError('treasury','unsupported_network')`, never a transfer on a default rail; `EvmTreasury` encodes an ERC-20 `transfer(to, usd6)` with the **6-decimal** value (`usd6` unchanged, no `parseEther`) and `HederaTreasury` builds a `TransferTransaction` for token `0.0.429274` with `memo ≤ 100` bytes; neither has a method that transfers more than the requested `usd6`. The daily cap is enforced in the API (wave 2), not here — note it.

## L15 — Factory, config, error mapping, secrets

- `createAdapters('local', { personhood: { expectSignal: true }, reseller: { failNextOrder: true } })` wires the options; `createAdapters('live')` throws a message pointing to `@ethglobal/adapters/live`.
- `liveConfigSchema.parse({})` fails **at construction** naming every missing variable (not at 02:00 on stage); `createLiveAdapters` is never constructed by any test in the repo (`grep -rn createLiveAdapters --include='*.test.ts'` ⇒ none).
- Every `AdapterError.code` thrown anywhere in `packages/adapters/src` appears in `ADAPTER_CODE_MAP` (grep `new AdapterError(` → set of codes; diff against the map's keys) — an unmapped code becomes `internal_error` in the API (500 where a 503/401 was due).
- No `fetch(` outside `packages/protocol/src/http.ts` and `src/testing/` (eslint `no-restricted-syntax` from the interfaces workstream; also grep).
- `scan.sh packages/adapters fixtures` clean (the relaxed list applies to mocks/tests/fixtures: `LPA:1$local.test$…` allowed).

## Reporting

Per L-item: test path, result, fixture provenance (`recordedAt` present or `[verify Wed]`), renames. Lead with L4 (lookups by annotation only), L6 (verifier response wins; mock gaps), L7 (`lpaSchema` at the boundary) and L10 (front-run recovery; routing never throws) — the ones that become wave-2 Criticals if missed.
