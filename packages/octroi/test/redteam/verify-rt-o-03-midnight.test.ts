/**
 * Red-team verification variant for RT-O-03 (create-if-absent live lock, A-33), now a regression: the human's live
 * lock was keyed by ONE UTC day, so two concurrent claims straddling midnight reserved different keys (D, D+1) and
 * both won. A claim now reserves its day AND the next (A-44), so the two contend for D+1 and exactly one wins.
 * Property (RT-O-03): never two live free entitlements for one human, whatever the request instants.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryLedger, type Personhood } from '@ethglobal/adapters';
import { fakeClock, T0 } from '@ethglobal/adapters/testing';
import { hourBucket, type Hex } from '@ethglobal/protocol/ids';

import { challenge, decide, type Campaign, type Decision } from '../../src/index.js';
import { campaign, counters, deps, freeReq, NULLIFIER, SECRET, SPK } from '../helpers.js';
import { networked } from './rt-helpers.js';

const DAY = 86_400_000;
const MIDNIGHT = (Math.floor(T0 / DAY) + 1) * DAY;
const CAMPAIGN_B: Hex = `0x${'bc'.repeat(32)}`;
const orb: Personhood = { verify: async () => ({ nullifierHash: NULLIFIER, level: 'orb' }) };

function claimAt(base: InMemoryLedger, at: number, c: Campaign): Promise<Decision> {
  const now = () => at;
  const d = { ...deps({}, fakeClock(at)), now, ledger: networked(base), personhood: orb };
  const ch = challenge('recharge', '/claim', SPK, at, SECRET);
  return decide(
    freeReq(d, { challenge: ch, campaign: c, counters: counters({ hourBucket: hourBucket(at) }) }),
    d,
  );
}

const A = campaign({ expiresAt: MIDNIGHT + 30 * DAY });
const B = campaign({ id: CAMPAIGN_B, expiresAt: MIDNIGHT + 30 * DAY });

describe('verify RT-O-03: one live free bundle per human across a UTC day boundary', () => {
  it('control: sequential claims at 23:59:59.999 and 00:00:00.001 ⇒ the second is a replay', async () => {
    const base = new InMemoryLedger({ now: () => MIDNIGHT });
    expect((await claimAt(base, MIDNIGHT - 1, A)).kind).toBe('serve-free');
    expect(await claimAt(base, MIDNIGHT + 1, B)).toMatchObject({ kind: 'deny', reason: 'replay' });
  });

  it('control: concurrent claims on the same UTC day ⇒ at most one serve-free', async () => {
    const base = new InMemoryLedger({ now: () => MIDNIGHT });
    const rs = await Promise.all([claimAt(base, MIDNIGHT - 2, A), claimAt(base, MIDNIGHT - 1, B)]);
    expect(rs.filter((r) => r.kind === 'serve-free')).toHaveLength(1);
  });

  // Regression RT-O-03 (fixed): the reservations used live(D) and live(D+1) and both create-if-absent succeeded.
  it('concurrent claims on campaigns A and B straddling UTC midnight ⇒ at most one serve-free [RT-O-03]', async () => {
    const base = new InMemoryLedger({ now: () => MIDNIGHT });
    const rs = await Promise.all([claimAt(base, MIDNIGHT - 1, A), claimAt(base, MIDNIGHT + 1, B)]);
    expect(rs.filter((r) => r.kind === 'serve-free')).toHaveLength(1);
    expect(rs.find((r) => r.kind !== 'serve-free')).toMatchObject({
      kind: 'deny',
      reason: 'replay',
    });
  });

  it('cross-midnight, either start order and either campaign first ⇒ exactly one serve-free [RT-O-03]', async () => {
    for (const [first, second] of [
      [A, B],
      [B, A],
    ] as const) {
      for (const [t1, t2] of [
        [MIDNIGHT + 1, MIDNIGHT - 1],
        [MIDNIGHT - 1, MIDNIGHT + 1],
        [MIDNIGHT - 60_000, MIDNIGHT + 60_000],
      ] as const) {
        const base = new InMemoryLedger({ now: () => MIDNIGHT });
        const rs = await Promise.all([claimAt(base, t1, first), claimAt(base, t2, second)]);
        expect(rs.filter((r) => r.kind === 'serve-free')).toHaveLength(1);
      }
    }
  });

  it('cross-midnight sequential, the first bundle still live ⇒ the next day a replay on any campaign [RT-O-03]', async () => {
    const base = new InMemoryLedger({ now: () => MIDNIGHT });
    expect((await claimAt(base, MIDNIGHT - 1, A)).kind).toBe('serve-free');
    expect(await claimAt(base, MIDNIGHT + DAY - 1, B)).toMatchObject({
      kind: 'deny',
      reason: 'replay',
    });
  });
});
