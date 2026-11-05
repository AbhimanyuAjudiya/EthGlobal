import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';

import { entitlement, forge, H, receipt, T0 } from './fixture.js';
import { EntitlementStore, ReceiptStore } from '../../src/store/index.js';

describe('attack: S stores (T-35, T-36)', () => {
  it('scaffold entity keys ent_000001…ent_000100 never resolve as logical keys', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const store = new EntitlementStore(ledger, () => T0);
    for (let i = 0; i < 100; i += 1)
      await store.create(entitlement({ key: `ent:v1:${String(i).padStart(8, '0')}` }));
    for (let i = 1; i <= 100; i += 1)
      expect(await store.getByKey(`ent_${String(i).padStart(6, '0')}`)).toBeNull();
  });

  it('a look-alike entity whose payload disagrees with its annotations is not served', async () => {
    const ledger = new InMemoryLedger({ now: () => T0 });
    const e = entitlement({ key: 'paid:0xabc:0x01' });
    await forge(
      ledger,
      {
        type: 'entitlement',
        key: e.key,
        kind: 'paid',
        status: 'ready',
        tier: 'orb',
        expiresAt: e.expiresAt,
      },
      { ...e, mbTotal: 30_000 },
    );
    expect(await new EntitlementStore(ledger, () => T0).getByKey(e.key)).toBeNull();
  });

  it("the agent's cap counts only agent-topup: a human 'topup' is not charged to it", async () => {
    const store = new ReceiptStore(new InMemoryLedger({ now: () => T0 }), () => T0);
    await store.add(receipt({ key: 'rcpt:a', kind: 'topup', usd6: '400000' }));
    expect(await store.spentUsd6(H, 'agent-topup', Math.floor(T0 / 86_400_000))).toBe(0n);
  });
});
