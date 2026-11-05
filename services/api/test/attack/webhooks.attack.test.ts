/** AP3 — the webhook rows not already in webhooks.test.ts / T-34 / T-82 (base64 MAC, valid MAC over garbage, ORDER_STATUS). */
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_MOCK_WEBHOOK_SECRET } from '@ethglobal/adapters';
import { bytesToHex, hmacSha256 } from '@ethglobal/crypto';

import { harness, iccidOf, provisioned, webhook, type Harness } from './fixture.js';

const signed = (h: Harness, body: string, encoding: 'hex' | 'base64' = 'hex') => {
  const ts = Math.floor(h.clock.now() / 1000);
  const mac = hmacSha256(DEFAULT_MOCK_WEBHOOK_SECRET, `${ts}.${body}`);
  return {
    'x-recharge-signature':
      encoding === 'hex' ? bytesToHex(mac).slice(2) : Buffer.from(mac).toString('base64'),
    'x-recharge-timestamp': String(ts),
    'x-recharge-event-id': `id-${body.length}-${encoding}`,
  };
};

describe('attack: webhooks (AP3)', () => {
  it('the right MAC in base64 (a documented encoding of verifyWebhookSignature) ⇒ 204', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const { delivery } = webhook(h, iccidOf(h, key), 5);
    const res = await h.request('/webhooks/reseller/mock', {
      method: 'POST',
      headers: signed(h, delivery.body, 'base64'),
      body: delivery.body,
    });
    expect(res.status).toBe(204);
  });

  it('a valid MAC over garbage, invalid UTF-8 or a negative usedMb ⇒ 400, never 500, nothing patched', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const update = vi.spyOn(h.adapters.ledger, 'update');
    for (const body of [
      'not json at all',
      '\udc80\udc80{',
      JSON.stringify({
        events: [
          {
            provider: 'mock',
            eventId: 'x',
            iccid: iccidOf(h, key),
            usedMb: -1,
            totalMb: 300,
            asOf: 1,
          },
        ],
      }),
    ]) {
      const res = await h.request('/webhooks/reseller/mock', {
        method: 'POST',
        headers: signed(h, body),
        body,
      });
      expect(res.status).toBe(400);
    }
    expect(update).not.toHaveBeenCalled();
  });

  it('an empty event list (e.g. ORDER_STATUS / CHECK_HEALTH) ⇒ 204, no ledger call', async () => {
    const h = await harness();
    const body = JSON.stringify({ events: [] });
    const query = vi.spyOn(h.adapters.ledger, 'query');
    expect(
      (
        await h.request('/webhooks/reseller/mock', {
          method: 'POST',
          headers: signed(h, body),
          body,
        })
      ).status,
    ).toBe(204);
    expect(query).not.toHaveBeenCalled();
  });
});
