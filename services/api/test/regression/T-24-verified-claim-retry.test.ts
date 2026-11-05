/** T-24, AP5.3: cheap checks before verify, and a verified-but-unserved human completes on retry from the same session. */
import { describe, expect, it, vi } from 'vitest';

import { fixtureProof } from '@ethglobal/adapters/testing';
import { hourBucket } from '@ethglobal/protocol/ids';

import { errorOf, harness } from '../support/harness.js';

describe('T-24 verified claim retry', () => {
  it('a full hour is refused before verify; a chain outage after verify is recovered next hour without spending a second proof', async () => {
    const h = await harness({ campaign: { claimsPerHour: 10 } });
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 't24' });
    expect(first.res.status).toBe(503);
    h.dataDrop.campaigns.get(h.campaignId)?.perHour.set(hourBucket(h.clock.now()), 10);
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    expect((await h.claim({ seed: 't24-other' })).res.status).toBe(429);
    expect(verify).not.toHaveBeenCalled();
    h.clock.advance(3_600_000 - (h.clock.now() % 3_600_000));
    const retry = await h.claim({ seed: 't24', keys: first.keys });
    expect(retry.res.status).toBe(201);
    // RT-A-05: the retry's proof is checked to be the same human; the verifier sees an already-spent proof
    expect(verify).toHaveBeenCalledTimes(1);
    await expect(verify.mock.results[0]?.value).rejects.toMatchObject({ code: 'already_verified' });
  });

  // RT-A-03: the admission slot is sized to the remaining budget too
  it('budget burst: budget for 2 claims, 6 concurrent humans ⇒ 2 served, 4 × 409 budget_exhausted, verify ≤ 2', async () => {
    const h = await harness({ campaign: { budget: 2n * 500_000n } });
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => h.claim({ seed: `t24-burst-${i}` })),
    );
    const outcomes = await Promise.all(
      results.map(async (r) => `${r.res.status}:${await errorOf(r.res)}`),
    );
    expect(outcomes.filter((o) => o.startsWith('201'))).toHaveLength(2);
    expect(outcomes.filter((o) => o === '409:budget_exhausted')).toHaveLength(4);
    expect(verify.mock.calls.length).toBeLessThanOrEqual(2);
    // once the budget is spent, a later human is refused before verify as well
    verify.mockClear();
    expect((await h.claim({ seed: 't24-late' })).res.status).toBe(409);
    expect(verify).not.toHaveBeenCalled();
  });

  // RT-A-03 defence in depth: a BudgetExhausted revert AFTER verify (budget spent elsewhere) keeps the intent
  it('a BudgetExhausted revert after verify keeps the intent; the sponsor tops up and the same session completes', async () => {
    const h = await harness();
    h.dataDrop.failNext.claim = 'BudgetExhausted';
    const first = await h.claim({ seed: 't24-budget' });
    expect([first.res.status, await errorOf(first.res)]).toEqual([409, 'budget_exhausted']);
    expect(h.deps.intents.size).toBe(1);
    const retry = await h.claim({ seed: 't24-budget', keys: first.keys });
    expect(retry.res.status).toBe(201);
    expect(h.deps.intents.size).toBe(0);
  });

  // RT-A-05: the intent is bound to the human's nullifier and to the verifier's answer
  it('same session, another human’s valid proof ⇒ judged as a new claim, the intent stays; a proof the verifier rejects ⇒ 401', async () => {
    const h = await harness();
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 't24-owner' });
    expect(first.res.status).toBe(503);
    // another human in the same session: a normal claim of their own, not the owner's intent
    const other = await h.claim({ seed: 't24-someone-else', keys: first.keys });
    expect(other.res.status).toBe(201);
    expect(h.deps.intents.size).toBe(1);
    // the owner's nullifier, but a proof the verifier rejects (signal bound to nothing we issued)
    const ch = await h.challengeFor('/claim', first.spk);
    const forged = fixtureProof('orb', `0x${'00'.repeat(32)}`, 't24-owner');
    const res = await h.json('/claim', {
      proof: forged,
      campaignId: h.campaignId,
      challenge: ch,
      sessionPubKey: first.spk,
    });
    expect([res.status, await errorOf(res)]).toEqual([401, 'invalid_proof']);
    expect(h.deps.intents.size).toBe(1);
    expect((await h.claim({ seed: 't24-owner', keys: first.keys })).res.status).toBe(201);
  });
});
