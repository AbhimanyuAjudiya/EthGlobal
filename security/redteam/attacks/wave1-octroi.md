# Wave 1 attack script — `@ethglobal/protocol`, `@ethglobal/octroi`, `@ethglobal/crypto`, `@ethglobal/eip3009`

**Run the moment wave 1 lands** (`@ethglobal/protocol` and `@ethglobal/crypto` land first — INTERFACES §14 — so P and C can start before O and E). Pure-logic packages: every attack is a vitest case with `fakeClock`, the mocks and `fast-check`; no network. Signatures are INTERFACES §1 (protocol), §2 (crypto), §4 (eip3009), §5 (octroi). If code and INTERFACES disagree, the code is wrong (INTERFACES §0): file a finding. Tests land in `packages/<pkg>/test/attack/*.attack.test.ts` under `describe('attack: …')`.

```sh
pnpm --filter @ethglobal/protocol --filter @ethglobal/octroi --filter @ethglobal/crypto --filter @ethglobal/eip3009 test -- --run --reporter=verbose
```

## 0. Shared fixture (`packages/octroi/test/attack/fixture.ts`)

```ts
import { InMemoryLedger, MockPaymentRail, MockPersonhood } from '@ethglobal/adapters';
import { T0, anvilAccounts, fakeClock, fixtureProof, paymentPayload } from '@ethglobal/adapters/testing';
import { AUDIENCE, NETWORKS, WORLD_ACTION } from '@ethglobal/protocol/ids';
import { keccak256, randomBytes, bytesToHex } from '@ethglobal/crypto';
import type { Campaign, CampaignCounters, OctroiDeps } from '@ethglobal/octroi';

export const SECRET = new Uint8Array(32).fill(7);
export const MOCK_USDC = '0x5FbDB2315678afecb367f032d93F642f64180aa3';          // first Anvil deployment; any address works for pure tests
export const SPK = bytesToHex(randomBytes(32));                                  // session public key (hex32)
export const resource = { url: 'http://127.0.0.1:8787/claim', description: 'welcome bundle', mimeType: 'application/json' };

export const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: ('0x' + 'ab'.repeat(32)) as `0x${string}`, sponsor: anvilAccounts[3], name: 'Demo sponsor',
  bundleMb: { orb: 300, document: 300, device: 0 },
  pricePerClaimUsd6: 500_000n, maxClaims: 1000, claimsPerHour: 5, validityDays: 7,
  wholesaleUsd6PerGb: 1_140_000n, idResaleUsd6: 500_000n, planId: 'in-1gb-7d',
  network: NETWORKS.anvil, contract: anvilAccounts[9], createdAt: T0, expiresAt: T0 + 7 * 864e5, ...over,
});
export const counters = (over: Partial<CampaignCounters> = {}): CampaignCounters =>
  ({ paused: false, budgetUsd6: 500_000_000n, spentUsd6: 0n, claimsThisHour: 0, hourBucket: Math.floor(T0 / 3_600_000), claimed: false, ...over });

export function deps(clock = fakeClock()) {
  const personhood = new MockPersonhood({ expectSignal: true });
  const d: OctroiDeps = {
    ledger: new InMemoryLedger({ now: clock.now }), personhood, payments: new MockPaymentRail({ now: clock.now }),
    secret: SECRET, now: clock.now, action: WORLD_ACTION,
    priceUsd6PerStep: 400_000n, stepMb: 100, maxMbPerPurchase: 3000, validityDays: 7,
    accepts: [{ scheme: 'exact', network: NETWORKS.anvil, asset: MOCK_USDC, payTo: anvilAccounts[1], maxTimeoutSeconds: 300 }],
    keccak256,
  };
  return { ...d, clock, personhood };
}
export const freeReq = (d: ReturnType<typeof deps>, ch: Challenge, proof = fixtureProof('orb', ch.signal), c = campaign(), ct = counters()) =>
  ({ resource, mb: 0, proof, challenge: ch, sessionPubKey: SPK, campaign: c, counters: ct, existingEntitlement: null });
```

## P — `@ethglobal/protocol` (`packages/protocol/test/attack/*.attack.test.ts`)

**P1 — x402 codec and payload bounds (T-26, T-28, T-45).** `decodePaymentPayload(base64 of 17 KiB)` throws `RechargeError('invalid_request')` before parsing; `accepted.payTo = '0.0.1234'` with `network: 'eip155:31337'` rejected (and the reverse); `accepts` longer than 8 rejected; `amount: '1.5'` / `'-1'` / `''` rejected; `x402Version: 1` rejected; `sessionNonce(SPK, keccak256)` hashes the **32 bytes** (`keccak256(hexToBytes(SPK))`), not the hex string — compare with viem `keccak256(hexToBytes(SPK))`.

