import { describe, expect, it, vi } from 'vitest';

import { campaign, claimChallenge, counters, deps, freeReq, T0, type ReqOver } from './fixture.js';
import { decide } from '../../src/index.js';

describe('attack: O7 nothing burns a verification before the cheap checks (T-24, T-46)', () => {
  it.each<[string, ReqOver, string]>([
    ['paused', { counters: counters({ paused: true }) }, 'paused'],
    ['budget', { counters: counters({ budgetUsd6: 400_000n }) }, 'budget'],
    ['cap', { counters: counters({ claimsThisHour: 5 }) }, 'cap'],
    ['expired', { campaign: campaign({ expiresAt: T0 - 1 }) }, 'expired'],
    ['no campaign', { campaign: undefined }, 'no-campaign'],
  ])('%s ⇒ deny before consume and verify', async (_n, over, reason) => {
    const d = deps();
    const verify = vi.spyOn(d.personhood, 'verify');
    const put = vi.spyOn(d.ledger, 'put');
    expect(await decide(freeReq(d, over), d)).toMatchObject({ kind: 'deny', reason });
    expect(verify).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('a doomed claim does not consume the challenge either', async () => {
    const d = deps();
    const ch = claimChallenge(d);
    expect(
      await decide(freeReq(d, { challenge: ch, counters: counters({ paused: true }) }), d),
    ).toMatchObject({ reason: 'paused' });
    expect((await decide(freeReq(d, { challenge: ch }), d)).kind).toBe('serve-free');
  });
});

describe('attack: O8 decide() persists nothing (T-25)', () => {
  it('after serve-free the ledger holds the consumed nonce and no entitlement', async () => {
    const d = deps();
    expect((await decide(freeReq(d), d)).kind).toBe('serve-free');
    expect(await d.ledger.query({ annotations: { type: 'entitlement' } })).toHaveLength(0);
    expect(await d.ledger.query({})).toHaveLength(1);
  });
});
