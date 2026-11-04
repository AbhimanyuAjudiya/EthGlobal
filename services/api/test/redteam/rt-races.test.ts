/**
 * Red team wave 2 (unscripted): races through the real HTTP surface on the fake chain — parallel top-ups on one
 * entitlement, the per-ICCID daily cap under concurrency, and the sponsor BUDGET (not the hourly cap) under a burst.
 * RT-A-01/02/03 are fixed: their attack tests are passing regressions named `… [RT-A-0N]`.
 */
import { describe, expect, it, vi } from 'vitest';

import { HUMAN_KEY, STRANGER_KEY, harness, provisioned } from '../support/harness.js';

const topUpPath = (key: string, mb = 100) => `/esim/topup?key=${encodeURIComponent(key)}&mb=${mb}`;

describe('attack: rt parallel top-ups on one entitlement', () => {
  // regression RT-A-01 (fixed): fulfilTopUp patches with the function form (mbTotal recomputed per CAS attempt)
  it('two concurrent paid top-ups (two distinct payments) both land in mbTotal [RT-A-01]', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 'rt-topup-race');
    const before = (await (await h.get(`/me/${encodeURIComponent(key)}?refresh=1`)).json()) as {
      mbTotal: number;
    };
    const quote = await h.get(topUpPath(key));
    expect(quote.status).toBe(402);
    const payA = await h.payFor(quote, { key: HUMAN_KEY });
    const payB = await h.payFor(quote, { key: STRANGER_KEY });
    const topUps = vi.spyOn(h.reseller, 'topUp');
    const [a, b] = await Promise.all([h.get(topUpPath(key), payA), h.get(topUpPath(key), payB)]);
    expect([a.status, b.status]).toEqual([200, 200]); // both payments settled: the users paid $0.80
    expect(topUps).toHaveBeenCalledTimes(2); // the reseller granted 200 MB
    const after = (await (await h.get(`/me/${encodeURIComponent(key)}?refresh=1`)).json()) as {
      mbTotal: number;
    };
    // property: every settled top-up is reflected in the ledger (no lost update)
    expect(after.mbTotal).toBe(before.mbTotal + 200);
  });

  // property: sequential top-ups are additive (control for the race above)
  it('control: two sequential paid top-ups add 200 MB', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 'rt-topup-seq');
    for (const k of [HUMAN_KEY, STRANGER_KEY]) {
      const q = await h.get(topUpPath(key));
      expect((await h.get(topUpPath(key), await h.payFor(q, { key: k }))).status).toBe(200);
    }
    const me = (await (await h.get(`/me/${encodeURIComponent(key)}?refresh=1`)).json()) as {
      mbTotal: number;
    };
    expect(me.mbTotal).toBe(300 + 200);
  });
});

describe('attack: rt daily top-up cap under concurrency', () => {
  // regression RT-A-02 (fixed): topUpGuard reserves a slot synchronously over today's receipt count
  it('TOPUPS_PER_ICCID_PER_DAY=2: five concurrent paid top-ups settle at most 2 [RT-A-02]', async () => {
    const h = await harness({ env: { TOPUPS_PER_ICCID_PER_DAY: '2' } });
    const { key } = await provisioned(h, 'rt-daily-cap');
    const quote = await h.get(topUpPath(key));
    const pays = await Promise.all(Array.from({ length: 5 }, () => h.payFor(quote)));
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const results = await Promise.all(pays.map(async (p) => h.get(topUpPath(key), p)));
    const ok = results.filter((r) => r.status === 200).length;
    // property: the per-ICCID daily cap holds before settle (no payment is taken above the cap)
    expect(settle.mock.calls.length).toBeLessThanOrEqual(2);
    expect(ok).toBeLessThanOrEqual(2);
  });

  // property: sequentially the cap holds and the 3rd is refused before settle
  it('control: the third sequential top-up is 429 daily_cap and is never settled', async () => {
    const h = await harness({ env: { TOPUPS_PER_ICCID_PER_DAY: '2' } });
    const { key } = await provisioned(h, 'rt-daily-seq');
    for (let i = 0; i < 2; i++) {
      const q = await h.get(topUpPath(key));
      expect((await h.get(topUpPath(key), await h.payFor(q))).status).toBe(200);
    }
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const q = await h.get(topUpPath(key));
    expect(q.status).toBe(429);
    expect(settle).not.toHaveBeenCalled();
  });
});

describe('attack: rt sponsor budget burst burns one-time proofs (T-24 / T-46 sibling)', () => {
  // regression RT-A-03 (fixed): admission slots = min(hour left, ⌊budget left / price⌋) − in flight, before verify
  it('budget for 3 claims, 10 concurrent humans ⇒ verify ≤ 3 and the rest refused before verify [RT-A-03]', async () => {
    const h = await harness({ campaign: { budget: 3n * 500_000n, claimsPerHour: 120 } });
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => h.claim({ seed: `rt-budget-${i}` })),
    );
    const statuses = results.map((r) => r.res.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    // property: a human is never verified for a claim the sponsor budget cannot pay (T-24: proofs are one-time)
    expect(verify.mock.calls.length).toBeLessThanOrEqual(3);
    expect(statuses.filter((s) => s === 409)).toHaveLength(7); // budget_exhausted, before verify
  });

  // since RT-A-03 nobody is burned: the losers are refused before verify, so there is no intent to keep
  it('budget for 1 claim, 3 concurrent humans ⇒ the 2 losers are refused before verify (no intent needed)', async () => {
    const h = await harness({ campaign: { budget: 1n * 500_000n, claimsPerHour: 120 } });
    const results = await Promise.all(
      Array.from({ length: 3 }, (_, i) => h.claim({ seed: `rt-burn-${i}` })),
    );
    const losers = results.filter((r) => r.res.status !== 201);
    expect(losers.length).toBe(2);
    for (const l of losers) expect([409, 503]).toContain(l.res.status);
    expect(h.deps.intents.size).toBe(0);
  });
});
