import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

import { PrivateKey } from '@x402/hedera';
import { describe, expect, it } from 'vitest';

import { MockConsensusLog } from '@ethglobal/adapters';
import { hcs14Uaid } from '@ethglobal/adapters/live';
import { T0 } from '@ethglobal/adapters/testing';

import { createFakeApi } from './fake-api.js';
import {
  ALLOW,
  DAY_MS,
  EVM_ACCEPT,
  harness,
  HEDERA_ACCEPT,
  HEDERA_MAINNET_ACCEPT,
  KEY,
  MAINNET_ALLOW,
  MAINNET_USDC,
  OWNER,
  seed,
  tempDir,
  urlOf,
} from './helpers.js';
import { loadConfig } from '../src/config.js';
import { buildAgent } from '../src/deps.js';
import { AgentState, Journal, STALE_CLAIM_MS } from '../src/journal.js';
import { memoryLog } from '../src/log.js';
import { ApiReads, LedgerReads, paidKeyPayer, PlansCache } from '../src/reads.js';
import { tick } from '../src/tick.js';

describe('agent state (.agent/)', () => {
  it('trigger claims: exclusive, done blocks, signed blocks until validBefore, stale claims expire', async () => {
    const s = new AgentState(await tempDir());
    expect(await s.claimTrigger('t1', T0)).toEqual({ ok: true });
    expect(await s.claimTrigger('t1', T0 + 1)).toEqual({ ok: false, reason: 'trigger-in-flight' });
    expect(await s.claimTrigger('t1', T0 + STALE_CLAIM_MS)).toEqual({ ok: true }); // the claimer died before signing
    await s.markSigned('t1', T0, T0 + 300_000);
    expect(await s.claimTrigger('t1', T0 + 299_999)).toEqual({
      ok: false,
      reason: 'trigger-in-flight',
    });
    expect(await s.claimTrigger('t1', T0 + 300_000)).toEqual({ ok: true });
    await s.markDone('t1', T0);
    expect(await s.claimTrigger('t1', T0 + 10 * DAY_MS)).toEqual({
      ok: false,
      reason: 'already-bought-for-trigger',
    });
    await s.releaseTrigger('t2'); // releasing a trigger that does not exist is fine
    await s.releaseTrigger('t1'); // a done trigger is never released
    expect((await s.trigger('t1'))?.state).toBe('done');
    await s.claimTrigger('t3', T0);
    await s.releaseTrigger('t3'); // the claimant's own unsigned claim: released
    expect(await s.trigger('t3')).toBeUndefined();
  });

  it('a corrupt trigger is in flight until it is old by mtime; a corrupt state file fails safe', async () => {
    const dir = await tempDir();
    const s = new AgentState(dir);
    await s.claimTrigger('t', T0);
    const triggers = join(dir, 'triggers');
    const { readdir, utimes } = await import('node:fs/promises');
    const [file] = (await readdir(triggers)).filter((f) => f.endsWith('.json'));
    await writeFile(join(triggers, file!), '{not json');
    // RT-G-01: a record being written (or torn) is somebody's claim, never "dead"
    expect(await s.claimTrigger('t', T0)).toEqual({ ok: false, reason: 'trigger-in-flight' });
    const old = new Date(Date.now() - STALE_CLAIM_MS - 1_000);
    await utimes(join(triggers, file!), old, old);
    expect(await s.claimTrigger('t', T0)).toEqual({ ok: true });
    await writeFile(join(dir, 'state.json'), '{"v":2}');
    expect(await s.spentToday(KEY, T0)).toBe(0n);
  });

  it('spent today is per UTC day and per key; lastExpiryBought pinned per key', async () => {
    const s = new AgentState(await tempDir());
    await Promise.all([
      s.recordPurchase({ key: KEY, now: T0, usd6: 400_000n }),
      s.recordPurchase({ key: KEY, now: T0, usd6: 400_000n, expiryFor: T0 + 1000 }),
    ]);
    expect(await s.spentToday(KEY, T0)).toBe(800_000n);
    expect(await s.spentToday('other-key', T0)).toBe(0n);
    expect(await s.lastExpiryBought(KEY)).toBe(T0 + 1000);
    const midnight = Math.ceil(T0 / DAY_MS) * DAY_MS;
    expect(await s.spentToday(KEY, midnight - 1)).toBe(800_000n);
    expect(await s.spentToday(KEY, midnight)).toBe(0n);
    await s.recordPurchase({ key: KEY, now: midnight, usd6: 1n });
    expect(await s.spentToday(KEY, midnight)).toBe(1n);
  });

  it('journal: empty before the first line, JSON lines after (bigints as strings)', async () => {
    const dir = await tempDir();
    const j = new Journal(dir);
    expect(await j.read()).toEqual([]);
    await j.write({ a: 1n });
    expect(await j.read()).toEqual([{ a: '1' }]);
    await mkdir(join(dir, 'x'), { recursive: true });
  });
});

