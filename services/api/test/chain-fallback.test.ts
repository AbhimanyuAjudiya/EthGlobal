/** RPC_FALLBACK_URL: a relay that errors hands the read to the second relay (chain.ts rpcTransport). */
import { createServer, type Server } from 'node:http';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createChainIdResolver } from '../src/chain.js';

import type { AddressInfo } from 'node:net';

const listen = (server: Server) =>
  new Promise<string>((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`),
    ),
  );

describe('RPC fallback', () => {
  const dead = createServer((_req, res) => {
    res.statusCode = 502;
    res.end('bad gateway');
  });
  let deadHits = 0;
  dead.on('request', () => deadHits++);
  const good = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      const { id } = JSON.parse(body) as { id: number };
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id, result: '0x128' }));
    });
  });
  let deadUrl = '';
  let goodUrl = '';
  beforeAll(async () => {
    [deadUrl, goodUrl] = await Promise.all([listen(dead), listen(good)]);
  });
  afterAll(() => {
    dead.close();
    good.close();
  });

  it('answers from RPC_FALLBACK_URL when RPC_URL fails', async () => {
    const chainId = createChainIdResolver({
      MODE: 'live',
      RPC_URL: deadUrl,
      RPC_FALLBACK_URL: goodUrl,
    });
    await expect(chainId()).resolves.toBe(296);
    expect(deadHits).toBe(1);
  });

  it('still fails without a fallback', async () => {
    const chainId = createChainIdResolver({
      MODE: 'live',
      RPC_URL: deadUrl,
      RPC_FALLBACK_URL: undefined,
    });
    await expect(chainId()).rejects.toThrow();
  });
});
