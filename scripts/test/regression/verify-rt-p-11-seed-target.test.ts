/**
 * Red-team verification variant for RT-P-11 (demo-seed --reset runs only against a local stack): the regression points
 * the seed at an API whose /healthz says mode=live. Here the API answers exactly what the gate wants
 * (`mode: 'local', chainId: 31337`) but RPC_URL is a node of ANOTHER chain (Base Sepolia, 84532) — the seed's
 * Anvil-key transactions must never be executable there. Also: /healthz spellings that are not exactly local/31337.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseTransaction, type Hex } from 'viem';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPTS = join(import.meta.dirname, '..', '..');
const TSX = join(SCRIPTS, 'node_modules/.bin/tsx');
const scratch = mkdtempSync(join(tmpdir(), 'verify-p11-'));
const servers: Server[] = [];
afterAll(() => {
  for (const s of servers) s.close();
  rmSync(scratch, { recursive: true, force: true });
});

async function listen(handler: (body: string, url: string) => unknown): Promise<number> {
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (d: Buffer) => (body += d.toString()));
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify(handler(body, req.url ?? '')));
    });
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return (server.address() as { port: number }).port;
}

function seed(apiPort: number, rpcPort: number): Promise<{ code: number | null; err: string }> {
  const out = join(scratch, `out-${apiPort}`);
  mkdirSync(out, { recursive: true });
  return new Promise((resolve) => {
    const child = spawn(TSX, [join(SCRIPTS, 'demo-seed.ts'), '--reset', '--quiet'], {
      cwd: SCRIPTS,
      env: {
        PATH: process.env.PATH ?? '',
        API_URL: `http://127.0.0.1:${apiPort}`,
        RPC_URL: `http://127.0.0.1:${rpcPort}/`,
        E2E_OUT: out,
      },
    });
    let err = '';
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    const t = setTimeout(() => child.kill('SIGKILL'), 50_000);
    child.on('exit', (code) => {
      clearTimeout(t);
      resolve({ code, err });
    });
  });
}

describe('verify RT-P-11: the seed never transacts on a chain that is not Anvil', () => {
  it('API says local/31337, RPC_URL serves chain 84532 ⇒ every broadcast tx is signed for 31337 (unexecutable there)', async () => {
    const methods: string[] = [];
    const raw: Hex[] = [];
    const rpc = await listen((body) => {
      const calls = [JSON.parse(body) as { id: number; method: string; params?: unknown[] }].flat();
      const answer = (c: { id: number; method: string; params?: unknown[] }) => {
        methods.push(c.method);
        if (c.method === 'eth_sendRawTransaction') raw.push(c.params![0] as Hex);
        const result =
          c.method === 'eth_chainId'
            ? '0x14a34'
            : c.method === 'eth_getBlockByNumber'
              ? {
                  number: '0x10',
                  timestamp: '0x690a0000',
                  baseFeePerGas: '0x1',
                  hash: `0x${'1'.repeat(64)}`,
                  transactions: [],
                }
              : c.method === 'eth_sendRawTransaction'
                ? `0x${'2'.repeat(64)}`
                : c.method === 'eth_call'
                  ? `0x${'0'.repeat(64 * 8)}`
                  : '0x1';
        return { jsonrpc: '2.0', id: c.id, result };
      };
      const parsed = JSON.parse(body) as unknown;
      return Array.isArray(parsed) ? calls.map(answer) : answer(calls[0]!);
    });
    const api = await listen((_b, url) =>
      url.startsWith('/healthz')
        ? { ok: true, mode: 'local', chainId: 31337 }
        : { now: Date.now() },
    );
    await seed(api, rpc);
    // the seed does not check the RPC's eth_chainId and DOES broadcast (observation, RT-P-11.md) — but every
    // transaction is EIP-155-signed for Anvil (31337), so no node of another chain can execute it
    expect(methods).toContain('eth_sendRawTransaction');
    expect(raw.length).toBeGreaterThan(0);
    for (const tx of raw) expect(parseTransaction(tx).chainId).toBe(31337);
  }, 60_000);

  it.each([
    { mode: 'Local', chainId: 31337 },
    { mode: 'local ', chainId: 31337 },
    { mode: 'local', chainId: '31337' },
    { mode: ['local'], chainId: 31337 },
    { mode: 'local' },
  ])(
    '/healthz %j ⇒ refused before any RPC call',
    async (health) => {
      const methods: string[] = [];
      const rpc = await listen((body) => {
        methods.push((JSON.parse(body) as { method?: string }).method ?? 'batch');
        return { jsonrpc: '2.0', id: 1, result: '0x7a69' };
      });
      const api = await listen((_b, url) => (url.startsWith('/healthz') ? health : {}));
      const r = await seed(api, rpc);
      expect(r.code).not.toBe(0);
      expect(r.err).toMatch(/refusing to seed/);
      expect(methods).toEqual([]);
    },
    60_000,
  );
});
