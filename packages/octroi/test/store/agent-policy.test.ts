import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { anvilAccounts, fakeClock } from '@ethglobal/adapters/testing';
import type { AgentPolicyWire } from '@ethglobal/protocol/schemas';

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
