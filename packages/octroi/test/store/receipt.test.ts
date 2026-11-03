import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { dayBucket } from '@ethglobal/protocol/ids';

import { ReceiptStore } from '../../src/store/index.js';
import { CAMPAIGN_ID, H, receipt, T0 } from '../helpers.js';

const LATE = Date.UTC(2026, 10, 3, 23, 59, 59);
const MIDNIGHT = Date.UTC(2026, 10, 4);

describe('ReceiptStore', () => {
  it('spentUsd6 sums only the matching kind/day', async () => {
    const store = new ReceiptStore(new InMemoryLedger({ now: () => T0 }), () => T0);
    const rows = [
      receipt({ key: 'rcpt:1', kind: 'agent-topup', usd6: '400000', at: T0 }),
      receipt({ key: 'rcpt:2', kind: 'agent-topup', usd6: '800000', at: LATE }),
      receipt({ key: 'rcpt:3', kind: 'agent-topup', usd6: '400000', at: MIDNIGHT }),
      receipt({ key: 'rcpt:4', kind: 'topup', usd6: '999999', at: T0 }),
      receipt({ key: 'rcpt:5', kind: 'agent-topup', usd6: undefined, at: T0 }),
      receipt({
        key: 'rcpt:6',
        kind: 'claim',
        entitlementKeyHash: `0x${'22'.repeat(32)}`,
        campaignId: CAMPAIGN_ID,
        at: T0,
      }),
    ];
    for (const r of rows) await store.add(r);
    expect(await store.spentUsd6(H, 'agent-topup', dayBucket(T0))).toBe(1_200_000n);
    expect(await store.spentUsd6(H, 'agent-topup', dayBucket(MIDNIGHT))).toBe(400_000n);
    expect(await store.spentUsd6(H, 'topup', dayBucket(T0))).toBe(999_999n);
    expect(await store.forEntitlement(H)).toHaveLength(5);
    expect((await store.forCampaign(CAMPAIGN_ID)).map((r) => r.key)).toEqual(['rcpt:6']);
    await expect(store.add(rows[0]!)).rejects.toMatchObject({ code: 'replay' });
  });
});
