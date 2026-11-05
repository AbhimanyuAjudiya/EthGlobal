/** AP2 — challenge and rp_context lifecycle (T-20, T-21, T-32, T-45, N2, N12). */
import { describe, expect, it, vi } from 'vitest';

import { fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';

import { errorOf, harness, SECRET, type Harness } from './fixture.js';
import { createApp } from '../../src/app.js';
import { buildDeps } from '../../src/deps.js';

const spk = () => bytesToHex(generateSessionKeypair().publicKey);
const claimWith = (h: Harness, challenge: unknown, sessionPubKey: string, seed = 'ap2') =>
  h.json('/claim', {
    proof: fixtureProof('orb', (challenge as { signal: `0x${string}` }).signal, seed),
    campaignId: h.campaignId,
    challenge,
    sessionPubKey,
  });

describe('attack: challenge lifecycle (AP2)', () => {
  it('/challenge and /world/rp-context write nothing', async () => {
    const h = await harness();
    const put = vi.spyOn(h.adapters.ledger, 'put');
    await h.challengeFor('/claim', spk());
    await h.json('/world/rp-context', { audience: 'recharge', path: '/claim' });
    expect(put).not.toHaveBeenCalled();
  });

  it('one challenge for two humans ⇒ the second is 409 replay', async () => {
    const h = await harness();
    const key = spk();
    const ch = await h.challengeFor('/claim', key);
    expect((await claimWith(h, ch, key, 'a')).status).toBe(201);
    expect(await errorOf(await claimWith(h, ch, key, 'b'))).toBe('replay');
  });

  it('expired challenge ⇒ 410 and personhood.verify not called', async () => {
    const h = await harness();
    const key = spk();
    const ch = await h.challengeFor('/claim', key);
    h.clock.advance(120_001);
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    expect(await errorOf(await claimWith(h, ch, key))).toBe('expired');
    expect(verify).not.toHaveBeenCalled();
  });

  it('a /claim challenge on /gift/claim, /card/redeem and /gift/reclaim ⇒ 401 each', async () => {
    const h = await harness();
    const key = spk();
    const ch = await h.challengeFor('/claim', key);
    const pin = '0000000000000000';
    expect((await h.json('/gift/claim', { pin, challenge: ch, sessionPubKey: key })).status).toBe(
      401,
    );
    expect((await h.json('/card/redeem', { pin, challenge: ch, sessionPubKey: key })).status).toBe(
      401,
    );
    expect(
      (
        await h.json('/gift/reclaim', {
          giftId: `0x${'01'.repeat(32)}`,
          payer: `0x${'02'.repeat(20)}`,
          signature: '0x00',
          challenge: ch,
        })
      ).status,
    ).toBe(401);
  });

  it('session swap and edited challenge fields ⇒ 401 (or 400 for a non-literal audience), never 201', async () => {
    const h = await harness();
    const a = spk();
    const ch = await h.challengeFor('/claim', a);
    expect((await claimWith(h, ch, spk())).status).toBe(401);
    const flip = (hex: string) => `${hex.slice(0, -1)}${hex.endsWith('0') ? '1' : '0'}`;
    expect((await claimWith(h, { ...ch, nonce: flip(ch.nonce) }, a)).status).toBe(401);
    expect((await claimWith(h, { ...ch, exp: ch.exp + 1 }, a)).status).toBe(401);
    expect((await claimWith(h, { ...ch, audience: 'recharg3' }, a)).status).toBe(400);
  });

  it('fail closed: ledger.put throwing ⇒ 503 ledger_unavailable and personhood.verify not called', async () => {
    const h = await harness();
    vi.spyOn(h.adapters.ledger, 'put').mockRejectedValue(new Error('arkiv down'));
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const { res } = await h.claim();
    expect([res.status, await errorOf(res)]).toEqual([503, 'ledger_unavailable']);
    expect(verify).not.toHaveBeenCalled();
  });

  it('restart replay: a fresh app over the same ledger still refuses a consumed challenge (ledger nonce entity)', async () => {
    const h = await harness();
    const key = spk();
    const ch = await h.challengeFor('/claim', key);
    expect((await claimWith(h, ch, key)).status).toBe(201);
    const deps = await buildDeps(
      {
        MODE: 'local',
        X402_FACILITATOR: 'mock',
        OCTROI_SECRET: SECRET,
        USDC_ADDRESS: h.deps.accepts[0]?.asset ?? '',
      },
      {
        now: h.clock.now,
        dataDrop: h.dataDrop,
        adapters: { ledger: h.adapters.ledger },
        anvilAnswers: async () => false,
      },
    );
    const restarted = createApp(deps);
    const res = await restarted.request('/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        proof: fixtureProof('orb', ch.signal as `0x${string}`, 'other'),
        campaignId: h.campaignId,
        challenge: ch,
        sessionPubKey: key,
      }),
    });
    expect(res.status).toBe(409);
  });
});
