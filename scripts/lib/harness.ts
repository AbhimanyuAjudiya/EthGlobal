/**
 * The one process harness (ARCHITECTURE §8 rule 13, ops-demo §1): start Anvil + Deploy.s.sol (scripts/dev-chain.sh),
 * the API (MODE=local), the web app; wait for ports; stop everything. Logs go to .e2e/<name>.log (git-ignored), or
 * to $E2E_OUT when scripts/e2e-local.sh runs the script inside its per-run directory.
 * scripts/e2e-local.sh drives the same three processes from bash for CI; TypeScript scripts use this file.
 *
 * Process hygiene (RT-P-02): every child is its own process-group leader, listed in .e2e/pids/harness-<pid>.pids
 * (the format e2e-local.sh uses: "<pgid> <name>"). A detached watchdog reaps those groups when this process dies,
 * SIGKILL included; the next harness run reaps any pid file whose owner is gone; `pnpm demo:stop`
 * (= `bash scripts/e2e-local.sh stop`) reaps them all on request.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import {
  appendFileSync,
  chmodSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';

import { httpJson } from '@ethglobal/protocol/http';

export const ROOT = join(import.meta.dirname, '..', '..');
/** Where this run's logs and seed state go: $E2E_OUT (a per-run dir from e2e-local.sh), else .e2e/. */
export const E2E_DIR = process.env.E2E_OUT ?? join(ROOT, '.e2e');
const PID_DIR = join(ROOT, '.e2e', 'pids');
const PID_FILE = join(PID_DIR, `harness-${process.pid}.pids`);
/** Paths (one per line) the watchdog deletes if this process dies before its own cleanup ran (PIN temp dirs). */
const RM_FILE = join(PID_DIR, `harness-${process.pid}.rm`);

const children: ChildProcess[] = [];

/** mkdir -p with 0700 (.e2e holds PINs, entitlement keys and the audit key: RT-P-11). */
export function privateDir(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  return dir;
}

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/** SIGTERM every process group listed in `file`, then remove it. */
function reapPidFile(file: string): void {
  const groups = readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => Number.parseInt(line.split(' ')[0] ?? '', 10))
    .filter((g) => Number.isSafeInteger(g) && g > 1);
  for (const g of groups) {
    try {
      process.kill(-g, 'SIGTERM');
    } catch {
      // already gone
    }
  }
  rmSync(file, { force: true });
}

/** Deletes `path` when this process dies, even by SIGKILL (the watchdog does it); stopAll() also deletes it. */
export function removeOnDeath(path: string): void {
  privateDir(PID_DIR);
  appendFileSync(RM_FILE, `${path}\n`, { mode: 0o600 });
  startWatchdog();
}

/** A previous harness run that died without cleanup (SIGKILL, OOM): reap its process groups before we start. */
export function reapStale(): void {
  if (!existsSync(PID_DIR)) return;
  for (const name of readdirSync(PID_DIR)) {
    const [, owner, kind] = /^harness-(\d+)\.(pids|rm)$/.exec(name) ?? [];
    if (owner === undefined || Number(owner) === process.pid || alive(Number(owner))) continue;
    const file = join(PID_DIR, name);
    if (kind === 'rm') {
      for (const path of readFileSync(file, 'utf8').split('\n').filter(Boolean))
        rmSync(path, { recursive: true, force: true });
      rmSync(file, { force: true });
    } else {
      console.warn(`harness: reaping the stack of dead run ${owner} (${file})`);
      reapPidFile(file);
    }
  }
}

let watchdog = false;
/** One detached bash loop per harness process: when we disappear (however), it kills every group in PID_FILE. */
function startWatchdog(): void {
  if (watchdog) return;
  watchdog = true;
  const script =
    'while kill -0 "$1" 2>/dev/null; do sleep 0.5; done; ' +
    'if [ -f "$3" ]; then while IFS= read -r p; do [ -n "$p" ] && rm -rf -- "$p"; done < "$3"; rm -f "$3"; fi; ' +
    '[ -f "$2" ] || exit 0; ' +
    'for g in $(cut -d" " -f1 "$2"); do kill -TERM -- "-$g" 2>/dev/null; done; sleep 2; ' +
    'for g in $(cut -d" " -f1 "$2"); do kill -KILL -- "-$g" 2>/dev/null; done; rm -f "$2"';
  spawn('bash', ['-c', script, 'harness-watchdog', String(process.pid), PID_FILE, RM_FILE], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

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
  privateDir(E2E_DIR);
  const log = join(E2E_DIR, `${name}.log`);
  const out = createWriteStream(log, { mode: 0o600 });
  const child = spawn(command, args, {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env },
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.pipe(out);
  child.stderr?.pipe(out);
  children.push(child);
  if (child.pid !== undefined) {
    privateDir(PID_DIR);
    appendFileSync(PID_FILE, `${child.pid} ${name}\n`, { mode: 0o600 });
    startWatchdog();
  }
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
      // loopback only (RT-P-01): /__local/* and the X-Seed-* hooks never reach the LAN
      HOST: '127.0.0.1',
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

/** apps/web: `next start` when a production build exists (mode 'auto'), else `next dev`. */
export async function startWeb(
  apiUrl: string,
  port = 3000,
  env: Record<string, string> = {},
  mode: 'auto' | 'dev' | 'start' = 'auto',
): Promise<WebHandle> {
  const webUrl = `http://127.0.0.1:${port}`;
  const web = join(ROOT, 'apps/web');
  const next = join(web, 'node_modules/.bin/next');
  if (!existsSync(next)) throw new Error('apps/web has no next binary (install or link apps/web)');
  const built = existsSync(join(web, '.next/BUILD_ID'));
  const command = mode === 'auto' ? (built ? 'start' : 'dev') : mode;
  const { child, log } = start('web', next, [command, '-p', String(port), '-H', '127.0.0.1'], {
    cwd: web,
    env: { NEXT_PUBLIC_MODE: 'local', NEXT_PUBLIC_API_URL: apiUrl, ...env },
  });
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

/**
 * Stops everything when this process exits or is orphaned (a wrapper such as `pnpm` or `timeout` killed without
 * forwarding the signal): the children run in their own process groups and would otherwise outlive us.
 */
export function stopWithParent(): void {
  reapStale();
  process.once('exit', stopAll);
  const parent = process.ppid;
  setInterval(() => {
    if (process.ppid !== parent) {
      stopAll();
      process.exit(1);
    }
  }, 1_000).unref();
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
  rmSync(PID_FILE, { force: true });
  if (existsSync(RM_FILE)) {
    for (const path of readFileSync(RM_FILE, 'utf8').split('\n').filter(Boolean))
      rmSync(path, { recursive: true, force: true });
    rmSync(RM_FILE, { force: true });
  }
}
