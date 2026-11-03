import { describe, expect, it } from 'vitest';

import { fakeClock, T0 } from './fixtures.js';
import { InMemoryLedger } from '../src/mocks/ledger.js';

describe('InMemoryLedger', () => {
  it('issues sequential keys and returns what was stored', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const first = await ledger.put({ payload: 'a', annotations: { type: 'receipt', amount: 5 } });
    const second = await ledger.put({ payload: 'b' });
    expect(first).toEqual({ key: 'ent_000001', expiresAt: null });
    expect(second.key).toBe('ent_000002');
    expect(await ledger.get(first.key)).toEqual({
      key: 'ent_000001',
      payload: 'a',
      annotations: { type: 'receipt', amount: 5 },
      createdAt: T0,
      expiresAt: null,
    });
    expect(await ledger.get('ent_999999')).toBeNull();
  });

  it('expires entities after expiresIn seconds', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const { key, expiresAt } = await ledger.put({ payload: 'ttl', expiresIn: 30 });
    expect(expiresAt).toBe(T0 + 30_000);
    clock.advance(29_999);
    expect(await ledger.get(key)).not.toBeNull();
    clock.advance(1);
    expect(await ledger.get(key)).toBeNull();
    expect(await ledger.query()).toEqual([]);
  });

  it('rejects a non-positive expiry', async () => {
    const ledger = new InMemoryLedger();
    await expect(ledger.put({ payload: 'x', expiresIn: 0 })).rejects.toMatchObject({
      code: 'invalid_expiry',
    });
  });

  it('queries by annotation equality with a limit, oldest first', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    for (const [owner, amount] of [
      ['a', 1],
      ['b', 2],
      ['a', 3],
    ] as const) {
      await ledger.put({ payload: '', annotations: { owner, amount } });
      clock.advance(1000);
    }
    const owned = await ledger.query({ annotations: { owner: 'a' } });
    expect(owned.map((entity) => entity.annotations.amount)).toEqual([1, 3]);
    expect(await ledger.query({ annotations: { owner: 'a', amount: 3 } })).toHaveLength(1);
    expect(await ledger.query({ limit: 2 })).toHaveLength(2);
    expect(await ledger.query({ annotations: { owner: 'zz' } })).toEqual([]);
  });

  it('hands out copies, not live references', async () => {
    const ledger = new InMemoryLedger();
    const { key } = await ledger.put({ payload: 'p', annotations: { n: 1 } });
    const entity = await ledger.get(key);
    entity!.annotations.n = 2;
    expect((await ledger.get(key))?.annotations.n).toBe(1);
  });
});
