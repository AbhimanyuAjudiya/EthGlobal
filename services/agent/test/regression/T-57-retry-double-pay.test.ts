/** T-57 / red team AG3 — a retry never becomes a second payment. */
import { describe, expect, it } from 'vitest';

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
  it('settled, then the connection dropped before the 200 → re-read ledger, success from receipts; sign ×1, settle ×1', async () => {
    const h = await harness({ api: { fault: (n) => (n === 1 ? 'drop-after-settle' : undefined) } });
    const out = await buyOnce(h);
    expect(out.signatures).toBe(1);
    expect(h.api.settled).toHaveLength(1);
    expect(h.api.paid).toHaveLength(1); // treated as success without resending
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

  it('resends stop before validBefore − 10 s and the trigger stays blocked until the authorization expires', async () => {
    const h = await harness({ api: { fault: () => '502' } });
    expect(await buyOnce(h)).toMatchObject({ skipped: 'network-error', signatures: 1 });
    await expectTriggerBlocked(h);
  });

  it('kill and restart between sign and response → the journal trigger blocks a new signature until validBefore', async () => {
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
    // process 2 (restart, same .agent dir) re-reads the ledger: unchanged ⇒ the trigger is in flight ⇒ no signature
    const restarted = await harness({ ledger: h.ledger, clock: h.clock, stateDir: h.stateDir });
    expect((await tick(restarted.agent.deps, KEY)).skipped).toBe('trigger-in-flight');
    expect(restarted.signatures()).toBe(0);
    // after validBefore the old authorization can no longer settle: a fresh signature is safe
    h.clock.advance(301_000);
    expect((await tick(restarted.agent.deps, KEY)).bought).toBeDefined();
    expect(restarted.signatures()).toBe(1);
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
