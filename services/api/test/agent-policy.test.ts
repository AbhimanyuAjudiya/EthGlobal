import { describe, expect, it } from 'vitest';

import { anvilKeys, anvilRoles } from '@ethglobal/adapters/testing';

import { agentPolicyPut } from './support/client.js';
import {
  harness,
  HUMAN_KEY,
  provisionPaid,
  STRANGER_KEY,
  topUp,
  type Harness,
} from './support/harness.js';

const POLICY = {
  maxUsd6PerDay: '2000000',
  thresholdMb: 50,
  stepMb: 100,
  paused: false,
  topUpOnExpiry: true,
  expiryLeadS: 3600,
};

const paidEntitlement = async (h: Harness) =>
  ((await (await provisionPaid(h)).res.json()) as { entitlementKey: string }).entitlementKey;

describe('PUT /agent/policy', () => {
  it('a valid AgentPolicy signature by the payer → 200; GET returns it with spentTodayUsd6 from receipts', async () => {
    const h = await harness();
    const key = await paidEntitlement(h);
    const res = await h.json(
      '/agent/policy',
      await agentPolicyPut(HUMAN_KEY, h.deps.chainId, key, POLICY, h.clock.now()),
      {},
      'PUT',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ policy: POLICY, spentTodayUsd6: '0' });
    await topUp(h, key, {
      payKey: anvilKeys[anvilRoles.agent],
      headers: { 'x-agent-uaid': 'uaid:aid:agent' },
    });
    const view = (await (await h.get(`/agent/policy/${encodeURIComponent(key)}`)).json()) as {
      spentTodayUsd6: string;
    };
    expect(view.spentTodayUsd6).toBe('400000');
  });

  it('wrong owner → 401; an older policy replayed → 409; a future issuedAt → 400; a tampered policy → 401', async () => {
    const h = await harness();
    const key = await paidEntitlement(h);
    expect(
      (
        await h.json(
          '/agent/policy',
          await agentPolicyPut(STRANGER_KEY, h.deps.chainId, key, POLICY, h.clock.now()),
          {},
          'PUT',
        )
      ).status,
    ).toBe(401);
    const older = await agentPolicyPut(
      HUMAN_KEY,
      h.deps.chainId,
      key,
      POLICY,
      h.clock.now() - 1000,
    );
    expect(
      (
        await h.json(
          '/agent/policy',
          await agentPolicyPut(
            HUMAN_KEY,
            h.deps.chainId,
            key,
            { ...POLICY, paused: true },
            h.clock.now(),
          ),
          {},
          'PUT',
        )
      ).status,
    ).toBe(200);
    expect((await h.json('/agent/policy', older, {}, 'PUT')).status).toBe(409);
    expect(
      (
        await h.json(
          '/agent/policy',
          await agentPolicyPut(HUMAN_KEY, h.deps.chainId, key, POLICY, h.clock.now() + 61_000),
          {},
          'PUT',
        )
      ).status,
    ).toBe(400);
    const signed = await agentPolicyPut(HUMAN_KEY, h.deps.chainId, key, POLICY, h.clock.now() + 1);
    expect(
      (
        await h.json(
          '/agent/policy',
          { ...signed, policy: { ...POLICY, maxUsd6PerDay: '999000000' } },
          {},
          'PUT',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        (await (await h.get(`/agent/policy/${encodeURIComponent(key)}`)).json()) as {
          policy: { paused: boolean };
        }
      ).policy.paused,
    ).toBe(true);
  });

  it('a free entitlement: the claiming session registers first (A-35), a second owner → 401; unknown entitlement → 404', async () => {
    const h = await harness();
    const { provisioned } = await import('./support/harness.js');
    const { key, spk } = await provisioned(h);
    const put = await agentPolicyPut(HUMAN_KEY, h.deps.chainId, key, POLICY, h.clock.now());
    expect((await h.json('/agent/policy', put, {}, 'PUT')).status).toBe(401); // key alone: no
    expect((await h.json('/agent/policy', { ...put, sessionPubKey: spk }, {}, 'PUT')).status).toBe(
      200,
    );
    expect(
      (
        await h.json(
          '/agent/policy',
          await agentPolicyPut(STRANGER_KEY, h.deps.chainId, key, POLICY, h.clock.now() + 1),
          {},
          'PUT',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await h.json(
          '/agent/policy',
          await agentPolicyPut(HUMAN_KEY, h.deps.chainId, 'paid:0xabc:0x01', POLICY, h.clock.now()),
          {},
          'PUT',
        )
      ).status,
    ).toBe(404);
    expect((await h.get('/agent/policy/nope-nope')).status).toBe(404);
  });
});
