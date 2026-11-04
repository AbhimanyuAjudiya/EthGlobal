/**
 * RT-P-01 (T-85): the API binds loopback unless HOST says otherwise, and MODE=local refuses any other HOST, so
 * /__local/clock, /__local/world-proof and the X-Seed-* hooks of a demo stack never reach the venue LAN.
 * The first test boots the real entry point (src/index.ts) in a child process and reads the listener address.
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isLoopbackHost, parseEnv } from '../src/env.js';
import { LIVE_ENV } from './support/live-env.js';

const API = join(import.meta.dirname, '..');
const TSX = join(API, 'node_modules/.bin/tsx');

const freePort = () =>
  new Promise<number>((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const address = s.address();
      s.close(() => resolve(typeof address === 'object' && address ? address.port : 0));
    });
  });

/** IPv4 listeners on `port` from /proc/net/tcp ("0100007F" = 127.0.0.1, "00000000" = 0.0.0.0); Linux only. */
const listeners = (port: number): string[] => {
  if (!existsSync('/proc/net/tcp')) return [];
  const hex = `:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  return readFileSync('/proc/net/tcp', 'utf8')
    .split('\n')
    .slice(1)
    .map((l) => l.trim().split(/\s+/))
    .filter((f) => f[3] === '0A' && f[1]?.endsWith(hex))
    .map((f) => f[1]!.split(':')[0]!);
};

describe('listen address (RT-P-01)', () => {
  it('src/index.ts in MODE=local listens on 127.0.0.1 only', async () => {
    const port = await freePort();
    const child = spawn(TSX, ['src/index.ts'], {
      cwd: API,
      env: {
        PATH: process.env.PATH ?? '',
        MODE: 'local',
        PORT: String(port),
        X402_FACILITATOR: 'mock',
        RESELLER: 'mock',
        LOG_LEVEL: 'info',
        USDC_ADDRESS: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (out += d.toString()));
    try {
      const deadline = Date.now() + 30_000;
      while (!out.includes('"api listening"')) {
        if (child.exitCode !== null) throw new Error(`api exited: ${out.slice(0, 400)}`);
        if (Date.now() > deadline) throw new Error(`api did not boot: ${out.slice(0, 400)}`);
        await new Promise((r) => setTimeout(r, 100));
      }
      const line = out.split('\n').find((l) => l.includes('"api listening"')) ?? '{}';
      expect((JSON.parse(line) as { host?: string }).host).toBe('127.0.0.1');
      if (existsSync('/proc/net/tcp')) expect(listeners(port)).toEqual(['0100007F']);
    } finally {
      child.kill('SIGTERM');
    }
  }, 45_000);

  it('HOST defaults to 127.0.0.1 in both modes; MODE=local refuses a non-loopback HOST', () => {
    expect(parseEnv({ MODE: 'local' }).HOST).toBe('127.0.0.1');
    expect(parseEnv(LIVE_ENV).HOST).toBe('127.0.0.1');
    expect(parseEnv({ ...LIVE_ENV, HOST: '0.0.0.0' }).HOST).toBe('0.0.0.0'); // the VPS says so explicitly
    for (const host of ['0.0.0.0', '192.168.1.20', '::', 'example.com'])
      expect(() => parseEnv({ MODE: 'local', HOST: host })).toThrow(/HOST/);
    for (const host of ['127.0.0.1', '127.0.0.2', '::1', 'localhost'])
      expect(parseEnv({ MODE: 'local', HOST: host }).HOST).toBe(host);
  });

  it('isLoopbackHost', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('127.0.0.1.example.com')).toBe(false);
  });
});
