import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@ethglobal/crypto';
import { AgentPolicyStore, ReceiptStore } from '@ethglobal/octroi';
import { dayBucket } from '@ethglobal/protocol/ids';

import {
  DAY_MS,
  expectTriggerBlocked,
  EVM_ACCEPT,
  harness,
  hcsMessages,
  KEY,
  OWNER,
  seed,
  setUsage,
  skips,
  STRANGER,
} from './helpers.js';
import { Journal } from '../src/journal.js';
import { tick } from '../src/tick.js';

describe('tick', () => {
  it('buys exactly one step at 20 % remaining', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbTotal: 1000, mbUsed: 800 });
    const first = await tick(h.agent.deps, KEY);
    expect(first.verdict).toMatchObject({
      buy: true,
      reason: 'threshold',
      mb: 100,
      costUsd6: 400_000n,
    });
    expect(first.bought).toMatchObject({
      mb: 100,
      usd6: 400_000n,
      network: 'eip155:31337',
      hcsSequence: 1,
    });
    expect(first.bought?.tx).toBe(h.api.settled[0]?.success ? h.api.settled[0].transaction : '');
    h.clock.advance(5_000);
    const second = await tick(h.agent.deps, KEY);
    expect(second.verdict).toEqual({ buy: false, reason: 'ok' });
    expect(h.api.settled).toHaveLength(1);
    expect(h.signatures()).toBe(1);
    expect(h.evm.account.signatures).toBe(1);
  });

  it('does not buy at 21 %', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbTotal: 1000, mbUsed: 790 });
    const r = await tick(h.agent.deps, KEY);
    expect(r.verdict).toEqual({ buy: false, reason: 'ok' });
    expect(h.api.topups).toHaveLength(0);
    expect(h.signatures()).toBe(0);
  });

  it('buys on expiry lead when topUpOnExpiry and only once per expiresAt (O13)', async () => {
    const h = await harness();
    const e = await seed(h.ledger, h.clock.now, {
      mbUsed: 0,
      expiresAt: h.clock.now() + 30 * 60_000,
    });
    const first = await tick(h.agent.deps, KEY);
    expect(first.bought).toMatchObject({ mb: 100 });
    expect(first.verdict).toMatchObject({ buy: true, reason: 'expiry' });
    expect(h.api.topups.at(-1)?.headers['x-agent-expiry-bought']).toBe(String(e.expiresAt));
    for (let i = 0; i < 20; i += 1) {
      h.clock.advance(60_000);
      const r = await tick(h.agent.deps, KEY);
      expect(r.verdict).toEqual({ buy: false, reason: 'already-bought-for-expiry' });
    }
    expect(h.api.settled).toHaveLength(1);
    // the API recorded lastExpiryBought from the header; the agent's own state.json has it too
    const pol = await new AgentPolicyStore(h.ledger, h.clock.now).get(KEY);
    expect(pol?.payload.lastExpiryBought).toBe(e.expiresAt);
    expect(await h.agent.deps.state.lastExpiryBought(KEY)).toBe(e.expiresAt);
  });

  it('expiry fires once even when the ledger never records lastExpiryBought (local state alone)', async () => {
    const h = await harness();
    const e = await seed(h.ledger, h.clock.now, { expiresAt: h.clock.now() + 10 * 60_000 });
    await tick(h.agent.deps, KEY);
    // the API "forgot" the header: policy rewritten without lastExpiryBought
    const store = new AgentPolicyStore(h.ledger, h.clock.now);
    const pol = await store.get(KEY);
    const { lastExpiryBought: _drop, ...rest } = pol!.payload;
    await store.put(rest);
    h.clock.advance(60_000);
    const r = await tick(h.agent.deps, KEY);
    expect(r.verdict.reason).toBe('already-bought-for-expiry');
    expect(e.expiresAt).toBeGreaterThan(h.clock.now());
    expect(h.api.settled).toHaveLength(1);
  });

  it('never exceeds the daily cap over a 24 h simulated loop with random usage', async () => {
    const h = await harness();
    // $2.00/day = five steps; starts 12:00 UTC so the run crosses one UTC midnight
    await seed(h.ledger, h.clock.now, {
      mbTotal: 1000,
      mbUsed: 0,
      policy: { maxUsd6PerDay: '2000000' },
    });
    let seedRandom = 42;
    const random = () => {
      seedRandom = (seedRandom * 1_103_515_245 + 12_345) % 2 ** 31;
      return seedRandom / 2 ** 31;
    };
    let used = 0;
    const end = h.clock.now() + DAY_MS;
    while (h.clock.now() < end) {
      h.clock.advance(5_000);
      used += 0.25; // 3 MB/min
      if (random() < 0.002) used += 150; // webhook-like jumps
      await setUsage(h.ledger, h.clock.now, Math.floor(used));
      await tick(h.agent.deps, KEY);
    }
    const receipts = await new ReceiptStore(h.ledger, h.clock.now).forEntitlement(sha256Hex(KEY));
    const perDay = new Map<number, bigint>();
    for (const r of receipts)
      perDay.set(dayBucket(r.at), (perDay.get(dayBucket(r.at)) ?? 0n) + BigInt(r.usd6 ?? '0'));
    expect(perDay.size).toBe(2); // the counter resets once at 00:00:00Z
    for (const spent of perDay.values()) expect(spent).toBeLessThanOrEqual(2_000_000n);
    expect([...perDay.values()].some((s) => s === 2_000_000n)).toBe(true);
    expect(hcsMessages(h)).toHaveLength(receipts.length);
  }, 120_000); // 17 280 ticks: ≈ 20 s alone, longer while the two-process race tests load the CPU

  it('pause stops it', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbTotal: 1000, mbUsed: 1000, policy: { paused: true } });
    const first = await tick(h.agent.deps, KEY);
    expect(first.verdict).toEqual({ buy: false, reason: 'paused' });
    expect(first.notification).toBe('Agent paused');
    h.clock.advance(5_000);
    const second = await tick(h.agent.deps, KEY);
    expect(second.notification).toBeUndefined(); // notified on change, not every tick
    expect(h.api.topups).toHaveLength(0);
    expect(h.signatures()).toBe(0);
  });

  it('cap notifies once and the notice resets on an ok verdict', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, {
      mbTotal: 1000,
      mbUsed: 900,
      policy: { maxUsd6PerDay: '300000' },
    });
    const r = await tick(h.agent.deps, KEY);
    expect(r.verdict.reason).toBe('cap');
    expect(r.notification).toBe('Daily cap reached · $0.30 · resumes 00:00 UTC');
    await setUsage(h.ledger, h.clock.now, 100);
    expect((await tick(h.agent.deps, KEY)).verdict.reason).toBe('ok');
    await setUsage(h.ledger, h.clock.now, 900);
    expect((await tick(h.agent.deps, KEY)).notification).toBeDefined();
  });

  it('no entitlement → skipped', async () => {
    const h = await harness();
    expect((await tick(h.agent.deps, KEY)).skipped).toBe('no-entitlement');
  });

  it('no policy → skipped', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 1000 });
    const reads = h.agent.deps.reads;
    const deps = {
      ...h.agent.deps,
      reads: {
        ...reads,
        entitlement: reads.entitlement.bind(reads),
        policy: async () => null,
        spentTodayUsd6: reads.spentTodayUsd6.bind(reads),
      },
    };
    expect((await tick(deps, KEY)).skipped).toBe('no-policy');
  });

  it('wrong owner → skipped', async () => {
    const h = await harness({ env: { AGENT_OWNER: STRANGER } });
    await seed(h.ledger, h.clock.now, { mbUsed: 1000, owner: OWNER });
    expect((await tick(h.agent.deps, KEY)).skipped).toBe('not-mine');
    expect(h.signatures()).toBe(0);
  });

  it('dry-run signs nothing', async () => {
    const h = await harness({ env: { AGENT_DRY_RUN: '1' } });
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const r = await tick(h.agent.deps, KEY);
    expect(r).toMatchObject({ skipped: 'dry-run', verdict: { buy: true } });
    expect(h.signatures()).toBe(0);
    expect(h.api.topups).toHaveLength(0);
    const journal = await new Journal(h.stateDir).read();
    expect(journal.some((l) => l.event === 'would-buy')).toBe(true);
  });

  it('every purchase yields an HCS receipt with the UAID', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 850 });
    await tick(h.agent.deps, KEY);
    await setUsage(h.ledger, h.clock.now, 1000);
    await tick(h.agent.deps, KEY);
    const msgs = hcsMessages(h);
    expect(msgs).toHaveLength(2);
    for (const m of msgs) {
      expect(m).toMatchObject({
        t: 'agent-topup',
        svc: 'agent',
        uaid: h.agent.uaid,
        ent: sha256Hex(KEY),
        mb: 100,
        usd6: '400000',
      });
      expect(h.agent.uaid).toMatch(/^uaid:aid:/);
    }
  });

  it('402 with no matching accepts → no purchase and a logged reason', async () => {
    const h = await harness({ api: { accepts: [{ ...EVM_ACCEPT, payTo: STRANGER }] } });
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const r = await tick(h.agent.deps, KEY);
    expect(r.skipped).toBe('no-acceptable-terms');
    expect(h.signatures()).toBe(0);
    expect(skips(h).find((s) => s.reason === 'no-acceptable-terms')).toMatchObject({
      field: 'payTo',
    });
    // nothing was signed, so the trigger is free again on the next tick
    expect((await tick(h.agent.deps, KEY)).skipped).toBe('no-acceptable-terms');
  });

  it('settlement pending → no receipt, and no second signature for the trigger', async () => {
    const h = await harness({ api: { fault: () => 'pending' } });
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const r = await tick(h.agent.deps, KEY);
    expect(r.skipped).toBe('settlement-pending');
    expect(r.bought).toBeUndefined();
    expect(hcsMessages(h)).toHaveLength(0);
    await expectTriggerBlocked(h);
  });

  it('a payment the API rejects is reported and never receipted', async () => {
    const h = await harness({ api: { fault: () => 'reject' } });
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    expect((await tick(h.agent.deps, KEY)).skipped).toBe('payment-rejected');
    expect(hcsMessages(h)).toHaveLength(0);
  });

  it('an invalid stored policy is skipped, not thrown', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const reads = h.agent.deps.reads;
    const bad = { owner: OWNER, policy: { ...(await reads.policy(KEY))!.policy, stepMb: 150 } };
    const deps = {
      ...h.agent.deps,
      reads: {
        ...reads,
        entitlement: reads.entitlement.bind(reads),
        policy: async () => bad,
        spentTodayUsd6: reads.spentTodayUsd6.bind(reads),
      },
    };
    expect((await tick(deps, KEY)).skipped).toBe('invalid-policy');
  });

  it('a buyer that throws is journaled and rethrown (the loop reports it)', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    const deps = { ...h.agent.deps, buyer: { buy: async () => Promise.reject(new Error('boom')) } };
    await expect(tick(deps, KEY)).rejects.toThrow('boom');
    const journal = await new Journal(h.stateDir).read();
    expect(journal.at(-1)).toMatchObject({ event: 'error' });
    expect(deps.inFlight.size).toBe(0);
  });
});
