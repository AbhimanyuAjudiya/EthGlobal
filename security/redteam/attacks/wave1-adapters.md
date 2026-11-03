# Wave 1 attack script — `packages/adapters` (mocks and `src/live/*` with fixtures)

**Run the moment wave 1 lands.** Targets: the extended `Ledger` (`update`, caller-chosen keys), `MockReseller`, `MockConsensusLog`, the patched `MockPersonhood`/`MockPaymentRail`, and the live adapters `ArkivLedger`, `WorldCloudPersonhood`, `RemoteFacilitator`, `SelfRunFacilitator`, `EsimAccessReseller`, `MegaEsimReseller`, `HcsLog`, `EnsResolver` — tested **only** against recorded fixtures in `fixtures/` with a stubbed `fetch` (the scaffold's `services/api/test/healthz.test.ts` shows the `vi.stubGlobal('fetch', …)` pattern). No network: the sandbox cannot reach any of these hosts (`docs/ENVIRONMENT-CONSTRAINTS.md`), which is also why "the adapter parses the fixture" is not the same as "the adapter works" — say so in the report. Threats: T-19, T-24, T-35…T-44. Tests land in `packages/adapters/test/attack/*.attack.test.ts` (mocks) and `packages/adapters/test/live/*.contract.test.ts` (request shape, error mapping, hostile responses).

```sh
pnpm --filter @ethglobal/adapters test -- --run --reporter=verbose
```

## L1 — Ledger expiry boundary and skewed clocks (T-35)

```ts
import { InMemoryLedger } from '../../src/index.js'; import { fakeClock, T0 } from '../fixtures.js';
it('an entity is dead at exactly expiresAt', async () => {
  const c = fakeClock(); const l = new InMemoryLedger({ now: c.now });
  const { key, expiresAt } = await l.put({ payload: 'x', expiresIn: 60 });
  c.advance(59_999); expect(await l.get(key)).not.toBeNull();
  c.advance(1);      expect(await l.get(key)).toBeNull();            // expiresAt > now is the live test — strict
  expect(expiresAt).toBe(T0 + 60_000);
});
it('server clock 60 s fast vs ledger: a reader using min(both) treats the entity as expired first', async () => {
  const ledgerClock = fakeClock(); const serverClock = fakeClock(T0 + 60_000);
  const l = new InMemoryLedger({ now: ledgerClock.now });
  const { key } = await l.put({ payload: 'x', annotations: { expiresAt: T0 + 90_000 }, expiresIn: 90 });
  const alive = async () => { const e = await l.get(key); return !!e && Number(e.annotations.expiresAt) > serverClock.now(); };
  expect(await alive()).toBe(true); serverClock.advance(31_000); expect(await alive()).toBe(false);   // server says dead at T0+91 s; ledger still has 29 s
});
```

Then the `update()` semantics: `update(key, { payload })` must **not** extend `expiresAt` unless `expiresIn` is passed; `update` on an expired or missing key throws `AdapterError('ledger', 'not_found')` — it never resurrects a dead entity (a top-up applied after expiry would otherwise create MB the reseller will not honour). `update` with `expiresIn` recomputes from `now`, not from `createdAt`.

## L2 — `ArkivLedger` BTL conversion (T-35)

Unit test with the adapter's conversion exposed (or via a fixture of the SDK call): `expiresIn = 604_800 s` (7 days) with `blockTimeMs = 2000` ⇒ `btl = 302_400` blocks; `blockTimeMs = 2100` ⇒ `288_000` (rounded **up**, never down); the returned `expiresAt` is `headTimestamp + btl × blockTimeMs`, not `Date.now() + expiresIn × 1000`; a configured `blockTimeMs ≤ 0` throws at construction; `impliedDriftSec` logged. Record the measured Kaolin block time as "unknown until Wed" in the report — this test proves the arithmetic, not the chain.

## L3 — Three load-bearing reads use the ledger's view

Read the API-facing helper the builder wrote for "is this entitlement alive" (probably `packages/octroi/src/entitlement.ts` or in the adapters package). It must consult `ledger.get` **and** `annotations.expiresAt`; a helper that trusts only the local `expiresAt` number cached in memory is a Med finding (THREAT-MODEL §6.3).

## L4 — Key space and enumeration (T-36)

```ts
it('semantic keys are honoured and sequential keys are gone', async () => {
  const l = new InMemoryLedger();
  const r = await l.put({ key: 'ent:v1:' + 'a'.repeat(64), payload: 'x' });          // if put() has no key param → finding (THREAT-MODEL §7.1)
  expect(r.key).toBe('ent:v1:' + 'a'.repeat(64));
  await expect(l.put({ key: r.key, payload: 'y' })).rejects.toMatchObject({ code: 'key_exists' });   // or document "last write wins" and make wave 2 enforce uniqueness elsewhere
  for (let i = 1; i <= 100; i++) expect(await l.get(`ent_${String(i).padStart(6, '0')}`)).toBeNull();
});
```

If `put` still mints `ent_000001` and the entitlement is found by scanning annotations, test that `query({ annotations: { type: 'entitlement', key } })` returns at most one and that `key` is HMAC-derived (64 hex). A design in which `/me/:key` takes the sequential key is a **High finding**.

## L5 — Public-ledger content allow-list (T-37)

Write a `MockReseller` order + an entitlement + a gift + a receipt the way the engine will (use the engine's own `toEntity()` helpers if exported; otherwise the shapes in `docs/arkiv.schema.json`), dump every entity (`ledger.query({})`) and every `MockConsensusLog` message as JSON, and run:

```sh
security/redteam/tools/scan.sh /tmp/ledger-dump.json /tmp/hcs-dump.json
```

Zero hits required: no `LPA:1$`, no `nullifier_hash`, no 19-digit ICCID, no `"pin":"1234…"`, no `"proof":"0x…"`. Also assert by schema: entitlement payload keys ⊆ `{type, key, tier, campaignId, mbTotal, mbUsed, usageAsOf, expiresAt, status, sealedRef, iccidHash}`; a `paid:` entitlement has no `ent:` key or nullifier-derived field. `docs/arkiv.schema.json` missing → Med (Arkiv submission requirement **and** the allow-list has no source of truth).

## L6 — `WorldCloudPersonhood` (T-19, T-22, T-24, T-38)

Stub `fetch`; assert the request: `POST https://developer.worldcoin.org/api/v2/verify/<app_id>`, JSON body with exactly `{ proof, merkle_root, nullifier_hash, verification_level, action, signal_hash }`, `signal_hash` = IDKit's `hashToField(signal)` (fixture vector `fixtures/world/signal-hash.json`; if absent, record "signal_hash unverified" — a mismatch would fail every live verification on Wednesday, which is the live check).

| Fixture response | Expected adapter behaviour |
|---|---|
| `200 {"success":true,"verification_level":"device",…}` while the request said `orb` | result `level: 'device'` (the **response** wins — T-22) |
| `400 {"code":"max_verifications_reached"}` | `AdapterError('personhood', 'already_verified')` ⇒ engine `deny: replay` |
| `400 {"code":"invalid_proof"}` / `invalid_merkle_root` | `AdapterError('personhood', 'invalid_proof')` |
| `200` with a body missing `success` | `AdapterError('personhood', 'invalid_response')` — never a success |
| network error / timeout (5 s) | `AdapterError('personhood', 'unavailable')` ⇒ deny |
| `200 {"success":true}` for a **second** call with the same nullifier (action unlimited) | success — the engine, not the adapter, dedups (O1) |

`MockPersonhood` gaps to verify (THREAT-MODEL §7.3–7.4): constructor option `maxVerifications` (default 1, `Infinity` for the unlimited-action configuration), and `context.signal` enforcement against a signal embedded in the fixture proof. Missing ⇒ High finding ("local mode cannot test signal binding / unlimited-action replay").

## L7 — Reseller response hardening (T-39)

Fixtures in `fixtures/reseller/<vendor>/{plans,order,usage,webhook}.json` plus **hostile** variants the red team adds under `fixtures/reseller/hostile/`:

| Hostile fixture | Expected |
|---|---|
| `order` returns `lpa: "javascript:alert(1)"` or `"LPA:1$<img onerror=…>$x"` | `AdapterError('reseller', 'invalid_response')` — LPA must match `^LPA:1\$[A-Za-z0-9.\-]+\$[A-Za-z0-9\-]+$` |
| `plans` with `dataMb: "1"` (string) or `data: "1GB"` | parse error or explicit unit conversion to `1024` MB — never `1` |
| `plans` with `wholesaleUsd: 0` / negative / `null` | rejected or flagged; `sizeBundle` guard (O6) is the second line |
| `plans` name of 10 kB or with `<script>` | truncated to ≤ 64 chars at the adapter boundary; stored as text |
| `usage` with `usedMb: -5` or `usedMb > totalMb` | `invalid_response` |
| `usage.asOf` in seconds instead of ms | detected (`asOf < 10¹¹`) and normalised or rejected — a 1970 "usage as of" on screen is the symptom |
| `order` 200 twice for the same idempotency key with different ICCIDs | adapter returns the first; second is `duplicate_order` (L8) |

Also: every request URL is built with `encodeURIComponent(planId|iccid)`; a `planId` of `../admin` or `?x=1` cannot change the path (assert the stubbed `fetch` saw the escaped URL). API keys go in headers, never in query strings; the adapter's `toString()`/errors never include the key (assert `JSON.stringify(err)` has no key material).

## L8 — Order idempotency (T-40)

`MockReseller.order(planId, { idempotencyKey })`: second call with the same key returns the same `EsimProfile` (or throws `duplicate_order`) and the mock's internal order count is 1. Live adapters send the vendor's idempotency header (eSIM Access and MegaeSIM differ — read the fixture). Two concurrent `order` calls with the same key ⇒ one profile.

## L9 — Inventory fallback (T-41)

If `InventoryReseller` (file-backed) exists: the file is `fixtures/inventory.enc` (or similar), git-ignored (`git check-ignore`), decrypted in memory with an operator key from env; `order()` marks a profile consumed **before** returning it (crash between the two steps must not re-issue — simulate by throwing after consume and asserting the next `order` returns a different profile); two concurrent orders ⇒ two distinct profiles; `scan.sh fixtures/` finds no `LPA:` in clear. A plaintext `inventory.json` committed to the repo is a **High finding** (bearer secrets worth real money).

## L10 — Facilitators (T-15, T-27, T-42)

`RemoteFacilitator` with fixtures `fixtures/facilitator/{verify-ok,settle-ok,settle-fail,settle-no-tx,hedera-settle}.json`:

- `settle-ok` ⇒ `{ success: true, transaction: <32-byte hex>, network: <requested> }`; a response whose `network` differs from the requested one ⇒ `success: false, errorReason: 'network_mismatch'`.
- `settle-no-tx` (`success: true`, no `transaction`) ⇒ `success: false, errorReason: 'invalid_response'` — a lying facilitator cannot produce a serve.
- URL comes from env and must be in the allow-list (`x402.org`, the hedera-dev facilitator host); `RemoteFacilitator` constructed with `http://attacker.example` throws.
- The `hedera` scheme payload shape is whatever Wednesday's recording says; until then the fixture is marked `recorded: false` and the report says so.

`SelfRunFacilitator` on Anvil (vitest with a running `scripts/dev-chain.sh`, or a viem test client): `verify` recovers the signer and compares with `authorization.from`, checks balance ≥ value, window, and `authorizationState`; `settle` waits for the receipt and returns `success: false` on `status: 'reverted'`; nonce-used after a third-party front-run ⇒ `success: true` with the found tx (A15 in `wave1-contracts.md`).

`MockPaymentRail` accepts `signature: '0xabcdef'` (shape only, by design). Assert that `createAdapters('local')` is **not** what `scripts/e2e-local.sh` uses for the payment rail — the local loop must run `SelfRunFacilitator` against Anvil at least once, or the EIP-3009 path is untested end-to-end (Med finding).

## L11 — `EnsResolver` normalisation (T-43)

```ts
it.each(['rаhul.eth' /* Cyrillic а */, 'alice​.eth', 'ALICE.eth '])('hostile or un-normalised name %s', async (name) => { … });
```

Expected: `resolve('rаhul.eth')` throws `AdapterError('names', 'invalid_name')` (ENSIP-15 via viem `normalize`); `'Alice.ETH '` → `alice.eth`; unresolvable → `null` (the API turns that into 400 **before** any 402). The scaffold's `MockNameResolver` lower-cases and trims only; it is acceptable for the mock as long as the live adapter normalises and a test proves the hostile cases on the live adapter's normaliser (pure function, no network). Resolution happens on mainnet with a Sepolia fallback; a `getEnsAddress` that silently returns `null` on RPC failure (so a gift is refused) is fine; one that throws unhandled is Low.

## L12 — `HcsLog` / `MockConsensusLog` content (T-44)

Receipts submitted via `consensus.submit(topic, message)`: parse each message; keys ⊆ `{type, entitlementKeyHash, mb, amountUsd6, network, tx, uaid, at}`; `message.length ≤ 1024` bytes; `scan.sh` over the dump is clean; `MockConsensusLog.read(topic, from)` returns strictly increasing `sequence`; `submit` to an unknown topic in live mode maps the SDK error to `AdapterError('consensus', 'unavailable')`.

## Error mapping and secrets (all live adapters)

For every live adapter: non-2xx ⇒ `AdapterError(<adapter>, <stable code>)`; thrown errors never include request headers; `AbortSignal.timeout(5_000)` on every `fetch`; `createAdapters('live')` with a missing env var throws **at construction** naming the variable (not on first use at 02:00 on stage). `createAdapters('live')` must not be constructed by any test — grep the test tree.

## Reporting

For each L-item: test path, result, fixture provenance (`recorded: true|false` — the Wednesday pre-deploy replaces every unrecorded fixture), and the renames observed. Lead with L4 (key space), L6 (verifier response wins; mock gaps) and L7 (LPA regex) — those are the ones that become wave-2 Criticals if missed.
