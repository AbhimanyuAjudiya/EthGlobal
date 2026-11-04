/** T-63 / RT-G-05 — no Anvil mnemonic in product source; the public Anvil key is derived only in MODE=local. */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  anvilAccounts,
  anvilRoles,
  fakeClock,
  FakeUsdc3009,
  TEST_USDC,
} from '@ethglobal/adapters/testing';

import { loadConfig } from '../../src/config.js';
import { buildAgent } from '../../src/deps.js';
import { memoryLog } from '../../src/log.js';
import { ALLOW, tempDir } from '../helpers.js';

import type { EvmPayer } from '../../src/payers/evm.js';

const SRC = join(import.meta.dirname, '../../src');

describe('T-63 no test mnemonic in src (RT-G-05)', () => {
  it('no file under src spells a BIP-39 test phrase or an Anvil private key', async () => {
    const files = (await readdir(SRC, { recursive: true })).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) {
      const text = await readFile(join(SRC, f), 'utf8');
      expect(text, f).not.toMatch(/\b(?:test ){11}junk\b/);
      expect(text, f).not.toMatch(/\b(?:abandon ){11}about\b/);
      expect(text, f).not.toMatch(/0x[0-9a-f]{64}/i);
    }
  });

  it('local without AGENT_EVM_PRIVATE_KEY pays from Anvil #4 (anvilRoles.agent), derived from adapters/testing', async () => {
    const config = loadConfig({
      MODE: 'local',
      AGENT_API_URL: 'http://api.test',
      AGENT_PAYTO_ALLOWLIST: ALLOW,
      AGENT_STATE_DIR: await tempDir(),
    });
    const clock = fakeClock();
    const usdc = new FakeUsdc3009({
      address: TEST_USDC,
      chainId: 31337,
      name: 'USD Coin',
      version: '2',
      now: clock.now,
      balances: {},
    });
    const log = memoryLog();
    const agent = await buildAgent(config, {
      log,
      now: clock.now,
      publicClient: usdc.publicClient(),
      hcs14: () => 'uaid:aid:t',
    });
    expect(agent.payers.map((p) => (p as EvmPayer).address)).toEqual([
      anvilAccounts[anvilRoles.agent],
    ]);
    expect(log.lines.some((l) => l.obj.what === 'owner')).toBe(true); // AGENT_OWNER unset ⇒ warned
  });
});
