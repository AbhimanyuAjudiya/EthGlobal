/**
 * T-79 / red team AG5 — ledger poisoning against the agent's direct reads. The ledger is writer-aware
 * (InMemoryLedger.asWriter, the local twin of ArkivLedger's `$creator == AGENT_LEDGER_WRITER` filter); a stranger's
 * look-alike entities must drive zero purchases.
 */
import { describe, expect, it } from 'vitest';

import { sha256Hex } from '@ethglobal/crypto';
import { AgentPolicyStore, EntitlementStore, ReceiptStore } from '@ethglobal/octroi';
import { keys } from '@ethglobal/protocol/ids';

import { loadConfig } from '../../src/config.js';
import { tick } from '../../src/tick.js';
import { harness, KEY, OWNER, POLICY, seed, STRANGER } from '../helpers.js';

describe('T-79 forged ledger entities (AG5)', () => {
  it("a stranger's agentpolicy (cap $1000, threshold 1 000 000 MB) is invisible → zero extra purchases", async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbTotal: 1000, mbUsed: 400 }); // the real entitlement is at 60 %
    const evil = h.ledger.asWriter(STRANGER);
    await new AgentPolicyStore(evil, h.clock.now).put({
      v: 1,
      entitlementKey: KEY,
      owner: OWNER.toLowerCase(),
      updatedAt: h.clock.now(),
      policy: { ...POLICY, maxUsd6PerDay: '1000000000', thresholdMb: 1_000_000 },
    });
    for (let i = 0; i < 10; i += 1) {
      expect((await tick(h.agent.deps, KEY)).verdict).toEqual({ buy: false, reason: 'ok' });
      h.clock.advance(5_000);
    }
    expect(h.signatures()).toBe(0);
  });

  it("a stranger's entitlement with the victim key and mbUsed = mbTotal → no purchase", async () => {
    const h = await harness();
    const real = await seed(h.ledger, h.clock.now, { mbTotal: 1000, mbUsed: 400 });
    await new EntitlementStore(h.ledger.asWriter(STRANGER), h.clock.now).create({
      ...real,
      mbUsed: real.mbTotal,
    });
    expect((await tick(h.agent.deps, KEY)).verdict.reason).toBe('ok');
    expect(h.signatures()).toBe(0);
  });

  it('fake agent-topup receipts by a stranger do not freeze the agent (spentToday unaffected)', async () => {
    const h = await harness();
    await seed(h.ledger, h.clock.now, { mbUsed: 900 });
    await new ReceiptStore(h.ledger.asWriter(STRANGER), h.clock.now).add({
      v: 1,
      key: keys.receipt('eip155:31337', '0xfake'),
      kind: 'agent-topup',
      entitlementKeyHash: sha256Hex(KEY),
      mb: 100,
      usd6: '10000000',
      network: 'eip155:31337',
      tx: '0xfake',
      at: h.clock.now(),
    });
    expect(await h.agent.deps.reads.spentTodayUsd6(KEY, h.clock.now())).toBe(0n);
    expect((await tick(h.agent.deps, KEY)).bought).toBeDefined();
  });

  it('AGENT_WATCH_KEYS empty: 1 000 forged policies naming AGENT_OWNER are not watched; the pass stays bounded', async () => {
    const h = await harness({ env: { AGENT_WATCH_KEYS: '', AGENT_OWNER: OWNER } });
    await seed(h.ledger, h.clock.now, { mbUsed: 100 });
    const evil = new AgentPolicyStore(h.ledger.asWriter(STRANGER), h.clock.now);
    for (let i = 0; i < 1000; i += 1) {
      await evil.put({
        v: 1,
        entitlementKey: `paid:forged:${i}`,
        owner: OWNER.toLowerCase(),
        policy: POLICY,
        updatedAt: h.clock.now(),
      });
    }
    expect(await h.agent.keys()).toEqual([KEY]);
  });

  it('live refuses to boot without the pinned writer (AGENT_LEDGER_WRITER)', () => {
    expect(() =>
      loadConfig({
        MODE: 'live',
        AGENT_API_URL: 'https://api.example',
        AGENT_PAYTO_ALLOWLIST: 'hedera:testnet|0.0.429274|0.0.6006|0.0.9185802',
        HCS_TOPIC_ID: '0.0.7001',
        ARKIV_RPC_URL: 'https://rpc.rabdi.db-chain.testnet.arkiv.network',
        ARKIV_CHAIN_ID: '7794095',
        AGENT_HEDERA_ACCOUNT_ID: '0.0.5005',
        AGENT_HEDERA_PRIVATE_KEY: 'x',
      }),
    ).toThrow(/AGENT_LEDGER_WRITER/);
  });
});
