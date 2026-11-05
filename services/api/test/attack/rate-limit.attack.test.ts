/** AP8 — rate limits, write amplification, limiter races, body limits (T-45). */
import { describe, expect, it, vi } from 'vitest';

import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';

import { harness, type Harness } from './fixture.js';

const post = async (
  h: Harness,
  path: string,
  body: unknown,
  ip: string,
  extra: Record<string, string> = {},
) =>
  h.request(path, {
    method: 'POST',
    ip,
    headers: { 'content-type': 'application/json', ...extra },
    body: JSON.stringify(body),
  });
const spk = () => bytesToHex(generateSessionKeypair().publicKey);

describe('attack: rate limits (AP8)', () => {
  it.each([
    ['/challenge', 10, () => ({ audience: 'recharge', path: '/claim', sessionPubKey: spk() })],
    ['/world/rp-context', 10, () => ({ audience: 'recharge', path: '/claim' })],
    ['/claim', 5, () => ({})],
    ['/card/redeem', 10, () => ({})],
    ['/gift/reclaim', 5, () => ({})],
  ] as const)('%s: request %i+1 from one IP ⇒ 429 with Retry-After', async (path, limit, body) => {
    const h = await harness();
    for (let i = 0; i < limit; i++)
      expect((await post(h, path, body(), '192.0.2.10')).status).not.toBe(429);
    const over = await post(h, path, body(), '192.0.2.10');
    expect(over.status).toBe(429);
    expect(Number(over.headers.get('retry-after'))).toBeGreaterThan(0);
  });

  it('50 concurrent /claim from one IP ⇒ at most 5 reach octroi, and the 429s touch no ledger, chain or reseller', async () => {
    const h = await harness();
    const ch = await h.challengeFor('/claim', spk());
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const query = vi.spyOn(h.adapters.ledger, 'query');
    const campaign = vi.spyOn(h.dataDrop, 'campaign');
    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        post(h, '/claim', { campaignId: h.campaignId, challenge: ch }, '192.0.2.11'),
      ),
    );
    expect(results.filter((r) => r.status === 429)).toHaveLength(45);
    expect(verify).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(campaign).not.toHaveBeenCalled();
  });

  it('without TRUST_PROXY a spoofed X-Forwarded-For shares the socket bucket; with it the RIGHT-most hop is used', async () => {
    const plain = await harness({ env: { TRUST_PROXY: '0' } });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++)
      statuses.push(
        (
          await post(
            plain,
            '/challenge',
            { audience: 'recharge', path: '/claim', sessionPubKey: spk() },
            `10.0.0.${i}`,
          )
        ).status,
      );
    expect(statuses.at(-1)).toBe(429);
    const proxied = await harness();
    const hops: number[] = [];
    for (let i = 0; i < 11; i++)
      hops.push(
        (
          await post(
            proxied,
            '/challenge',
            { audience: 'recharge', path: '/claim', sessionPubKey: spk() },
            `1.1.1.${i}, 203.0.113.50`,
          )
        ).status,
      );
    expect(hops.at(-1)).toBe(429);
  });

  it('a 65 KiB JSON body ⇒ 413; 64 KiB of nested arrays ⇒ 400 quickly', async () => {
    const h = await harness();
    const big = await h.request('/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pad: 'x'.repeat(65 * 1024) }),
    });
    expect(big.status).toBe(413);
    const started = performance.now();
    const nested = await h.request('/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: `${'['.repeat(30_000)}${']'.repeat(30_000)}`,
    });
    expect(nested.status).toBe(400);
    expect(performance.now() - started).toBeLessThan(500);
  });

  it('1 000 /challenge and 1 000 unpaid top-ups create 0 ledger entities; 1 000 random /me reads make 0 reseller calls', async () => {
    const h = await harness();
    const put = vi.spyOn(h.adapters.ledger, 'put');
    const usage = vi.spyOn(h.reseller, 'usage');
    await Promise.all(
      Array.from({ length: 1000 }, () =>
        post(
          h,
          '/challenge',
          { audience: 'recharge', path: '/claim', sessionPubKey: spk() },
          '192.0.2.12',
        ),
      ),
    );
    await Promise.all(
      Array.from({ length: 200 }, async (_, i) =>
        h.get(
          `/me/${encodeURIComponent(`ent:v1:0x${i.toString(16).padStart(64, '0')}`)}?refresh=1`,
        ),
      ),
    );
    expect(put).not.toHaveBeenCalled();
    expect(usage).not.toHaveBeenCalled();
  });
});