**P2 — `fetchWithPayment` signs at most once (T-57).** A stub `fetch` that answers 402 twice: `signer.sign` called exactly once, the second 402 is returned to the caller unpaid; `timeoutMs` honoured (a never-resolving fetch rejects); `PAYMENT-RESPONSE` surfaced as `settlement`.

**P3 — units (T-08, T-23, T-26).** `usd6('0.40') === 400_000n`; `usd6('1e3')`, `usd6('-1')`, `usd6('0.1234567')`, `usd6('NaN')`, `usd6('1,000')` all throw; `formatUsd6(400_000n) === '$0.40'`; `priceUsd6(300, 100, 400_000n) === 1_200_000n`; `assertMbStep(199, 100, 3000)` and `assertMbStep(3100, 100, 3000)` and `assertMbStep(0, …)` throw `invalid_request`; `mbFromBytes(1_073_741_824) === 1073` (decimal MB, D-5); `secondsUntil(now − 1, now) === 1` (never 0 — `Ledger.expiresIn` must be positive); `dayBucket` is UTC (`dayBucket(Date.UTC(2026,10,3,23,59,59))` ≠ `dayBucket(Date.UTC(2026,10,4,0,0,0))`).

**P4 — strings that reach the ledger or the screen (T-39, T-70).** `LPA_PATTERN` rejects `javascript:alert(1)`, `LPA:1$<img onerror=1>$x`, `LPA:1$a b$c`, `LPA:1$$x`; accepts `LPA:1$smdp.example$ABC-123` and the 3-segment form. `safeTextSchema(64)` rejects control chars, newlines, emoji, 65 chars; **accepts `<` and `>`** (they are printable ASCII) — so it is **not** an XSS filter: record that the only XSS control is escaping at render (T-58) and add that sentence to the wave report. `giftRequestSchema.name` length and `mb` multiples; `entitlementSchema` refuses `mbUsed > mbTotal`; `campaignSchema.bundleMb.device` must be literally 0.

**P5 — PIN (T-48).** `generatePin(randomBytes)` → 16 digits, `isValidPin` true; flip one digit ⇒ false; swap two adjacent digits ⇒ false (Verhoeff); 10⁴ PINs distinct; `generatePin` with a biased `randomBytes` (all zeros) still yields a valid check digit (the function must not loop forever or throw); `serialFromGiftId` is 8 hex chars.

**P6 — typed data and canonical JSON (T-53, T-72, T-73).** `canonicalJson({b:1,a:[{d:1,c:2}]}) === '{"a":[{"c":2,"d":1}],"b":1}'`; `undefined` dropped, `NaN`/bigint throw; `AGENT_POLICY_TYPES.policyHash` recomputed from `canonicalJson(policy)` differs when `paused` flips; `rechargeDomain(31337)` has no `verifyingContract` (so a signature is not chain-contract bound — intended; note it). `ERROR_CODES`: every code maps to a status; `ADAPTER_CODE_MAP` maps `already_verified → replay`, `unavailable → ledger_unavailable`, `nonce_already_used → invalid_payment`, and **every** `AdapterError` code the adapters package throws (grep `new AdapterError(` and diff).

## O — `@ethglobal/octroi`

### O1 — Nullifier replay with a permissive verifier (T-18)

```ts
it('second claim with the same nullifier is deny:replay even when the verifier allows repeat verifications', async () => {
  const d = deps(); const c = campaign();
  const ch1 = challenge(AUDIENCE, '/claim', SPK, d.now(), SECRET);
  const first = await decide(freeReq(d, ch1), d);
  expect(first.kind).toBe('serve-free');
  // decide() persists nothing (INTERFACES §5): the API would write the entitlement after DataDrop.claim. Simulate both outcomes:
  const ch2 = challenge(AUDIENCE, '/claim', SPK, d.now(), SECRET);
  const viaLedger = await decide({ ...freeReq(d, ch2), existingEntitlement: (first as any).entitlement }, d);
  expect(viaLedger).toMatchObject({ kind: 'deny', reason: 'replay' });
  const ch3 = challenge(AUDIENCE, '/claim', SPK, d.now(), SECRET);
  const viaChain = await decide({ ...freeReq(d, ch3), counters: counters({ claimed: true }) }, d);
  expect(viaChain).toMatchObject({ kind: 'deny', reason: 'replay' });
});
```

