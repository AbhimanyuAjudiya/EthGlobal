/**
 * THREAT-MODEL T-85 (local-only hooks reach a real network) and T-64 (print secrets) — regression for RT-P-01, RT-P-02
 * and RT-P-11 on the TypeScript side (the bash side, SIGKILL of e2e-local.sh, is security/redteam/wave3-ops/run.sh
 * "process hygiene"; the API bind is services/api/test/listen.test.ts):
 *   - a harness process that is SIGKILLed has its PIN temp dir deleted by the watchdog;
 *   - a dead run's process groups are reaped by the next harness run (stale pid file);
 *   - demo-seed --reset refuses an API that is not MODE=local before deleting anything;
 *   - print-cards refuses a PRINT_TOKEN shorter than 32 random bytes;
 *   - the harness starts the API with HOST=127.0.0.1 and MODE=local only.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

const SCRIPTS = join(import.meta.dirname, '..', '..');
const ROOT = join(SCRIPTS, '..');
const TSX = join(SCRIPTS, 'node_modules/.bin/tsx');
const HARNESS = join(SCRIPTS, 'lib/harness.ts');
const PID_DIR = join(ROOT, '.e2e', 'pids');
const scratch = mkdtempSync(join(tmpdir(), 'rt85-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
const until = async (pred: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!pred() && Date.now() < end) await new Promise((r) => setTimeout(r, 100));
  return pred();
};

describe('harness process hygiene (RT-P-02, RT-P-11)', () => {
  it('SIGKILL of a harness process: the watchdog deletes its registered PIN temp dir', async () => {
    const secret = join(scratch, 'pins');
    mkdirSync(secret);
    writeFileSync(join(secret, 'cards.json'), '[]', { mode: 0o600 });
    const entry = join(scratch, 'victim.mts');
    writeFileSync(
      entry,
      `const { removeOnDeath } = await import(${JSON.stringify(HARNESS)});\n` +
        `removeOnDeath(${JSON.stringify(secret)});\nconsole.log('ready');\nsetInterval(() => {}, 1000);\n`,
    );
    // one process (`node --import tsx`, not the tsx wrapper): SIGKILL must hit the pid the watchdog watches
    const child = spawn(process.execPath, ['--import', 'tsx', entry], {
      cwd: SCRIPTS,
      stdio: ['ignore', 'pipe', 'inherit'],
    });
    try {
      await new Promise<void>((resolve) => child.stdout.once('data', () => resolve()));
      child.kill('SIGKILL');
      expect(await until(() => !existsSync(secret), 5_000)).toBe(true);
    } finally {
      child.kill('SIGKILL');
    }
  }, 30_000);

  it('the next harness run reaps the process groups of a run that died without cleanup', async () => {
    // a "stack" in its own process group, recorded by a run whose owner pid is dead
    const stack = spawn('sleep', ['300'], { detached: true, stdio: 'ignore' });
    stack.unref();
    const dead = spawnSync('true').pid; // a pid that has exited
    mkdirSync(PID_DIR, { recursive: true });
    const file = join(PID_DIR, `harness-${dead}.pids`);
    writeFileSync(file, `${stack.pid} chain\n`);
    expect(alive(stack.pid!)).toBe(true);
    const entry = join(scratch, 'reaper.mts');
    writeFileSync(
      entry,
      `const { reapStale } = await import(${JSON.stringify(HARNESS)});\nreapStale();\n`,
    );
    const r = spawnSync(TSX, [entry], { cwd: SCRIPTS, encoding: 'utf8' });
    expect(r.status).toBe(0);
    expect(await until(() => !alive(stack.pid!), 5_000)).toBe(true);
    expect(existsSync(file)).toBe(false);
  }, 30_000);

  it('startApi runs the API with MODE=local and HOST=127.0.0.1 (RT-P-01)', () => {
    const src = readFileSync(HARNESS, 'utf8');
    const env =
      /export async function startApi[\s\S]*?env: \{([\s\S]*?)\.\.\.env,/.exec(src)?.[1] ?? '';
    expect(env).toContain("MODE: 'local'");
    expect(env).toContain("HOST: '127.0.0.1'");
    expect(readFileSync(join(SCRIPTS, 'e2e-local.sh'), 'utf8')).toMatch(
      /env MODE=local HOST=127\.0\.0\.1 /,
    );
  });
});

describe('demo-seed --reset checks the target first (RT-P-11)', () => {
  let server: Server | undefined;
  afterAll(() => server?.close());

  it('an API whose /healthz says mode=live: refused, nothing deleted, no transaction attempted', async () => {
    const hits: string[] = [];
    server = createServer((req, res) => {
      hits.push(`${req.method} ${req.url}`);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ ok: true, mode: 'live', chainId: 84532 }));
    });
    await new Promise<void>((r) => server!.listen(0, '127.0.0.1', r));
    const port = (server.address() as { port: number }).port;
    const out = join(scratch, 'e2e-out');
    mkdirSync(out, { recursive: true });
    writeFileSync(join(out, 'cards.json'), '"sentinel"');
    const r = await new Promise<{ code: number | null; err: string }>((resolve) => {
      const child = spawn(TSX, [join(SCRIPTS, 'demo-seed.ts'), '--reset', '--quiet'], {
        cwd: SCRIPTS,
        env: {
          PATH: process.env.PATH ?? '',
          API_URL: `http://127.0.0.1:${port}`,
          RPC_URL: 'http://127.0.0.1:9/',
          E2E_OUT: out,
        },
      });
      let err = '';
      child.stderr.on('data', (d: Buffer) => (err += d.toString()));
      child.on('exit', (code) => resolve({ code, err }));
    });
    expect(r.code).not.toBe(0);
    expect(r.err).toMatch(/refusing to seed .*mode=live/);
    expect(readFileSync(join(out, 'cards.json'), 'utf8')).toBe('"sentinel"');
    expect(hits).toEqual(['GET /healthz']);
  }, 60_000);
});

describe('print-cards PRINT_TOKEN (RT-P-11, T-64)', () => {
  it.each(['short', 'x'.repeat(42), `${'a'.repeat(43)}+/=`])(
    'refuses PRINT_TOKEN=%s',
    (token) => {
      const r = spawnSync(
        TSX,
        [join(SCRIPTS, 'print-cards.ts'), '--count', '1', '--out', scratch],
        {
          cwd: SCRIPTS,
          encoding: 'utf8',
          env: { PATH: process.env.PATH ?? '', PRINT_TOKEN: token },
          timeout: 30_000,
        },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(/PRINT_TOKEN must be ≥ 43 base64url characters/);
      expect(r.stderr + r.stdout).not.toContain(token.length > 8 ? token : '\u0000');
    },
    40_000,
  );
});
