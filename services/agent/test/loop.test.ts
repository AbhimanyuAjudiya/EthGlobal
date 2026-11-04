import { describe, expect, it } from 'vitest';

import { InMemoryLedger, MockConsensusLog } from '@ethglobal/adapters';
import { hcs14Uaid } from '@ethglobal/adapters/live';
import { fakeClock, TEST_USDC } from '@ethglobal/adapters/testing';

import { createFakeApi } from './fake-api.js';
import {
  urlOf,
  ALLOW,
  EVM_ACCEPT,
  evmPayer,
  harness,
  KEY,
  PAYOUT,
  seed,
  tempDir,
} from './helpers.js';
import { applyFlags, main, parseCliArgs } from '../src/cli.js';
import { loadConfig } from '../src/config.js';
import { memoryLog } from '../src/log.js';
import { jitter, runLoop, runPass } from '../src/loop.js';

import type { tick } from '../src/tick.js';

async function cliEnv() {
  const clock = fakeClock();
  const ledger = new InMemoryLedger({ now: clock.now });
  const api = createFakeApi({ ledger, now: clock.now, accepts: [EVM_ACCEPT] });
  const evm = await evmPayer(clock.now);
  const env = {
    MODE: 'local',
    AGENT_API_URL: 'http://api.test',
    AGENT_PAYTO_ALLOWLIST: `eip155:31337|${TEST_USDC}|${PAYOUT}`,
    AGENT_STATE_DIR: await tempDir(),
    AGENT_WATCH_KEYS: KEY,
  };
  const consensus = new MockConsensusLog({ now: clock.now });
  const opts = {
    fetch: api.fetch,
    now: clock.now,
    log: memoryLog(),
    consensus,
    hcs14: hcs14Uaid,
    publicClient: evm.usdc.publicClient(),
  };
  return { clock, ledger, api, env, opts, consensus };
}

describe('loop and CLI', () => {
  it('--once exits 0 after one pass (local mode: API reads, Anvil #4 EVM payer, HCS mock)', async () => {
    const c = await cliEnv();
    await seed(c.ledger, c.clock.now, { mbUsed: 900 });
    expect(await main(['--once'], c.env, c.opts)).toBe(0);
    expect(c.api.settled).toHaveLength(1);
    expect(c.consensus.messages('0.0.1001')).toHaveLength(1);
  });

  it('--once --dry-run performs zero purchases', async () => {
    const c = await cliEnv();
    await seed(c.ledger, c.clock.now, { mbUsed: 900 });
    expect(await main(['--once', '--dry-run'], c.env, c.opts)).toBe(0);
    expect(c.api.paid).toHaveLength(0);
  });

  it('exit 2 when a tick throws', async () => {
    const c = await cliEnv();
    const broken: typeof fetch = async (input, init) =>
      urlOf(input).includes('/me/') ? Response.json({ nope: true }) : c.api.fetch(input, init);
    expect(await main(['--once', '--key', KEY], c.env, { ...c.opts, fetch: broken })).toBe(2);
  });

  it('exit 1 on a bad configuration', async () => {
    const log = memoryLog();
    expect(
      await main(
        ['--once'],
        { MODE: 'live', AGENT_API_URL: 'http://x', AGENT_PAYTO_ALLOWLIST: '' },
        { log },
      ),
    ).toBe(1);
    expect(log.lines[0]?.level).toBe('error');
  });

  it('runs the loop until aborted', async () => {
    const c = await cliEnv();
    await seed(c.ledger, c.clock.now, { mbUsed: 900 });
    const controller = new AbortController();
    const done = main([], c.env, { ...c.opts, signal: controller.signal });
    for (let i = 0; i < 50 && c.api.settled.length === 0; i += 1)
      await new Promise((r) => setTimeout(r, 20));
    controller.abort();
    expect(await done).toBe(0);
    expect(c.api.settled).toHaveLength(1);
  });

  it('ticks are sequential per key', async () => {
    const h = await harness();
    let active = 0;
    let maxActive = 0;
    const order: string[] = [];
    const slow: typeof tick = async (_deps, key) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      order.push(key);
      active -= 1;
      return { key, verdict: { buy: false, reason: 'ok' } };
    };
    const pass = await runPass(h.agent.deps, ['a', 'b', 'c'], slow);
    expect(maxActive).toBe(1);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(pass.errors).toEqual([]);
  });

  it('a throwing tick is reported and the pass goes on', async () => {
    const h = await harness();
    const flaky: typeof tick = async (_d, key) => {
      if (key === 'b') throw new Error('ledger_unavailable');
      return { key, verdict: { buy: false, reason: 'ok' } };
    };
    const pass = await runPass(h.agent.deps, ['a', 'b', 'c'], flaky);
    expect(pass.results.map((r) => r.key)).toEqual(['a', 'c']);
    expect(pass.errors).toEqual([{ key: 'b', error: 'ledger_unavailable' }]);
  });

  it('runLoop: one pass per interval with ±10 % jitter, survives a failing key source', async () => {
    const h = await harness();
    const controller = new AbortController();
    const sleeps: number[] = [];
    let passes = 0;
    await runLoop({
      deps: h.agent.deps,
      keys: async () => {
        passes += 1;
        if (passes === 2) throw new Error('keys failed');
        return [];
      },
      tickMs: 5_000,
      log: h.log,
      signal: controller.signal,
      random: () => 0.999,
      sleep: async (ms) => {
        sleeps.push(ms);
        if (sleeps.length === 3) controller.abort();
      },
    });
    expect(passes).toBe(3);
    expect(sleeps.every((ms) => ms >= 4_500 && ms <= 5_500)).toBe(true);
    expect(jitter(60_000, () => 0)).toBe(54_000);
    expect(jitter(60_000, () => 0.5)).toBe(60_000);
    expect(h.log.lines.some((l) => l.obj.error === 'keys failed')).toBe(true);
  });

  it('flags override env: --once, --dry-run, --key (repeatable)', () => {
    const flags = parseCliArgs(['--once', '--dry-run', '--key', 'k1', '--key', 'k2']);
    expect(flags).toEqual({ once: true, dryRun: true, keys: ['k1', 'k2'] });
    const c = applyFlags(
      loadConfig({
        AGENT_API_URL: 'http://x',
        AGENT_PAYTO_ALLOWLIST: ALLOW,
        AGENT_WATCH_KEYS: 'k0',
      }),
      flags,
    );
    expect(c).toMatchObject({ once: true, dryRun: true, watchKeys: ['k1', 'k2'] });
    expect(() => parseCliArgs(['--bogus'])).toThrow();
  });
});
