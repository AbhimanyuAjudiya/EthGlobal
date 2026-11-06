import { describe, expect, it, vi } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { anvilAccounts, paymentPayload } from '@ethglobal/adapters/testing';

import {
  buildAccepts,
  decide,
  giftEntitlementKey,
  entitlementIndex,
  AgentPolicyStore,
  GiftStore,
  ClaimStore,
} from '../../src/index.js';
import {
  deps,
  freeReq,
  permissive,
  ledgerWith,
  gift,
  GIFT_ID,
  SECRET,
  OTHER_SECRET,
  T0,
  resource,
} from '../helpers.js';

describe('recovery and capability privacy', () => {
  it.each([2, 3])(
    'a failed reservation write %s releases the earlier locks and permits a fresh verified claim',
    async (failedWrite) => {
      const base = new InMemoryLedger({ now: () => T0 });
      let writes = 0;
      const ledger = ledgerWith(base, {
        put: async (input) => {
          if (input.annotations?.type === 'claim' && ++writes === failedWrite)
            throw new Error('temporary write failure');
          return base.put(input);
        },
      });
      const d = deps({ ledger, personhood: permissive() });
      expect(await decide(freeReq(d), d)).toMatchObject({
        kind: 'deny',
        reason: 'ledger-unavailable',
      });
      expect(await base.query({ annotations: { type: 'claim' } })).toHaveLength(0);
      expect(await decide(freeReq(d), d)).toMatchObject({ kind: 'serve-free' });
    },
  );

  it('journals a reservation before locks and promotes it only after all locks exist', async () => {
    const d = deps({ personhood: permissive() });
    const events: string[] = [];
    d.onFreeReservation = async (_decision, r) => {
      expect(r.locks).toHaveLength(3);
      expect(await d.ledger.query({ annotations: { type: 'claim' } })).toHaveLength(0);
      events.push('pending');
    };
    d.onFreeDecision = async () => {
      expect(await d.ledger.query({ annotations: { type: 'claim' } })).toHaveLength(3);
      events.push('reserved');
    };
    expect(await decide(freeReq(d), d)).toMatchObject({ kind: 'serve-free' });
    expect(events).toEqual(['pending', 'reserved']);
  });

  it('a failed durable promotion releases all three reservations', async () => {
    const d = deps({
      personhood: permissive(),
      onFreeDecision: async () => {
        throw new Error('disk full');
      },
    });
    expect(await decide(freeReq(d), d)).toMatchObject({
      kind: 'deny',
      reason: 'ledger-unavailable',
    });
    expect(await d.ledger.query({ annotations: { type: 'claim' } })).toHaveLength(0);
  });

  it('does not release another attempt’s reservation', async () => {
    const d = deps();
    const store = new ClaimStore(d.ledger, d.now);
    const token = `0x${'ab'.repeat(32)}` as const;
    const other = `0x${'cd'.repeat(32)}` as const;
    await store.reserve('claim:reservation', 'free-live', T0 + 60000, token);
    await store.release('claim:reservation', other);
    expect(await store.owned('claim:reservation', token)).toBe(true);
    await store.release('claim:reservation', token);
    expect(await store.held('claim:reservation')).toBe(false);
    expect(await store.owned('claim:reservation', token)).toBe(false);
    // The tombstoned Arkiv row may physically survive for one second; its expired annotation
    // must not prevent a new full-length lock from being acquired immediately.
    expect(await store.reserve('claim:reservation', 'free-live', T0 + 120000, token)).toBe(true);
    expect(await store.owned('claim:reservation', token)).toBe(true);
  });

  it('persists the settled decision before consuming the payment', async () => {
    const d = deps();
    const saved = vi.fn(async () => {
      expect(await d.ledger.query({ annotations: { type: 'claim' } })).toHaveLength(0);
    });
    d.onPaidDecision = saved;
    const request = { resource, mb: 100, payment: paymentPayload(buildAccepts(d, 100)[0]!) };
    expect(await decide(request, d)).toMatchObject({ kind: 'serve-paid' });
    expect(saved).toHaveBeenCalledOnce();
    expect(await d.ledger.query({ annotations: { type: 'claim' } })).toHaveLength(1);
  });

  it('gift IDs do not reveal their capabilities, and claimed gifts publish only their indexes', async () => {
    const d = deps();
    const key = giftEntitlementKey(SECRET, GIFT_ID);
    expect(key).not.toContain(GIFT_ID.slice(2));
    expect(key).not.toBe(giftEntitlementKey(OTHER_SECRET, GIFT_ID));
    const store = new GiftStore(d.ledger, d.now);
    await store.create(gift());
    await store.markClaimed(GIFT_ID, key);
    expect((await store.bySerial(gift().serial))?.payload.claimedKey).toBe(entitlementIndex(key));
    expect(JSON.stringify(await d.ledger.query())).not.toContain(key);
  });

  it('public policies reveal no capability and concurrent stale writes cannot undo a pause', async () => {
    const d = deps();
    const key = 'ent:v1:private-capability';
    const store = new AgentPolicyStore(d.ledger, d.now);
    const policy = {
      v: 1 as const,
      entitlementKey: key,
      owner: anvilAccounts[2],
      updatedAt: T0,
      policy: {
        maxUsd6PerDay: '4000000',
        thresholdMb: 50,
        stepMb: 1000,
        paused: false,
        topUpOnExpiry: false,
        expiryLeadS: 3600,
      },
    };
    await store.put(policy);
    const newer = { ...policy, updatedAt: T0 + 2, policy: { ...policy.policy, paused: true } };
    await Promise.allSettled([store.put(newer), store.put({ ...policy, updatedAt: T0 + 1 })]);
    expect((await store.get(key))?.payload).toMatchObject({
      updatedAt: T0 + 2,
      policy: { paused: true },
    });
    expect(await store.get(entitlementIndex(key))).toBeNull();
    expect(JSON.stringify(await d.ledger.query())).not.toContain(key);
    expect((await store.all())[0]?.payload.entitlementKey).toBe(entitlementIndex(key));
    await expect(store.put({ ...newer, owner: anvilAccounts[3] })).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });
});
