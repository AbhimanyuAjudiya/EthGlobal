/** T-31, AP4: the sealed LPA is delivered exactly once; the ledger holds a blob reference only; nothing re-delivers it. */
import { describe, expect, it } from 'vitest';

import { harness, provisioned } from '../support/harness.js';

describe('T-31 LPA single delivery', () => {
  it('only the /claim response carries sealedLpa; /me, receipts and the ledger hold no LPA or sealed box', async () => {
    const h = await harness();
    const { body, path } = await provisioned(h);
    expect(body.sealedLpa?.ct).toMatch(/^0x[0-9a-f]+$/);
    const surfaces = [
      await (await h.get(`/me/${path}`)).text(),
      await (await h.get(`/me/${path}/receipts`)).text(),
      JSON.stringify(await h.adapters.ledger.query()),
    ];
    for (const text of surfaces) {
      expect(text).not.toContain(body.sealedLpa?.ct ?? 'none');
      expect(text).not.toMatch(/LPA:1\$/);
    }
    const [entity] = await h.adapters.ledger.query({ annotations: { type: 'entitlement' } });
    const { sealedRef } = JSON.parse(entity?.payload ?? '{}') as { sealedRef: string };
    const blob = await h.adapters.blobs.get(sealedRef);
    expect(new TextDecoder().decode(blob ?? new Uint8Array())).toContain(
      body.sealedLpa?.ct ?? 'none',
    );
  });
});
