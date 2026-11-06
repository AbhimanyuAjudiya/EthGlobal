/** T-69, AP16: the 402 body and /plans advertise testnet networks only (SALES_ENABLED=false). */
import { describe, expect, it } from 'vitest';

import { TESTNET_NETWORKS } from '@ethglobal/protocol/ids';
import { decodePaymentRequired } from '@ethglobal/protocol/x402';

import { harness } from '../support/harness.js';

describe('T-69 testnet only', () => {
  it('every advertised network is a testnet network', async () => {
    const h = await harness();
    const plans = (await (await h.get('/plans')).json()) as {
      paid: { accepts: { network: string }[] };
    };
    const quote = await h.json('/gift', { name: 'bob.eth', mb: 1000 });
    const networks = [
      ...plans.paid.accepts,
      ...decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED') ?? '').accepts,
    ].map((a) => a.network);
    expect(networks.length).toBeGreaterThan(0);
    expect(networks.every((n) => TESTNET_NETWORKS.includes(n))).toBe(true);
  });
});
