/**
 * Red-team verification variant for RT-O-08 (per-campaign claim record, A-33), now a regression: the record lived
 * `min(campaign.expiresAt, now + 180 d)`, so on a longer campaign the same human was served again once it died.
 * Now (A-44) the record lives until the campaign's `expiresAt` + CLAIM_RECORD_GRACE_MS, and a campaign whose record
 * would outlive the ledger's maximum lifetime is refused: CampaignTooLongError at registration, a typed deny in
 * decide() before anything is verified or burned.
 */
import { describe, expect, it } from 'vitest';

import { InMemoryLedger, MAX_LEDGER_EXPIRES_IN_S, type Personhood } from '@ethglobal/adapters';
import { fakeClock, T0 } from '@ethglobal/adapters/testing';
import { hourBucket } from '@ethglobal/protocol/ids';

import {
  CampaignStore,
  CampaignTooLongError,
  challenge,
  CLAIM_RECORD_GRACE_MS,
  decide,
  EntitlementStore,
  MAX_CAMPAIGN_MS,
  type Campaign,
} from '../../src/index.js';
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

  // Regression RT-O-08 (fixed): on day 181 of a 365-day campaign the claim record (≤ 180 d) was gone ⇒ serve-free.
  it('a 365-day campaign is refused with a typed error, before verify, and never served [RT-O-08]', async () => {
    const clock = fakeClock();
    let verified = 0;
    const d: TestDeps = {
      ...deps({}, clock),
      personhood: { verify: async (...a) => (verified++, orb.verify(...a)) },
    };
    const c = campaign({ validityDays: 1, expiresAt: T0 + 365 * DAY });
    expect(await claim(d, c)).toEqual({
      kind: 'deny',
      reason: 'invalid-request',
      detail: 'campaign_too_long',
    });
    expect(verified).toBe(0);
    const store = new CampaignStore(new InMemoryLedger({ now: clock.now }), clock.now);
    const put = store.put(c);
    await expect(put).rejects.toBeInstanceOf(CampaignTooLongError);
    await expect(put).rejects.toMatchObject({
      code: 'invalid_request',
      maxExpiresAt: T0 + MAX_CAMPAIGN_MS,
    });
  });

  it('the longest campaign the ledger allows refuses the same human on its last day [RT-O-08]', async () => {
    expect(MAX_CAMPAIGN_MS + CLAIM_RECORD_GRACE_MS).toBe(MAX_LEDGER_EXPIRES_IN_S * 1000);
    const clock = fakeClock();
    const d: TestDeps = { ...deps({}, clock), personhood: orb };
    const c = campaign({ validityDays: 1, expiresAt: T0 + MAX_CAMPAIGN_MS });
    await new CampaignStore(d.ledger, d.now).put(c);
    const first = await claim(d, c);
    if (first.kind !== 'serve-free') throw new Error('setup');
    await new EntitlementStore(d.ledger, d.now).create(first.entitlement);
    clock.advance(MAX_CAMPAIGN_MS - 60_000);
    expect(await claim(d, c)).toMatchObject({ kind: 'deny', reason: 'replay' });
  });
});
