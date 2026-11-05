import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '../../src/index.js';
import { anvilAccounts, describeLedger, fakeClock, T0 } from '../../src/testing/index.js';

describeLedger('InMemoryLedger', async () => {
  const clock = fakeClock();
  return { ledger: new InMemoryLedger({ now: clock.now }), clock };
});

describe('InMemoryLedger specifics', () => {
  it('update resets expiresIn and keeps createdAt', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const { key } = await ledger.put({ payload: 'a', expiresIn: 10 });
    clock.advance(5_000);
    await ledger.update(key, { annotations: { type: 'x' } }, 100);
    expect(await ledger.get(key)).toMatchObject({
      createdAt: T0,
      expiresAt: T0 + 5_000 + 100_000,
      payload: 'a',
    });
  });

  it('a look-alike entity written by another account is invisible (L16, T-79)', async () => {
    const clock = fakeClock();
    const ours = new InMemoryLedger({ now: clock.now, writer: anvilAccounts[2] });
    const evil = ours.asWriter(anvilAccounts[7]);
    const k = `ent:v1:${'a'.repeat(64)}`;
    const mine = await ours.put({
      payload: 'real',
      annotations: { type: 'entitlement', key: k },
      expiresIn: 60,
    });
    const forged = await evil.put({
      payload: 'forged',
      annotations: { type: 'entitlement', key: k },
      expiresIn: 60,
    });
    expect((await ours.query({ annotations: { key: k } })).map((e) => e.payload)).toEqual(['real']);
    expect(await ours.get(forged.key)).toBeNull();
    await expect(ours.update(forged.key, { payload: 'x' })).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(await evil.get(mine.key)).toBeNull();
    expect((await evil.query({ annotations: { key: k } })).map((e) => e.payload)).toEqual([
      'forged',
    ]);
  });

  it('a no-expiry entity has expiresAt null; a negative limit is invalid', async () => {
    const ledger = new InMemoryLedger();
    await expect(ledger.put({ payload: 'p' })).resolves.toMatchObject({ expiresAt: null });
    await expect(ledger.query({ limit: -1 })).rejects.toMatchObject({ code: 'invalid_request' });
  });
});
