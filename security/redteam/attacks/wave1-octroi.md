# Wave 1 attack script — `packages/octroi`, `packages/crypto`, `packages/eip3009`

**Run the moment wave 1 lands.** Pure-logic packages; every attack is a vitest case with fake clocks and the scaffold's mocks, no network. Names below are from `DECISION.md` §6.2 (`quotaKey`, `sizeBundle`, `challenge`, `consumeChallenge`, `decide`, `shouldTopUp`, `sealLpa`/`openLpa`, `verifyWebhookSignature`, `digestTransferWithAuthorization`, `recoverSigner`, …). If a name differs, test the property and note the rename. Attack tests land in `packages/<pkg>/test/attack/*.attack.test.ts` under `describe('attack: …')`; property tests use `fast-check` (add as a devDependency of the package, pinned).

```sh
pnpm --filter @ethglobal/octroi --filter @ethglobal/crypto --filter @ethglobal/eip3009 test -- --run --reporter=verbose
```

## 0. Shared fixture (`packages/octroi/test/attack/fixture.ts`)

```ts
import { InMemoryLedger, MockPaymentRail, MockPersonhood, anvilAccounts, type PersonhoodProof } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/test/fixtures';   // or copy fakeClock — it is 8 lines
import type { Campaign, OctroiDeps } from '../../src/index.js';

export const SECRET = new Uint8Array(32).fill(7);
export const PAY_TO = anvilAccounts[1];
export const campaign = (over: Partial<Campaign> = {}): Campaign => ({
  id: '0x' + 'ab'.repeat(32), sponsor: anvilAccounts[2], name: 'Demo sponsor',
  bundleMb: { orb: 300, document: 300, device: 0 },
  pricePerClaimUsd6: 500_000n, maxClaims: 1000, claimsPerHour: 5,
  validityDays: 7, wholesaleUsdPerGb: 1.14, idResaleUsd: 0.5,
  paused: false, expiresAt: Date.UTC(2026, 10, 10), ...over,
});
export function deps(clock = fakeClock()): OctroiDeps & { clock: typeof clock; personhood: MockPersonhood } {
  const personhood = new MockPersonhood();
  return {
    clock, personhood,
    ledger: new InMemoryLedger({ now: clock.now }),
    payments: new MockPaymentRail({ now: clock.now }),
    secret: SECRET, now: clock.now, priceUsd6PerStep: 400_000n, stepMb: 100, payTo: PAY_TO,
    accepts: [
      { network: 'eip155:31337', asset: '0x5FbDB2315678afecb367f032d93F642f64180aa3' },   // MockUSDC3009 on Anvil
      { network: 'eip155:84532', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },   // Base Sepolia USDC
    ],
  };
}
export const orbProof = (nullifier = '0x' + '11'.repeat(32)): PersonhoodProof => ({
  proof: '0x' + 'aa'.repeat(64), merkle_root: '0x' + 'bb'.repeat(32),
  nullifier_hash: nullifier as `0x${string}`, verification_level: 'orb',
});
```

The resource for `decide()` is `{ url: 'http://localhost:8787/claim', description: 'welcome bundle', mimeType: 'application/json' }`.

## O1 — Nullifier replay (T-18)

```ts
it('second claim with the same nullifier is deny:replay, not a second bundle', async () => {
  const d = deps(); const c = campaign();
  const ch1 = challenge('recharge.local', '/claim', d.now());
  const first = await decide({ proof: orbProof(), challenge: ch1, campaign: c, mb: 0, resource, sessionPubKey: SPK }, d);
  expect(first.kind).toBe('serve-free');
  // the API would now call DataDrop.claim and write the entitlement; simulate the entity write the engine expects:
  // (if decide() writes the entity itself, skip this line — and check it does so only AFTER the chain claim in wave 2)
  const ch2 = challenge('recharge.local', '/claim', d.now());
  const second = await decide({ proof: orbProof(), challenge: ch2, campaign: c, mb: 0, resource, sessionPubKey: SPK }, d);
  expect(second).toMatchObject({ kind: 'deny', reason: 'replay' });
});
it('concurrent claims for one nullifier yield exactly one serve-free', async () => {
  const d = deps(); const c = campaign();
  const [a, b] = await Promise.all([
    decide({ proof: orbProof(), challenge: challenge('recharge.local', '/claim', d.now()), campaign: c, mb: 0, resource, sessionPubKey: SPK }, d),
    decide({ proof: orbProof(), challenge: challenge('recharge.local', '/claim', d.now()), campaign: c, mb: 0, resource, sessionPubKey: SPK }, d),
  ]);
  expect([a.kind, b.kind].filter((k) => k === 'serve-free')).toHaveLength(1);
});
```

