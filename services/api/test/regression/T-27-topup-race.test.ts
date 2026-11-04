/** T-27 / T-30, RT-A-01 + RT-A-02: concurrent paid top-ups are additive, and the daily cap holds under concurrency. */
import { describe, expect, it, vi } from 'vitest';

import { Admission } from '../../src/admission.js';
import { HUMAN_KEY, STRANGER_KEY, harness, provisioned } from '../support/harness.js';

const topUpPath = (key: string, mb = 100) => `/esim/topup?key=${encodeURIComponent(key)}&mb=${mb}`;
const mbTotal = async (h: Awaited<ReturnType<typeof harness>>, key: string) =>
  ((await (await h.get(`/me/${encodeURIComponent(key)}?refresh=1`)).json()) as { mbTotal: number })
    .mbTotal;

describe('T-27 top-up race (RT-A-01)', () => {
  it('two concurrent paid top-ups ⇒ +200 MB, each response reports its own fresh total', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 't27-race');
    const quote = await h.get(topUpPath(key));
    const [payA, payB] = await Promise.all([
      h.payFor(quote, { key: HUMAN_KEY }),
      h.payFor(quote, { key: STRANGER_KEY }),
    ]);
    const [a, b] = await Promise.all([h.get(topUpPath(key), payA), h.get(topUpPath(key), payB)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const totals = [a, b].map(async (r) => ((await r.json()) as { mbTotal: number }).mbTotal);
    expect((await Promise.all(totals)).sort()).toEqual([400, 500]);
    expect(await mbTotal(h, key)).toBe(500);
  });
});

describe('T-30 daily top-up cap under concurrency (RT-A-02)', () => {
  it('a refused or failed top-up frees its slot; served ones count until their receipts are read', async () => {
    const h = await harness({ env: { TOPUPS_PER_ICCID_PER_DAY: '2' } });
    const { key } = await provisioned(h, 't30-slots');
    const quote = await h.get(topUpPath(key));
    // a top-up whose settlement fails is not served: its slot comes back
    vi.spyOn(h.adapters.payments, 'settle').mockResolvedValueOnce({
      success: false,
      errorReason: 'settle_unavailable',
      network: 'eip155:31337',
    });
    expect((await h.get(topUpPath(key), await h.payFor(quote))).status).toBe(402);
    const pays = await Promise.all(Array.from({ length: 4 }, () => h.payFor(quote)));
    const results = await Promise.all(pays.map(async (p) => h.get(topUpPath(key), p)));
    expect(results.map((r) => r.status).sort()).toEqual([200, 200, 429, 429]);
    expect(await mbTotal(h, key)).toBe(500);
  });

  it('Admission: a commit after the counter read is still subtracted; one before it is not', () => {
    let now = 1_000;
    const a = new Admission(() => now);
    const before = a.mark();
    const first = a.take('k', 2, 0, before);
    first?.(true); // committed after `before` was taken: a reader of the old count must still see it
    expect(a.take('k', 2, 0, before)).toBeDefined();
    expect(a.take('k', 2, 0, before)).toBeUndefined(); // 1 committed + 1 in flight
    const after = a.mark(); // a read that started after the commit sees it in `used`
    expect(a.take('k', 2, 1, after)).toBeUndefined(); // 1 used + 1 in flight
    now += 10 * 60_000; // commits are forgotten long after any read that could have missed them
    expect(a.take('k', 3, 1, before)).toBeDefined();
  });
});
