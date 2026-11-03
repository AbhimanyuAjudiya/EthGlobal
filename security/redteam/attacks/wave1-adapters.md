# Wave 1 attack script — `@ethglobal/adapters` (ports, mocks, `./live` with fixtures, `./testing`)

**Run the moment wave 1 lands.** Interface: `docs/INTERFACES.md` §3 (ports and factory), §3.3 (`live/` classes), §3.4 (testing helpers and the `describe*` contract suites), §10 (fixture catalogue). Threats: T-15, T-19, T-24, T-35…T-44, T-71 (treasury port), T-75 (facilitator), T-78 (Hedera scheme), T-79 (Arkiv forgery), T-80 (World environment), T-82/T-83 (eSIM Access). Vendor shapes are `docs/vendor/API-FACTS.md` as adopted by INTERFACES A-18…A-30 — a live adapter written against anything else (Kaolin, BTL, `/api/v2/verify`, `signedTransaction`, `@hashgraph/sdk`, signed eSIM Access webhooks) is a finding, not a rename. Live adapters are tested **only** through `fixtureFetch` (INTERFACES §3.4: throws `FixtureMiss` on an unmatched request, so request shapes are asserted) — the sandbox cannot reach any sponsor host (`docs/ENVIRONMENT-CONSTRAINTS.md`). Say in the report which fixtures are `recordedAt: <Wed>` and which are reconstructions (`[verify Wed]`). Tests land in `packages/adapters/test/attack/*.attack.test.ts` (mocks, suites) and `packages/adapters/test/live/*.contract.test.ts`; hostile cases the red team adds to the shared `describe*` suites run against **every** implementation of a port.

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

## L2 — `ArkivLedger` expiry mapping (T-35; INTERFACES A-24; SDK `@arkiv-network/sdk@1.0.1` on rabdi 7794095)

`new ArkivLedger({ client, now })` over the fake `ArkivClientLike`: `put({ expiresIn: 604_800 })` calls `createEntity(schema, values, { expiration: ExpirationTime.fromSeconds(604_800) })`; `expiresIn: 601` ⇒ `fromSeconds(602)` (whole 2-s blocks, rounded **up** — never `fromSeconds(601)`, which the SDK rejects, and never 600); `expiresIn: 1` ⇒ `fromSeconds(2)`; `expiresIn: 7_884_000 × 2 + 1` ⇒ `AdapterError('ledger','invalid_request')` **before** any RPC (the chain would revert `ExpiryBeyondMaxLifetime`); no `btl`/`expiresIn` key ever reaches the SDK call (spy on the fake); `flags.permissionlessExtension` is absent or `false` on every create (T-79 f); the returned `expiresAt` derives from the entity's `$expiresAt` **block number** and the chain head in the fixture (`fixtures/arkiv/create.json`), not `Date.now()`; chain id in config ≠ 7794095 (or 7738577 when explicitly configured for tiramisu) ⇒ construction fails, and `60138453025` (Kaolin, retired) ⇒ construction fails with a message naming A-23; `impliedDriftSec` is logged via the injected logger. `update` maps to the SDK's update call and returns the **new** entity key (INTERFACES §3.1: "the returned key may differ; callers re-index by `ANN.key`") — assert the store re-queries by annotation afterwards (S-series). `fixtures/arkiv/expired.json`: `get` of an expired entity ⇒ `null`, not a throw. rabdi's real block time (nominal 2 s) is measured on Wednesday: the test proves arithmetic, the report says so.

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

Zero hits. Then by schema: every payload parses with its INTERFACES §1.4 schema; `entitlement` carries `iccidHash`/`iccidEnc` and never `iccid`; `gift` carries `pinKey` and never `pin`; `receipt` carries `entitlementKeyHash` and never the key; `campaign` has no `paused/budget/spent` (on-chain only); annotations ⊆ `ANN`. `docs/arkiv.schema.json` (generated by `scripts/gen-arkiv-schema.ts`) matches `pnpm gen:arkiv-schema --check`. A field outside the schema that reaches the ledger is High; a schema that _allows_ `iccid` is High.

## L6 — `WorldCloudPersonhood` (IDKit 4 / v4 verify) and the mock's gaps (T-19, T-22, T-24, T-38, T-80)

