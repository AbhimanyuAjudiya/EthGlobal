/** AP6 — campaign states before verify, and the pending-profile saga (T-24, T-25). */
import { describe, expect, it, vi } from 'vitest';

import { MockReseller } from '@ethglobal/adapters';
import { T0 } from '@ethglobal/adapters/testing';

import { harness } from './fixture.js';

describe('attack: campaign states and pending profiles (AP6)', () => {
  it('paused / budget / unknown ⇒ no verify and no ledger write at all', async () => {
    for (const [opts, campaignId] of [
      [{ paused: true }, undefined],
      [{ budget: 1n }, undefined],
      [{}, `0x${'cd'.repeat(32)}`],
    ] as const) {
      const h = await harness({ campaign: opts });
      const verify = vi.spyOn(h.adapters.personhood, 'verify');
      const put = vi.spyOn(h.adapters.ledger, 'put');
      const { res } = await h.claim(campaignId ? { campaignId } : {});
      expect(res.status).toBeGreaterThanOrEqual(404);
      expect(verify).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
    }
  });

  it('reseller down once ⇒ 202 pending-profile without sealedLpa; /me retries the same order key ⇒ ready; Claimed stays 1', async () => {
    const reseller = new MockReseller({ now: () => T0, failNextOrder: true });
    const h = await harness({ overrides: { adapters: { reseller } } });
    const order = vi.spyOn(reseller, 'order');
    const { res } = await h.claim({ seed: 'pending' });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      status: string;
      sealedLpa?: unknown;
      entitlementKey: string;
    };
    expect(body.status).toBe('pending-profile');
    expect(body.sealedLpa).toBeUndefined();
    const path = encodeURIComponent(body.entitlementKey);
    const me = (await (await h.get(`/me/${path}`)).json()) as { status: string };
    expect(me.status).toBe('ready');
    expect(order.mock.calls.map((c) => c[1].idempotencyKey)).toEqual([
      body.entitlementKey,
      body.entitlementKey,
    ]);
    expect(reseller.orders()).toHaveLength(1);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    // AP6.3 (design finding, README): the retried profile is sealed to the original session key and stored as a blob
    // reference; /me never returns it, so a separate one-time delivery route is still needed.
    expect(await (await h.get(`/me/${path}`)).text()).not.toMatch(/sealedLpa|LPA:/);
    const [entity] = await h.adapters.ledger.query({ annotations: { type: 'entitlement' } });
    expect(entity?.payload).toMatch(/"sealedRef":"bzz:\/\//);
  });
});
