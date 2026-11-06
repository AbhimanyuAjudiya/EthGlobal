/** T-57 / red team AG3 — a retry never becomes a second payment. */
import { describe, expect, it } from 'vitest';

import { Buyer } from '../../src/buyer.js';
import { AgentState } from '../../src/journal.js';
import { tick } from '../../src/tick.js';
import {
  AGENT_ADDRESS,
  buyOnce,
  expectTriggerBlocked,
  harness,
  HEDERA_ACCEPT,
  hederaPayer,
  KEY,
  setUsage,
} from '../helpers.js';

describe('T-57 retry double-pay (AG3)', () => {
  it('settled, then the connection dropped before the 200 → same authorization recovers the response; sign ×1, settle ×1', async () => {
    const h = await harness({ api: { fault: (n) => (n === 1 ? 'drop-after-settle' : undefined) } });
    const out = await buyOnce(h);
    expect(out.signatures).toBe(1);
    expect(h.api.settled).toHaveLength(1);
    expect(h.api.paid).toHaveLength(2);
    expect(h.api.paid[1]).toEqual(h.api.paid[0]);
    const settled = h.api.settled[0];
    expect(out.bought).toMatchObject({ tx: settled?.success ? settled.transaction : 'x', mb: 100 });
  });

  it('502 without settling → the SAME payload (same nonce) is resent; never a second signature', async () => {
    const h = await harness({ api: { fault: (n) => (n <= 2 ? '502' : undefined) } });
    const out = await buyOnce(h);
    expect(out.signatures).toBe(1);
    expect(h.api.paid).toHaveLength(3);
    expect(h.api.paid[1]).toEqual(h.api.paid[0]);
    expect(h.api.paid[2]).toEqual(h.api.paid[0]);
    expect(h.api.settled).toHaveLength(1);
    expect(out.bought).toBeDefined();
  });

  it('authorization expiry never permits a replacement signature while its outcome is unknown', async () => {
    const h = await harness({ api: { fault: () => '502' } });
    expect(await buyOnce(h)).toMatchObject({ skipped: 'network-error', signatures: 1 });
    await expectTriggerBlocked(h);
    h.clock.advance(301_000);
    await expectTriggerBlocked(h);
    expect(h.api.paid.every((p) => JSON.stringify(p) === JSON.stringify(h.api.paid[0]))).toBe(true);
  });

  it('kill and restart between sign and response → the journal replays the original authorization', async () => {
    const h = await harness();
    await buyOnce(h); // buys at mbTotal 1000 → 1100; now push usage so the next crossing triggers
    await setUsage(h.ledger, h.clock.now, 1000);
    // process 1 signs, then "dies": the request never reaches the API
    const deadFetch: typeof fetch = async (input, init) => {
      if (new Headers(init?.headers).has('PAYMENT-SIGNATURE'))
        throw new TypeError('process killed');
      return h.api.fetch(input, init);
    };
    const killed = await harness({ ledger: h.ledger, clock: h.clock, stateDir: h.stateDir });
    killed.agent.deps.buyer = new (await import('../../src/buyer.js')).Buyer({
      apiUrl: 'http://api.test',
      fetch: deadFetch,
      now: h.clock.now,
      payers: [killed.evm.payer],
      allowList: killed.config.allowList,
      maxUsd6PerStep: 1_000_000n,
      reads: killed.agent.deps.reads,
      uaid: killed.agent.uaid,
      log: killed.log,
      maxAttempts: 1,
    });
    expect((await tick(killed.agent.deps, KEY)).skipped).toBe('network-error');
    expect(killed.signatures()).toBe(1);
    // Process 2 replays the private journal payload; it never asks the wallet for a replacement.
    const restarted = await harness({ ledger: h.ledger, clock: h.clock, stateDir: h.stateDir });
    expect((await tick(restarted.agent.deps, KEY)).bought).toBeDefined();
    expect(restarted.signatures()).toBe(0);
    expect(restarted.api.paid).toHaveLength(1);
    expect(await restarted.agent.deps.state.pending(KEY)).toBeUndefined();
  });

  it('a settled request whose response was lost recovers after expiry without another charge or signature', async () => {
    const h = await harness();
    const buyer = (fetchFn: typeof fetch) =>
      new Buyer({
        apiUrl: 'http://api.test',
        fetch: fetchFn,
        now: h.clock.now,
        payers: [h.evm.payer],
        allowList: h.config.allowList,
        maxUsd6PerStep: 1_000_000n,
        reads: h.agent.deps.reads,
        uaid: h.agent.uaid,
        log: h.log,
        maxAttempts: 1,
      });
    h.agent.deps.buyer = buyer(async (input, init) => {
      const response = await h.api.fetch(input, init);
      if (new Headers(init?.headers).has('PAYMENT-SIGNATURE')) throw new TypeError('lost response');
      return response;
    });
    expect(await buyOnce(h)).toMatchObject({ skipped: 'network-error', signatures: 1 });
    const original = h.api.paid[0];
    h.clock.advance(301_000);
    h.agent.deps.state = new AgentState(h.stateDir); // restarted process, same private journal
    h.agent.deps.buyer = buyer(h.api.fetch);
    expect((await tick(h.agent.deps, KEY)).bought).toBeDefined();
    expect(h.signatures()).toBe(1);
    expect(h.api.settled).toHaveLength(1);
    expect(h.api.paid).toEqual([original, original]);
    expect(await h.agent.deps.state.spentToday(KEY, h.clock.now())).toBe(400_000n);
  });

  it('Hedera: the resent transaction is byte-identical (the network dedups by transaction id)', async () => {
    const h = await harness({
      api: {
        accepts: [HEDERA_ACCEPT],
        fault: (n) => (n === 1 ? '502' : undefined),
        settleHedera: async (_p, req) => ({
          success: true,
          transaction: '0.0.9185802@1793750069.580498333',
          network: req.network,
          payer: '0.0.5005',
        }),
      },
      payers: (evm) => [hederaPayer(), evm],
    });
    const out = await buyOnce(h);
    expect(out.signatures).toBe(1);
    expect(h.api.paid).toHaveLength(2);
    const [a, b] = h.api.paid.map((p) => (p.payload as { transaction: string }).transaction);
    expect(a).toBe(b);
    expect(out.bought).toMatchObject({
      network: 'hedera:testnet',
      tx: '0.0.9185802@1793750069.580498333',
    });
  });

  it('the authorization is from the agent wallet (Anvil #4)', async () => {
    const h = await harness();
    await buyOnce(h);
    const p = h.api.paid[0]?.payload;
    expect(p && 'authorization' in p ? p.authorization.from : '').toBe(AGENT_ADDRESS);
  });
});
