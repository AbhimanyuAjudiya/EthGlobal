import { inspect } from 'node:util';

import { hashToField } from '@ethglobal/crypto';
import { WORLD_ACTION } from '@ethglobal/protocol/ids';
import { signRequest } from '@worldcoin/idkit-core/signing';
import { describe, expect, it, vi } from 'vitest';

import { WorldCloudPersonhood } from '../../src/live/world-personhood.js';
import { createRpContextSigner, rpContextSigner } from '../../src/live/world-rp-context.js';
import { Secret } from '../../src/live/secret.js';
import {
  describePersonhood,
  fixtureFetch,
  fixtureProof,
  loadFixture,
  OTHER_SIGNAL,
  SUITE_SIGNAL,
  T0,
} from '../../src/testing/index.js';

import type { Hex } from '../../src/types.js';

const world = (file: string, logger?: { warn: (m: string) => void }) =>
  new WorldCloudPersonhood({
    rpId: 'rp_recharge0test',
    action: WORLD_ACTION,
    environment: 'production',
    fetch: fixtureFetch(`world/${file}.json`, { strictBody: true }),
    ...(logger ? { logger } : {}),
  });
const ctx = { action: WORLD_ACTION, signal: SUITE_SIGNAL };
const orb = fixtureProof('orb', SUITE_SIGNAL, 'world-ok-v4');

describePersonhood('WorldCloudPersonhood over fixtures/world/contract-suite.json', async () => world('contract-suite'));

