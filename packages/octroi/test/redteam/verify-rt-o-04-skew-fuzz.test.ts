/**
 * Red-team verification variant for RT-O-04 (consumed-nonce entity outlives the challenge, NONCE_TTL_S = 300, A-37):
 * the regressions pin three points (issuer +5 s, 6 % drift, now == exp). This fuzzes the whole space at once —
 * issuer skew, consumer skew and replayer skew each anywhere in ±5 s (three different instances), consume at any
 * instant the consumer accepts, ledger expiry clock running up to 50 % fast (5× the A-37 margin), replay at any
 * instant up to 10 s past exp on a fresh cache. Property: a replay is never 'ok'.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { T0 } from '@ethglobal/adapters/testing';
import { CHALLENGE_TTL_S, NONCE_TTL_S } from '@ethglobal/protocol/ids';

import { challenge, consumeChallenge } from '../../src/index.js';
import { SECRET, SPK } from '../helpers.js';

const TTL = CHALLENGE_TTL_S * 1000;
const skew = fc.integer({ min: -5_000, max: 5_000 });

describe('verify RT-O-04: no fresh-cache replay anywhere in the skew × drift × timing space', () => {
  it('NONCE_TTL_S covers TTL + both skews with margin (control)', () => {
    expect(NONCE_TTL_S * 1000).toBeGreaterThan(TTL + 3 * 5_000);
  });

  it('three instances, ±5 s each, ledger up to 50 % fast ⇒ replay never ok (fuzz, 1 000 runs)', async () => {
    await fc.assert(
      fc.asyncProperty(
        skew,
        skew,
        skew,
        fc.integer({ min: 0, max: TTL + 10_000 }),
        fc.integer({ min: 0, max: TTL + 20_000 }),
        fc.double({ min: 1, max: 1.5, noNaN: true }),
        async (issuer, consumer, replayer, consumeAfter, replayAfter, rate) => {
          let real = T0;
          const ledger = new InMemoryLedger({ now: () => T0 + Math.round((real - T0) * rate) });
          const c = challenge('recharge', '/claim', SPK, T0 + issuer, SECRET);
          real = T0 + consumeAfter;
          const first = await consumeChallenge(ledger, new Set(), c, SPK, real + consumer, SECRET);
          fc.pre(first === 'ok');
          real += replayAfter;
          const again = await consumeChallenge(ledger, new Set(), c, SPK, real + replayer, SECRET);
          expect(again).not.toBe('ok');
        },
      ),
      { numRuns: 1_000, seed: 0x5eed04 },
    );
  });
});