`new WorldCloudPersonhood({ rpId: 'rp_test', environment: 'production', action: WORLD_ACTION, fetch: fixtureFetch('world/verify-ok.json', { strictBody: true }) })`. Request (INTERFACES A-25, API-FACTS §4.4): `POST https://developer.world.org/api/v4/verify/rp_test`, body = the IDKit 4 result **byte-for-byte unchanged** (strictBody compares canonical JSON with the input proof; any added/removed key ⇒ `FixtureMiss`). After the response: `success === true`, **every** `results[].success`, `action === WORLD_ACTION`, `environment === 'production'`, every `responses[].signal_hash === hashToField(signal)` (vectors from API-FACTS §4.2: `hashToField("") = 0x00c5d246…85a4`, `"test_signal" → 0x00c1636e…12ed`, `"hello" → 0x001c8aff…6dea`), nullifier decimal → hex32 (`BigInt(n).toString(16).padStart(64,'0')`; a value ≥ 2²⁵⁶ ⇒ `invalid_response`).

| Fixture                                                                                                                       | Expected                                                                                                                   |
| ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `verify-ok.json` whose `results[0].identifier` is the device credential while the forwarded proof claims `proof_of_human`     | result `level: 'device'` (response wins — T-22)                                                                            |
| `verify-staging.json` (`environment: "staging"`, a simulator proof)                                                           | `AdapterError('personhood', 'invalid_proof')` — **Critical** if accepted (T-80)                                            |
| `verify-other-action.json` (`action: "some-other-action"`)                                                                    | `invalid_proof`                                                                                                            |
| `verify-partial.json` (`success: true`, one of two `results[]` with `success: false`)                                         | `invalid_proof` — never success                                                                                            |
| `verify-signal-mismatch.json` (valid, but `signal_hash` of another challenge)                                                 | `invalid_proof` (the Portal does not know our signal; the adapter must check, T-19)                                        |
| `verify-nullifier-replayed.json` (`400 nullifier_replayed`) and `verify-max-verifications.json` (`max_verifications_reached`) | `AdapterError('personhood', 'already_verified')` ⇒ `replay` via `ADAPTER_CODE_MAP` (and, in the API, T-24's intent lookup) |
| `verify-app-not-migrated.json` (`400 app_not_migrated`)                                                                       | `AdapterError('personhood', 'unavailable')` with the code in details — an operator problem, not the human's                |
| `verify-invalid-proof.json`                                                                                                   | `AdapterError('personhood', 'invalid_proof')`                                                                              |
| `verify-malformed.json` (200 without `success`)                                                                               | `AdapterError('personhood', 'invalid_response')` — never success                                                           |
| timeout / network error                                                                                                       | `AdapterError('personhood', 'unavailable')`                                                                                |
| a second call, same nullifier, `verify-ok.json`                                                                               | success — the engine dedups, not the adapter (O1)                                                                          |

Mock: `new MockPersonhood({ expectSignal: true }).verify(fixtureProof('orb', sigA), { action, signal: sigB })` ⇒ `invalid_proof` (the mock checks `signal_hash` of the IDKit-shaped fixture, A-26); without `expectSignal` the scaffold behaviour; the `maxVerifications` option (THREAT-MODEL §7 item 6; default 1 like IDKit 4) — if absent, note it; `describePersonhood` gains the signal case and the staging case so the live adapter is held to them too.

`createRpContextSigner` (adapters `live/`, wraps `signRequest` from `@worldcoin/idkit-core/signing`): with a test key, `issue()` ⇒ `expires_at − created_at === 300`, `created_at` from the injected clock (never a caller argument), `action === WORLD_ACTION` (a caller-supplied action is ignored or rejected); the signature verifies with the documented algorithm (`0x01 ‖ nonce ‖ created_at u64 BE ‖ expires_at u64 BE ‖ hash_to_field(action)`, EIP-191) — recover the signer and compare with the key's address; two issues ⇒ distinct nonces; `JSON.stringify(signer)` and every thrown error contain no key bytes (`scan.sh` the serialised object) (T-81).

## L7 — Reseller responses, URLs, secrets (T-39)

Fixtures `fixtures/reseller/esimaccess/{plans,order,query,topup,usage,webhook-usage}.json`, `fixtures/reseller/megaesim/*.json`, plus hostile variants the red team adds under `fixtures/reseller/hostile/`:

| Hostile fixture                                                                           | Expected                                                                                                        |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `order` with `lpa: "javascript:alert(1)"` / `"LPA:1$<img onerror=1>$x"` / `"LPA:1$a b$c"` | `AdapterError('reseller', 'invalid_response')` (`lpaSchema`)                                                    |
| `plans` with `data: "1GB"` or bytes                                                       | `dataMb` is `mbFromBytes(bytes)` or an explicit catalogue conversion — `1 GB → 1000`, never `1` or `1024` (D-5) |
| `plans` with `wholesaleUsd6: 0n` / negative / missing                                     | rejected or flagged; O6's guard is the second line                                                              |
| `plans` name 10 kB / `<script>`                                                           | truncated to ≤ 64 chars at the boundary, stored as text                                                         |
| `usage` with `usedMb: -5` or `> totalMb`, `asOf` in **seconds**                           | `invalid_response`; seconds detected (`< 1e11`) and normalised or rejected — "usage as of 1970" is the symptom  |
| `order` 200 twice for one idempotency key with different ICCIDs                           | first wins; second ⇒ `duplicate_order` (L8)                                                                     |
| `query` returning a profile for a **different** ICCID than asked                          | `invalid_response`                                                                                              |

eSIM Access request auth (A-27, API-FACTS §5.1; T-83): every call is `POST https://api.esimaccess.com/api/v1/open/<endpoint>` with `RT-AccessCode`, `RT-Timestamp` (**ms**; a value `< 1e12` is a bug), `RT-RequestID` (fresh uuid per call — two calls ⇒ two ids), `RT-Signature` = lower-case hex HMAC-SHA256(key = accessCode, `timestamp + requestId + accessCode + rawBody`) — recompute it in the test from the recorded headers and the exact body string the adapter sent; the body is the string that was signed (no re-serialisation between signing and sending); `/esim/order` sends `{ transactionId: <idempotencyKey>, packageInfoList: [{ packageCode, count: 1 }] }`; an empty `ac` after polling ⇒ `pending-profile`, never a fabricated LPA; `topUp` resolves `esimTranNo` via `/esim/query { iccid }` first; error codes `101003`/`401001` ⇒ `unauthorized`, `200007` ⇒ `unavailable`, `310402` ⇒ re-query by `transactionId`, never a second order; prices `× 100` ⇒ Usd6 (`18000` ⇒ `1_800_000n`), volumes bytes ⇒ MB. `MegaEsimReseller` (A-28) throws `unavailable` on every call and `liveConfigSchema` refuses `RESELLER=megaesim`. URLs: the endpoint is a constant, never built from `planId`/`iccid` (those go in the JSON body); API credentials only in headers, never in the query string or body; `JSON.stringify(err)` and `err.message` contain no `accessCode` and no `RT-Signature` (`scan.sh` the serialised error). 8 req/s client limiter (the 9th call in one second waits). `httpJson` timeout 10 s honoured.

## L8 — Webhook verdicts and idempotent orders (T-34, T-40)

`MockReseller.signedWebhook(events, now)` returns `{ body, headers: { 'x-recharge-signature', 'x-recharge-timestamp', 'x-recharge-event-id' } }`. `verifyWebhook(rawBody, headers, now)`:

| Case                                                                       | Verdict                                                                                         |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| as signed                                                                  | `{ ok: true, eventId }`                                                                         |
| same again                                                                 | `{ ok: false, reason: 'replay' }` (adapter-held cache; TTL 5 min)                               |
| `x-recharge-timestamp` ± 301 s                                             | `skew`                                                                                          |
| timestamp in ms                                                            | `skew` or `bad_signature` — never `ok`                                                          |
| body re-serialised (`JSON.stringify(JSON.parse(body))` with a key swapped) | `bad_signature`                                                                                 |
| header missing / signature empty / non-hex                                 | `missing_headers` / `bad_signature`; **never throws** (wrap in `expect(() => …).not.toThrow()`) |
| `parseWebhook(rawBody)` with `usedMb > totalMb`                            | throws `AdapterError('reseller','invalid_response')`                                            |

**eSIM Access webhooks are unsigned (T-82, A-27).** `EsimAccessReseller.verifyWebhook(rawBody, headers, now)` where the route has set `x-recharge-url-token` (from `?token=`) and `x-recharge-remote-ip`:

| Case                                                                      | Verdict                                                                                                                                                                                      |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| token == `ESIMACCESS_WEBHOOK_TOKEN`, IP in the five documented sender IPs | `{ ok: true, eventId: sha256(rawBody) }`                                                                                                                                                     |
| same body again within 5 min                                              | `replay`                                                                                                                                                                                     |
| token wrong / missing / one char shorter / differs only in case           | `bad_signature` / `missing_headers`; compare is constant-time (no early return — inspect the code)                                                                                           |
| IP `10.0.0.1` or absent                                                   | `bad_signature`                                                                                                                                                                              |
| body with `RT-*` headers that "look signed" but a wrong token             | still `bad_signature` (the adapter must not accept a forged `RT-Signature` as authentication)                                                                                                |
| `parseWebhook` of `ESIM_STATUS` / `DATA_USAGE`                            | events are **hints** with `iccid` only — the numbers in the body (`orderUsage`, `remain`, `totalVolume`) are not exposed as `usedMb`/`totalMb` (the API re-reads `usage(iccid)`, wave 2 AP3) |
| `ORDER_STATUS` (no ICCID)                                                 | a hint with `orderNo`, never a usage event                                                                                                                                                   |
| `CHECK_HEALTH`                                                            | no event; route answers 204                                                                                                                                                                  |

`describeReseller` gains: `order(planId, { idempotencyKey: 'k' })` twice ⇒ same `orderId`/`iccid`, `orders()` length 1; two **concurrent** orders with one key ⇒ one profile; `topUp(iccid, 100, { idempotencyKey })` twice ⇒ one `totalMb` increment; `MockReseller` with `failNextOrder: true` throws once then succeeds (used by wave 2's `pending-profile` test). `FallbackReseller(primary, inventory)`: `order` falls back when the primary throws; `usage`/`topUp` **do not** (a top-up on an inventory profile the primary never issued must surface as an error, not silently succeed on the fallback). Live adapters send the vendor's idempotency header from the fixture.

## L9 — `InventoryReseller` (T-41)

`new InventoryReseller({ file: 'fixtures/inventory.enc', sealKey, now })` where the red team generates a test inventory with `scripts/inventory-seal.ts` (or the builder's tool) from `fixtures/inventory.example.json` (`LPA:1$local.test$…` only): `git check-ignore fixtures/inventory.enc` is true; `order()` marks a profile consumed **before** returning (simulate a crash after consume: the next `order` returns a different profile); two concurrent orders ⇒ two distinct profiles; the file never contains `LPA:` in clear (`scan.sh fixtures/`); a wrong `sealKey` fails at construction, not at first order on stage. A plaintext inventory committed anywhere ⇒ **High**.

## L10 — Facilitators (T-15, T-27, T-42, T-75, T-78)

`RemoteFacilitator({ url, fetch: fixtureFetch('facilitator/x402org/…'), allowedHosts: ['x402.org'], networks: ['eip155:84532'] })`:

- `settle-ok.json` ⇒ `{ success: true, transaction: <0x…64>, network: 'eip155:84532', payer }`; a response whose `network` differs from the request ⇒ `success: false, errorReason: 'network_mismatch'`; `success: true` without `transaction` (hostile fixture) ⇒ `errorReason: 'invalid_response'`; `verify-invalid.json` ⇒ `isValid: false`.
- Constructed with `url: 'http://attacker.example/'` ⇒ throws (allow-list); with `url` on an allowed host but a `networks` list not containing the payload's network ⇒ `invalidReason: 'unsupported_scheme'`.
- Allow-list (A-30): `x402.org`, `api.testnet.blocky402.com`, `testnet.facilitator.launa.dev`, `localhost`; anything else ⇒ construction throws. `feePayer()` reads `/supported` (`fixtures/facilitator/hedera/supported.json`) and returns the `hedera:testnet` kind's `extra.feePayer`; a `/supported` whose fee payer differs from the pinned one (`0.0.9185802` x402.org, `0.0.7162784` Blocky402) ⇒ throws at boot (T-42).
- Hedera (A-20): the payload is `{ transaction: <base64 partially-signed TransferTransaction> }`; the pre-A-20 `{ signedTransaction, memo }` ⇒ `invalid_payload`; a Hedera payload given to the **EVM** rail ⇒ `unsupported_scheme` (INTERFACES §3.1); settle response `transaction: '0.0.1234@1700000000.000000000'` ⇒ accepted for `hedera:testnet`, `transactionId` used only when `transaction` is absent; a 32-byte hex on a Hedera settlement ⇒ `invalid_response`; `errorReason: 'settlement_pending'` ⇒ non-terminal (never `success:true`); `RoutingPaymentRail({ 'eip155:84532': evm, 'hedera:testnet': hedera })` routes by `accepted.network` and answers `unsupported_scheme` for an unknown network — never throws. T-78: a hostile `settle-ok` whose transfer lists another recipient must not become `success:true` once the mirror-node check exists (live-only; record as "not testable before Wed").

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

`MockTreasury.refund({ network, to, usd6, memo })` returns a deterministic `tx` and appears in `refunds()`; `failNext` makes exactly the next call throw `AdapterError('treasury','unavailable')`; `balanceUsd6(network)` decreases by `usd6`; `RoutingTreasury` with an unknown network ⇒ `AdapterError('treasury','unsupported_network')`, never a transfer on a default rail; `EvmTreasury` encodes an ERC-20 `transfer(to, usd6)` with the **6-decimal** value (`usd6` unchanged, no `parseEther`) and `HederaTreasury` builds a `TransferTransaction` (`@hiero-ledger/sdk` via `@x402/hedera` re-exports, key from `PrivateKey.fromStringECDSA`, A-22) for token `0.0.429274` with `memo ≤ 100` bytes and a `payTo` that is a plain `0.0.x` (aliases rejected); neither has a method that transfers more than the requested `usd6`. The daily cap is enforced in the API (wave 2), not here — note it.

## L15 — Factory, config, error mapping, secrets

- `createAdapters('local', { personhood: { expectSignal: true }, reseller: { failNextOrder: true } })` wires the options; `createAdapters('live')` throws a message pointing to `@ethglobal/adapters/live`.
- `liveConfigSchema.parse({})` fails **at construction** naming every missing variable (not at 02:00 on stage); `createLiveAdapters` is never constructed by any test in the repo (`grep -rn createLiveAdapters --include='*.test.ts'` ⇒ none).
- Every `AdapterError.code` thrown anywhere in `packages/adapters/src` appears in `ADAPTER_CODE_MAP` (grep `new AdapterError(` → set of codes; diff against the map's keys) — an unmapped code becomes `internal_error` in the API (500 where a 503/401 was due).
- No `fetch(` outside `packages/protocol/src/http.ts` and `src/testing/` (eslint `no-restricted-syntax` from the interfaces workstream; also grep).
- `scan.sh packages/adapters fixtures` clean (the relaxed list applies to mocks/tests/fixtures: `LPA:1$local.test$…` allowed).

## L16 — Arkiv entity forgery and query poisoning (T-79)

rabdi is public: anyone can write an entity with our schema name and attribute values. The control is a **creator filter**, not secrecy of the schema.

```ts
it('a look-alike entity written by another account is invisible to every store', async () => {
  const l = new InMemoryLedger({ now: clock.now, writer: OUR_WRITER });       // §7 item 13: writer-aware mock
  const evil = l.asWriter(anvilAccounts[7]);
  const k = 'ent:v1:' + 'a'.repeat(64);
  await new EntitlementStore(l, clock.now).create(entitlement({ key: k, mbTotal: 300, mbUsed: 250 }));
  await evil.put({ payload: JSON.stringify(entitlement({ key: k, mbTotal: 30_000, mbUsed: 0 })), annotations: { type: 'entitlement', key: k, expiresAt: T0 + 9e9 }, expiresIn: 60 });
  await evil.put({ payload: JSON.stringify(agentPolicy({ entitlementKey: k, maxUsd6PerDay: '1000000000' })), annotations: { type: 'agentpolicy', key: keys.agentPolicy(k) }, expiresIn: 60 });
  await evil.put({ payload: JSON.stringify(openGift({ namehash: NH, pinKey: hmacKey(SECRET, 'pin', utf8(KNOWN_PIN)) })), annotations: { type: 'gift', key: 'gift:' + NH + ':0x01' }, expiresIn: 60 });
  expect((await new EntitlementStore(l, clock.now).getByKey(k))!.payload.mbTotal).toBe(300);
  expect(await new AgentPolicyStore(l, clock.now).get(k)).toBeNull();
  expect(await new GiftStore(l, clock.now).openByNamehash(NH)).toEqual([]);
});
it('ownership transferred TO our writer does not make a foreign entity trusted ($creator, not $owner)', …);
it('two entities from OUR writer with one logical key → the store refuses (503-class error), never picks one', …);
```

Live adapter (fixture-backed fake `ArkivClientLike`): every `select()` built by `ArkivLedger.query` carries `where(… eq('$creator', ARKIV_WRITER_ADDRESS) …)` (assert on the recorded query object) and `get(entityKey)` drops an entity whose `$creator` differs; the writer address comes from config, and `ArkivLedger` refuses to construct without it. A store that trusts `$owner` only, or no filter at all, is **Critical** (forged agent policy ⇒ a victim's agent wallet spends to its cap).

## Reporting

Per L-item: test path, result, fixture provenance (`recordedAt` present or `[verify Wed]`), renames. Lead with L16 (creator filter), L6 (verifier response wins; environment; mock gaps), L4 (lookups by annotation only), L7 (`lpaSchema` at the boundary; eSIM Access signing) and L10 (front-run recovery; routing never throws) — the ones that become wave-2 Criticals if missed.
