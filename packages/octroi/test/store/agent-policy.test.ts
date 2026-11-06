import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { anvilAccounts, fakeClock } from '@ethglobal/adapters/testing';
import { AGENT_POLICY_TTL_S, keys } from '@ethglobal/protocol/ids';
import type { AgentPolicyWire } from '@ethglobal/protocol/schemas';

import { entitlementIndex } from '../../src/keys.js';
import { AgentPolicyStore } from '../../src/store/index.js';
import { forge, T0 } from '../helpers.js';

const policy = (over: Partial<AgentPolicyWire> = {}): AgentPolicyWire => ({
  v: 1,
  entitlementKey: 'ent:v1:abc',
  owner: anvilAccounts[2],
  policy: {
    maxUsd6PerDay: '2000000',
    thresholdMb: 60,
    stepMb: 100,
    paused: false,
    topUpOnExpiry: true,
    expiryLeadS: 3600,
  },
  updatedAt: T0,
  ...over,
});

describe('AgentPolicyStore', () => {
  async function legacyRow(ledger: InMemoryLedger, p: AgentPolicyWire) {
    return ledger.put({
      annotations: {
        type: 'agentpolicy',
        key: keys.agentPolicy(p.entitlementKey),
        owner: p.owner.toLowerCase(),
      },
      payload: JSON.stringify(p),
      expiresIn: AGENT_POLICY_TTL_S,
    });
  }

  it('reads an existing legacy pause and owner without mutation; a same-owner write migrates it in place', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const paused = policy({
      policy: { ...policy().policy, paused: true },
      lastExpiryBought: T0 + 50,
    });
    const original = await legacyRow(ledger, paused);
    const store = new AgentPolicyStore(ledger, () => T0);
    expect((await store.get(paused.entitlementKey))?.payload).toEqual(paused);
    expect((await ledger.get(original.key))?.payload).toContain(paused.entitlementKey);
    expect(JSON.stringify(await store.all())).not.toContain(paused.entitlementKey);
    expect(await store.get(entitlementIndex(paused.entitlementKey))).toBeNull();
    await expect(
      store.put({ ...paused, owner: anvilAccounts[3], updatedAt: T0 + 1 }),
    ).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(
      store.put({ ...paused, policy: { ...paused.policy, paused: false }, updatedAt: T0 - 1 }),
    ).rejects.toMatchObject({ code: 'replay' });
    expect((await store.put({ ...paused, updatedAt: T0 + 1, lastExpiryBought: T0 + 1 })).key).toBe(
      original.key,
    );
    expect((await store.get(paused.entitlementKey))?.payload).toMatchObject({
      policy: { paused: true },
      lastExpiryBought: T0 + 50,
    });
    expect(await ledger.query()).toHaveLength(1);
    expect(JSON.stringify(await ledger.query())).not.toContain(paused.entitlementKey);
  });

  it('two namespaces keep the freshest policy and greatest expiry marker; owner conflicts fail closed', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const store = new AgentPolicyStore(ledger, () => T0);
    const older = policy({ lastExpiryBought: T0 + 100 });
    await store.put(older);
    const newer = {
      ...older,
      updatedAt: T0 + 1,
      policy: { ...older.policy, paused: true },
      lastExpiryBought: T0 + 1,
    };
    const legacy = await legacyRow(ledger, newer);
    expect((await store.get(older.entitlementKey))?.payload).toMatchObject({
      updatedAt: T0 + 1,
      policy: { paused: true },
      lastExpiryBought: T0 + 100,
    });
    expect(await store.all()).toHaveLength(1);
    expect(JSON.stringify(await store.all())).not.toContain(older.entitlementKey);
    await expect(store.put(older)).rejects.toMatchObject({ code: 'replay' });
    await store.put({ ...newer, updatedAt: T0 + 2 });
    expect((await store.get(older.entitlementKey))?.payload).toMatchObject({
      updatedAt: T0 + 2,
      policy: { paused: true },
      lastExpiryBought: T0 + 100,
    });
    await ledger.update(legacy.key, {
      payload: JSON.stringify({ ...newer, owner: anvilAccounts[3] }),
      annotations: {
        type: 'agentpolicy',
        key: keys.agentPolicy(newer.entitlementKey),
        owner: anvilAccounts[3].toLowerCase(),
      },
    });
    await expect(store.get(older.entitlementKey)).rejects.toMatchObject({ code: 'unauthorized' });
    await expect(store.put({ ...newer, updatedAt: T0 + 3 })).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('same-timestamp disagreement across namespaces cannot silently undo a pause', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const store = new AgentPolicyStore(ledger, () => T0);
    await store.put(policy());
    await legacyRow(ledger, policy({ policy: { ...policy().policy, paused: true } }));
    await expect(store.get(policy().entitlementKey)).rejects.toMatchObject({ code: 'replay' });
    await expect(store.put(policy())).rejects.toMatchObject({ code: 'replay' });
  });

  it('concurrent legacy migration preserves the newest pause under CAS', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const store = new AgentPolicyStore(ledger, () => T0);
    await legacyRow(ledger, policy());
    const pause = policy({ updatedAt: T0 + 2, policy: { ...policy().policy, paused: true } });
    await Promise.allSettled([store.put(policy({ updatedAt: T0 + 1 })), store.put(pause)]);
    expect((await store.get(pause.entitlementKey))?.payload).toMatchObject(pause);
    expect(await ledger.query()).toHaveLength(1);
    expect(JSON.stringify(await ledger.query())).not.toContain(pause.entitlementKey);
  });

  it('put creates then replaces, renewing the lifetime; all lists', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const store = new AgentPolicyStore(ledger, clock.now);
    await store.put(policy());
    clock.advance(1000);
    const res = await store.put(policy({ lastExpiryBought: T0 + 5, updatedAt: T0 + 1000 }));
    expect(res.expiresAt).toBe(T0 + 1000 + 30 * 86_400_000);
    expect(await store.get('ent:v1:abc')).toMatchObject({ payload: { lastExpiryBought: T0 + 5 } });
    expect(await store.all()).toHaveLength(1);
  });

  it('a forged row whose annotations disagree with its payload is ignored (T-79 class)', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const p = policy();
    await forge(
      ledger,
      { type: 'agentpolicy', key: 'policy:ent:v1:abc', owner: anvilAccounts[7].toLowerCase() },
      p,
    );
    expect(await new AgentPolicyStore(ledger, () => T0).get('ent:v1:abc')).toBeNull();
  });
});