describe('WorldCloudPersonhood (A-25; T-19, T-22, T-38, T-80)', () => {
  it('POST /api/v4/verify/{rp_id} with the IDKit result byte-for-byte (fixture strictBody); 200 ⇒ the verifier level, decimal nullifier ⇒ hex32', async () => {
    const result = await world('verify-ok-v4').verify(orb, ctx);
    const nullifier = (orb.responses[0] as { nullifier: string }).nullifier;
    expect(result).toEqual({ level: 'orb', nullifierHash: `0x${BigInt(nullifier).toString(16).padStart(64, '0')}` });
    // one extra key in the body is a different request: FixtureMiss ⇒ fixture_miss, never success
    await expect(world('verify-ok-v4').verify({ ...orb, extra: 1 } as typeof orb, ctx)).rejects.toMatchObject({
      code: 'fixture_miss',
    });
  });

  it('V3 legacy device proof: hex nullifier, level device', async () => {
    await expect(world('verify-ok-v3-legacy').verify(fixtureProof('device', SUITE_SIGNAL, 'world-ok-v3'), ctx)).resolves.toMatchObject({
      level: 'device',
    });
  });

  it("the verifier's identifier wins over the proof's claim (T-22)", async () => {
    await expect(world('verify-device-wins').verify(orb, ctx)).resolves.toMatchObject({ level: 'device' });
  });

  it.each([
    ['verify-staging', 'invalid_proof'],
    ['verify-other-action', 'invalid_proof'],
    ['verify-partial', 'invalid_proof'],
    ['verify-session', 'invalid_proof'],
    ['verify-all-failed', 'invalid_proof'],
    ['verify-invalid-proof', 'invalid_proof'],
    ['verify-replayed', 'already_verified'],
    ['verify-max-verifications', 'already_verified'],
    ['verify-malformed', 'invalid_response'],
    ['verify-nullifier-mismatch', 'invalid_response'],
    ['verify-nullifier-overflow', 'invalid_response'],
  ])('%s ⇒ %s', async (file, code) => {
    await expect(world(file).verify(orb, ctx)).rejects.toMatchObject({ adapter: 'personhood', code });
  });

  it('app_not_migrated ⇒ unavailable with the code in details, logged loudly', async () => {
    const warn = vi.fn();
    await expect(world('verify-app-not-migrated', { warn }).verify(orb, ctx)).rejects.toMatchObject({
      code: 'unavailable',
      details: { code: 'app_not_migrated' },
    });
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/app_not_migrated/));
  });

  it('404 / 429 / 5xx / network ⇒ unavailable / rate_limited / unavailable / unavailable', async () => {
    const p = world('verify-transport-errors');
    await expect(p.verify(orb, ctx)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(p.verify(orb, ctx)).rejects.toMatchObject({ code: 'rate_limited' });
    await expect(p.verify(orb, ctx)).rejects.toMatchObject({ code: 'unavailable' });
    const down = new WorldCloudPersonhood({
      rpId: 'rp_x',
      action: WORLD_ACTION,
      environment: 'production',
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    });
    await expect(down.verify(orb, ctx)).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('signal_hash ≠ hashToField(signal) ⇒ invalid_proof before any request (O2, T-19, T-24)', async () => {
    const neverCalled = vi.fn();
    const p = new WorldCloudPersonhood({ rpId: 'rp_x', action: WORLD_ACTION, environment: 'production', fetch: neverCalled });
    await expect(p.verify(fixtureProof('orb', OTHER_SIGNAL, 'x'), ctx)).rejects.toMatchObject({ code: 'invalid_proof' });
    await expect(p.verify({} as typeof orb, ctx)).rejects.toMatchObject({ code: 'invalid_proof' });
    await expect(p.verify(orb, { action: 'other' })).rejects.toMatchObject({ code: 'invalid_action' });
    expect(neverCalled).not.toHaveBeenCalled();
  });

  it('constructor refuses a bad rp_id and a non-https base URL', () => {
    const base = { action: WORLD_ACTION, environment: 'production' as const };
    expect(() => new WorldCloudPersonhood({ ...base, rpId: 'not an id' })).toThrow(/rp_/);
    expect(() => new WorldCloudPersonhood({ ...base, rpId: 'rp_1', baseUrl: 'http://developer.world.org' })).toThrow(/https/);
  });

  it('hashToField vectors (fixtures/world/hash-to-field-vectors.json)', () => {
    const { vectors } = loadFixture<{ vectors: { input: string; output: string }[] }>('world/hash-to-field-vectors.json');
    for (const v of vectors) expect(hashToField(v.input)).toBe(v.output);
  });
});

describe('createRpContextSigner (T-81)', () => {
  const vector = loadFixture<{
    signingKeyHex: Hex;
    signer: Hex;
    entropy: Hex;
    action: string;
    nonce: Hex;
    created_at: number;
    expires_at: number;
    signature: Hex;
  }>('world/rp-context-vector.json');
  const make = (over: Record<string, unknown> = {}) =>
    createRpContextSigner({
      appId: 'app_recharge',
      rpId: 'rp_recharge0test',
      action: WORLD_ACTION,
      environment: 'production',
      signingKeyHex: vector.signingKeyHex,
      now: () => T0,
      ...over,
    });

  it('signRequest output matches rp-context-vector (documented algorithm, injected clock)', async () => {
    const ctx = await make({ entropy: () => new Uint8Array(32).fill(0x22) }).issue();
    expect(ctx).toMatchObject({
      nonce: vector.nonce,
      created_at: vector.created_at,
      expires_at: vector.expires_at,
      signature: vector.signature,
      action: WORLD_ACTION,
      rp_id: 'rp_recharge0test',
      environment: 'production',
    });
    expect(ctx.expires_at - ctx.created_at).toBe(300);
    await expect(rpContextSigner(ctx)).resolves.toBe(vector.signer);
  });

  it("idkit-core's own signRequest output verifies with the same algorithm (library drift guard)", async () => {
    const sig = signRequest({ signingKeyHex: vector.signingKeyHex, action: WORLD_ACTION, ttl: 300 });
    const signer = await rpContextSigner({
      rp_id: 'rp_x',
      app_id: 'app_x',
      environment: 'production',
      action: WORLD_ACTION,
      nonce: sig.nonce,
      created_at: sig.createdAt,
      expires_at: sig.expiresAt,
      signature: sig.sig,
    });
    expect(signer).toBe(vector.signer);
  });

  it('two issues ⇒ distinct nonces; ttl > 300 refused; key never appears in the result, errors or inspect output', async () => {
    const signer = make({ signingKeyHex: new Secret(vector.signingKeyHex) });
    const [a, b] = await Promise.all([signer.issue(), signer.issue()]);
    expect(a.nonce).not.toBe(b.nonce);
    const key = vector.signingKeyHex.slice(2);
    for (const out of [JSON.stringify(a), JSON.stringify(signer), inspect(signer, { depth: 5 }), inspect(new Secret(vector.signingKeyHex))]) {
      expect(out).not.toContain(key);
    }
    expect(() => make({ ttlS: 301 })).toThrow(/ttl/);
    let message = '';
    try {
      make({ signingKeyHex: '0x1234' });
    } catch (e) {
      message = String(e);
    }
    expect(message).toMatch(/not a 32-byte/);
    expect(message).not.toContain('1234');
  });
});