The scaffold `MockPersonhood` refuses a second `verify` for the same `(action, nullifier)` with `already_verified` — that is **not** the control (the World action is unlimited, ARCHITECTURE §6). Construct the mock permissively (`maxVerifications: Infinity` if the builder added the option from THREAT-MODEL §7.6; otherwise a stub that always succeeds) and keep the test green. If `decide()` only denies because the mock threw ⇒ **Critical finding**. Also assert: `serve-free.claimKey === onchainClaimKey(c.id, campaignClaimKey(auditKey(SECRET, c.id), nullifier))` and `serve-free.entitlement.key === keys.entitlementFree(quotaKey(SECRET, nullifier))`.

### O2 — Proof not bound to our challenge (T-19)

```ts
it('a proof minted for another challenge is invalid-proof', async () => {
  const d = deps(); const chA = challenge(AUDIENCE, '/claim', SPK, d.now(), SECRET); const chB = challenge(AUDIENCE, '/claim', SPK, d.now(), SECRET);
  const r = await decide(freeReq(d, chB, fixtureProof('orb', chA.signal)), d);
  expect(r).toMatchObject({ kind: 'deny', reason: 'invalid-proof' });
});
it('decide passes the recomputed signal to personhood.verify', async () => {
  const d = deps(); const spy = vi.spyOn(d.personhood, 'verify'); const ch = challenge(AUDIENCE, '/claim', SPK, d.now(), SECRET);
  await decide(freeReq(d, ch), d);
  expect(spy).toHaveBeenCalledWith(expect.anything(), { action: WORLD_ACTION, signal: ch.signal });
  expect(ch.signal).toBe(signalFor(ch.nonce, AUDIENCE));
});
```

### O3 — Challenge forgery, replay, expiry, fail-closed, double-consume (T-20, T-32)

```ts
const ch = () => challenge(AUDIENCE, '/claim', SPK, T0, SECRET);
it('consume twice → ok then replayed',           async () => { const d = deps(); const c = ch(); const set = new Set<string>(); expect(await consumeChallenge(d.ledger, set, c, SPK, T0, SECRET)).toBe('ok'); expect(await consumeChallenge(d.ledger, set, c, SPK, T0, SECRET)).toBe('replayed'); });
it('fresh Set, populated ledger → replayed',    async () => { const d = deps(); const c = ch(); await consumeChallenge(d.ledger, new Set(), c, SPK, T0, SECRET); expect(await consumeChallenge(d.ledger, new Set(), c, SPK, T0, SECRET)).toBe('replayed'); });
it('exp boundary',                              async () => { const d = deps(); const c = ch(); expect(c.exp).toBe(T0 + 120_000); expect(await consumeChallenge(d.ledger, new Set(), c, SPK, c.exp - 1, SECRET)).toBe('ok'); expect(await consumeChallenge(d.ledger, new Set(), ch(), SPK, c.exp + 1, SECRET)).toBe('expired'); });
it('tampered path / audience / exp / nonce byte → invalid (MAC)', async () => { const d = deps(); for (const bad of [{ path: '/gift/claim' }, { audience: 'evil' }, { exp: T0 + 10 }, { nonce: flipLastByte(ch().nonce) }]) expect(await consumeChallenge(d.ledger, new Set(), { ...ch(), ...bad } as Challenge, SPK, T0, SECRET)).toBe('invalid'); });
it('different sessionPubKey than issued → invalid (free-lane binding, T-32)', async () => { const d = deps(); expect(await consumeChallenge(d.ledger, new Set(), ch(), bytesToHex(randomBytes(32)), T0, SECRET)).toBe('invalid'); });
it('challenge minted with another secret → invalid',  async () => { const d = deps(); const forged = challenge(AUDIENCE, '/claim', SPK, T0, new Uint8Array(32).fill(9)); expect(await consumeChallenge(d.ledger, new Set(), forged, SPK, T0, SECRET)).toBe('invalid'); });
it('ledger put throws → unavailable, and decide() denies ledger-unavailable', async () => {
  const d = deps(); const broken = Object.create(d.ledger, { put: { value: async () => { throw new Error('kaolin'); } } }) as typeof d.ledger;
  expect(await consumeChallenge(broken, new Set(), ch(), SPK, T0, SECRET)).toBe('unavailable');
  const r = await decide(freeReq({ ...d, ledger: broken }, ch()), { ...d, ledger: broken });
  expect(r).toMatchObject({ kind: 'deny', reason: 'ledger-unavailable' });
});
it('two concurrent consumes of one nonce: exactly one ok', async () => {
  const d = deps(); const set = new Set<string>(); const c = ch();
  const slow = Object.create(d.ledger, { put: { value: async (i: LedgerPutInput) => { await new Promise((r) => setTimeout(r, 5)); return d.ledger.put(i); } } }) as typeof d.ledger;
  const rs = await Promise.all([consumeChallenge(slow, set, c, SPK, T0, SECRET), consumeChallenge(slow, set, c, SPK, T0, SECRET)]);
  expect(rs.filter((r) => r === 'ok')).toHaveLength(1);
});
it('issuing a challenge writes nothing (D-3)', async () => { const d = deps(); ch(); expect(await d.ledger.query({})).toHaveLength(0); });
it('consuming writes exactly one nonce entity with expiresIn 120', async () => { const d = deps(); await consumeChallenge(d.ledger, new Set(), ch(), SPK, T0, SECRET); const es = await d.ledger.query({ annotations: { type: 'nonce' } }); expect(es).toHaveLength(1); expect(es[0]!.expiresAt).toBe(T0 + 120_000); });
```

