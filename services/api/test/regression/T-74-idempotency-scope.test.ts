/** T-74, AP12: the Idempotency-Key cache is scoped to (route, key, client, body, payment) and never serves another client. */
import { describe, expect, it } from 'vitest';

import { harness, seedCard } from '../support/harness.js';

describe('T-74 idempotency scope', () => {
  it('the same key on another route or from another IP is processed independently', async () => {
    const h = await harness();
    const card = await seedCard(h);
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'shared-key' };
    const cardRes = await h.request(`/card/redeem`, {
      method: 'POST',
      ip: '192.0.2.31',
      headers,
      body: JSON.stringify({ pin: card.pin }),
    });
    const giftRes = await h.request('/gift', {
      method: 'POST',
      ip: '192.0.2.31',
      headers,
      body: JSON.stringify({ name: 'bob.eth', mb: 1000 }),
    });
    const other = await h.request('/gift', {
      method: 'POST',
      ip: '192.0.2.32',
      headers,
      body: JSON.stringify({ name: 'bob.eth', mb: 1000 }),
    });
    expect([cardRes.status, giftRes.status, other.status]).toEqual([400, 402, 402]);
    expect(other.headers.get('idempotent-replay')).toBeNull();
  });
});
