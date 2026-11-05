/** T-47, AP10.6: no GET route changes state except the documented x402 GETs and /me refresh. */
import { describe, expect, it, vi } from 'vitest';

import { harness, provisioned, seedCard } from '../support/harness.js';

describe('T-47 GET is read-only', () => {
  it('GET /card/:serial, /plans, /me/:key/receipts, /sponsor/:id (unauthenticated) and /openapi.json write nothing', async () => {
    const h = await harness();
    const { path } = await provisioned(h);
    const card = await seedCard(h);
    await h.get(`/me/${path}`);
    const put = vi.spyOn(h.adapters.ledger, 'put');
    const update = vi.spyOn(h.adapters.ledger, 'update');
    const claim = vi.spyOn(h.dataDrop, 'claim');
    for (const url of [
      `/card/${card.serial}?pin=${card.pin}`,
      '/plans',
      `/me/${path}`,
      `/me/${path}/receipts`,
      `/sponsor/${h.campaignId}`,
      '/openapi.json',
      '/healthz',
    ]) {
      await h.get(url, { 'user-agent': 'Slackbot-LinkExpanding 1.0', 'sec-purpose': 'prefetch' });
    }
    expect([put.mock.calls.length, update.mock.calls.length, claim.mock.calls.length]).toEqual([
      0, 0, 0,
    ]);
  });
});
