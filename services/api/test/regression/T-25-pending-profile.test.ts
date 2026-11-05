/** T-25, AP6.2: settlement/claim before fulfilment; a reseller outage leaves a durable pending-profile that /me completes. */
import { describe, expect, it } from 'vitest';

import { MockReseller } from '@ethglobal/adapters';

import { harness, provisionPaid } from '../support/harness.js';

describe('T-25 pending profile', () => {
  it('a paid provision during a reseller outage ⇒ 202 (paid once), then ready on the next /me without a second payment', async () => {
    const h = await harness({
      overrides: { adapters: { reseller: new MockReseller({ failNextOrder: true }) } },
    });
    const { res } = await provisionPaid(h);
    expect(res.status).toBe(202);
    const { entitlementKey } = (await res.json()) as { entitlementKey: string };
    const me = (await (await h.get(`/me/${encodeURIComponent(entitlementKey)}`)).json()) as {
      status: string;
    };
    expect(me.status).toBe('ready');
    const receipts = await h.adapters.ledger.query({
      annotations: { type: 'receipt', receiptKind: 'provision' },
    });
    expect(receipts).toHaveLength(1);
  });
});