Note: `MockPersonhood` itself refuses a second `verify` for the same `(action, nullifier)` with `already_verified`. That is **not** the control (World's action will be unlimited — THREAT-MODEL §7.3); the engine must deny on its own state. Patch the mock with `maxVerifications: Infinity` (or construct a permissive stub) and re-run O1 — if the second call then becomes `serve-free`, **Critical finding**: replay protection relied on the verifier.

## O2 — Proof not bound to the challenge (T-19)

```ts
it('a proof whose signal was computed for another nonce is invalid-proof', async () => {
  const d = deps(); const c = campaign();
  const chA = challenge('recharge.local', '/claim', d.now());
  const chB = challenge('recharge.local', '/claim', d.now());
  const proofForA = orbProofWithSignal(chA.signal);       // fixture proof that encodes the signal it was minted for
  const r = await decide({ proof: proofForA, challenge: chB, campaign: c, mb: 0, resource, sessionPubKey: SPK }, d);
  expect(r).toMatchObject({ kind: 'deny', reason: 'invalid-proof' });
});
it('decide passes the recomputed signal to personhood.verify', async () => {
  const d = deps(); const spy = vi.spyOn(d.personhood, 'verify');
  const ch = challenge('recharge.local', '/claim', d.now());
  await decide({ proof: orbProof(), challenge: ch, campaign: campaign(), mb: 0, resource, sessionPubKey: SPK }, d);
  expect(spy).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'recharge-welcome', signal: ch.signal }));
});
```

The scaffold's `MockPersonhood` ignores `context.signal`. If the builder did not extend it (THREAT-MODEL §7.4) the first test cannot be written honestly — file a **High finding** ("signal binding untestable in local mode") rather than a green test that proves nothing. Also assert `challenge()` output: `signal === keccak256(concat(nonce, utf8(audience)))`, `exp === now + 120_000` (or `+120` if seconds — check the unit and that `consumeChallenge` uses the same one).

## O3 — Challenge replay, expiry, fail-closed, double-consume (T-20)

```ts
it('consume twice → ok then replayed', async () => {
  const d = deps(); const cache = new Set<string>(); const ch = challenge('a', '/claim', d.now());
  expect(await consumeChallenge(d.ledger, cache, ch, d.now())).toBe('ok');
  expect(await consumeChallenge(d.ledger, cache, ch, d.now())).toBe('replayed');
});
it('expired at exp + 1 s; valid at exp − 1 s', async () => {
  const d = deps(); const ch = challenge('a', '/claim', d.now());
  expect(await consumeChallenge(d.ledger, new Set(), ch, ch.exp - 1_000)).toBe('ok');
  expect(await consumeChallenge(d.ledger, new Set(), { ...ch, nonce: other }, ch.exp + 1_000)).toBe('expired');
});
it('ledger throwing ⇒ unavailable, and decide() treats that as deny', async () => {
  const d = deps();
  d.ledger = { ...d.ledger, put: async () => { throw new Error('kaolin hiccup'); }, get: d.ledger.get.bind(d.ledger), query: d.ledger.query.bind(d.ledger) } as typeof d.ledger;
  const ch = challenge('a', '/claim', d.now());
  expect(await consumeChallenge(d.ledger, new Set(), ch, d.now())).toBe('unavailable');
  const r = await decide({ proof: orbProof(), challenge: ch, campaign: campaign(), mb: 0, resource, sessionPubKey: SPK }, d);
  expect(r.kind).toBe('deny');                                      // reason 'unavailable' if §7.6 was adopted, else 'replay'
});
it('a fresh process (empty cache) still rejects a nonce the ledger already holds', async () => {
  const d = deps(); const ch = challenge('a', '/claim', d.now());
  await consumeChallenge(d.ledger, new Set(), ch, d.now());
  expect(await consumeChallenge(d.ledger, new Set(), ch, d.now())).toBe('replayed');   // the ledger, not the Set, is the store
});
it('two concurrent consumes of one nonce: exactly one ok', async () => {
  const d = deps(); const cache = new Set<string>(); const ch = challenge('a', '/claim', d.now());
  const slow = { ...d.ledger, put: async (i: LedgerPutInput) => { await new Promise((r) => setTimeout(r, 5)); return d.ledger.put(i); } } as typeof d.ledger;
  const rs = await Promise.all([consumeChallenge(slow, cache, ch, d.now()), consumeChallenge(slow, cache, ch, d.now())]);
  expect(rs.filter((r) => r === 'ok')).toHaveLength(1);
});
```

If the in-memory `Set` is updated **after** the ledger `await`, the last test yields two `ok` → **High finding** (race; one nonce, two claims across one process). If the ledger entity is written after returning `ok`, the fresh-process test fails → High.

## O4 — Audience / path confusion (T-21)

`challenge('recharge.local', '/claim', now)` consumed via `decide()` for a request whose `resource.url` path is `/gift/claim`, or with `audience: 'evil.example'` → `deny: invalid-proof`. If `decide()` has no notion of the current route, the check must live in `services/api`'s `octroi()` middleware — record where, and make wave 2 test it; a missing check in **both** places is a High finding.

## O5 — Tier escalation (T-22)

```ts
it('tier comes from the verifier, not the request body', async () => {
  const d = deps();
  vi.spyOn(d.personhood, 'verify').mockResolvedValue({ nullifierHash: '0x' + '11'.repeat(32), level: 'device' });
  const r = await decide({ proof: { ...orbProof(), verification_level: 'orb' }, challenge: challenge('a', '/claim', d.now()), campaign: campaign(), mb: 0, resource, sessionPubKey: SPK }, d);
  // device tier gets no gift: expect payment-required (paid lane at the human price), never serve-free
  expect(r.kind).toBe('payment-required');
});
it.each([['orb', 300], ['document', 300], ['secure_document', 300], ['device', 0]] as const)('%s → %i MB', (level, mb) => {
  expect(sizeBundle(campaign(), tierOf(level))).toBe(mb);
});
it('unknown level → none → payment-required', …);
```

## O6 — `sizeBundle` property test (T-23)

```ts
it('never exceeds 300 MB, never makes farming EV-positive', () => {
  fc.assert(fc.property(fc.double({ min: 0, max: 50, noNaN: true }), fc.constantFrom('orb', 'document'), (wholesale, tier) => {
    const mb = sizeBundle(campaign({ wholesaleUsdPerGb: wholesale }), tier);
    expect(Number.isInteger(mb) && mb >= 0 && mb <= 300).toBe(true);
    if (wholesale > 0) expect(mb * (wholesale / 1024)).toBeLessThanOrEqual(0.8 * 0.5 + 1e-9);   // bundle cost ≤ 80 % of ID resale price
  }));
  expect(sizeBundle(campaign({ wholesaleUsdPerGb: 2.5 }), 'orb')).toBeLessThanOrEqual(160);    // DECISION §6.5
  expect(sizeBundle(campaign({ wholesaleUsdPerGb: 0 }), 'orb')).toBe(300);                      // guard, not Infinity
  expect(sizeBundle(campaign({ wholesaleUsdPerGb: NaN }), 'orb')).toBe(300);
  expect(sizeBundle(campaign({ bundleMb: { orb: 5000, document: 5000, device: 0 } }), 'orb')).toBe(300);
  expect(sizeBundle(campaign(), 'device')).toBe(0);
});
```

A result above 300, a non-integer, `Infinity`, or a GB/MB mix (e.g. `1 024 000` for a `1 GB` plan) → High.

## O7 — Burned verification on a doomed claim (T-24)

```ts
it.each([
  ['paused',  campaign({ paused: true }),                 'paused'],
  ['expired', campaign({ expiresAt: 0 }),                 'expired'],
  ['budget',  campaign({ maxClaims: 0 }),                 'budget'],
])('%s campaign: deny before personhood.verify is called', async (_n, c, reason) => {
  const d = deps(); const spy = vi.spyOn(d.personhood, 'verify');
  const r = await decide({ proof: orbProof(), challenge: challenge('a', '/claim', d.now()), campaign: c, mb: 0, resource, sessionPubKey: SPK }, d);
  expect(r).toMatchObject({ kind: 'deny', reason });
  expect(spy).not.toHaveBeenCalled();
});
```

Then the hourly cap: with `claimsPerHour: 1`, after one `serve-free`, the next distinct human must get `deny: cap` **without** `verify` being called. If `verify` runs first, the human's proof is consumed for nothing (and with `MockPersonhood`'s one-shot rule they can never retry) → **High**.

