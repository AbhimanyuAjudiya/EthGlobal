/**
 * `pnpm demo` — the whole product in MODE=local on one machine: Anvil + Deploy.s.sol, the API (self-run facilitator,
 * mock reseller), the demo seed, and (with --web) the web app. Stays up until Ctrl-C; logs in .e2e/*.log.
 *
 *   pnpm demo                 # chain :8545, API :8787, seed
 *   pnpm demo -- --web        # + apps/web on :3000
 *   pnpm demo -- --agent      # + the agent looping on the seeded paid key (5-s ticks)
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
  cliArgs,
  E2E_DIR,
  ROOT,
  startApi,
  startChain,
  startWeb,
  stopAll,
  stopWithParent,
} from './lib/harness.js';
import { anvilAddresses } from './lib/stack.js';

const { values: flags } = parseArgs({
  args: cliArgs(),
  options: {
    web: { type: 'boolean', default: false },
    agent: { type: 'boolean', default: false },
    'chain-port': { type: 'string', default: '8545' },
    'api-port': { type: 'string', default: '8787' },
  },
});

stopWithParent();
process.once('SIGINT', () => {
  stopAll();
  process.exit(0);
});
process.once('SIGTERM', () => {
  stopAll();
  process.exit(0);
});

try {
  const chain = await startChain(Number(flags['chain-port']));
  console.log(`chain  ${chain.rpcUrl} (deployed; log ${chain.log})`);
  const api = await startApi(chain.rpcUrl, Number(flags['api-port']));
  console.log(`api    ${api.apiUrl} (log ${api.log})`);
  const env = { ...process.env, API_URL: api.apiUrl, RPC_URL: chain.rpcUrl };
  const tsx = join(ROOT, 'scripts/node_modules/.bin/tsx');
  const seeded = spawn(tsx, [join(ROOT, 'scripts/demo-seed.ts'), '--reset'], {
    env,
    stdio: 'inherit',
  });
  const code = await new Promise<number>((resolve) => seeded.once('exit', (c) => resolve(c ?? 1)));
  if (code !== 0) throw new Error(`demo-seed exited ${code}`);
  if (flags.web) {
    const web = await startWeb(api.apiUrl);
    console.log(`web    ${web.webUrl} (log ${web.log})`);
  }
  if (flags.agent) {
    const keys = JSON.parse(readFileSync(join(E2E_DIR, 'keys.json'), 'utf8')) as { paid: string };
    const a = anvilAddresses();
    spawn(join(ROOT, 'services/agent/node_modules/.bin/tsx'), ['src/index.ts'], {
      cwd: join(ROOT, 'services/agent'),
      env: {
        ...env,
        MODE: 'local',
        AGENT_API_URL: api.apiUrl,
        AGENT_EVM_RPC_URL: chain.rpcUrl,
        AGENT_WATCH_KEYS: keys.paid,
        AGENT_PAYTO_ALLOWLIST: `eip155:31337|${a.usdc}|${a.payout}`,
        AGENT_STATE_DIR: join(ROOT, '.agent'),
      },
      stdio: 'inherit',
    });
    console.log('agent  looping on the seeded paid key (journal: .agent/journal.jsonl)');
  }
  console.log('demo is up — Ctrl-C stops every process');
  await new Promise(() => undefined);
} catch (error) {
  console.error(`demo: ${error instanceof Error ? error.message : String(error)}`);
  stopAll();
  process.exit(1);
}
