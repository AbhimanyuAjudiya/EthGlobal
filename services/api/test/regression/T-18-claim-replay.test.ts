/** T-18, AP1: one free entitlement per human; the ledger key, the in-process mutex and DataDrop.claimed all hold. */
import { describe, expect, it } from 'vitest';

import { permissivePersonhood } from '../attack/fixture.js';
import { harness } from '../support/harness.js';

describe('T-18 claim replay', () => {
  it('five sequential and five concurrent replays of one human produce one Claimed and one profile', async () => {
    const h = await harness({ overrides: { adapters: { personhood: permissivePersonhood() } } });
    const sequential = [];
    for (let i = 0; i < 5; i++) sequential.push((await h.claim({ seed: 't18' })).res.status);
    const concurrent = (
      await Promise.all(Array.from({ length: 5 }, () => h.claim({ seed: 't18' })))
    ).map((r) => r.res.status);
    expect(sequential).toEqual([201, 409, 409, 409, 409]);
    expect(concurrent).toEqual([409, 409, 409, 409, 409]);
    expect([h.dataDrop.claimedEvents.length, h.reseller.orders().length]).toEqual([1, 1]);
  });
});
