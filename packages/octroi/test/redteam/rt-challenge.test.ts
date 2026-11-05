/**
 * Red team (wave 1, octroi): challenge MAC and consume beyond wave1-octroi.md O3/O4 (T-20, T-21, T-32, T-35).
 * The tests once filed as findings (RT-O-01…09) are passing regressions named `… [RT-O-0N]`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { T0 } from '@ethglobal/adapters/testing';
import { RechargeError } from '@ethglobal/protocol/errors';
import { CHALLENGE_PATHS, type ChallengePath, type Hex } from '@ethglobal/protocol/ids';

import { challenge, consumeChallenge, type Challenge } from '../../src/index.js';
import { ledgerWith, OTHER_SPK, SECRET, SPK } from '../helpers.js';
import { freshCacheReplay } from './rt-helpers.js';

const RUNS = { numRuns: 300 };

describe('attack: rt nonce entity outlives the challenge (T-20 × T-35)', () => {
  const sameClock = (n: number) => n;
  const at = (ms: number) => (clock: { set(ms: number): void }) => clock.set(T0 + ms);

  // Regression RT-O-04 (fixed)
  it('a challenge issued by an instance 5 s ahead (inside the skew guard) cannot be replayed on a fresh cache after 121 s [RT-O-04]', async () => {
    // Instance A's clock is 5 s ahead: exp = T0 + 125 s, which consumeChallenge accepts (≤ TTL + 5 s); at
    // T0 + 121 s the nonce entity (expiresIn 120 from consume) is gone while the challenge is still valid.
    const r = await freshCacheReplay({
      ledgerNow: sameClock,
      issueAt: (n) => n + 5_000,
      then: at(121_000),
    });
    expect(r).toBe('replayed');
  });

  // Regression RT-O-04 (fixed)
  it('a ledger whose expiry clock runs 6 % fast (block-time drift, T-35) does not open a replay window [RT-O-04]', async () => {
    // Arkiv expiry is counted in blocks; blocks 6 % faster than the assumed 2 s end the entity 6 % early.
    const drift = (n: number) => T0 + Math.round((n - T0) * 1.06);
    const r = await freshCacheReplay({ ledgerNow: drift, issueAt: sameClock, then: at(115_000) });
    expect(r).toBe('replayed');
  });

  // Regression RT-O-04 (fixed) (boundary): consumed in the issuing millisecond, the entity dies at exactly exp, while
  // consumeChallenge still accepts now == exp.
  it('same clock, consumed at issue: fresh-Set replay at now == exp is refused [RT-O-04]', async () => {
    const r = await freshCacheReplay({
      ledgerNow: sameClock,
      issueAt: sameClock,
      then: (c, exp) => c.set(exp),
    });
    expect(r).toBe('replayed');
  });

  // Property: a constant ledger-clock OFFSET (ledger 10 s ahead) cancels out — the entity lifetime is relative.
  it('ledger clock 10 s ahead (offset, not drift): fresh-Set replay at T0 + 115 s → replayed', async () => {
    const r = await freshCacheReplay({
      ledgerNow: (n) => n + 10_000,
      issueAt: sameClock,
      then: at(115_000),
    });
    expect(r).toBe('replayed');
  });

  // Property: with one clock and no skew, a nonce consumed ≥ 1 ms after issue is covered for its whole life.
  it.each([1, 1_000, 60_000, 119_000, 120_000])(
    'same clock: consumed %i ms after issue → fresh-Set replay at exp is refused',
    async (delay) => {
      const r = await freshCacheReplay({
        ledgerNow: sameClock,
        issueAt: (n) => n - delay,
        then: at(120_000 - delay),
      });
      expect(r).toBe('replayed');
    },
  );

  // Regression RT-O-03 (fixed) (no atomic consume across processes: the ledger port has no create-if-absent)
  it('two API instances (two caches, one ledger) consuming one nonce concurrently: exactly one ok [RT-O-03]', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const c = challenge('recharge', '/claim', SPK, T0, SECRET);
    const rs = await Promise.all([
      consumeChallenge(ledger, new Set(), c, SPK, T0, SECRET),
      consumeChallenge(ledger, new Set(), c, SPK, T0, SECRET),
    ]);
    expect(rs.filter((r) => r === 'ok')).toHaveLength(1);
  });
});

describe('attack: rt hostile audience / path strings in the MAC (T-21)', () => {
  const ledger = () => new InMemoryLedger({ now: () => T0 });
  const fieldStr = fc.string({ unit: 'grapheme', maxLength: 40 });

  // Property: length-prefixing makes (audience, path) injective — no two distinct pairs share a tag.
  it('a tag minted for (a1, p1) never verifies for any other (a2, p2) incl. separators and unicode', async () => {
    await fc.assert(
      fc.asyncProperty(
        fieldStr,
        fc.constantFrom(...CHALLENGE_PATHS),
        fieldStr,
        fc.constantFrom(...CHALLENGE_PATHS),
        async (a1, p1, a2, p2) => {
          fc.pre(a1 !== a2 || p1 !== p2);
          const c = challenge(a1, p1, SPK, T0, SECRET);
          const moved = { ...c, audience: a2, path: p2 };
          expect(await consumeChallenge(ledger(), new Set(), moved, SPK, T0, SECRET)).toBe(
            'invalid',
          );
        },
      ),
      RUNS,
    );
  });

  // Property: boundary-shifting pairs that collide under plain concatenation do not collide here.
  it.each([
    ['recharge/gift', '/claim', 'recharge', '/gift/claim'],
    ['recharge\u0000', '/claim', 'recharge', '\u0000/claim'],
    ['recharge|', '/claim', 'recharge', '|/claim'],
    ['rechargeé', '/claim', 'rechargeé', '/claim'], // NFC vs NFD
    ['recharge', '/claim', 'RECHARGE', '/claim'],
    ['recharge', '/claim', 'recharge ', '/claim'],
  ])('(%j, %j) ≠ (%j, %j)', async (a1, p1, a2, p2) => {
    const c = challenge(a1, p1 as ChallengePath, SPK, T0, SECRET);
    const moved = { ...c, audience: a2, path: p2 as ChallengePath };
    expect(await consumeChallenge(ledger(), new Set(), moved, SPK, T0, SECRET)).toBe('invalid');
  });

  // Property: a path outside CHALLENGE_PATHS is refused even with a valid MAC.
  it('path outside CHALLENGE_PATHS minted with the real secret → invalid', async () => {
    const c = challenge('recharge', '/esim/provision' as ChallengePath, SPK, T0, SECRET);
    expect(await consumeChallenge(ledger(), new Set(), c, SPK, T0, SECRET)).toBe('invalid');
  });

  // Property: a 300-byte audience presented at consume is 'invalid', never a throw.
  it('oversized audience at consume → invalid (no throw)', async () => {
    const c = challenge('recharge', '/claim', SPK, T0, SECRET);
    expect(
      await consumeChallenge(
        ledger(),
        new Set(),
        { ...c, audience: 'x'.repeat(300) },
        SPK,
        T0,
        SECRET,
      ),
    ).toBe('invalid');
  });

  // Property: an audience longer than the nonce schema allows fails closed at consume (never 'ok').
  it('a 64-char audience minted with the real secret is not consumable (nonce schema max 32) → fails closed', async () => {
    const c = challenge('a'.repeat(64), '/gift/claim', SPK, T0, SECRET);
    expect(await consumeChallenge(ledger(), new Set(), c, SPK, T0, SECRET)).not.toBe('ok');
  });

  // Regression RT-O-07 (fixed)
  it('challenge() with a > 255-byte audience throws RechargeError(invalid_request), not RangeError [RT-O-07]', () => {
    let thrown: unknown;
    try {
      challenge('x'.repeat(256), '/claim', SPK, T0, SECRET);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(RechargeError);
  });

  // Regression RT-O-07 (fixed)
  it.each([Number.NaN, 1.5, Number.POSITIVE_INFINITY])(
    'challenge() with now = %s throws RechargeError, not RangeError [RT-O-07]',
    (now) => {
      let thrown: unknown;
      try {
        challenge('recharge', '/claim', SPK, now, SECRET);
      } catch (e) {
        thrown = e;
      }
      expect(thrown).toBeInstanceOf(RechargeError);
    },
  );
});

describe('attack: rt session key and nonce encodings (T-32, T-20)', () => {
  const ledger = () => new InMemoryLedger({ now: () => T0 });
  const flipHex = (h: Hex, i: number): Hex => {
    const chars = h.split('');
    chars[i] = chars[i] === '0' ? '1' : '0';
    return chars.join('') as Hex;
  };

  // Property: any single nibble change of the session key invalidates the challenge.
  it('every one-nibble substitution of sessionPubKey → invalid', async () => {
    const c = challenge('recharge', '/claim', SPK, T0, SECRET);
    for (let i = 2; i < SPK.length; i += 7) {
      expect(await consumeChallenge(ledger(), new Set(), c, flipHex(SPK, i), T0, SECRET)).toBe(
        'invalid',
      );
    }
    expect(await consumeChallenge(ledger(), new Set(), c, OTHER_SPK, T0, SECRET)).toBe('invalid');
  });

  // Property: a malformed session key (short, 0X, non-hex) is invalid, never a throw.
  it.each(['0x', '0x1234', `0X${'5a'.repeat(32)}`, `0x${'zz'.repeat(32)}`, `${'5a'.repeat(32)}`])(
    'sessionPubKey %j → invalid',
    async (spk) => {
      const c = challenge('recharge', '/claim', SPK, T0, SECRET);
      expect(await consumeChallenge(ledger(), new Set(), c, spk as Hex, T0, SECRET)).toBe(
        'invalid',
      );
    },
  );

  // Property: an upper-cased nonce is the same nonce — replay is caught by the ledger on a fresh cache.
  it('upper-cased nonce replay on a fresh Set → replayed', async () => {
    const l = ledger();
    const c = challenge('recharge', '/claim', SPK, T0, SECRET);
    expect(await consumeChallenge(l, new Set(), c, SPK, T0, SECRET)).toBe('ok');
    const upper: Challenge = { ...c, nonce: c.nonce.toUpperCase().replace('0X', '0x') as Hex };
    expect(await consumeChallenge(l, new Set(), upper, SPK, T0, SECRET)).toBe('replayed');
  });

  // Property: a failing ledger read keeps the nonce burned in the cache (fail closed, brief §8.2).
  it('ledger query throws → unavailable, and the same nonce is replayed afterwards on that cache', async () => {
    const base = ledger();
    const broken = ledgerWith(base, {
      query: async () => {
        throw new Error('down');
      },
    });
    const set = new Set<string>();
    const c = challenge('recharge', '/claim', SPK, T0, SECRET);
    expect(await consumeChallenge(broken, set, c, SPK, T0, SECRET)).toBe('unavailable');
    expect(await consumeChallenge(base, set, c, SPK, T0, SECRET)).toBe('replayed');
  });

  // Property: exp at the boundary — now == exp is ok, exp − now == TTL + 5 s ok, +1 ms beyond is invalid.
  it('skew guard boundaries', async () => {
    const at = (issue: number, now: number) =>
      consumeChallenge(
        ledger(),
        new Set(),
        challenge('recharge', '/claim', SPK, issue, SECRET),
        SPK,
        now,
        SECRET,
      );
    expect(await at(T0, T0 + 120_000)).toBe('ok');
    expect(await at(T0, T0 + 120_001)).toBe('expired');
    expect(await at(T0 + 5_000, T0)).toBe('ok');
    expect(await at(T0 + 5_001, T0)).toBe('invalid');
  });
});
