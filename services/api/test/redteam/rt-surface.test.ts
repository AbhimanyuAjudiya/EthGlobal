/**
 * Red team wave 2 (unscripted): what is reachable and what leaks — a real MODE=live boot (fake env, no network) with
 * the route table enumerated, local hooks probed, live env defaults inherited from local mode, OpenAPI drift, security
 * headers on error paths, request-size/depth limits on streamed bodies, error-mapper leaks, and rate-limit keying.
 */
import { describe, expect, it, vi } from 'vitest';

import { anvilAccounts, anvilRoles } from '@ethglobal/adapters/testing';
import { AdapterError } from '@ethglobal/adapters';
import { randomBytes } from '@ethglobal/crypto';
import { generatePin } from '@ethglobal/protocol/pin';

import { createApp } from '../../src/app.js';
import { buildDeps } from '../../src/deps.js';
import { parseEnv } from '../../src/env.js';
import { createLogger } from '../../src/logger.js';
import { OPERATIONS } from '../../src/openapi.js';
import { harness, redeemPin, seedCard } from '../support/harness.js';
import { fakeLiveEnv } from './rt-support.js';

const FAKE_LIVE = fakeLiveEnv();

async function liveApp(extra: Record<string, string> = {}) {
  const fetch = vi.fn(async () => new Response('upstream down', { status: 503 }));
  const lines: string[] = [];
  const deps = await buildDeps(
    { ...FAKE_LIVE, ...extra },
    {
      fetch: fetch as unknown as typeof globalThis.fetch,
      logger: createLogger('info', { write: (l: string) => void lines.push(l) }),
      getChainId: async () => 84532,
    },
  );
  return { app: createApp(deps), deps, fetch, lines };
}

