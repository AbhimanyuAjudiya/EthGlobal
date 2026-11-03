import { pino } from 'pino';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createApp } from '../src/app.js';
import { createChainIdResolver } from '../src/chain.js';
import { parseEnv } from '../src/env.js';

const logger = pino({ level: 'silent' });

type FetchInput = Parameters<typeof fetch>[0];
type FetchInit = Parameters<typeof fetch>[1];

describe('GET /healthz', () => {
  it('reports chain 31337 in local mode without touching the network', async () => {
    const app = createApp({
      env: { MODE: 'local' },
      logger,
      getChainId: createChainIdResolver({ MODE: 'local' }),
    });
    const response = await app.request('/healthz');
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, mode: 'local', chainId: 31337 });
  });

  it('reports whatever the RPC answers in live mode', async () => {
    const app = createApp({
      env: { MODE: 'live' },
      logger,
      getChainId: () => Promise.resolve(1301),
    });
    const response = await app.request('/healthz');
    expect(await response.json()).toEqual({ ok: true, mode: 'live', chainId: 1301 });
  });

  it('answers 503 when the chain cannot be reached', async () => {
    const app = createApp({
      env: { MODE: 'live' },
      logger,
      getChainId: () => Promise.reject(new Error('ECONNREFUSED')),
    });
    const response = await app.request('/healthz');
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, mode: 'live', error: 'chain_unreachable' });
  });

  it('answers 404 as JSON elsewhere', async () => {
    const app = createApp({
      env: { MODE: 'local' },
      logger,
      getChainId: () => Promise.resolve(31337),
    });
    const response = await app.request('/nope');
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'not_found' });
  });
});

describe('createChainIdResolver (live)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads eth_chainId from the configured RPC through viem', async () => {
    const fetchMock = vi.fn(async (input: FetchInput, init?: FetchInit) => {
      const { id } = (await new Request(input, init).json()) as { id: number };
      return Response.json({ jsonrpc: '2.0', id, result: '0x515' });
    });
    vi.stubGlobal('fetch', fetchMock);
    const getChainId = createChainIdResolver({ MODE: 'live', RPC_URL: 'http://rpc.test' });
    await expect(getChainId()).resolves.toBe(1301);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [input, init] = fetchMock.mock.calls[0]!;
    const request = new Request(input, init);
    expect(request.url).toBe('http://rpc.test/');
    expect(request.method).toBe('POST');
  });
});

describe('parseEnv', () => {
  it('defaults to local mode on port 8787', () => {
    expect(parseEnv({})).toEqual({ MODE: 'local', PORT: 8787, LOG_LEVEL: 'info', CHAIN: 31337 });
  });

  it('treats empty strings as unset', () => {
    expect(parseEnv({ RPC_URL: '', PORT: '' }).PORT).toBe(8787);
  });

  it('requires RPC_URL in live mode and rejects bad values', () => {
    expect(() => parseEnv({ MODE: 'live' })).toThrow(/RPC_URL is required when MODE=live/);
    expect(() => parseEnv({ MODE: 'staging' })).toThrow(/Invalid environment/);
    expect(() => parseEnv({ MODE: 'live', RPC_URL: 'not a url' })).toThrow(/RPC_URL/);
    expect(
      parseEnv({ MODE: 'live', RPC_URL: 'https://sepolia.unichain.org', CHAIN: '1301' }),
    ).toMatchObject({
      MODE: 'live',
      CHAIN: 1301,
    });
  });
});
