/**
 * Red-team verification variant for RT-P-02 (a SIGKILLed e2e-local.sh leaves nothing running): wave3-ops/run.sh kills
 * the harness once, after "PASS setup: api". Here it is killed at three other moments — the first instant Anvil's port
 * listens (before or while its pid file is written), right after "PASS setup: anvil", and after "PASS setup: api" with
 * an immediate second run on the SAME ports (stale-run reaping must not refuse it, and it must be reaped in turn).
 * Same sandbox as run.sh: an isolated root whose `tsx` is a stub (no seed, no API code runs), .e2e/ untouched.
 */
import { execSync, spawn, type ChildProcess } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const ADDR = join(ROOT, 'packages/contracts/deploy/addresses.anvil.json');
const SB = join(tmpdir(), `verify-p02-${process.pid}`);
let backup: string | undefined;

const listening = (port: number): boolean => {
  const hex = `:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  return readFileSync('/proc/net/tcp', 'utf8')
    .split('\n')
    .slice(1)
    .some((l) => {
      const f = l.trim().split(/\s+/);
      return f[3] === '0A' && f[1]?.endsWith(hex);
    });
};
const sandboxProcs = (): string[] => {
  try {
    return execSync(`pgrep -af '${SB}/root/scripts' || true`, { encoding: 'utf8' })
      .split('\n')
      .filter((l) => l && !l.includes('pgrep'));
  } catch {
    return [];
  }
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await sleep(25);
  return pred();
}

function start(chain: number, api: number): { child: ChildProcess; log: () => string } {
  let out = '';
  const child = spawn('bash', [join(SB, 'root/scripts/e2e-local.sh')], {
    env: { ...process.env, E2E_ANVIL_PORT: String(chain), E2E_API_PORT: String(api) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (d: Buffer) => (out += d.toString()));
  child.stderr.on('data', (d: Buffer) => (out += d.toString()));
  return { child, log: () => out };
}

async function settled(
  chain: number,
  api: number,
): Promise<{ chain: boolean; api: boolean; procs: string[] }> {
  await until(() => !listening(chain) && !listening(api) && sandboxProcs().length === 0, 8_000);
  return { chain: listening(chain), api: listening(api), procs: sandboxProcs() };
}

describe.skipIf(!existsSync('/proc/net/tcp'))(
  'verify RT-P-02: SIGKILL at other phases leaves nothing behind',
  () => {
    beforeAll(() => {
      rmSync(SB, { recursive: true, force: true });
      mkdirSync(join(SB, 'root/scripts/node_modules/.bin'), { recursive: true });
      for (const f of ['e2e-local.sh', 'dev-chain.sh'])
        copyFileSync(join(ROOT, 'scripts', f), join(SB, 'root/scripts', f));
      for (const d of ['services', 'packages', 'node_modules', 'security'])
        symlinkSync(join(ROOT, d), join(SB, 'root', d));
      writeFileSync(join(SB, 'root/scripts/node_modules/.bin/tsx'), '#!/bin/sh\nexec sleep 300\n');
      chmodSync(join(SB, 'root/scripts/node_modules/.bin/tsx'), 0o755);
      if (existsSync(ADDR)) backup = readFileSync(ADDR, 'utf8');
    });
    afterAll(() => {
      try {
        execSync(`pkill -9 -f '${SB}/root/scripts' || true`);
      } catch {
        /* nothing left */
      }
      if (backup !== undefined) writeFileSync(ADDR, backup);
      rmSync(SB, { recursive: true, force: true });
    });

    it('killed the first instant Anvil listens (×3) ⇒ nothing listening, no sandbox process', async () => {
      for (let i = 0; i < 3; i++) {
        const [c, a] = [8686 + i * 2, 8896 + i * 2];
        const run = start(c, a);
        expect(await until(() => listening(c), 60_000)).toBe(true);
        run.child.kill('SIGKILL');
        expect(await settled(c, a)).toEqual({ chain: false, api: false, procs: [] });
      }
    }, 240_000);

    it('killed right after "PASS setup: anvil" ⇒ nothing listening', async () => {
      const [c, a] = [8692, 8902];
      const run = start(c, a);
      expect(await until(() => run.log().includes('PASS setup: anvil'), 90_000)).toBe(true);
      run.child.kill('SIGKILL');
      expect(await settled(c, a)).toEqual({ chain: false, api: false, procs: [] });
    }, 150_000);

    it('killed after "PASS setup: api", then a second run on the same ports starts and is reaped in turn', async () => {
      const [c, a] = [8694, 8904];
      const first = start(c, a);
      expect(await until(() => first.log().includes('PASS setup: api'), 120_000)).toBe(true);
      first.child.kill('SIGKILL');
      const second = start(c, a);
      expect(await until(() => second.log().includes('PASS setup: anvil'), 120_000)).toBe(true);
      second.child.kill('SIGKILL');
      expect(await settled(c, a)).toEqual({ chain: false, api: false, procs: [] });
    }, 300_000);
  },
);