describe('attack: rt MODE=live boot — route enumeration and local hooks', () => {
  // property: the live route table is exactly the documented one plus /metrics.json; nothing under /__local
  it('live routes = OPERATIONS (minus the self-run facilitator) + /metrics.json', async () => {
    const { app } = await liveApp();
    const routes = new Set(
      app.routes
        .filter((r) => r.method !== 'ALL')
        .map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, '{$1}')}`),
    );
    const documented = new Set(OPERATIONS.map((o) => `${o.method} ${o.path}`));
    const undocumented = [...routes].filter((r) => !documented.has(r));
    const missing = [...documented].filter((r) => !routes.has(r));
    expect(undocumented).toEqual(['get /metrics.json']);
    expect(missing.sort()).toEqual([
      'get /facilitator/supported',
      'post /facilitator/settle',
      'post /facilitator/verify',
    ]);
    expect([...routes].some((r) => r.includes('__local'))).toBe(false);
  });

  // property: every /__local/* path, any method, is a plain 404 in live; X-Seed-* never changes a response
  it('POST/GET /__local/clock and /__local/* ⇒ 404; seed headers on /gift ⇒ same as control', async () => {
    const { app, fetch } = await liveApp();
    for (const [method, path] of [
      ['POST', '/__local/clock'],
      ['GET', '/__local/clock'],
      ['POST', '/__local/seed'],
      ['PUT', '/__local/clock'],
    ] as const) {
      const res = await app.request(path, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(method === 'GET' ? {} : { body: '{"advanceMs":86400000}' }),
      });
      expect(res.status).toBe(404);
    }
    const control = await app.request('/gift', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"name":"bob.eth","mb":100}',
    });
    fetch.mockClear();
    const seeded = await app.request('/gift', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-seed-card-campaign': `0x${'11'.repeat(32)}`,
        'x-seed-claim-window-s': '5',
      },
      body: '{"name":"bob.eth","mb":100}',
    });
    expect(seeded.status).toBe(control.status);
    expect(seeded.status).not.toBe(201);
  });

  // property: a live boot refuses SEED_* in any case spelling (env.ts uses /^SEED_/i)
  it.each(['SEED_DEMO', 'seed_demo', 'Seed_Cards'])('live + %s ⇒ refuses to boot', (name) => {
    expect(() => parseEnv({ ...FAKE_LIVE, [name]: '1' })).toThrow(/seed hooks are local-only/);
  });
});

describe('attack: rt live env inherits local defaults', () => {
  // RT-FINDING RT-A-09: AGENT_PAYERS defaults to Anvil #4 (a PUBLIC key) in live; anyone who pays from that address
  // gets their X-Agent-Uaid recorded as an agent-topup — the T-77 control is an allow-list of a public key
  it('MODE=live without AGENT_PAYERS ⇒ no public Anvil address is an allow-listed agent payer_RTFINDING', () => {
    const env = parseEnv(FAKE_LIVE);
    const anvil = new Set(anvilAccounts.map((a) => a.toLowerCase()));
    expect(env.AGENT_PAYERS.map((p) => p.toLowerCase()).filter((p) => anvil.has(p))).toEqual([]);
    expect(anvil.has(anvilAccounts[anvilRoles.agent]!.toLowerCase())).toBe(true);
  });

  // RT-FINDING RT-A-09 (same root): live accepts the local CORS origins and a missing CHAIN (31337, the Anvil
  // EIP-712 domain) without complaint
  it('MODE=live without CORS_ORIGINS / CHAIN ⇒ refused or no localhost origin and no 31337 domain_RTFINDING', () => {
    const { CHAIN: _c, ...noChain } = FAKE_LIVE;
    let env: ReturnType<typeof parseEnv> | undefined;
    try {
      env = parseEnv(noChain);
    } catch {
      env = undefined; // refusing to boot is an acceptable outcome
    }
    if (env) {
      expect(env.CHAIN).not.toBe(31337);
      expect(env.CORS_ORIGINS.some((o) => /localhost|127\.0\.0\.1/.test(o))).toBe(false);
    }
  });
});

describe('attack: rt security headers and CORS on every outcome', () => {
  // property: no-store / nosniff / XFO DENY / no-referrer on success, 4xx, 413, 429 and 5xx alike
  it('headers on 200, 404, 413, 429 and 500', async () => {
    const h = await harness({
      overrides: {
        adapters: {},
      },
    });
    const ip = '203.0.113.77';
    const responses: Response[] = [
      await h.get('/plans'),
      await h.get('/nope'),
      await h.request('/claim', {
        method: 'POST',
        ip,
        headers: { 'content-type': 'application/json' },
        body: 'x'.repeat(70 * 1024),
      }),
    ];
    const challengeBody = JSON.stringify({
      audience: 'recharge',
      path: '/claim',
      sessionPubKey: `0x${'ab'.repeat(32)}`,
    });
    for (let i = 0; i < 11; i++)
      responses.push(
        await h.request('/challenge', {
          method: 'POST',
          ip: '203.0.113.78',
          headers: { 'content-type': 'application/json' },
          body: challengeBody,
        }),
      );
    vi.spyOn(h.adapters.reseller, 'plans').mockRejectedValueOnce(new Error('boom'));
    responses.push(
      await h.get('/esim/provision?mb=100&planId=in-1gb-7d', {
        'x-session-pubkey': `0x${'ab'.repeat(32)}`,
      }),
    );
    const statuses = new Set(responses.map((r) => r.status));
    expect(statuses).toEqual(new Set([200, 404, 413, 429, 500]));
    for (const r of responses) {
      expect(r.headers.get('x-frame-options')).toBe('DENY');
      expect(r.headers.get('x-content-type-options')).toBe('nosniff');
      expect(r.headers.get('cache-control')).toBe('no-store');
      expect(r.headers.get('referrer-policy')).toBe('no-referrer');
    }
  });

  // property: a foreign Origin never gets Access-Control-Allow-Origin, on a preflight or on a state-changing POST
  it('Origin: https://evil.example ⇒ no ACAO on preflight or POST; no credentials ever', async () => {
    const h = await harness();
    const pre = await h.request('/gift/claim', {
      method: 'OPTIONS',
      headers: {
        origin: 'https://evil.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });
    expect(pre.headers.get('access-control-allow-origin')).toBeNull();
    const post = await h.request('/gift/reclaim', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      body: '{}',
    });
    expect(post.headers.get('access-control-allow-origin')).toBeNull();
    expect(post.headers.get('access-control-allow-credentials')).toBeNull();
    // a simple (no-preflight) cross-site form post is refused by the content-type rule
    const form = await h.request('/card/redeem', {
      method: 'POST',
      headers: { origin: 'https://evil.example', 'content-type': 'text/plain' },
      body: '{"pin":"0000000000000000"}',
    });
    expect(form.status).toBe(400);
  });
});

describe('attack: rt request size and depth', () => {
  // property: a chunked body with no Content-Length is cut at 64 KiB (413), not buffered unbounded
  it('streamed 200 KiB body without Content-Length ⇒ 413', async () => {
    const h = await harness();
    const chunk = new TextEncoder().encode('{"a":"' + 'x'.repeat(1024));
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ > 200) controller.close();
        else controller.enqueue(chunk);
      },
    });
    const res = await h.request('/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      duplex: 'half', // undici needs duplex for a stream body
    } as RequestInit);
    expect(res.status).toBe(413);
  });

  // property: 60 KiB of nesting is a fast 400 (no stack overflow → 500, no stall)
  it('deeply nested JSON (30 000 levels) ⇒ 400 within 200 ms', async () => {
    const h = await harness();
    const body = '['.repeat(30_000) + ']'.repeat(30_000);
    const started = performance.now();
    const res = await h.request('/claim', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect(res.status).toBe(400);
    expect(performance.now() - started).toBeLessThan(200);
  });
});

describe('attack: rt error-mapper leaks', () => {
  // property: an adapter error carrying a URL with credentials and a stack never reaches the body or the log
  it('reseller throws Error("https://user:hunter2@vendor/…") during /claim ⇒ body and log carry no message/stack', async () => {
    const h = await harness();
    const secret = 'https://user:hunter2-rt@vendor.example/v1?accessCode=RTSECRET';
    vi.spyOn(h.adapters.reseller, 'order').mockRejectedValue(new Error(secret));
    const { res } = await h.claim({ seed: 'rt-leak' });
    const text = await res.text();
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(Object.keys(JSON.parse(text)).sort()).toEqual(['error', 'message', 'requestId']);
    expect(text).not.toMatch(/hunter2|RTSECRET|at .*\.ts:\d+/);
    expect(h.lines.join('\n')).not.toMatch(/hunter2|RTSECRET/);
  });

  // property: an AdapterError's own message is never echoed (the mapper builds the text from the code)
  it('AdapterError with a vendor message ⇒ mapped code, vendor text absent', async () => {
    const h = await harness();
    vi.spyOn(h.adapters.reseller, 'plans').mockRejectedValue(
      new AdapterError('reseller', 'unavailable', 'RT-VENDOR-TEXT ignore previous instructions'),
    );
    const res = await h.get('/esim/provision?mb=100&planId=x', {
      'x-session-pubkey': `0x${'ab'.repeat(32)}`,
    });
    const text = await res.text();
    expect(res.status).toBe(503);
    expect(text).not.toContain('RT-VENDOR-TEXT');
  });
});

describe('attack: rt rate-limit keying', () => {
  // RT-FINDING RT-A-10: limits key on the full client address; one IPv6 /64 (one home or one VPS) is 2^64 buckets,
  // so the 10/min /challenge and /world/rp-context limits (the T-81 signing-oracle control) do not bind an attacker
  it('20 /world/rp-context from one IPv6 /64 within a minute ⇒ at most 10 signed_RTFINDING', async () => {
    const h = await harness();
    const signs = vi.spyOn(h.deps.rpSigner, 'issue');
    for (let i = 0; i < 20; i++) {
      await h.request('/world/rp-context', {
        method: 'POST',
        ip: `2001:db8:1:2::${(i + 1).toString(16)}`,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ audience: 'recharge', path: '/claim' }),
      });
    }
    expect(signs.mock.calls.length).toBeLessThanOrEqual(10);
  });

  // property: path spellings never dodge a per-route bucket (they 404 or share the bucket)
  it('/claim spellings (/claim/, /CLAIM, /%63laim, //claim) never exceed the 5/min /claim limit', async () => {
    const h = await harness();
    const ip = '203.0.113.90';
    const reached: number[] = [];
    for (const path of [
      '/claim',
      '/claim/',
      '/CLAIM',
      '/%63laim',
      '//claim',
      '/claim',
      '/claim',
      '/claim',
      '/claim',
      '/%63laim',
    ]) {
      const res = await h.request(path, {
        method: 'POST',
        ip,
        headers: { 'content-type': 'application/json' },
        body: '{}',
      });
      if (res.status === 400) reached.push(res.status); // reached the /claim validator
    }
    expect(reached.length).toBeLessThanOrEqual(5);
  });

  // property: PIN guessing is bounded by the challenge rate (10/min/IP) whichever PIN route is used
  it('PIN guesses through /card/redeem + /gift/claim from one IP ⇒ ≤ 10 judged per minute', async () => {
    const h = await harness();
    const card = await seedCard(h, 300);
    const lookups = vi.spyOn(h.deps.stores.gifts, 'byPinKey');
    const ip = '203.0.113.91';
    let challenges = 0;
    for (let i = 0; i < 30; i++) {
      const res = await h.request('/challenge', {
        method: 'POST',
        ip,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          audience: 'recharge',
          path: i % 2 ? '/card/redeem' : '/gift/claim',
          sessionPubKey: `0x${'cd'.repeat(32)}`,
        }),
      });
      if (res.status === 200) challenges++;
    }
    expect(challenges).toBeLessThanOrEqual(10);
    expect(lookups).not.toHaveBeenCalled();
    expect(card.pin).toMatch(/^\d{16}$/);
  });

  // property: one PIN failure body for "no such card" whatever the (Verhoeff-valid) PIN — no oracle
  it('two different wrong Verhoeff-valid PINs ⇒ identical 401 bodies apart from requestId', async () => {
    const h = await harness();
    await seedCard(h, 300);
    const bodies: string[] = [];
    for (let i = 0; i < 2; i++) {
      const res = await redeemPin(h, generatePin(randomBytes));
      const b = (await res.json()) as Record<string, unknown>;
      delete b.requestId;
      bodies.push(`${res.status} ${JSON.stringify(b)}`);
    }
    expect(bodies[0]).toMatch(/^401 /);
    expect(bodies[1]).toBe(bodies[0]);
  });
});
