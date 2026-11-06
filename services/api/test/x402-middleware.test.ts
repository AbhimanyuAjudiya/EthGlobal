import { describe, expect, it } from 'vitest';

import { encodePaymentPayload, PAYMENT_SIGNATURE_HEADER } from '@ethglobal/protocol/x402';

import { exactPayment } from './support/client.js';
import { errorOf, harness, HUMAN_KEY, provisioned, topUp } from './support/harness.js';

describe('x402() middleware', () => {
  it('malformed or > 16 KiB PAYMENT-SIGNATURE → 400 before any adapter call', async () => {
    const h = await harness();
    const { path } = await provisioned(h);
    const url = `/esim/topup?key=${path}&mb=1000`;
    for (const header of [
      'not base64!',
      Buffer.from('not json').toString('base64'),
      'A'.repeat(17 * 1024),
      Buffer.from(JSON.stringify({ x402Version: 1 })).toString('base64'),
    ]) {
      const res = await h.get(url, { [PAYMENT_SIGNATURE_HEADER]: header });
      expect([res.status, await errorOf(res)]).toEqual([400, 'invalid_request']);
    }
  });

  it('402 carries the PAYMENT-REQUIRED header; success carries PAYMENT-RESPONSE', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const { quote, paid } = await topUp(h, key);
    expect(quote.headers.get('PAYMENT-REQUIRED')).toBeTruthy();
    expect(paid.headers.get('PAYMENT-RESPONSE')).toBeTruthy();
  });

  it('a v1 X-PAYMENT header is ignored (402, never served)', async () => {
    const h = await harness();
    const { key, path } = await provisioned(h);
    const { quote } = await topUp(h, key);
    const required = JSON.parse(
      Buffer.from(quote.headers.get('PAYMENT-REQUIRED') ?? '', 'base64').toString(),
    ) as { accepts: Parameters<typeof exactPayment>[1][] };
    const v1 = encodePaymentPayload(
      await exactPayment(HUMAN_KEY, required.accepts[0]!, { now: h.clock.now() }),
    );
    expect((await h.get(`/esim/topup?key=${path}&mb=1000`, { 'X-PAYMENT': v1 })).status).toBe(402);
  });

  it('X-Session-Pubkey must be hex32', async () => {
    const h = await harness();
    expect((await h.get('/esim/provision?mb=1000', { 'x-session-pubkey': '0x1234' })).status).toBe(
      400,
    );
  });
});
