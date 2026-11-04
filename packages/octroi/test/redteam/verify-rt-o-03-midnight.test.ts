/**
 * Red-team verification variant for RT-O-03 (create-if-absent live lock, A-33): the human's live lock is DAY-keyed
 * (`claim:HMAC('live' ‖ quotaKey ‖ day)`). Two concurrent claims by one human on two campaigns that straddle UTC
 * midnight read "no lock" for every day, then reserve DIFFERENT lock keys (day D and day D+1) — the create-if-absent
 * never collides. Property (RT-O-03): never two live free entitlements for one human.
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

  // RT-FINDING RT-O-03: the two reservations use live(D) and live(D+1); both create-if-absent succeed.
  it('concurrent claims on campaigns A and B straddling UTC midnight ⇒ at most one serve-free_RTFINDING', async () => {
    const base = new InMemoryLedger({ now: () => MIDNIGHT });
    const rs = await Promise.all([claimAt(base, MIDNIGHT - 1, A), claimAt(base, MIDNIGHT + 1, B)]);
    expect(rs.filter((r) => r.kind === 'serve-free')).toHaveLength(1);
  });
});
