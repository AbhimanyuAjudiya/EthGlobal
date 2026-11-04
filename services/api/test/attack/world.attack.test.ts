/** AP17 — World ID 4 verifier checks and the rp_context oracle (T-80, T-81, T-38, T-19). */
import { describe, expect, it, vi } from 'vitest';

import { fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';

import { errorOf, harness, type Harness } from './fixture.js';

const fresh = () => bytesToHex(generateSessionKeypair().publicKey);
const submit = async (
  h: Harness,
  mutate: (p: ReturnType<typeof fixtureProof>, signal: `0x${string}`) => unknown,
) => {
  const spk = fresh();
  const ch = await h.challengeFor('/claim', spk);
  const proof = mutate(
    fixtureProof('orb', ch.signal as `0x${string}`, `w-${spk.slice(2, 10)}`),
    ch.signal as `0x${string}`,
  );
  return h.json('/claim', { proof, campaignId: h.campaignId, challenge: ch, sessionPubKey: spk });
};

describe('attack: World ID verifier and rp_context (AP17)', () => {
  it('staging environment, another action’s signal, a partial result set ⇒ 401 each; never 201', async () => {
    const h = await harness();
    expect((await submit(h, (p) => ({ ...p, environment: 'staging' }))).status).toBe(401);
    expect(
      (
        await submit(h, (p) => ({
          ...p,
          responses: [...p.responses, fixtureProof('orb', `0x${'99'.repeat(32)}`).responses[0]],
        }))
      ).status,
    ).toBe(401);
    expect((await submit(h, () => fixtureProof('orb', `0x${'98'.repeat(32)}`))).status).toBe(401);
    expect(h.dataDrop.claimedEvents).toHaveLength(0);
  });

  it('the proof reaches the verifier unchanged and the tier comes from the verifier, not the body (T-22)', async () => {
    const h = await harness();
    const verify = vi
      .spyOn(h.adapters.personhood, 'verify')
      .mockImplementation(async () => ({ nullifierHash: `0x${'42'.repeat(32)}`, level: 'device' }));
    const spk = fresh();
    const ch = await h.challengeFor('/claim', spk);
    const proof = fixtureProof('orb', ch.signal as `0x${string}`, 'tier');
    const res = await h.json('/claim', {
      proof,
      campaignId: h.campaignId,
      challenge: ch,
      sessionPubKey: spk,
    });
    expect(verify.mock.calls[0]?.[0]).toEqual(proof);
    expect(res.status).toBe(402);
  });

  it('the 11th rp-context in a minute ⇒ 429 before the signer runs', async () => {
    const h = await harness();
    const issue = vi.spyOn(h.deps.rpSigner, 'issue');
    for (let i = 0; i < 11; i++)
      await h.request('/world/rp-context', {
        method: 'POST',
        ip: '192.0.2.77',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audience: 'recharge', path: '/claim' }),
      });
    expect(issue).toHaveBeenCalledTimes(10);
  });

  it('the signing key appears in no response, error or log line', async () => {
    const h = await harness();
    const key = h.deps.env.WORLD_RP_SIGNING_KEY.slice(2);
    const texts = [
      await (await h.json('/world/rp-context', { audience: 'recharge', path: '/claim' })).text(),
      await (await h.json('/world/rp-context', { audience: 'x' })).text(),
    ];
    for (const t of [...texts, h.lines.join('')]) expect(t).not.toContain(key);
  });

  it('relay: an rp_context + challenge obtained by session A and submitted with session B ⇒ 401', async () => {
    const h = await harness();
    const a = fresh();
    const ch = await h.challengeFor('/claim', a);
    await h.json('/world/rp-context', { audience: 'recharge', path: '/claim' });
    const res = await h.json('/claim', {
      proof: fixtureProof('orb', ch.signal as `0x${string}`, 'relay'),
      campaignId: h.campaignId,
      challenge: ch,
      sessionPubKey: fresh(),
    });
    expect(await errorOf(res)).toBe('invalid_proof');
  });
});