## O8 — Partial failure ordering (T-25)

Engine-level: `decide()` returning `serve-free` must **not** have written the entitlement entity yet if the chain claim happens in the route (otherwise a failed `DataDrop.claim` leaves a phantom entitlement). Assert `await d.ledger.query({ annotations: { type: 'entitlement' } })` is empty after a `serve-free`. If `decide()` is designed to write it, it must expose a two-phase API (`prepare` → `commit`) — record the design and hand the saga test to wave 2 (`reseller.order` throwing once ⇒ entitlement `pending-profile`, `Claimed` count 1).

## O9 — Payment ↔ MB mismatch (T-26)

```ts
const pay = (d, over = {}) => paymentPayload(requirementsFor(d, '400000'), over);  // from adapters test fixtures, adapted to deps.accepts[0]
it('mb not a multiple of stepMb → deny/400', …);                                    // mb: 199
it('two steps requested, one step paid → invalid-payment', async () => {
  const r = await decide({ payment: pay(d), mb: 200, resource, sessionPubKey: SPK }, d);   // value 400000 for 200 MB
  expect(r).toMatchObject({ kind: 'deny', reason: 'invalid-payment' });
});
it('over-payment is also rejected (exact scheme)', …);                             // value 800000 for 100 MB
it('mb ≤ 0, mb = 1e9, mb = NaN → deny/400', …);
```

