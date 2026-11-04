/**
 * Red team wave 2 (unscripted): races through the real HTTP surface on the fake chain — parallel top-ups on one
 * entitlement, the per-ICCID daily cap under concurrency, and the sponsor BUDGET (not the hourly cap) under a burst.
 * Failing cases are marked // RT-FINDING and named *_RTFINDING; passing ones are kept as regressions.
 */
import { describe, expect, it, vi } from 'vitest';

import { HUMAN_KEY, STRANGER_KEY, harness, provisioned } from '../support/harness.js';

const topUpPath = (key: string, mb = 100) => `/esim/topup?key=${encodeURIComponent(key)}&mb=${mb}`;

describe('attack: rt parallel top-ups on one entitlement', () => {
  // RT-FINDING RT-A-01: fulfilTopUp patches mbTotal = (read-before) + mb with no per-key mutex; two paid top-ups lose one
  it('two concurrent paid top-ups (two distinct payments) both land in mbTotal_RTFINDING', async () => {
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
  // RT-FINDING RT-A-02: topUpGuard counts receipts BEFORE settle; N concurrent payments all pass a cap of 2
  it('TOPUPS_PER_ICCID_PER_DAY=2: five concurrent paid top-ups settle at most 2_RTFINDING', async () => {
    const h = await harness({ env: { TOPUPS_PER_ICCID_PER_DAY: '2' } });
    const { key } = await provisioned(h, 'rt-daily-cap');
    const quote = await h.get(topUpPath(key));
    const pays = await Promise.all(Array.from({ length: 5 }, () => h.payFor(quote)));
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const results = await Promise.all(pays.map((p) => h.get(topUpPath(key), p)));
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
  // RT-FINDING RT-A-03: admission sizes the queue to the HOURLY cap only; a burst against a budget of 3 claims runs
  // verify() for every human and 7 lose their one-time World proof to BudgetExhausted (not kept as an intent)
  it('budget for 3 claims, 10 concurrent humans ⇒ verify ≤ 3 and the rest refused before verify_RTFINDING', async () => {
    const h = await harness({ campaign: { budget: 3n * 500_000n, claimsPerHour: 120 } });
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => h.claim({ seed: `rt-budget-${i}` })),
    );
    const statuses = results.map((r) => r.res.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(3);
    // property: a human is never verified for a claim the sponsor budget cannot pay (T-24: proofs are one-time)
    expect(verify.mock.calls.length).toBeLessThanOrEqual(3);
  });

  // documents what the burned humans see: a terminal error, no intent kept, and a retry is a replay
  it('a human burned by BudgetExhausted cannot recover (no intent, retry denied)', async () => {
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
