import { afterEach, describe, expect, it, vi } from 'vitest';

import { createChainIdResolver } from '../src/chain.js';
import { openApiDocument, OPERATIONS } from '../src/openapi.js';
import { errorOf, harness } from './support/harness.js';

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

describe('app basics', () => {
  it('GET /healthz reports local chain 31337 and the attestor', async () => {
    const h = await harness();
    const res = await h.get('/healthz');
    expect(await res.json()).toMatchObject({
      ok: true,
      mode: 'local',
      chainId: 31337,
      attestor: h.dataDrop.attestor,
    });
  });

  it('GET /healthz answers 503 when the chain cannot be reached', async () => {
    const h = await harness({
      overrides: { getChainId: () => Promise.reject(new Error('ECONNREFUSED')) },
    });
    const res = await h.get('/healthz');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ ok: false, mode: 'local', error: 'chain_unreachable' });
  });

  it('unknown routes are errorBody 404s with the request id; every response carries the security headers', async () => {
    const h = await harness();
    const res = await h.get('/nope', { 'x-request-id': 'req-12345678' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'not_found',
      message: 'Not found.',
      requestId: 'req-12345678',
    });
    expect(res.headers.get('x-request-id')).toBe('req-12345678');
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
  });

  it('mints a request id when the client one is not 8–64 URL-safe chars', async () => {
    const h = await harness();
    const res = await h.get('/plans', { 'x-request-id': 'bad id!' });
    expect(res.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('CORS: exact-origin allow-list, x402 headers exposed, no credentials', async () => {
    const h = await harness();
    const ok = await h.request('/plans', {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:3000', 'access-control-request-method': 'GET' },
    });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
    expect(ok.headers.get('access-control-allow-credentials')).toBeNull();
    const get = await h.get('/plans', { origin: 'http://localhost:3000' });
    expect(get.headers.get('access-control-expose-headers')).toMatch(/PAYMENT-REQUIRED/);
    const evil = await h.get('/plans', { origin: 'https://evil.example' });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('bodies need Content-Type: application/json and valid JSON (400)', async () => {
    const h = await harness();
    const text = await h.request('/challenge', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{}',
    });
    expect([text.status, await errorOf(text)]).toEqual([400, 'invalid_request']);
    const broken = await h.request('/challenge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect(broken.status).toBe(400);
  });

  it('GET /plans: campaign from the ledger + chain, paid terms, gift sizes; cached 60 s', async () => {
    const h = await harness();
    const plans = (await (await h.get('/plans')).json()) as {
      campaign: { id: string; remainingClaims: number };
      paid: { accepts: unknown[]; priceUsd6PerStep: string };
    };
    expect(plans.campaign.id).toBe(h.campaignId);
    expect(plans.campaign.remainingClaims).toBe(2000);
    expect(plans.paid.priceUsd6PerStep).toBe('400000');
    expect(JSON.stringify(plans)).not.toMatch(/agentkit|maxAmountRequired/);
    const spy = vi.spyOn(h.deps.stores.campaigns, 'list');
    await h.get('/plans');
    expect(spy).not.toHaveBeenCalled();
  });

  it('GET /metrics.json exposes counters and histograms', async () => {
    const h = await harness();
    await h.get('/plans');
    const m = (await (await h.get('/metrics.json')).json()) as {
      histograms: Record<string, unknown>;
      degraded: boolean;
    };
    expect(Object.keys(m.histograms).some((k) => k.startsWith('http_ms'))).toBe(true);
    expect(m.degraded).toBe(false);
  });
});

describe('GET /openapi.json', () => {
  it('is OpenAPI 3.1 generated from the protocol schemas and equals the committed file', async () => {
    const h = await harness();
    const served = await (await h.get('/openapi.json')).json();
    const doc = openApiDocument();
    expect(served).toEqual(doc);
    expect(doc.openapi).toBe('3.1.0');
    const committed = (await import('../openapi.json', { with: { type: 'json' } })).default;
    expect(committed).toEqual(doc);
  });

  it('documents every route of the app and no route it does not have', async () => {
    const h = await harness();
    const routes = new Set(
      h.app.routes
        .filter((r) => r.method !== 'ALL')
        .map((r) => `${r.method.toLowerCase()} ${r.path.replace(/:(\w+)/g, '{$1}')}`),
    );
    for (const op of OPERATIONS) expect(routes).toContain(`${op.method} ${op.path}`);
    const documented = new Set(OPERATIONS.map((op) => `${op.method} ${op.path}`));
    const undocumented = [...routes].filter((r) => !documented.has(r) && r !== 'get /metrics.json');
    expect(undocumented).toEqual([]);
  });
});

describe('createChainIdResolver', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('local never touches a node; live reads eth_chainId through viem', async () => {
    await expect(createChainIdResolver({ MODE: 'local', RPC_URL: undefined })()).resolves.toBe(
      31337,
    );
    const fetchMock = vi.fn(async (input: FetchInput, init?: FetchInit) => {
      const { id } = (await new Request(input, init).json()) as { id: number };
      return Response.json({ jsonrpc: '2.0', id, result: '0x515' });
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createChainIdResolver({ MODE: 'live', RPC_URL: 'http://rpc.test' })(),
    ).resolves.toBe(1301);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('POST /__local/clock (MODE=local only)', () => {
  it('moves the injected local clock forward and refuses bad input', async () => {
    const { LocalClock } = await import('../src/seed.js');
    const { createApp } = await import('../src/app.js');
    const h = await harness();
    const clock = new LocalClock(() => 1_000);
    const app = createApp(h.deps, { localClock: clock });
    const post = (body: unknown) =>
      app.request('/__local/clock', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    expect((await post({ advanceMs: 5_000 })).status).toBe(200);
    expect(clock.now()).toBe(6_000);
    expect((await post({ advanceMs: -1 })).status).toBe(400);
    expect(h.lines.join('')).toMatch(/"hook":"clock"/);
  });
});
