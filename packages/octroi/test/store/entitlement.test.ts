import { describe, expect, it, vi } from 'vitest';

import { InMemoryLedger, type LedgerEntity } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/testing';

import { entitlementIndex } from '../../src/index.js';
import { EntitlementStore, isLive } from '../../src/store/index.js';
import { entitlement, failing, forge, ledgerWith, T0 } from '../helpers.js';

const setup = () => {
  const clock = fakeClock();
  const ledger = new InMemoryLedger({ now: clock.now });
  return { clock, ledger, store: new EntitlementStore(ledger, clock.now) };
};
const E = entitlement({
  key: 'ent:v1:0xabc',
  campaignId: `0x${'AB'.repeat(32)}`,
  iccidHash: `0x${'CD'.repeat(32)}`,
});
const PLAIN = entitlement({ key: E.key });
const ann = {
  type: 'entitlement',
  key: entitlementIndex(E.key), // A-34: the ledger holds the index, never the capability
  kind: 'free',
  status: 'ready',
  tier: 'orb',
  expiresAt: E.expiresAt,
};

describe('EntitlementStore', () => {
  it('create sets expiresIn = secondsUntil', async () => {
    const { ledger, store } = setup();
    const put = vi.spyOn(ledger, 'put');
    const res = await store.create(E);
    expect(put.mock.calls[0]![0]).toMatchObject({
      expiresIn: 3 * 86_400,
      annotations: {
        ...ann,
        campaignId: `0x${'ab'.repeat(32)}`,
        iccidHash: `0x${'cd'.repeat(32)}`,
      },
    });
    expect(res.expiresAt).toBe(E.expiresAt);
    expect(put.mock.calls[0]![0].payload).not.toContain(E.key); // RT-O-01: not in the payload either
    expect(JSON.parse(put.mock.calls[0]![0].payload)).toMatchObject({
      key: entitlementIndex(E.key),
    });
    expect(await store.getByKey(E.key)).toMatchObject({
      entityKey: res.key,
      payload: E,
      expiresAt: E.expiresAt,
    });
    // server-internal lookups see the index (the capability is not on the ledger) …
    expect(await store.getByIccidHash(`0x${'cd'.repeat(32)}`)).toMatchObject({
      payload: { key: entitlementIndex(E.key) },
    });
    // … and the index is not a capability: /me/:key with it finds nothing
    expect(await store.getByKey(entitlementIndex(E.key))).toBeNull();
    await expect(
      store.create({ ...E, key: entitlementIndex('ent:v1:other') }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('create refuses a duplicate logical key, an already-dead entity and an invalid payload', async () => {
    const { store } = setup();
    await store.create(E);
    await expect(store.create(E)).rejects.toMatchObject({ code: 'replay' });
    await expect(
      store.create(entitlement({ key: 'ent:v1:dead', expiresAt: T0 })),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      store.create(entitlement({ key: 'ent:v1:bad', mbUsed: 400 })),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('getByKey ignores entities whose annotations.expiresAt < now even if the ledger still returns them (L1–L3)', async () => {
    const { clock, ledger, store } = setup();
    await forge(
      ledger,
      { ...ann, expiresAt: T0 + 1000 },
      { ...PLAIN, expiresAt: T0 + 1000 },
      86_400,
    );
    expect(await store.getByKey(E.key)).not.toBeNull();
    clock.set(T0 + 1000); // boundary: expiresAt == now is dead
    expect(await store.getByKey(E.key)).toBeNull();
    const row = (over: Partial<LedgerEntity>): LedgerEntity => ({
      key: 'k',
      payload: '',
      annotations: {},
      createdAt: 0,
      expiresAt: null,
      ...over,
    });
    expect(isLive(row({ annotations: { expiresAt: 'never' } }), T0)).toBe(false);
    expect(isLive(row({ expiresAt: T0 }), T0)).toBe(false);
    expect(isLive(row({}), T0)).toBe(true);
  });

  it('looks up by the logical key only, never by entity key (T-36)', async () => {
    const { store } = setup();
    const { key } = await store.create(E);
    expect(await store.getByKey(key)).toBeNull();
  });

  it('two live entities for one key → internal_error', async () => {
    const { ledger, store } = setup();
    await store.create(E);
    await forge(ledger, ann, E, 60);
    await expect(store.getByKey(E.key)).rejects.toMatchObject({ code: 'internal_error' });
  });

  it('malformed payload → null', async () => {
    const { ledger, store } = setup();
    for (const [i, payload] of [
      '{not json',
      { ...PLAIN, mbTotal: -1 },
      { ...PLAIN, tier: 'device' },
    ].entries()) {
      const key = `ent:v1:bad${i}`;
      await forge(
        ledger,
        { ...ann, key: entitlementIndex(key) },
        typeof payload === 'string' ? payload : { ...payload, key },
      );
      expect(await store.getByKey(key)).toBeNull();
    }
  });

  it('patch keeps the logical key and re-derives annotations', async () => {
    const { clock, ledger, store } = setup();
    await store.create(E);
    const update = vi.spyOn(ledger, 'update');
    const next = await store.patch(E.key, {
      status: 'installed',
      mbUsed: 10,
      key: 'ent:v1:hijack',
    });
    expect(next.payload).toMatchObject({ key: E.key, status: 'installed', mbUsed: 10 });
    expect(update.mock.calls[0]![1].annotations).toMatchObject({
      key: entitlementIndex(E.key),
      status: 'installed',
    });
    // the index (what a webhook's getByIccidHash hands back) patches the same row
    const viaIndex = await store.patch(entitlementIndex(E.key), { mbUsed: 11 });
    expect(viaIndex.payload).toMatchObject({ key: entitlementIndex(E.key), mbUsed: 11 });
    expect(update.mock.calls[0]![2]).toBeUndefined(); // lifetime unchanged without opts.expiresAt
    const later = T0 + 10 * 86_400_000;
    const extended = await store.patch(E.key, { mbTotal: 400 }, { expiresAt: later });
    expect(update.mock.calls[2]![2]).toBe(10 * 86_400);
    expect(extended).toMatchObject({
      expiresAt: later,
      payload: { expiresAt: later, mbTotal: 400 },
    });
    await expect(store.patch(E.key, { expiresAt: later + 1 })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    clock.set(later);
    await expect(store.patch(E.key, { mbUsed: 1 })).rejects.toMatchObject({ code: 'not_found' }); // never resurrects
  });

  it('expiringWithin lists soonest first, bounded', async () => {
    const { store } = setup();
    for (const days of [5, 1, 3])
      await store.create(
        entitlement({ key: `ent:v1:d${days}`, expiresAt: T0 + days * 86_400_000 }),
      );
    const soon = await store.expiringWithin(4 * 86_400_000);
    expect(soon.map((f) => f.payload.key)).toEqual(
      ['ent:v1:d1', 'ent:v1:d3'].map(entitlementIndex),
    );
    expect(await store.expiringWithin(10 * 86_400_000, 1)).toHaveLength(1);
  });

  it('ledger errors propagate to the caller (who maps them to 503)', async () => {
    const { ledger, clock } = setup();
    const store = new EntitlementStore(ledgerWith(ledger, { query: failing }), clock.now);
    await expect(store.getByKey(E.key)).rejects.toThrow('arkiv rpc down');
  });
});