describe('reads', () => {
  it('ApiReads maps /me, /agent/policy and /me/:key/receipts; unknown keys are null', async () => {
    const h = await harness();
    const reads = new ApiReads('http://api.test', h.api.fetch);
    expect(await reads.entitlement(KEY)).toBeNull();
    expect(await reads.policy(KEY)).toBeNull();
    expect(await reads.spentTodayUsd6(KEY)).toBe(0n);
    expect(await reads.latestTopupTx(KEY, 0)).toBeUndefined();
    const seeded = await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    expect(await reads.entitlement(KEY)).toMatchObject({
      key: KEY,
      mbTotal: 1000,
      mbUsed: 900,
      expiresAt: seeded.expiresAt,
    });
    expect(await reads.policy(KEY)).toMatchObject({ owner: OWNER.toLowerCase() });
    expect(await reads.watchKeys()).toEqual([]);
    await tick(h.agent.deps, KEY);
    const settled = h.api.settled[0];
    expect(await reads.spentTodayUsd6(KEY)).toBe(400_000n);
    expect(await reads.latestTopupTx(KEY, h.clock.now())).toBe(
      settled?.success ? settled.transaction : 'x',
    );
    expect(await reads.latestTopupTx(KEY, h.clock.now() + 1)).toBeUndefined();
    const failing = new ApiReads(
      'http://api.test',
      async () => new Response('down', { status: 503 }),
    );
    await expect(failing.entitlement(KEY)).rejects.toThrow(/503/);
  });

  it('paidKeyPayer: the payer a paid key was issued to; nothing for other kinds (RT-G-04)', () => {
    expect(paidKeyPayer(KEY)).toBe(OWNER.toLowerCase());
    expect(paidKeyPayer('paid::0x11')).toBeUndefined();
    expect(paidKeyPayer(`ent:1:0x${'22'.repeat(32)}`)).toBeUndefined();
  });

  it('LedgerReads finds the newest agent-topup tx since a time', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    await tick(h.agent.deps, KEY);
    const reads = new LedgerReads(h.ledger, h.clock.now);
    expect(await reads.latestTopupTx(KEY, h.clock.now())).toMatch(/^0x/);
    expect(await reads.watchKeys(OWNER, 10)).toEqual([KEY]);
    expect(await reads.watchKeys(OWNER, 0)).toEqual([]);
  });

  it('PlansCache caches /plans for 60 s', async () => {
    const h = await harness();
    let calls = 0;
    const counting: typeof fetch = async (i, init) => ((calls += 1), h.api.fetch(i, init));
    const plans = new PlansCache({ apiUrl: 'http://api.test', fetch: counting, now: h.clock.now });
    await plans.get();
    h.clock.advance(59_999);
    await plans.get();
    expect(calls).toBe(1);
    h.clock.advance(1);
    await plans.get();
    expect(calls).toBe(2);
  });
});

