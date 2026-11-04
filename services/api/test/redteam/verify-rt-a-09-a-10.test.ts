/**
 * Red-team verification variants for RT-A-09 (MODE=live inherits no local default) and RT-A-10 (rate limits bucket
 * IPv6 by /64). The regressions use the canonical spellings ('31337', 'http://localhost:3000', the checksummed
 * Anvil #4, `2001:db8:1:2::N`). Here: other spellings of the same values.
 */
import { describe, expect, it, vi } from 'vitest';

import { anvilAccounts } from '@ethglobal/adapters/testing';

import { fakeLiveEnv } from './rt-support.js';
import { isLoopbackEquivalentHost, isLoopbackOrigin, parseEnv } from '../../src/env.js';
import { ipBucket } from '../../src/middleware/rate-limit.js';
import { harness } from '../support/harness.js';

const FAKE_LIVE = fakeLiveEnv();

/** Either refuses to boot or yields a value that is not the local one. */
function refusedOr(
  env: Record<string, string>,
  ok: (e: ReturnType<typeof parseEnv>) => boolean,
): boolean {
  try {
    return ok(parseEnv(env));
  } catch {
    return true;
  }
}

describe('verify RT-A-09: other spellings of the local defaults are refused in MODE=live', () => {
  it.each(['0x7a69', ' 31337', '031337', '31337.0', '3.1337e4', 'eip155:31337'])(
    'CHAIN=%j ⇒ refused or not 31337',
    (chain) => {
      expect(refusedOr({ ...FAKE_LIVE, CHAIN: chain }, (e) => e.CHAIN !== 31337)).toBe(true);
    },
  );

  const noLoopback = (origins: string) =>
    refusedOr({ ...FAKE_LIVE, CORS_ORIGINS: origins }, (e) =>
      e.CORS_ORIGINS.every(
        (o) => !/localhost|127\.|\[::1\]|0\.0\.0\.0/i.test(o.replace(/\.(?=[:/]|$)/, '')),
      ),
    );

  it.each([
    'http://127.0.0.1:3000',
    'http://[::1]:3000',
    'http://LOCALHOST:3000',
    'https://recharge.example, http://localhost:3000',
    ',http://localhost:3000',
  ])('CORS_ORIGINS=%j ⇒ refused or no loopback origin', (origins) => {
    expect(noLoopback(origins)).toBe(true);
  });

  // Regression RT-A-09 (fixed): LOCALHOST_ORIGIN matched only localhost / 127.x.y.z / [::1] exactly, so these loopback
  // spellings booted MODE=live with a loopback CORS origin. isLoopbackOrigin parses with WHATWG URL first.
  it.each([
    'http://localhost.:3000',
    'http://0.0.0.0:3000',
    'http://app.localhost:3000',
    'http://127.1:3000',
  ])('CORS_ORIGINS=%j ⇒ refused or no loopback origin [RT-A-09]', (origins) => {
    expect(noLoopback(origins)).toBe(true);
  });

  it.each([
    'http://localhost.:3000',
    'http://LOCALHOST..:3000',
    'http://app.localhost:3000',
    'https://a.b.localhost.',
    'http://0.0.0.0:3000',
    'http://0:3000',
    'http://0.1.2.3',
    'http://127.1:3000',
    'http://127.255.255.254',
    'http://0x7f.1',
    'http://2130706433',
    'http://017700000001',
    'http://[::1]:3000',
    'http://[0:0:0:0:0:0:0:1]',
    'http://[::]:3000',
    'http://[::ffff:127.0.0.1]',
    'http://[::ffff:7f00:1]',
    'http://[::127.0.0.1]',
    'http://[::ffff:0.0.0.0]',
    'not an origin',
  ])(
    'MODE=live refuses the loopback-equivalent (or invalid) CORS origin %j [RT-A-09]',
    (origin) => {
      expect(isLoopbackOrigin(origin)).toBe(true);
      expect(() =>
        parseEnv({ ...FAKE_LIVE, CORS_ORIGINS: `https://recharge.example,${origin}` }),
      ).toThrow(/CORS_ORIGINS/);
    },
  );

  it.each([
    'https://recharge.example',
    'https://localhost.example.com',
    'https://mylocalhost',
    'http://128.0.0.1',
    'http://10.0.0.1:3000',
    'http://[2001:db8::1]',
    'http://[::ffff:8.8.8.8]',
    'http://[::2]',
  ])('a non-loopback origin %j is not a loopback origin [RT-A-09]', (origin) => {
    expect(isLoopbackOrigin(origin)).toBe(false);
    expect(isLoopbackEquivalentHost(new URL(origin).hostname)).toBe(false);
  });

  it('parseEnv boots MODE=live with public origins only', () => {
    expect(
      parseEnv({
        ...FAKE_LIVE,
        CORS_ORIGINS: 'https://recharge.example,https://app.recharge.example',
      }).CORS_ORIGINS,
    ).toEqual(['https://recharge.example', 'https://app.recharge.example']);
  });

  it.each([
    ['lower-cased Anvil #4', anvilAccounts[4].toLowerCase()],
    ['upper-cased hex', `0x${anvilAccounts[4].slice(2).toUpperCase()}`],
    ['second in a list', `0x${'12'.repeat(20)}, ${anvilAccounts[0]}`],
    ['every Anvil account', anvilAccounts.join(',')],
  ])('AGENT_PAYERS with %s ⇒ refused or no public Anvil payer', (_n, payers) => {
    const anvil = new Set(anvilAccounts.map((a) => a.toLowerCase()));
    expect(
      refusedOr({ ...FAKE_LIVE, AGENT_PAYERS: payers }, (e) =>
        e.AGENT_PAYERS.every((p) => !anvil.has(p.toLowerCase())),
      ),
    ).toBe(true);
  });
});

describe('verify RT-A-10: every spelling of one /64 is one bucket', () => {
  const SAME_64 = [
    '2001:db8:1:2::1',
    '2001:DB8:1:2::FFFF',
    '2001:0db8:0001:0002:0000:0000:0000:0003',
    '[2001:db8:1:2::4]',
    '2001:db8:1:2::5%eth0',
    '2001:db8:1:2:aaaa:bbbb:1.2.3.4',
    '2001:db8:1:2:0:0:0:6',
    '2001:db8:1:2:ffff:ffff:ffff:ffff',
  ];
  it('ipBucket maps every spelling to the same /64', () => {
    const buckets = new Set(SAME_64.map(ipBucket));
    expect([...buckets]).toEqual(['2001:db8:1:2::/64']);
  });

  it('20 /world/rp-context across those spellings within a minute ⇒ at most 10 signed', async () => {
    const h = await harness();
    const signs = vi.spyOn(h.deps.rpSigner, 'issue');
    for (let i = 0; i < 20; i++) {
      await h.request('/world/rp-context', {
        method: 'POST',
        ip: SAME_64[i % SAME_64.length]!,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audience: 'recharge', path: '/claim' }),
      });
    }
    expect(signs.mock.calls.length).toBeLessThanOrEqual(10);
  });
});
