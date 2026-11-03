import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { concat, hexToBytes, hmacSha256, keccak256, utf8 } from '@ethglobal/crypto';
import { AUDIENCE, type Hex } from '@ethglobal/protocol/ids';

import { failing, ledgerWith, OTHER_SECRET, OTHER_SPK, SECRET, SPK, T0 } from './helpers.js';
import { challenge, consumeChallenge, signalFor, type Challenge } from '../src/index.js';

const issue = (now = T0, spk: Hex = SPK) => challenge(AUDIENCE, '/claim', spk, now, SECRET);
const ledger = () => new InMemoryLedger({ now: () => T0 });
const consume = (
  c: Challenge,
  opts: {
    at?: number;
    spk?: Hex;
    cache?: Set<string>;
    l?: InMemoryLedger | ReturnType<typeof ledgerWith>;
  } = {},
) =>
  consumeChallenge(
    opts.l ?? ledger(),
    opts.cache ?? new Set(),
    c,
    opts.spk ?? SPK,
    opts.at ?? T0,
    SECRET,
  );

describe('challenge', () => {
  it('issues 32-byte nonce with valid MAC', async () => {
    const c = issue();
    expect(c.nonce).toMatch(/^0x[0-9a-f]{64}$/);
    expect(c.exp).toBe(T0 + 120_000);
    expect(c).toMatchObject({ audience: AUDIENCE, path: '/claim' });
    expect(await consume(c)).toBe('ok');
  });

  it('the MAC covers length-prefixed audience and path (no split ambiguity)', () => {
    const c = issue();
    const random = hexToBytes(c.nonce).slice(0, 16);
    const naive = hmacSha256(SECRET, random, AUDIENCE, '/claim').slice(0, 16);
    expect(hexToBytes(c.nonce).slice(16)).not.toEqual(naive);
  });

  it('signalFor matches keccak(nonce‖audience)', () => {
    const c = issue();
    expect(c.signal).toBe(signalFor(c.nonce, AUDIENCE));
    expect(c.signal).toBe(keccak256(concat(hexToBytes(c.nonce), utf8(AUDIENCE))));
  });

  it('second consume → replayed (O3)', async () => {
    const l = ledger();
    const c = issue();
    const cache = new Set<string>();
    expect(await consume(c, { l, cache })).toBe('ok');
    expect(await consume(c, { l, cache })).toBe('replayed');
    expect(await consume(c, { l })).toBe('replayed'); // fresh cache, ledger remembers
  });

  it('now = exp + 1 s → expired', async () => {
    const c = issue();
    expect(await consume(c, { at: c.exp + 1000 })).toBe('expired');
    expect(await consume(c, { at: c.exp })).toBe('ok');
  });

  it('swapped sessionPubKey → invalid (C4)', async () => {
    expect(await consume(issue(), { spk: OTHER_SPK })).toBe('invalid');
    expect(await consume(issue(), { spk: '0x1234' })).toBe('invalid');
  });

  it('other path/audience → invalid (O4)', async () => {
    const c = issue();
    for (const bad of [
      { path: '/gift/claim' },
      { audience: 'evil' },
      { path: '/nope' },
      { exp: c.exp + 1 },
    ])
      expect(await consume({ ...c, ...bad } as Challenge)).toBe('invalid');
  });

  it('malformed nonce, exp, signal or a foreign secret → invalid', async () => {
    const c = issue();
    for (const bad of [
      { nonce: '0x12' },
      { exp: -1 },
      { exp: 1.5 },
      { signal: issue().signal },
      { signal: 7 },
      { audience: 'x'.repeat(300) },
    ])
      expect(await consume({ ...c, ...bad } as unknown as Challenge)).toBe('invalid');
    expect(await consume(challenge(AUDIENCE, '/claim', SPK, T0, OTHER_SECRET))).toBe('invalid');
  });

  it('a challenge claiming more than TTL + 5 s of life is invalid (clock-skew guard)', async () => {
    const future = issue(T0 + 10_000);
    expect(await consume(future, { at: T0 + 5_000 })).toBe('ok');
    expect(await consume(issue(T0 + 10_000), { at: T0 + 4_999 })).toBe('invalid');
  });

  it('ledger put throws → unavailable and the nonce stays in the cache', async () => {
    const c = issue();
    const cache = new Set<string>();
    const broken = ledgerWith(ledger(), { put: failing });
    expect(await consume(c, { l: broken, cache })).toBe('unavailable');
    expect(cache.has(c.nonce)).toBe(true);
    expect(await consume(c, { cache })).toBe('replayed'); // fail closed: no retry of the same nonce
    expect(await consume(issue(), { l: ledgerWith(ledger(), { query: failing }) })).toBe(
      'unavailable',
    );
  });

  it('Promise.all([consume, consume]) yields exactly one ok (T-20)', async () => {
    const l = ledger();
    const slow = ledgerWith(l, {
      query: async (q) => {
        await new Promise((r) => setTimeout(r, 5));
        return l.query(q);
      },
    });
    const c = issue();
    const cache = new Set<string>();
    const rs = await Promise.all([consume(c, { l: slow, cache }), consume(c, { l: slow, cache })]);
    expect(rs.sort()).toEqual(['ok', 'replayed']);
  });

  it('a weak secret is refused at issue and at consume', async () => {
    const weak = new Uint8Array(8);
    expect(() => challenge(AUDIENCE, '/claim', SPK, T0, weak)).toThrow();
    await expect(consumeChallenge(ledger(), new Set(), issue(), SPK, T0, weak)).rejects.toThrow();
  });
});
