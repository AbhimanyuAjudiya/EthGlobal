/**
 * Red-team verification variants for the top-up findings, through the real HTTP surface:
 *   RT-A-01 — four distinct payers AND a usage webhook racing on one entitlement: every settled top-up lands
 *             (mbTotal == 300 + 100 × served) and the webhook's usage is not rolled back.
 *   RT-A-02 — TOPUPS_PER_ICCID_PER_DAY=2 with six concurrent requests, half of them carrying a payment that fails
 *             before settle (wrong amount): a refused request frees its slot, and still ≤ 2 settle.
 *   RT-A-08 — a captured top-up PAYMENT-SIGNATURE for entitlement K replayed, unmodified, on the SAME route for the
 *             attacker's entitlement K2 (the route binding is `extra.resource = path`, the query is not bound).
 */
import { describe, expect, it, vi } from 'vitest';

import { anvilKeys } from '@ethglobal/adapters/testing';

import { harness, HUMAN_KEY, iccidOf, provisioned, webhook } from '../support/harness.js';

const topUpPath = (key: string, mb = 100) => `/esim/topup?key=${encodeURIComponent(key)}&mb=${mb}`;
const meOf = async (h: Awaited<ReturnType<typeof harness>>, key: string) =>
  (await (await h.get(`/me/${encodeURIComponent(key)}?refresh=1`)).json()) as {
    mbTotal: number;
    mbUsed: number;
  };

describe('verify RT-A-01: concurrent top-ups from four payers + a usage webhook', () => {
  it('every 200 lands in mbTotal; the webhook usage survives', async () => {
    const h = await harness({ env: { TOPUPS_PER_ICCID_PER_DAY: '10' } });
    const { key } = await provisioned(h, 'verify-a01');
    const before = await meOf(h, key);
    const quote = await h.get(topUpPath(key));
    const pays = await Promise.all(
      [1, 2, 3, 4].map((i) => h.payFor(quote, { key: anvilKeys[i + 4]! })),
    );
    const usage = webhook(h, iccidOf(h, key), 120);
    const [hook, ...results] = await Promise.all([
      usage.send(),
      ...pays.map((p) => h.get(topUpPath(key), p)),
    ]);
    expect(hook.status).toBeLessThan(300);
    const served = results.filter((r) => r.status === 200).length;
    expect(served).toBe(4);
    const after = await meOf(h, key);
    expect(after.mbTotal).toBe(before.mbTotal + 100 * served);
    expect(after.mbUsed).toBeGreaterThanOrEqual(120);
  });
});

describe('verify RT-A-02: refused requests free their slot, the cap still holds', () => {
  it('cap 2, six concurrent (three with a wrong amount) ⇒ settle ≤ 2, served ≤ 2, and ≥ 1 valid served', async () => {
    const h = await harness({ env: { TOPUPS_PER_ICCID_PER_DAY: '2' } });
    const { key } = await provisioned(h, 'verify-a02');
    const quote = await h.get(topUpPath(key));
    const good = await Promise.all([0, 1, 2].map(() => h.payFor(quote)));
    const bad = await Promise.all([0, 1, 2].map(() => h.payFor(quote, { value: '1' })));
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const results = await Promise.all(
      [bad[0]!, good[0]!, bad[1]!, good[1]!, bad[2]!, good[2]!].map(async (p) =>
        h.get(topUpPath(key), p),
      ),
    );
    const ok = results.filter((r) => r.status === 200).length;
    expect(settle.mock.calls.length).toBeLessThanOrEqual(2);
    expect(ok).toBeLessThanOrEqual(2);
    expect(ok).toBeGreaterThanOrEqual(1);
    // after the burst, the day is closed for this ICCID once two are served
    if (ok === 2) expect((await h.get(topUpPath(key))).status).toBe(429);
  });
});

describe('verify RT-A-08: a payment is bound to what it bought', () => {
  // RT-FINDING RT-A-08: accepts carry extra.resource = c.req.path only; `key` (the entitlement being topped up) is in the
  // query, so the same unmodified header buys MB for ANY entitlement on /esim/topup.
  it('a top-up payment for K replayed unmodified for K2 on /esim/topup ⇒ refused_RTFINDING', async () => {
    const h = await harness();
    const victim = await provisioned(h, 'verify-a08-victim');
    const thief = await provisioned(h, 'verify-a08-thief');
    const quote = await h.get(topUpPath(victim.key));
    const captured = await h.payFor(quote, { key: HUMAN_KEY }); // the victim's signed payment
    const stolen = await h.get(topUpPath(thief.key), captured); // first to arrive wins
    const thiefAfter = await meOf(h, thief.key);
    expect(stolen.status).not.toBe(200);
    expect(thiefAfter.mbTotal).toBe(300);
  });

  it('control: the same header replayed on /esim/provision or /gift is refused', async () => {
    const h = await harness();
    const victim = await provisioned(h, 'verify-a08-ctl');
    const captured = await h.payFor(await h.get(topUpPath(victim.key)));
    expect((await h.get('/esim/provision?mb=100', captured)).status).not.toBe(200);
  });
});