describe('buildAgent wiring', () => {
  it('live: Arkiv reads pinned to the writer, the Agent Kit wallet (associated at boot), its HCS log', async () => {
    const config = loadConfig({
      MODE: 'live',
      AGENT_API_URL: 'https://api.example',
      AGENT_PAYTO_ALLOWLIST: ALLOW,
      AGENT_STATE_DIR: await tempDir(),
      AGENT_LEDGER_WRITER: '0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38',
      HCS_TOPIC_ID: '0.0.7001',
      ARKIV_RPC_URL: 'https://rpc.rabdi.db-chain.testnet.arkiv.network',
      ARKIV_CHAIN_ID: '7794095',
      AGENT_HEDERA_ACCOUNT_ID: '0.0.5005',
      AGENT_HEDERA_PRIVATE_KEY: PrivateKey.generateECDSA().toStringRaw(),
      AGENT_WATCH_KEYS: KEY,
      // live refuses a public Anvil/Hardhat owner (RT-G-04): a non-public address
      AGENT_OWNER: '0x5eF1b7a6c3D2E9f0A1b2C3d4E5f60718293a4B5c',
    });
    const mirror: typeof fetch = async () =>
      Response.json({ tokens: [{ token_id: '0.0.429274', balance: '3000000' }] });
    const log = memoryLog();
    const agent = await buildAgent(config, { fetch: mirror, log, hcs14: hcs14Uaid });
    try {
      expect(agent.payers.map((p) => p.network)).toEqual(['hedera:testnet']);
      expect(agent.deps.reads).toBeInstanceOf(LedgerReads);
      expect(agent.uaid).toContain('nativeId=hedera:testnet:0.0.5005');
      expect(await agent.payers[0]!.balanceUsd6()).toBe(3_000_000n);
      expect(await agent.keys()).toEqual([KEY]);
      expect(
        log.lines.some(
          (l) => l.obj.what === 'hedera-association' && l.obj.association === 'already',
        ),
      ).toBe(true);
    } finally {
      agent.close();
    }
  });

  it('live with a hedera:mainnet allow-list: mainnet payer, mainnet mirror and USDC, mainnet UAID nativeId', async () => {
    const config = loadConfig({
      MODE: 'live',
      AGENT_API_URL: 'https://api.example',
      AGENT_PAYTO_ALLOWLIST: MAINNET_ALLOW,
      AGENT_STATE_DIR: await tempDir(),
      AGENT_LEDGER_WRITER: '0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38',
      HCS_TOPIC_ID: '0.0.7001',
      ARKIV_RPC_URL: 'https://rpc.rabdi.db-chain.testnet.arkiv.network',
      ARKIV_CHAIN_ID: '7794095',
      AGENT_HEDERA_ACCOUNT_ID: '0.0.5005',
      AGENT_HEDERA_PRIVATE_KEY: PrivateKey.generateECDSA().toStringRaw(),
      AGENT_WATCH_KEYS: KEY,
      AGENT_OWNER: '0x5eF1b7a6c3D2E9f0A1b2C3d4E5f60718293a4B5c',
    });
    expect(config).toMatchObject({
      hederaNetwork: 'hedera:mainnet',
      hederaAsset: MAINNET_USDC,
      mirrorUrl: 'https://mainnet.mirrornode.hedera.com',
    });
    const urls: string[] = [];
    const mirror: typeof fetch = async (input) => {
      urls.push(urlOf(input));
      return Response.json({ tokens: [{ token_id: MAINNET_USDC, balance: '3000000' }] });
    };
    const log = memoryLog();
    const agent = await buildAgent(config, { fetch: mirror, log, hcs14: hcs14Uaid });
    try {
      expect(agent.payers.map((p) => p.network)).toEqual(['hedera:mainnet']);
      expect(agent.uaid).toContain('nativeId=hedera:mainnet:0.0.5005');
      expect(urls).toEqual([
        `https://mainnet.mirrornode.hedera.com/api/v1/accounts/0.0.5005/tokens?token.id=${MAINNET_USDC}`,
      ]);
      expect(await agent.payers[0]!.balanceUsd6()).toBe(3_000_000n);
      expect(log.lines.find((l) => l.obj.what === 'hedera-association')?.obj).toMatchObject({
        association: 'already',
        network: 'hedera:mainnet',
        asset: MAINNET_USDC,
      });
      // a 402 on testnet, or on mainnet naming testnet USDC 0.0.429274, is refused by the payer itself
      const payer = agent.payers[0]!;
      expect(payer.refusal({ ...HEDERA_ACCEPT, amount: '400000' })).toBe('network');
      expect(
        payer.refusal({ ...HEDERA_MAINNET_ACCEPT, asset: '0.0.429274', amount: '400000' }),
      ).toBe('asset');
      expect(payer.refusal({ ...HEDERA_MAINNET_ACCEPT, amount: '400000' })).toBeUndefined();
    } finally {
      agent.close();
    }
  });

  it('live without the Hedera wallet has no consensus log and refuses to build', async () => {
    const config = {
      ...loadConfig({ AGENT_API_URL: 'http://x', AGENT_PAYTO_ALLOWLIST: ALLOW }),
      mode: 'live' as const,
    };
    await expect(
      buildAgent(config, { log: memoryLog(), payers: [], hcs14: hcs14Uaid }),
    ).rejects.toThrow(/consensus/);
    await expect(
      buildAgent(
        { ...config },
        { log: memoryLog(), payers: [], consensus: new MockConsensusLog(), hcs14: hcs14Uaid },
      ),
    ).rejects.toThrow(/ARKIV/);
  });

  it('local: an unreachable EVM RPC degrades to "no payer" with a warning; keys() needs watch keys or an owner', async () => {
    const h = await harness();
    const api = createFakeApi({ ledger: h.ledger, now: h.clock.now, accepts: [EVM_ACCEPT] });
    const config = loadConfig({
      AGENT_API_URL: 'http://api.test',
      AGENT_PAYTO_ALLOWLIST: ALLOW,
      AGENT_STATE_DIR: await tempDir(),
      AGENT_EVM_RPC_URL: 'http://127.0.0.1:1',
    });
    const log = memoryLog();
    const agent = await buildAgent(config, {
      fetch: api.fetch,
      log,
      hcs14: hcs14Uaid,
      now: h.clock.now,
    });
    expect(agent.payers).toEqual([]);
    expect(
      log.lines.filter((l) => l.obj.what === 'evm-payer' || l.obj.what === 'payers'),
    ).toHaveLength(2);
    expect(agent.deps.reads).toBeInstanceOf(ApiReads);
    expect(await agent.keys()).toEqual([]);
    const noEvm = await buildAgent(
      { ...config, allowList: config.allowList.filter((a) => a.network.startsWith('hedera')) },
      { fetch: api.fetch, log, hcs14: hcs14Uaid },
    );
    expect(noEvm.payers).toEqual([]);
  });
});
