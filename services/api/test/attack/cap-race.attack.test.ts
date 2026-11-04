/** AP5 — hourly-cap race, burned verifications and the verified-but-unserved recovery (T-46, T-24). */
import { describe, expect, it, vi } from 'vitest';

import { fixtureProof } from '@ethglobal/adapters/testing';

import { errorOf, harness } from './fixture.js';
import { INTENT_TTL_MS } from '../../src/flows/entitle.js';

describe('attack: hourly cap and burned proofs (AP5)', () => {
  it('a revert HourlyCap from the chain ⇒ 429 retryable, the admission slot is released, the next claim succeeds', async () => {
    const h = await harness({ campaign: { claimsPerHour: 3 } });
    h.dataDrop.failNext.claim = 'HourlyCap';
    const res = await h.claim({ seed: 'slot-1' });
    expect([res.res.status, await errorOf(res.res)]).toEqual([429, 'hourly_cap']);
    expect(res.res.headers.get('retry-after')).toBeTruthy();
    expect(h.deps.admission.inFlight(h.campaignId)).toBe(0);
    expect((await h.claim({ seed: 'slot-2' })).res.status).toBe(201);
  });

  it('verified but unserved: the chain fails after verify ⇒ 503; the same session retries with a fresh challenge ⇒ 201 without a second verify', async () => {
    const h = await harness();
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 'intent' });
    expect([first.res.status, await errorOf(first.res)]).toEqual([503, 'chain_unavailable']);
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const ch = await h.challengeFor('/claim', first.spk);
    const retry = await h.json('/claim', {
      proof: first.proof,
      campaignId: h.campaignId,
      challenge: ch,
      sessionPubKey: first.spk,
    });
    expect(retry.status).toBe(201);
    expect(verify).not.toHaveBeenCalled();
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('…while another session key cannot redeem that human’s pending intent (401/409), and an old intent lapses', async () => {
    const h = await harness();
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 'intent-2' });
    expect(first.res.status).toBe(503);
    const thief = await h.claim({ seed: 'intent-2' });
    expect([401, 409]).toContain(thief.res.status);
    h.clock.advance(INTENT_TTL_MS + 1);
    const ch = await h.challengeFor('/claim', first.spk);
    const late = await h.json('/claim', {
      proof: fixtureProof('orb', ch.signal as `0x${string}`, 'intent-2'),
      campaignId: h.campaignId,
      challenge: ch,
      sessionPubKey: first.spk,
    });
    expect(late.status).toBe(409);
    expect(h.dataDrop.claimedEvents).toHaveLength(0);
  });
});
