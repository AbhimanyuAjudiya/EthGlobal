/** AP20 — agent policy and agent headers (T-73, T-77). */
import { describe, expect, it } from 'vitest';

import { anvilKeys, anvilRoles } from '@ethglobal/adapters/testing';

import { agentPolicyPut, harness, HUMAN_KEY, provisioned, topUp } from './fixture.js';

const POLICY = {
  maxUsd6PerDay: '1000000',
  thresholdMb: 50,
  stepMb: 100,
  paused: false,
  topUpOnExpiry: true,
  expiryLeadS: 600,
};

describe('attack: agent policy (AP20)', () => {
  it('owner squat on a free entitlement: whoever registers first owns it (FINDING Med: needs an /agent/policy challenge, T-73 b)', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const squat = await h.json(
      '/agent/policy',
      await agentPolicyPut(
        anvilKeys[anvilRoles.stranger],
        h.deps.chainId,
        key,
        POLICY,
        h.clock.now(),
      ),
      {},
      'PUT',
    );
    expect(squat.status).toBe(200);
    expect(
      (
        await h.json(
          '/agent/policy',
          await agentPolicyPut(HUMAN_KEY, h.deps.chainId, key, POLICY, h.clock.now() + 1),
          {},
          'PUT',
        )
      ).status,
    ).toBe(401);
  });

  it('X-Agent-Expiry-Bought on someone else’s top-up never moves lastExpiryBought', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    await h.json(
      '/agent/policy',
      await agentPolicyPut(HUMAN_KEY, h.deps.chainId, key, POLICY, h.clock.now()),
      {},
      'PUT',
    );
    await topUp(h, key, {
      payKey: anvilKeys[anvilRoles.stranger],
      headers: { 'x-agent-expiry-bought': String(h.clock.now()) },
    });
    const stored = await h.deps.stores.policies.get(key);
    expect(stored?.payload.lastExpiryBought).toBeUndefined();
  });
});
