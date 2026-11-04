/**
 * I-10 of BUILD-PLAN §4 against the real stack: the agent's `--once` pass (the same `loadConfig → buildAgent →
 * runPass` path `recharge-agent --once` runs, over real TCP to services/api, paying from Anvil #4 through the API's
 * self-run facilitator) on the paid key demo-seed.ts left at 18 % remaining. This is the "point at services/api"
 * swap of services/agent/test/integration/local-anvil.test.ts, done here because a services/agent file may not
 * import services/api (eslint zone "services never import each other").
 *
 * Asserts: exactly one purchase — payout +400 000 on Anvil, `/me` mbTotal +100, one HCS `agent-topup` message with a
 * `uaid:aid:` string, one `buy` line in the journal, an `agent-topup` receipt on `/me/:key/receipts`; a second pass
 * buys nothing. Agent log lines go to $E2E_OUT/agent.log (default .e2e/; scanned by the I-18 step).
 *
 *   API_URL=… RPC_URL=… pnpm --filter @ethglobal/scripts exec tsx e2e-agent.ts   (after demo-seed.ts)
 */
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { MockConsensusLog } from '@ethglobal/adapters';
import { buildAgent, loadConfig, runPass } from '@ethglobal/agent';

import { E2E_DIR } from './lib/harness.js';
import {
  anvilAddresses,
  apiClient,
  check,
  publicClientFor,
  stackFromEnv,
  usdcBalance,
} from './lib/stack.js';

const LOG = join(E2E_DIR, 'agent.log');
const stack = stackFromEnv();
const api = apiClient(stack);
const chain = publicClientFor(stack);
const deployed = anvilAddresses();
const paidKey = (JSON.parse(readFileSync(join(E2E_DIR, 'keys.json'), 'utf8')) as { paid: string })
  .paid;
const me = async () =>
  (await api.request(`/me/${encodeURIComponent(paidKey)}`, { expect: [200] })).data as {
    mbTotal: number;
    mbUsed: number;
  };

const sink = (level: string) => (obj: Record<string, unknown>, msg?: string) =>
  appendFileSync(LOG, `${JSON.stringify({ level, service: 'agent', ...obj, msg })}\n`, {
    mode: 0o600,
  });
const log = { info: sink('info'), warn: sink('warn'), error: sink('error') };
const consensus = new MockConsensusLog({ now: Date.now });
const stateDir = mkdtempSync(join(tmpdir(), 'recharge-agent-e2e-'));
const config = loadConfig({
  MODE: 'local',
  AGENT_ONCE: '1',
  AGENT_API_URL: stack.apiUrl,
  AGENT_EVM_RPC_URL: stack.rpcUrl,
  AGENT_WATCH_KEYS: paidKey,
  AGENT_PAYTO_ALLOWLIST: `eip155:31337|${deployed.usdc}|${deployed.payout}`,
  AGENT_STATE_DIR: stateDir,
});

async function pass(): Promise<void> {
  const agent = await buildAgent(config, { consensus, log });
  try {
    const result = await runPass(agent.deps, await agent.keys());
    check(result.errors.length === 0, `agent tick threw: ${JSON.stringify(result.errors)}`);
  } finally {
    agent.close();
  }
}

const journal = (): { event: string }[] =>
  readFileSync(join(stateDir, 'journal.jsonl'), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { event: string });
const topupMessages = () =>
  consensus
    .messages(config.hcsTopic)
    .map((m) => JSON.parse(m) as Record<string, unknown>)
    .filter((m) => m.t === 'agent-topup');

/** The line CI asserts under E2E_FAULT=1 (`FAIL I-10 agent: … [E2E_FAULT planted]`). */
const FAULT_MARKER = '[E2E_FAULT planted]';
const t0 = performance.now();
try {
  const before = await me();
  check(
    before.mbTotal - before.mbUsed <= 60,
    `seeded paid key is not below the threshold: ${JSON.stringify(before)}`,
  );
  const payoutBefore = await usdcBalance(chain, deployed.usdc, deployed.payout);

  await pass();
  const after = await me();
  // E2E_FAULT (any value): the test of the test — a deliberately wrong expectation must fail the whole run, and
  // fail HERE: CI greps for FAULT_MARKER so a port clash or a missing build cannot pass for the planted failure (RT-P-07)
  const fault = Boolean(process.env.E2E_FAULT);
  const step = fault ? 101 : 100;
  check(
    after.mbTotal === before.mbTotal + step,
    `mbTotal ${before.mbTotal} → ${after.mbTotal}, want +${step}${fault ? ` ${FAULT_MARKER}` : ''}`,
  );
  const paid = (await usdcBalance(chain, deployed.usdc, deployed.payout)) - payoutBefore;
  check(paid === 400_000n, `payout moved ${paid}, want 400000`);
  const [message, ...more] = topupMessages();
  check(
    message !== undefined && more.length === 0,
    `want one agent-topup HCS message, got ${more.length + (message ? 1 : 0)}`,
  );
  check(
    typeof message.uaid === 'string' && message.uaid.startsWith('uaid:aid:'),
    `HCS message without a uaid:aid: (${String(message.uaid)})`,
  );
  check(
    journal().filter((l) => l.event === 'buy').length === 1,
    'journal does not hold exactly one buy',
  );
  const receipts = JSON.stringify(
    (await api.request(`/me/${encodeURIComponent(paidKey)}/receipts`, { expect: [200] })).data,
  );
  check(receipts.includes('"agent-topup"'), 'no agent-topup receipt on /me/:key/receipts');

  await pass();
  check((await me()).mbTotal === after.mbTotal, 'second pass changed mbTotal');
  check(topupMessages().length === 1, 'second pass submitted another agent-topup');
  check(journal().filter((l) => l.event === 'buy').length === 1, 'second pass journaled a buy');
  check(
    (await usdcBalance(chain, deployed.usdc, deployed.payout)) - payoutBefore === 400_000n,
    'second pass paid',
  );
  console.log(
    `PASS I-10 agent --once on the seeded paid key: one buy (+100 MB, payout +400000, HCS agent-topup ${String(message.uaid).slice(0, 24)}…), second pass buys nothing (${Math.round(performance.now() - t0)} ms)`,
  );
} catch (error) {
  console.log(`FAIL I-10 agent: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