Two `ok`s ⇒ **High** (Set updated after the `await`). Fresh-Set replay accepted ⇒ **High** (entity written after `ok`).

### O4 — Audience/path confusion (T-21)

A `/claim` challenge presented to `decide()` for a request whose route is `/gift/claim` (the API passes the route; if `decide()` does not know the route, the check lives in `octroi()` middleware — record where and hand it to wave 2) ⇒ `deny: invalid-proof`. Missing in both ⇒ High.

### O5 — Tier escalation (T-22)

```ts
it('tier comes from the verifier, never from the body', async () => {
  const d = deps(); vi.spyOn(d.personhood, 'verify').mockResolvedValue({ nullifierHash: ('0x' + '11'.repeat(32)) as Hex, level: 'device' });
  const ch = challenge(AUDIENCE, '/claim', SPK, d.now(), SECRET);
  const r = await decide(freeReq(d, ch, { ...fixtureProof('device', ch.signal), verification_level: 'orb' }), d);
  expect(r.kind).toBe('payment-required');                                   // device: no gift, the human price
  expect((r as any).body.accepts[0].amount).toBe('400000');
});
it.each([['orb', 'orb'], ['document', 'document'], ['secure_document', 'document'], ['device', 'device']] as const)('tierFromLevel(%s) = %s', (l, t) => expect(tierFromLevel(l)).toBe(t));
it('unknown level → none → payment-required', …);
```

### O6 — `sizeBundle` property (T-23; INTERFACES A-1: 1 GB = 1000 MB, integer `Usd6`)

```ts
it('never exceeds 300 MB and never makes farming EV-positive', () => {
  fc.assert(fc.property(fc.bigInt({ min: 100_000n, max: 50_000_000n }), fc.constantFrom('orb', 'document'), (wholesaleUsd6PerGb, tier) => {
    const mb = sizeBundle({ bundleMb: { orb: 300, document: 300, device: 0 }, idResaleUsd6: 500_000n, wholesaleUsd6PerGb }, tier);
    expect(Number.isInteger(mb) && mb >= 0 && mb <= 300).toBe(true);
    expect(BigInt(mb) * wholesaleUsd6PerGb / 1000n).toBeLessThanOrEqual(400_000n);        // ≤ 80 % of the $0.50 ID price
  }));
  expect(sizeBundle(campaign({ wholesaleUsd6PerGb: 2_500_000n }), 'orb')).toBe(160);       // DECISION §6.5: exactly 160 at $2.50/GB
  expect(sizeBundle(campaign({ wholesaleUsd6PerGb: 1_140_000n }), 'orb')).toBe(300);       // 350 → capped
  expect(sizeBundle(campaign({ wholesaleUsd6PerGb: 0n }), 'orb')).toBe(300);               // guard
  expect(sizeBundle(campaign({ bundleMb: { orb: 5000, document: 5000, device: 0 } }), 'orb')).toBe(300);
  expect(sizeBundle(campaign({ bundleMb: { orb: 100, document: 300, device: 0 } }), 'orb')).toBe(100);
  expect(sizeBundle(campaign(), 'device')).toBe(0); expect(sizeBundle(campaign(), 'none')).toBe(0);
});
```

A `/1024`, a float, `Infinity`, or 161 at $2.50/GB ⇒ High.

### O7 — Nothing burns a verification before the cheap checks (T-24, T-46)

