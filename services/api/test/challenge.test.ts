import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { rpContextSigner } from '@ethglobal/adapters/live';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import { consumeChallenge, type Challenge } from '@ethglobal/octroi';
import { rpContextSchema } from '@ethglobal/protocol/schemas';

import { errorOf, harness } from './support/harness.js';

const spk = () => bytesToHex(generateSessionKeypair().publicKey);

describe('POST /challenge', () => {
  it('returns a MAC-valid challenge bound to sessionPubKey', async () => {
    const h = await harness();
    const key = spk();
    const ch = (await h.challengeFor('/claim', key)) as Challenge;
    expect(ch.exp).toBe(h.clock.now() + 120_000);
    expect(
      await consumeChallenge(
        h.deps.octroi.ledger,
        new Set(),
        ch,
        key,
        h.clock.now(),
        h.deps.secret,
      ),
    ).toBe('ok');
    expect(
      await consumeChallenge(
        h.deps.octroi.ledger,
        new Set(),
        { ...ch, nonce: (await h.challengeFor('/claim', key)).nonce } as Challenge,
        spk(),
        h.clock.now(),
        h.deps.secret,
      ),
    ).toBe('invalid');
  });

  it('writes nothing to the ledger', async () => {
    const h = await harness();
    const put = vi.spyOn(h.adapters.ledger, 'put');
    await h.challengeFor('/claim', spk());
    expect(put).not.toHaveBeenCalled();
  });

  it('refuses paths outside CHALLENGE_PATHS and a wrong audience', async () => {
    const h = await harness();
    expect(
      (await h.json('/challenge', { audience: 'recharge', path: '/admin', sessionPubKey: spk() }))
        .status,
    ).toBe(400);
    expect(
      (await h.json('/challenge', { audience: 'other', path: '/claim', sessionPubKey: spk() }))
        .status,
    ).toBe(400);
  });

  it('11th request in a minute → 429 before any work (T-45)', async () => {
    const h = await harness();
    const statuses = [];
    for (let i = 0; i < 11; i++)
      statuses.push(
        (
          await h.request('/challenge', {
            method: 'POST',
            ip: '192.0.2.7',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ audience: 'recharge', path: '/claim', sessionPubKey: spk() }),
          })
        ).status,
      );
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses[10]).toBe(429);
  });
});

describe('POST /world/rp-context', () => {
  it('returns rpContextSchema with expires_at − created_at = 300 from the server clock', async () => {
    const h = await harness();
    const ctx = rpContextSchema.parse(
      await (
        await h.json('/world/rp-context', { audience: 'recharge', path: '/claim', created_at: 1 })
      ).json(),
    );
    expect(ctx.expires_at - ctx.created_at).toBe(300);
    expect(ctx.created_at).toBe(Math.floor(h.clock.now() / 1000));
    expect(ctx).toMatchObject({
      rp_id: 'rp_local',
      action: 'recharge-welcome',
      environment: 'production',
    });
  });

  it('the signature verifies against the RP signer address (fixture key)', async () => {
    const h = await harness();
    const ctx = rpContextSchema.parse(
      await (await h.json('/world/rp-context', { audience: 'recharge', path: '/claim' })).json(),
    );
    expect(await rpContextSigner(ctx)).toBe(
      privateKeyToAccount(h.deps.env.WORLD_RP_SIGNING_KEY as `0x${string}`).address,
    );
  });

  it('refuses another action or audience (400)', async () => {
    const h = await harness();
    expect((await h.json('/world/rp-context', { audience: 'x', path: '/claim' })).status).toBe(400);
    expect(
      await errorOf(await h.json('/world/rp-context', { audience: 'recharge', path: '/nope' })),
    ).toBe('invalid_request');
  });

  it('a different OCTROI_SECRET mints challenges this API rejects', async () => {
    const other = await harness({ env: { OCTROI_SECRET: `0x${'09'.repeat(32)}` } });
    const h = await harness();
    const key = spk();
    const forged = (await other.challengeFor('/claim', key)) as Challenge;
    expect(
      await consumeChallenge(
        h.deps.octroi.ledger,
        new Set(),
        forged,
        key,
        h.clock.now(),
        h.deps.secret,
      ),
    ).toBe('invalid');
  });
});