The scaffold `MockPaymentRail` accepts `value ≥ amount` (`insufficient_amount` only when lower). The **engine** must enforce equality for the `exact` scheme; relying on the mock's `≥` is a Med finding (an agent could be tricked into overpaying — see T-56).

## O10 — Serve-before-settle (T-27)

```ts
it('settle failure ⇒ deny, no entitlement', async () => {
  const d = deps(); vi.spyOn(d.payments, 'settle').mockResolvedValue({ success: false, errorReason: 'reverted', network: 'eip155:31337' });
  const r = await decide({ payment: pay(d), mb: 100, resource, sessionPubKey: SPK }, d);
  expect(r).toMatchObject({ kind: 'deny', reason: 'invalid-payment' });
});
it('verify ok but settle throws ⇒ deny', …);
it('settle success with a malformed transaction hash ⇒ deny', …);   // transaction: '0x1234'
```

## O11 — `accepts[]` substitution (T-28)

For each field of `payload.accepted` (`network`, `asset`, `payTo`, `amount`, `scheme`): tamper it to a value not in `deps.accepts` (e.g. `network: 'eip155:1'`, `payTo: attacker`, `amount: '1'`) with a payload that is otherwise consistent → `deny: invalid-payment`. The scaffold mock returns `requirements_mismatch`; make sure the engine compares against **its own** `accepts`, not against whatever requirements the client echoes back.

## O12 — HMAC quota key (T-29)

```ts
it('deterministic, secret-dependent, never contains the nullifier', () => {
  const n = ('0x' + 'c3'.repeat(32)) as Hex;
  const a = quotaKey(SECRET, n), b = quotaKey(SECRET, n), c = quotaKey(new Uint8Array(32).fill(8), n);
  expect(a).toBe(b); expect(a).not.toBe(c);
  expect(a.toLowerCase()).not.toContain('c3c3c3c3');
  expect(quotaKey(SECRET, n)).toMatch(/^0x[0-9a-f]{64}$/);
});
it('rejects a short secret', () => expect(() => quotaKey(new Uint8Array(16), n)).toThrow());
```

Cross-check against Node: `createHmac('sha256', SECRET).update(hexToBytes(n)).digest('hex')` — if the implementation HMACs the **hex string** rather than the bytes, record it (not a vulnerability, but the live sponsor audit key must use the same convention).

## O13 — `shouldTopUp` (T-30)