```ts
it.each([
  ['paused',  counters({ paused: true }),                              'paused'],
  ['budget',  counters({ budgetUsd6: 400_000n }),                      'budget'],    // < pricePerClaim
  ['cap',     counters({ claimsThisHour: 5 }),                         'cap'],
])('%s ⇒ deny before verify', async (_n, ct, reason) => {
  const d = deps(); const spy = vi.spyOn(d.personhood, 'verify');
  const r = await decide({ ...freeReq(d, challenge(AUDIENCE, '/claim', SPK, d.now(), SECRET)), counters: ct }, d);
  expect(r).toMatchObject({ kind: 'deny', reason }); expect(spy).not.toHaveBeenCalled();
});
it('expired campaign ⇒ deny:expired before verify', …);                  // campaign({ expiresAt: T0 − 1 })
it('no campaign ⇒ deny:no-campaign before verify', …);                   // campaign: undefined
it('a doomed claim does not consume the challenge either', async () => { /* paused + same challenge afterwards on a live campaign ⇒ serve-free */ });
```

The last test is a design question: if `consumeChallenge` runs before the counters check, a user whose claim was refused for `paused` must fetch a new challenge (fine, cheap) — but if it runs before and the nonce entity is written, the ledger write happened for nothing (T-45). INTERFACES §5 puts counters **before** `consumeChallenge`; assert that order with spies on `d.ledger.put` and `d.personhood.verify`.

### O8 — `decide()` persists nothing (T-25)

After any `serve-free`/`serve-paid`, `await d.ledger.query({})` is empty and `d.payments` is the only side effect (`settle` for paid). The saga (`DataDrop.claim` → `reseller.order` → `EntitlementStore.create`) is `services/api/src/flows/entitle.ts` — wave 2 tests `reseller.order` throwing once ⇒ `pending-profile`, one `Claimed`.

### O9 — Payment ↔ MB mismatch (T-26)

```ts
const req = (d, mb) => buildAccepts(d, mb)[0]!;
const pay = (d, mb, over = {}) => paymentPayload(req(d, mb), over);
it('mb not a multiple of stepMb → deny invalid-request (or 400 upstream)', async () => expect((await decide({ resource, mb: 199, payment: pay(d, 100) }, d)).kind).toBe('deny'));
it('200 MB requested, one step paid → invalid-payment', async () => expect(await decide({ resource, mb: 200, payment: pay(d, 100) }, d)).toMatchObject({ kind: 'deny', reason: 'invalid-payment' }));
it('over-payment is rejected (exact scheme)', async () => expect(await decide({ resource, mb: 100, payment: pay(d, 100, { value: '800000' }) }, d)).toMatchObject({ kind: 'deny', reason: 'invalid-payment' }));
it('mb > maxMbPerPurchase, mb ≤ 0, mb = NaN → deny', …);
it('buildAccepts amount is exactly steps × price and carries no extra fields', () => expect(req(d, 300).amount).toBe('1200000'));
```

The scaffold `MockPaymentRail` accepts `value ≥ amount`; the **engine** must require equality — relying on the mock is Med.

### O10 — Serve-before-settle (T-27)

`settle` → `{ success: false }` ⇒ `deny: invalid-payment`; `settle` throws ⇒ deny (not a 500 — `decide()` never throws for business outcomes, ARCHITECTURE §9); `settle` returns `success: true` with `transaction: '0x12'` or a different `network` ⇒ deny (`settleResultSchema` min length / network match); `verify` false ⇒ `settle` **never called** (spy).

### O11 — `accepts[]` substitution (T-28)

For each field of `payload.accepted` — `network: 'eip155:1'`, `asset: other`, `payTo: anvilAccounts[7]`, `amount: '1'`, `scheme: 'permit'`, `maxTimeoutSeconds: 9999` — ⇒ `deny: invalid-payment`. The engine compares against `buildAccepts(deps, mb)`, never against what the client echoes.

### O12 — Keys (T-18, T-29; INTERFACES A-9)

```ts
const n = ('0x' + 'c3'.repeat(32)) as Hex;
it('quotaKey deterministic, secret-dependent, domain-separated, nullifier-free', () => {
  expect(quotaKey(SECRET, n)).toBe(quotaKey(SECRET, n)); expect(quotaKey(SECRET, n)).not.toBe(quotaKey(new Uint8Array(32).fill(8), n));
  expect(quotaKey(SECRET, n).toLowerCase()).not.toContain('c3c3c3c3c3c3');
  expect(quotaKey(SECRET, n)).not.toBe(campaignClaimKey(SECRET, n));                       // 'quota' vs no prefix / different key
  expect(quotaKey(SECRET, n)).toBe(hmacKey(SECRET, 'quota', hexToBytes(n)));               // the documented construction
});
it('audit key chain', () => {
  const a = auditKey(SECRET, campaign().id); expect(a).toHaveLength(32);
  expect(campaignClaimKey(a, n)).not.toBe(campaignClaimKey(auditKey(SECRET, ('0x' + 'cd'.repeat(32)) as Hex), n));   // unlinkable across campaigns
  expect(onchainClaimKey(campaign().id, campaignClaimKey(a, n))).toBe(keccak256(concat(hexToBytes(campaign().id), hexToBytes(campaignClaimKey(a, n)))));
});
it('a 16-byte secret is refused by whoever constructs deps (env.ts in wave 2); here: quotaKey throws or env schema rejects', …);
```

