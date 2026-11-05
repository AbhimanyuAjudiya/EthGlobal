/**
 * Red-team verification variants for the agent's own-spend journal and owner pinning:
 *   RT-G-02 — FOUR real processes append 30 purchases each while a crash-torn line (no trailing newline) sits in the
 *             middle of the journal ⇒ own spend counts all 120 (and the torn line swallows nothing).
 *   RT-G-03 — a clock that steps +2 days, then −1 day, then back ⇒ every day keeps its own spend; the UTC day boundary
 *             (23:59:59.999 vs 00:00:00.000) files each purchase under its own day.
 *   RT-G-04 — live with AGENT_OWNER pinned to a PUBLIC Anvil account: anyone holding that published key is "the owner"
 *             and can register the policy the agent then pays under (the T-73 b squat the fix closes).
 */
import { execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { anvilAccounts, publicDevAccounts } from '@ethglobal/adapters/testing';

import { loadConfig } from '../../src/config.js';
import { AgentState } from '../../src/journal.js';
import { ALLOW, tempDir } from '../helpers.js';

const TSX = join(import.meta.dirname, '../../node_modules/.bin/tsx');
const WORKER = join(import.meta.dirname, 'rt-proc-worker.ts');
const NOW = Date.UTC(2026, 10, 4, 12);
const DAY = 86_400_000;

const record = (dir: string, count: number, startAt: number): Promise<string> =>
  new Promise((resolve, reject) => {
    execFile(
      TSX,
      [WORKER, 'record', dir, String(count), String(startAt)],
      { timeout: 60_000 },
      (e, out) => (e ? reject(new Error(e.message, { cause: e })) : resolve(out)),
    );
  });

describe('verify RT-G-02: four processes + a torn line', () => {
  it('4 × 30 concurrent appends around a torn line ⇒ 120 counted', async () => {
    const dir = await tempDir();
    const s = new AgentState(dir);
    await s.recordPurchase({ key: 'rt-key', now: NOW, usd6: 400_000n }); // creates the journal
    await appendFile(join(dir, 'spent.jsonl'), '{"v":1,"day":2049'); // a crash mid-write
    const startAt = Date.now() + 1_500;
    await Promise.all([0, 1, 2, 3].map(() => record(dir, 30, startAt)));
    expect(await new AgentState(dir).spentToday('rt-key', NOW)).toBe(121n * 400_000n);
  }, 90_000);
});

describe('verify RT-G-03: clock steps in both directions and the UTC day boundary', () => {
  it('+2 d, −1 d, back: each day keeps its own spend', async () => {
    const s = new AgentState(await tempDir());
    const k = 'ent:v1:verify-g03';
    await s.recordPurchase({ key: k, now: NOW, usd6: 1_000_000n });
    await s.recordPurchase({ key: k, now: NOW + 2 * DAY, usd6: 200_000n });
    await s.recordPurchase({ key: k, now: NOW + DAY, usd6: 30_000n });
    expect(await s.spentToday(k, NOW + 1)).toBe(1_000_000n);
    expect(await s.spentToday(k, NOW + DAY + 1)).toBe(30_000n);
    expect(await s.spentToday(k, NOW + 2 * DAY + 1)).toBe(200_000n);
  });

  it('23:59:59.999 and 00:00:00.000 UTC are different days', async () => {
    const s = new AgentState(await tempDir());
    const k = 'ent:v1:verify-g03-midnight';
    const midnight = Date.UTC(2026, 10, 5);
    await s.recordPurchase({ key: k, now: midnight - 1, usd6: 9_000_000n });
    await s.recordPurchase({ key: k, now: midnight, usd6: 400_000n });
    expect(await s.spentToday(k, midnight - 1)).toBe(9_000_000n);
    expect(await s.spentToday(k, midnight + 1)).toBe(400_000n);
  });
});

describe('verify RT-G-04: the pinned owner must be someone only the user controls', () => {
  const live = {
    AGENT_API_URL: 'http://127.0.0.1:8787/',
    AGENT_PAYTO_ALLOWLIST: ALLOW,
    MODE: 'live',
    AGENT_LEDGER_WRITER: '0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38',
    HCS_TOPIC_ID: '0.0.7001',
    ARKIV_RPC_URL: 'https://rpc.rabdi.db-chain.testnet.arkiv.network',
    ARKIV_CHAIN_ID: '7794095',
    AGENT_HEDERA_ACCOUNT_ID: '0.0.5005',
    AGENT_HEDERA_PRIVATE_KEY: 'k',
  };

  it('control: a non-public owner boots live', () => {
    expect(loadConfig({ ...live, AGENT_OWNER: `0x${'12'.repeat(20)}` }).mode).toBe('live');
  });

  // Regression RT-G-04 (fixed): loadConfig refused a public Anvil PAYER key in live but accepted a public Anvil OWNER
  // address (the builder's own live fixture pinned Anvil #5); whoever holds the published key signed the policy as "the
  // owner". Every public Anvil/Hardhat default account is now refused as AGENT_OWNER in live, in any case.
  it('live with AGENT_OWNER = any public Anvil/Hardhat account ⇒ refused [RT-G-04]', () => {
    const owners = [...publicDevAccounts, ...anvilAccounts.map((a) => a.toLowerCase())];
    const accepted = owners.filter((owner) => {
      try {
        loadConfig({ ...live, AGENT_OWNER: owner });
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted).toEqual([]);
  });
});
