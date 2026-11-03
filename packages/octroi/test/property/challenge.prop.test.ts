import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { bytesToHex, hexToBytes } from '@ethglobal/crypto';
import { AUDIENCE, type Hex } from '@ethglobal/protocol/ids';

import { challenge, consumeChallenge, type Challenge } from '../../src/index.js';
import { SECRET, SPK, T0 } from '../helpers.js';

const RUNS = { numRuns: 300 };
const flipHex = (hex: Hex, bit: number): Hex => {
  const bytes = hexToBytes(hex);
  const i = bit % (bytes.length * 8);
  bytes[i >> 3]! ^= 1 << (i & 7);
  return bytesToHex(bytes);
};
const flipText = (s: string, bit: number): string => {
  const i = bit % (s.length * 7);
  const at = Math.floor(i / 7);
  return s.slice(0, at) + String.fromCharCode(s.charCodeAt(at) ^ (1 << (i % 7))) + s.slice(at + 1);
};
const consume = (c: Challenge, spk: Hex = SPK, now = T0) =>
  consumeChallenge(new InMemoryLedger({ now: () => now }), new Set(), c, spk, now, SECRET);

describe('challenge properties', () => {
  it('10⁴ challenges have distinct nonces', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1)
      seen.add(challenge(AUDIENCE, '/claim', SPK, T0, SECRET).nonce);
    expect(seen.size).toBe(10_000);
  });

  it('any single-bit flip in nonce/audience/path/exp/sessionPubKey makes consumeChallenge return invalid', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('nonce', 'audience', 'path', 'exp', 'sessionPubKey'),
        fc.nat({ max: 1023 }),
        async (field, bit) => {
          const c = challenge(AUDIENCE, '/claim', SPK, T0, SECRET);
          const flipped: Record<string, () => Promise<string>> = {
            nonce: () => consume({ ...c, nonce: flipHex(c.nonce, bit) }),
            audience: () => consume({ ...c, audience: flipText(c.audience, bit) }),
            path: () => consume({ ...c, path: flipText(c.path, bit) as Challenge['path'] }),
            exp: () => consume({ ...c, exp: Number(BigInt(c.exp) ^ (1n << BigInt(bit % 41))) }),
            sessionPubKey: () => consume(c, flipHex(SPK, bit)),
          };
          expect(await flipped[field]!()).toBe('invalid');
        },
      ),
      RUNS,
    );
  });

  it('replay and expiry: inside the window ok then replayed; past exp expired', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 0, max: 240_000 }), async (dt) => {
        const c = challenge(AUDIENCE, '/claim', SPK, T0, SECRET);
        const ledger = new InMemoryLedger({ now: () => T0 + dt });
        const cache = new Set<string>();
        const first = await consumeChallenge(ledger, cache, c, SPK, T0 + dt, SECRET);
        const again = await consumeChallenge(ledger, new Set(), c, SPK, T0 + dt, SECRET);
        expect([first, again]).toEqual(
          T0 + dt > c.exp ? ['expired', 'expired'] : ['ok', 'replayed'],
        );
      }),
      RUNS,
    );
  });
});