### O13 — `shouldTopUp` (T-30; INTERFACES A-13/A-14)

```ts
const e = (over = {}) => ({ v: 1, key: 'ent:v1:x', kind: 'free', status: 'ready', tier: 'orb', planId: 'p', mbTotal: 300, mbUsed: 250, usageAsOf: T0, usageSource: 'webhook', createdAt: T0, expiresAt: T0 + 3 * 864e5, ...over }) as Entitlement;
const p = (over = {}) => ({ maxUsd6PerDay: 10_000_000n, thresholdMb: 60, stepMb: 100, paused: false, topUpOnExpiry: true, expiryLeadS: 3600, ...over });
it('threshold: one step at ≤ thresholdMb remaining', () => expect(shouldTopUp(e(), p(), 0n, T0, 400_000n)).toEqual({ buy: true, mb: 100, reason: 'threshold', costUsd6: 400_000n }));
it('61 MB remaining: no buy',                          () => expect(shouldTopUp(e({ mbUsed: 239 }), p(), 0n, T0, 400_000n).buy).toBe(false));
it('cap: the step that would cross the cap is refused', () => expect(shouldTopUp(e(), p(), 9_610_000n, T0, 400_000n)).toEqual({ buy: false, reason: 'cap' }));
it('cap: exactly reaching the cap is allowed',          () => expect(shouldTopUp(e(), p(), 9_600_000n, T0, 400_000n).buy).toBe(true));
it('paused wins',                                      () => expect(shouldTopUp(e({ mbUsed: 300 }), p({ paused: true }), 0n, T0, 400_000n)).toEqual({ buy: false, reason: 'paused' }));
it('expiry fires once per expiresAt value', () => {
  const soon = e({ mbUsed: 0, expiresAt: T0 + 1800_000 });
  expect(shouldTopUp(soon, p(), 0n, T0, 400_000n)).toMatchObject({ buy: true, reason: 'expiry' });
  expect(shouldTopUp(soon, p(), 0n, T0, 400_000n, soon.expiresAt)).toEqual({ buy: false, reason: 'already-bought-for-expiry' });
});
it('an expired entity is never topped up (it cannot be extended)', () => expect(shouldTopUp(e({ expiresAt: T0 - 1 }), p(), 0n, T0, 400_000n)).toEqual({ buy: false, reason: 'expired' }));
it('stepMb 300 costs 3 steps and the cap counts the whole cost', () => expect(shouldTopUp(e(), p({ stepMb: 300 }), 8_900_000n, T0, 400_000n)).toEqual({ buy: false, reason: 'cap' }));   // 8.9 + 1.2 > 10
it('24 h simulated loop never exceeds the cap', () => { /* usage +3 MB/min, re-feed verdicts; Σ costUsd6 ≤ maxUsd6PerDay */ });
```

### G — `decideGiftReclaim` (D-7, T-71)

```ts
const giftReceipt = (over = {}) => ({ v: 1, key: 'rcpt:eip155:31337:0xabc', kind: 'gift', entitlementKeyHash: H, mb: 1000, usd6: '4000000', network: NETWORKS.anvil, tx: '0xabc', payer: anvilAccounts[5], at: T0, ...over }) as Receipt;
const base = { giftId: G, payer: anvilAccounts[5], now: T0 + 8 * 864e5, escrow: null, receipts: [giftReceipt()], ledgerOk: true, feeUsd6: 0n };
it('ledger not ok → ledger-unavailable, never refund',           () => expect(decideGiftReclaim({ ...base, ledgerOk: false }).kind).toBe('deny'));
it('escrow still present (open, before claimBy) → too-early',    () => expect(decideGiftReclaim({ ...base, now: T0 + 1, escrow: openGift() })).toMatchObject({ kind: 'deny', reason: 'too-early' }));
it('escrow present with state claimed → claimed (§7 item 4)',    () => expect(decideGiftReclaim({ ...base, escrow: { ...openGift(), state: 'claimed' } })).toMatchObject({ kind: 'deny', reason: 'claimed' }));
it('gift-claim receipt → claimed',                              () => expect(decideGiftReclaim({ ...base, receipts: [giftReceipt(), giftReceipt({ kind: 'gift-claim' })] })).toMatchObject({ kind: 'deny', reason: 'claimed' }));
it('gift-reclaim receipt → already-reclaimed (even if pending)', …);
it('other payer → not-payer',                                   …);
it('no gift receipt → unknown-gift',                            …);
it('after claimBy + 30 d → window-closed',                       …);
it('refund amount = usd6 − min(fee, usd6); fee ≥ usd6 ⇒ 0 (should that be a deny? record)', …);
it('escrow absent but now < claimBy (ledger dropped it early, T-35) → too-early, not refund', () => expect(decideGiftReclaim({ ...base, now: T0 + 6 * 864e5 }).kind).toBe('deny'));
```