```ts
const e = (over = {}) => ({ key: 'ent:v1:x', tier: 'orb', mbTotal: 300, mbUsed: 250, usageAsOf: now, expiresAt: now + 3 * 864e5, ...over });
const p = (over = {}) => ({ maxUsdPerDay: 10, thresholdMb: 60, stepMb: 100, paused: false, topUpOnExpiry: true, ...over });
it('threshold: buys exactly one step at ≤ thresholdMb remaining', () => expect(shouldTopUp(e(), p(), 0, now)).toEqual({ buy: true, mb: 100, reason: 'threshold' }));
it('one MB above threshold: no buy', () => expect(shouldTopUp(e({ mbUsed: 239 }), p(), 0, now).buy).toBe(false));
it('cap: the step that would cross maxUsdPerDay is refused', () => expect(shouldTopUp(e(), p(), 9.61, now)).toEqual({ buy: false, reason: 'cap' }));   // 9.61 + 0.40 > 10
it('cap boundary: exactly reaching the cap is allowed', () => expect(shouldTopUp(e(), p(), 9.60, now).buy).toBe(true));
it('paused wins over everything', () => expect(shouldTopUp(e({ mbUsed: 300 }), p({ paused: true }), 0, now)).toEqual({ buy: false, reason: 'paused' }));
it('expiry: buys once; same expiresAt again → no buy (caller passes lastExpiryBought or the engine dedups)', …);
it('24 h simulated loop never exceeds the cap', () => {
  let spent = 0; const usage = e({ mbUsed: 0 });
  for (let t = now; t < now + 864e5; t += 60_000) {
    usage.mbUsed = Math.min(usage.mbTotal, usage.mbUsed + 3);                 // 3 MB/min
    const r = shouldTopUp(usage, p(), spent, t);
    if (r.buy) { spent += 0.4 * (r.mb / 100); usage.mbTotal += r.mb; }
  }
  expect(spent).toBeLessThanOrEqual(10);
});
```

An agent that buys when `spent + stepUsd > maxUsdPerDay` or loops on `expiry` is a High finding (user money; DECISION §6.5 agent row).

---

## C — `packages/crypto`

### C1 — Round trip and negatives (T-33)

```ts
const lpa = 'LPA:1$local.test$0001';
const { publicKey, secretKey } = generateSessionKeypair();            // X25519
const aad = concat(hexToBytes(paymentNonce), utf8('ent:v1:abc'));
it('open(seal(x)) = x', async () => expect(await openLpa(await sealLpa(lpa, publicKey, aad), secretKey, aad)).toBe(lpa));
it('wrong key fails', …);  it('wrong AAD fails', …);  it('one flipped ciphertext byte fails', …);  it('truncated blob fails', …);
it('10 000 seals have 10 000 distinct nonces', async () => { const ns = new Set(); for (…) ns.add(bytesToHex((await sealLpa(lpa, publicKey, aad)).nonce)); expect(ns.size).toBe(10_000); });
it('the sealed blob does not contain the plaintext', async () => expect(bytesToHex(await sealLpa(lpa, publicKey, aad)).toString()).not.toContain(utf8ToHex('LPA:1$')));
```

### C2 — Single delivery (T-31)

Engine/API property, but the crypto package must make it **possible**: `sealLpa` output is an opaque blob (`ephemeralPubKey ‖ nonce ‖ ciphertext`) with no plaintext fields; there is no `sealLpa` variant that returns the plaintext alongside; `openLpa` zeroises nothing it does not own. Grep `packages/crypto/src` for `console.` and for any export that returns the LPA from a sealed blob without the secret key.

### C3 — Forbidden-pattern scan on the package's own tests and fixtures

```sh
security/redteam/tools/scan.sh packages/crypto packages/octroi packages/eip3009
```

Only `LPA:1$local.test$…` may appear (mocks/tests are on the relaxed list).

### C4 — `sessionPubKey` binding (T-32)

If the binding rule is `nonce = keccak256(sessionPubKey)`: in `decide()` tests, sign a payment whose `authorization.nonce` is random and attach `extra.sessionPubKey = SPK` → `deny: invalid-payment`; then `nonce = keccak256(SPK)` → `serve-paid`; then swap `extra.sessionPubKey` to `SPK2` after signing → deny. For the free lane: `POST /challenge` is wave 2, but `challenge()` should carry the pubkey (`Challenge.sessionPubKey?`) and `decide()` must compare — if neither exists, file a **High finding** referencing THREAT-MODEL §7.2 (the LPA can be redirected by a MITM at the airport).

### C5 — KDF/AEAD construction review

