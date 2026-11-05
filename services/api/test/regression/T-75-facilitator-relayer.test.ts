/** T-75, RT-A-12: the public facilitator relays no dust, bounds each payer, and the relayer sends one tx at a time. */
import { describe, expect, it } from 'vitest';

import type { Hex } from '@ethglobal/protocol/ids';
import type { PaymentRequirements } from '@ethglobal/protocol/schemas';

import { serialRelayer } from '../../src/deps.js';
import { FACILITATOR_PER_PAYER_PER_MIN } from '../../src/routes/facilitator.js';
import { exactPayment } from '../support/client.js';
import { errorOf, harness, HUMAN_KEY, STRANGER_KEY, type Harness } from '../support/harness.js';

const terms = (h: Harness, amount = '400000'): PaymentRequirements => ({
  ...h.deps.accepts[0]!,
  amount,
});
const verify = async (h: Harness, req: PaymentRequirements, key: Hex = HUMAN_KEY) =>
  h.json('/facilitator/verify', {
    x402Version: 2,
    paymentPayload: await exactPayment(key, req, { now: h.clock.now() }),
    paymentRequirements: req,
  });

describe('T-75 facilitator guards (RT-A-12)', () => {
  it('an amount below one step (the smallest thing we sell) ⇒ 400 before the rail', async () => {
    const h = await harness();
    const res = await verify(h, terms(h, '1'));
    expect([res.status, await errorOf(res)]).toEqual([400, 'invalid_request']);
    expect((await verify(h, terms(h))).status).toBe(200);
  });

  it(`${FACILITATOR_PER_PAYER_PER_MIN} calls per payer per minute, from any IP; another payer is unaffected`, async () => {
    const h = await harness();
    for (let i = 0; i < FACILITATOR_PER_PAYER_PER_MIN; i++)
      expect((await verify(h, terms(h))).status).toBe(200);
    const limited = await verify(h, terms(h));
    expect([limited.status, await errorOf(limited)]).toEqual([429, 'rate_limited']);
    expect(limited.headers.get('retry-after')).toBeTruthy();
    expect((await verify(h, terms(h), STRANGER_KEY)).status).toBe(200);
    h.clock.advance(60_001);
    expect((await verify(h, terms(h))).status).toBe(200);
  });

  it('serialRelayer: submissions never overlap, a failure does not block the next', async () => {
    let active = 0;
    let peak = 0;
    const order: number[] = [];
    let n = 0;
    const relayer = serialRelayer({
      address: '0x0000000000000000000000000000000000000001',
      submit: async () => {
        const id = ++n;
        active++;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active--;
        order.push(id);
        if (id === 2) throw new Error('nonce too low');
        return { hash: `0x${String(id).padStart(64, '0')}`, status: 'success' };
      },
    });
    const token = '0x0000000000000000000000000000000000000002';
    const results = await Promise.allSettled([1, 2, 3].map(() => relayer.submit(token, '0x')));
    expect(peak).toBe(1);
    expect(order).toEqual([1, 2, 3]);
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected', 'fulfilled']);
    expect(relayer.address).toBe('0x0000000000000000000000000000000000000001');
    expect(serialRelayer({ submit: (t, d) => relayer.submit(t, d) }).address).toBeUndefined();
  });
});