Note for the report: `claimBy` is not on the receipt — the function must derive it from `giftReceipt.at + GIFT_CLAIM_WINDOW_S`; if `validityDays`/claim windows ever become configurable per gift this drifts (Low, document).

### S — stores (`@ethglobal/octroi/store`)

- `EntitlementStore.getByKey` returns `null` when the ledger still holds the entity but `annotations.expiresAt < now` (T-35, min of two clocks), and when the entity is gone; it queries `{ type:'entitlement', key }` — grep the store for `ledger.get(` with a caller-supplied string (⇒ finding, T-36).
- `EntitlementStore.patch(key, { mbTotal }, { expiresAt })` resets `expiresIn` to `secondsUntil(expiresAt, now)`; without `expiresAt` the lifetime is unchanged; `patch` on an expired entity throws (`not_found`), never resurrects.
- `NonceStore.consume` then `consumed(nonce) === true`; after 121 s `consumed === false` **and** `consumeChallenge` still says `expired` (the MAC/exp check, not the store, decides).
- `GiftStore.byPinKey(hmacKey(secret,'pin', wrongPin)) === null`; `openByNamehash` excludes `state:'claimed'`; `markClaimed` is idempotent.
- `ReceiptStore.spentUsd6(hash, 'agent-topup', day)` sums only that kind and UTC day (receipts at 23:59:59Z and 00:00:00Z fall in different buckets); `kind:'topup'` (human) is not counted against the agent's cap.
- `CampaignStore.put` rejects a `name` failing `safeTextSchema(64)` and `bundleMb.device !== 0` (zod at the store boundary, T-70).

## C — `@ethglobal/crypto`

### C1 — Sealing (T-33)

```ts
const lpa = 'LPA:1$local.test$0001'; const { publicKey, secretKey } = generateSessionKeypair(); const aad = lpaAad(('0x' + '11'.repeat(32)) as Hex, 'ent:v1:abc');
it('open(seal(x)) = x', () => expect(openLpa(sealLpa(lpa, publicKey, aad), secretKey, aad)).toBe(lpa));
it('wrong key / wrong AAD / flipped ct byte / flipped nonce byte / truncated ct → SealError', …);
it('box shape is sealedBoxSchema {v:1, epk, nonce(24 B), ct} and contains no plaintext', () => { const b = sealLpa(lpa, publicKey, aad); expect(sealedBoxSchema.parse(b)).toBeTruthy(); expect(b.ct).not.toContain(bytesToHex(utf8('LPA:1$')).slice(2)); });
it('10 000 seals ⇒ 10 000 distinct nonces and epks', …);
it('zeroize clears the secret', () => { zeroize(secretKey); expect(secretKey.every((b) => b === 0)).toBe(true); expect(() => openLpa(sealLpa(lpa, publicKey, aad), secretKey, aad)).toThrow(); });
it('lpaAad is utf8(`${nonce}|${entitlementKey}`) and differs per key', …);
```

Read `packages/crypto/src/sealed-lpa.ts`: X25519 (`@noble/curves`) → HKDF-SHA256 (`salt = epk ‖ recipientPk`, `info = 'recharge/lpa/v1'`) → XChaCha20-Poly1305 (`@noble/ciphers`) with `randomBytes(24)`. Anything hand-rolled, a static nonce, `Math.random`, or AES-CBC without a MAC ⇒ **Critical**. `sealToServer`/`openFromServer` (ICCID at rest): same negatives; `epk` zero-filled; a box sealed to the server never opens with a session key.

### C2 — Single delivery is a property of the API, enabled here

No export returns plaintext from a box without the secret; `console.` absent from `packages/crypto/src`; `scan.sh packages/crypto packages/octroi packages/eip3009 packages/protocol` clean.

### C3 — HMAC primitives (T-29)