Read `packages/crypto/src/sealed-lpa.ts`: X25519 (`@noble/curves/ed25519` `x25519`) → HKDF-SHA256 with `info = 'recharge/lpa/v1'` and a salt that includes the ephemeral public key → XChaCha20-Poly1305 (`@noble/ciphers/chacha`) with a 24-byte `randomBytes` nonce. Anything hand-rolled (XOR, AES-CBC without MAC, SHA-only "encryption"), a reused/static nonce, or `Math.random` → **Critical**.

### C6 — `verifyWebhookSignature` (T-34)

```ts
const secret = 'whsec_test'; const body = '{"iccid":"8991000000000000001","usedMb":120,"totalMb":300,"asOf":1762200000000}';
const sig = (ts: number, b = body) => createHmac('sha256', secret).update(`${ts}.${b}`).digest('hex');
it.each([[0, true], [299, true], [-299, true], [301, false], [-301, false]])('skew %i s → %s', (skew, ok) =>
  expect(verifyWebhookSignature(secret, body, sig(T + skew), T + skew, T, 300)).toBe(ok));
it('millisecond timestamp is rejected even if the MAC matches', () => expect(verifyWebhookSignature(secret, body, sig(T * 1000), T * 1000, T, 300)).toBe(false));
it('re-serialised body (key order) fails', () => expect(verifyWebhookSignature(secret, JSON.stringify(JSON.parse(body)), sig(T), T, T, 300)).toBe(false));   // if JSON.stringify reorders nothing here, swap two keys manually
it('length mismatch / non-hex / empty signature → false, never throws', …);
it('timing: compare uses timingSafeEqual (read the source; a === compare is a Med finding)', …);
it('replay: the same (timestamp, signature) accepted twice by the pure function is fine — the API route must hold the seen-set; record for wave 2', …);
```

---

## E — `packages/eip3009`

### E1 — Digest vectors (T-13, T-14)

Compare `digestTransferWithAuthorization(domain(usdc, 31337), auth)` with the digest `MockUSDC3009` computes on Anvil (`forge test` exposes it via a view, or compute with `cast`), and with Circle's published vectors in `fixtures/eip3009/vectors.json` (recorded from the Circle docs by a human; if the fixture is missing, record **"vectors unverified"** in the report — the Wed pre-deploy relays one real Base Sepolia transfer, which is the live check). Different `chainId` or `verifyingContract` → different digest; `name`/`version` default to `"USD Coin"`/`"2"`.

### E2 — `recoverSigner` round trip

Sign with viem `privateKeyToAccount(anvilKey0).signTypedData(...)`; `recoverSigner(digest, sig)` must equal `anvilAccounts[0]`; a different `from` must **not** be accepted by `SelfRunFacilitator.verify` (it must compare recovered vs `authorization.from`).

### E3 — Calldata encoders

`encodeTransferWithAuthorization(auth, sig)` decodes with viem `decodeFunctionData` against the `MockUSDC3009` ABI to the same fields; `encodeReceiveWithAuthorization` likewise; a 64-byte (EIP-2098) signature is either expanded to 65 bytes or rejected — never passed through.

### E4 — Relayer griefing (T-16)

`Relayer.submit` must simulate (`eth_call`/`estimateGas`) before sending; with a stubbed transport that makes the simulation revert, `submit` returns `{ status: 'reverted' }` **without** a `eth_sendRawTransaction` call (count calls on the stub). 50 authorizations from an unfunded `from` ⇒ 0 sends.

### E5 — Malleability (T-17)

Take a valid signature `(r, s, v)`; build `(r, n − s, v ^ 1)`; `recoverSigner` must throw or return a non-matching address (viem's `recoverAddress` rejects high-`s` — confirm). `v ∈ {0, 1}` normalised to `{27, 28}`; `v = 29` rejected.

### E6 — Validity window semantics

`SelfRunFacilitator.verify`: `validAfter > now` ⇒ `not_yet_valid`; `validBefore ≤ now + 30 s` ⇒ `expired` (margin for inclusion — a payload that expires in 5 s cannot be settled honestly); `validBefore − now > 3600` accepted but logged. These mirror the scaffold mock's codes.

## Reporting

For each O/C/E item: test path, result, and the exact name used if it differed from this script. Open the report with the two architectural checks that matter most: **does replay protection survive a permissive verifier (O1)?** and **does a doomed claim consume a verification (O7)?**
