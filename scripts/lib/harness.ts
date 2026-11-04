/**
 * The one process harness (ARCHITECTURE §8 rule 13, ops-demo §1): start Anvil + Deploy.s.sol (scripts/dev-chain.sh),
 * the API (MODE=local), the web app; wait for ports; stop everything. Logs go to .e2e/<name>.log (git-ignored).
 * scripts/e2e-local.sh drives the same three processes from bash for CI; TypeScript scripts use this file.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { httpJson } from '@ethglobal/protocol/http';

export const ROOT = join(import.meta.dirname, '..', '..');
export const E2E_DIR = join(ROOT, '.e2e');

const children: ChildProcess[] = [];

/** argv for parseArgs, without the `--` that `pnpm <script> -- --flag` forwards verbatim. */
export const cliArgs = (): string[] => {
  const args = process.argv.slice(2);
  return args[0] === '--' ? args.slice(1) : args;
};

export interface WaitOptions {
  timeoutMs?: number;
  everyMs?: number;
}

/** Polls `pred` until it is truthy; throws with `what` after the deadline (ops-demo §12 bug 2: no fixed sleeps). */
export async function waitFor(
  pred: () => Promise<boolean> | boolean,
  what: string,
  { timeoutMs = 60_000, everyMs = 100 }: WaitOptions = {},
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await Promise.resolve(pred()).catch(() => false)) return;
    if (Date.now() > deadline)
      throw new Error(`timed out after ${timeoutMs} ms waiting for ${what}`);
    await new Promise((r) => setTimeout(r, everyMs));
  }
}

/** true when GET `url` answers any status below 500 within 2 s. */
export async function answers(url: string): Promise<boolean> {
  try {
    const { status } = await httpJson(url, {
      timeoutMs: 2_000,
      responseType: 'bytes',
      allowStatus: [301, 302, 307, 308, 400, 401, 402, 404, 410],
    });
    return status < 500;
  } catch {
    return false;
  }
}

function start(
  name: string,
  command: string,
  args: string[],
  opts: { cwd: string; env?: Record<string, string> },
): { child: ChildProcess; log: string } {
  mkdirSync(E2E_DIR, { recursive: true });
  const log = join(E2E_DIR, `${name}.log`);
  const out = createWriteStream(log);
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  children.push(child);
  return { child, log };
}

export interface ChainHandle {
  rpcUrl: string;
  log: string;
}

/** Anvil 31337 (1-s blocks) + Deploy.s.sol through scripts/dev-chain.sh; resolves once the deploy finished. */
export async function startChain(port = 8545): Promise<ChainHandle> {
  const rpcUrl = `http://127.0.0.1:${port}`;
  const { child, log } = start('chain', 'bash', [join(ROOT, 'scripts/dev-chain.sh')], {
    cwd: ROOT,
    env: { ANVIL_PORT: String(port) },
  });
  await waitFor(() => {
    if (child.exitCode !== null) throw new Error(`dev-chain exited; see ${log}`);
    return existsSync(log) && readFileSync(log, 'utf8').includes('deploy script finished');
  }, `the deploy on ${rpcUrl} (${log})`);
  return { rpcUrl, log };
}

export interface ApiHandle {
  apiUrl: string;
  log: string;
}

/** The API in MODE=local on Anvil with the self-run facilitator and the mock reseller (BUILD-PLAN §4). */
export async function startApi(
  rpcUrl: string,
  port = 8787,
  env: Record<string, string> = {},
): Promise<ApiHandle> {
  const apiUrl = `http://127.0.0.1:${port}`;
  const api = join(ROOT, 'services/api');
  const { child, log } = start('api', join(api, 'node_modules/.bin/tsx'), ['src/index.ts'], {
    cwd: api,
    env: {
      MODE: 'local',
      X402_FACILITATOR: 'self',
      RESELLER: 'mock',
      ANVIL_RPC_URL: rpcUrl,
      PORT: String(port),
      LOG_LEVEL: 'info',
      TRUST_PROXY: '1',
      CAMPAIGN_ID: '',
      ...env,
    },
  });
  await waitFor(async () => {
    if (child.exitCode !== null) throw new Error(`api exited; see ${log}`);
    const { data } = await httpJson<{ chainId?: number }>(`${apiUrl}/healthz`, {
      timeoutMs: 2_000,
    });
    return data.chainId === 31337;
  }, `GET ${apiUrl}/healthz (${log})`);
  return { apiUrl, log };
}

export interface WebHandle {
  webUrl: string;
  log: string;
}

/** apps/web: `next start` when a production build exists, else `next dev`. */
export async function startWeb(
  apiUrl: string,
  port = 3000,
  env: Record<string, string> = {},
): Promise<WebHandle> {
  const webUrl = `http://127.0.0.1:${port}`;
  const web = join(ROOT, 'apps/web');
  const next = join(web, 'node_modules/.bin/next');
  if (!existsSync(next)) throw new Error('apps/web has no next binary (install or link apps/web)');
  const built = existsSync(join(web, '.next/BUILD_ID'));
  const { child, log } = start(
    'web',
    next,
    [built ? 'start' : 'dev', '-p', String(port), '-H', '127.0.0.1'],
    {
      cwd: web,
      env: { NEXT_PUBLIC_MODE: 'local', NEXT_PUBLIC_API_URL: apiUrl, ...env },
    },
  );
  await waitFor(
    async () => {
      if (child.exitCode !== null) throw new Error(`web exited; see ${log}`);
      return answers(`${webUrl}/`);
    },
    `${webUrl}/ (${log})`,
    { timeoutMs: 120_000, everyMs: 500 },
  );
  return { webUrl, log };
}

/** Kills every process this harness started (each runs in its own process group: anvil under dev-chain too). */
export function stopAll(): void {
  for (const child of children.splice(0)) {
    if (child.pid === undefined || child.exitCode !== null) continue;
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  }
}
