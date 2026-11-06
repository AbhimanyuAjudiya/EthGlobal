/** AP5 — hourly-cap race, burned verifications and the verified-but-unserved recovery (T-46, T-24). */
import { describe, expect, it, vi } from 'vitest';

import { fixtureProof } from '@ethglobal/adapters/testing';

import { errorOf, harness } from './fixture.js';

describe('attack: hourly cap and burned proofs (AP5)', () => {
  it('reserves the final lifetime claim before verification even when the budget and hourly cap allow more', async () => {
    const h = await harness({ campaign: { claimsPerHour: 10, budget: 10_000_000n } });
    const campaign = await h.deps.stores.campaigns.get(h.campaignId);
    await h.deps.stores.campaigns.put({ ...campaign!.payload, maxClaims: 1 });
    let entered!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const checkProof = h.adapters.personhood.verify.bind(h.adapters.personhood);
    const verify = vi.spyOn(h.adapters.personhood, 'verify').mockImplementation(async (...args) => {
      entered();
      await blocked;
      return checkProof(...args);
    });
    const first = h.claim({ seed: 'last-lifetime-slot' });
    await started;
    const denied = await h.claim({ seed: 'parallel-lifetime-slot' });
    expect([denied.res.status, await errorOf(denied.res)]).toEqual([409, 'budget_exhausted']);
    expect(verify).toHaveBeenCalledTimes(1);
    release();
    expect((await first).res.status).toBe(201);
    h.clock.advance(60 * 60_000);
    const later = await h.claim({ seed: 'next-hour-lifetime-slot' });
    expect([later.res.status, await errorOf(later.res)]).toEqual([409, 'budget_exhausted']);
    expect(verify).toHaveBeenCalledTimes(1);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    expect(h.reseller.orders()).toHaveLength(1);
  });

  it('a revert HourlyCap from the chain ⇒ 429 retryable, the admission slot is released, the next claim succeeds', async () => {
    const h = await harness({ campaign: { claimsPerHour: 3 } });
    h.dataDrop.failNext.claim = 'HourlyCap';
    const res = await h.claim({ seed: 'slot-1' });
    expect([res.res.status, await errorOf(res.res)]).toEqual([429, 'hourly_cap']);
    expect(res.res.headers.get('retry-after')).toBeTruthy();
    expect(h.deps.admission.inFlight(h.campaignId)).toBe(0);
    expect((await h.claim({ seed: 'slot-2' })).res.status).toBe(201);
  });

  // RT-A-05: the resume is bound to the human (same nullifier, accepted by the verifier as already_verified), not to
  // the session public key alone — the one-time proof is not spent again, it is shown again
  it('verified but unserved: the chain fails after verify ⇒ 503; the same session retries with a fresh challenge ⇒ 201 without a second proof', async () => {
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
    expect(verify).toHaveBeenCalledTimes(1);
    await expect(verify.mock.results[0]?.value).rejects.toMatchObject({ code: 'already_verified' });
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('…while another session key cannot redeem that human’s pending intent, the original session can recover beyond 65 minutes', async () => {
    const h = await harness();
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 'intent-2' });
    expect(first.res.status).toBe(503);
    const thief = await h.claim({ seed: 'intent-2' });
    expect([401, 409]).toContain(thief.res.status);
    h.clock.advance(65 * 60_000 + 1);
    const ch = await h.challengeFor('/claim', first.spk);
    const late = await h.json('/claim', {
      proof: fixtureProof('orb', ch.signal as `0x${string}`, 'intent-2'),
      campaignId: h.campaignId,
      challenge: ch,
      sessionPubKey: first.spk,
    });
    expect(late.status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });
});