`hmacKey(secret, 'quota', bytes)` equals Node `createHmac('sha256', secret).update('quota').update(bytes).digest('hex')` (parts concatenated in order, no separators — record the convention for the sponsor's audit tooling); `timingSafeEqual` returns `false` on length mismatch without throwing; `randomBytes(32)` from `crypto.getRandomValues`.

### C4 — `sessionNonce` binding end to end (T-32)

Sign a payment whose `authorization.nonce` is random and set `requireSessionKey: true` with `sessionPubKey: SPK` ⇒ `deny: invalid-payment`; `nonce = sessionNonce(SPK, keccak256)` ⇒ `serve-paid`; swap `sessionPubKey` to another key after signing ⇒ deny. Without `requireSessionKey` (plain top-up) a random nonce is accepted.

### C5 — `verifyWebhookSignature` (T-34) — `nowMs` is **milliseconds**, `timestamp` **seconds**

```ts
const secret = utf8('whsec_test'); const body = '{"events":[{"provider":"mock","eventId":"e1","iccid":"8991000000000000001","usedMb":120,"totalMb":300,"asOf":1762200000000}]}';
const T = 1_762_200_000; const sig = (ts: number, b = body) => bytesToHex(hmacSha256(secret, `${ts}.${b}`)).slice(2);
it.each([[0, true], [299, true], [-299, true], [301, false], [-301, false]])('skew %i s → %s', (skew, ok) => expect(verifyWebhookSignature(secret, `${T + skew}.${body}`, sig(T + skew), T + skew, T * 1000, 300)).toBe(ok));
it('millisecond timestamp rejected even with a matching MAC', () => expect(verifyWebhookSignature(secret, `${T * 1000}.${body}`, sig(T * 1000), T * 1000, T * 1000, 300)).toBe(false));
it('re-serialised body fails', () => { const b2 = JSON.stringify(JSON.parse(body), null, 1); expect(verifyWebhookSignature(secret, `${T}.${b2}`, sig(T), T, T * 1000, 300)).toBe(false); });
it('base64 signature accepted; empty / non-hex / wrong length → false, never throws', …);
it('default window is 300 and both directions', …);
```

The adapter-level replay cache and provider headers are `wave1-adapters.md` L7/L8.

## E — `@ethglobal/eip3009`

**E1 — Vectors (T-13, T-14).** `fixtures/eip3009/vectors.json` (written by `forge script script/EmitVectors.s.sol`, Anvil key #5): every tuple's `transfer`/`receive` digest reproduced by `digestTransferWithAuthorization(domain(token, chainId, 'USD Coin', '2'), auth)`; `recoverSigner(digest, sig)` = Anvil #5; a digest under `chainId 84532` differs. If the file is absent, `describe.skipIf` and write **"vectors unverified"** in the report. `domains.json`: `readDomain` is used for live tokens — a hard-coded `("USD Coin","2")` anywhere outside the mock's own test is a Med finding (Base Sepolia faucet USDC may differ).

**E2 — `recoverSigner` (async, T-17).** viem `signTypedData` round trip; flipped-`s` ⇒ rejected; `v ∈ {0,1}` normalised; `v = 29` rejected; 64-byte EIP-2098 **accepted** here and expanded to 65 bytes by `encode*` before calldata (the mock accepts 65 only, A13).

**E3 — Encoders.** `encodeTransferWithAuthorization(auth, sig)` round-trips through viem `decodeFunctionData({ abi: EIP3009_ABI })` to the same fields; selector is the **bytes-signature** overload; `fromPaymentAuthorization`/`toPaymentAuthorization` round trip (`bigint` ↔ digit strings, seconds).

**E4 — Relayer griefing (T-16).** `createViemRelayer({ simulate: true })` with a transport stub whose `eth_call` reverts ⇒ `{ status: 'reverted' }` and **zero** `eth_sendRawTransaction`; 50 authorizations from an unfunded `from` ⇒ zero sends. `simulate: false` must not be the default.

**E5 — `SelfRunFacilitator` semantics** (the class lives in adapters, the checks come from here): `validAfter > now` ⇒ `not_yet_valid`; `validBefore ≤ now + 30 s` ⇒ `expired` (inclusion margin); recovered signer ≠ `from` ⇒ `invalid_signature`; `balanceOf(from) < value` ⇒ `insufficient_funds`; `authorizationState` used ⇒ `nonce_already_used` **unless** the matching `Transfer(from, payTo, value)` exists (T-15) — see `wave1-adapters.md` L10.

**E6 — Typed-data objects.** `TRANSFER_WITH_AUTHORIZATION_TYPES` field order and names match the Solidity typehash string byte for byte (hash the `encodeType` and compare with `keccak256("TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)")`).

## Reporting

Per item: test path, result, rename observed. Lead with O1 (replay without the verifier's help), O7 (nothing burns before the cheap checks), O6 (160 at $2.50/GB) and C4 (`sessionNonce`) — those four are the properties the product's sentence rests on.
