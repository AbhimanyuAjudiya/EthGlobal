/**
 * Red-team verification variant for RT-O-08 (per-campaign claim record, A-33): the record lives
 * `min(campaign.expiresAt, now + 180 d)` (Arkiv's lifetime cap), but nothing bounds a campaign's `expiresAt` to 180 d
 * (campaignSchema `expiresAt: msSchema`; the API's /sponsor/register and DataDrop accept any future expiry). On a
 * campaign that outlives its claim record, the same human's second claim is decided inside decide() — the property
 * RT-O-08 asked for — only while the record lives.
 */
import { describe, expect, it } from 'vitest';

import { type Personhood } from '@ethglobal/adapters';
import { fakeClock, T0 } from '@ethglobal/adapters/testing';
import { hourBucket } from '@ethglobal/protocol/ids';

import { challenge, decide, EntitlementStore, type Campaign } from '../../src/index.js';
import {
  campaign,
  counters,
  deps,
  freeReq,
  NULLIFIER,
  SECRET,
  SPK,
  type TestDeps,
} from '../helpers.js';

const DAY = 86_400_000;
const orb: Personhood = { verify: async () => ({ nullifierHash: NULLIFIER, level: 'orb' }) };

async function claim(d: TestDeps, c: Campaign) {
  const now = d.now();
  const ch = challenge('recharge', '/claim', SPK, now, SECRET);
  return decide(
    freeReq(d, { challenge: ch, campaign: c, counters: counters({ hourBucket: hourBucket(now) }) }),
    d,
  );
}

describe('verify RT-O-08: one claim per (human, campaign) for the whole campaign', () => {
  it('control: a 90-day campaign refuses the same human on day 60 (record lives until campaign end)', async () => {
    const clock = fakeClock();
    const d: TestDeps = { ...deps({}, clock), personhood: orb };
    const c = campaign({ validityDays: 1, expiresAt: T0 + 90 * DAY });
    const first = await claim(d, c);
    if (first.kind !== 'serve-free') throw new Error('setup');
    await new EntitlementStore(d.ledger, d.now).create(first.entitlement);
    clock.advance(60 * DAY);
    expect(await claim(d, c)).toMatchObject({ kind: 'deny', reason: 'replay' });
  });

  // RT-FINDING RT-O-08: on day 181 of a 365-day campaign the claim record (≤ 180 d) is gone ⇒ serve-free again.
  it('a 365-day campaign still refuses the same human on day 181 inside decide()_RTFINDING', async () => {
    const clock = fakeClock();
    const d: TestDeps = { ...deps({}, clock), personhood: orb };
    const c = campaign({ validityDays: 1, expiresAt: T0 + 365 * DAY });
    const first = await claim(d, c);
    if (first.kind !== 'serve-free') throw new Error('setup');
    await new EntitlementStore(d.ledger, d.now).create(first.entitlement);
    clock.advance(181 * DAY);
    expect(await claim(d, c)).toMatchObject({ kind: 'deny', reason: 'replay' });
  });
});
