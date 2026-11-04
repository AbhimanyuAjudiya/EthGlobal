/**
 * Red team (wave 1, octroi): shouldTopUp (T-30, A-13/A-14) and decideGiftReclaim (T-71, D-7) beyond O13 / G.
 * `_RTFINDING` tests (marked `// RT-FINDING`) fail today.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { T0 } from '@ethglobal/adapters/testing';
import { GIFT_CLAIM_WINDOW_S, GIFT_RECLAIM_WINDOW_S } from '@ethglobal/protocol/ids';

import { decideGiftReclaim, shouldTopUp, type TopUpPolicy } from '../../src/index.js';
import { entitlement, gift, GIFT_ID, receipt } from '../helpers.js';

const policy = (over: Partial<TopUpPolicy> = {}): TopUpPolicy => ({
  maxUsd6PerDay: 10_000_000n,
  thresholdMb: 60,
  stepMb: 100,
  paused: false,
  topUpOnExpiry: true,
  expiryLeadS: 3600,
  ...over,
});
const STEP = 400_000n;
const CLAIM_BY = T0 + GIFT_CLAIM_WINDOW_S * 1000;
const base = {
  giftId: GIFT_ID,
  payer: gift().payer!,
  now: CLAIM_BY + 1,
  escrow: null,
  receipts: [receipt()],
  ledgerOk: true,
  feeUsd6: 0n,
};

describe('attack: rt shouldTopUp', () => {
  // Property: the daily cap boundary is exact to the micro-USD: spent + step == cap buys, +1 µUSD refuses.
  it('cap boundary in micro-USD', () => {
    const e = entitlement();
    expect(shouldTopUp(e, policy(), 9_600_000n, T0, STEP).buy).toBe(true);
    expect(shouldTopUp(e, policy(), 9_600_001n, T0, STEP)).toEqual({ buy: false, reason: 'cap' });
    expect(shouldTopUp(e, policy({ maxUsd6PerDay: 0n }), 0n, T0, STEP)).toEqual({
      buy: false,
      reason: 'cap',
    });
  });

  // Property: expiry fires once per expiresAt VALUE — every distinct value inside the lead buys once, so the
  // number of expiry buys is bounded by the number of distinct expiresAt values the API writes (and the cap).
  it('expiry-lead: one buy per distinct expiresAt, and the cap bounds the loop even if expiresAt keeps moving', () => {
    let spent = 0n;
    let last: number | undefined;
    let buys = 0;
    for (let i = 0; i < 100; i++) {
      const e = entitlement({ mbUsed: 0, expiresAt: T0 + 1_800_000 + i }); // the API nudges expiresAt by 1 ms
      const v = shouldTopUp(e, policy(), spent, T0, STEP, last);
      if (v.buy) {
        buys++;
        spent += v.costUsd6;
        last = e.expiresAt;
      }
      const again = shouldTopUp(e, policy(), spent, T0, STEP, last);
      expect(again.buy).toBe(false);
    }
    expect(buys).toBe(25); // 25 × $0.40 = $10.00 = the cap, never more
    expect(spent).toBeLessThanOrEqual(10_000_000n);
  });

  // Property: paused flipped mid-loop stops buying immediately and resumes without a burst.
  it('paused flip mid-loop', () => {
    let spent = 0n;
    const buys: number[] = [];
    for (let minute = 0; minute < 120; minute++) {
      const paused = minute >= 30 && minute < 60;
      const e = entitlement({
        mbTotal: 300 + buys.length * 100,
        mbUsed: Math.min(300 + buys.length * 100, minute * 5),
      });
      const v = shouldTopUp(
        e,
        policy({ paused, topUpOnExpiry: false }),
        spent,
        T0 + minute * 60_000,
        STEP,
      );
      if (paused) expect(v).toEqual({ buy: false, reason: 'paused' });
      if (v.buy) {
        spent += v.costUsd6;
        buys.push(minute);
      }
    }
    expect(buys.filter((m) => m >= 30 && m < 60)).toEqual([]);
    expect(spent).toBeLessThanOrEqual(10_000_000n);
  });

  // Property (fast-check): for any non-negative price and usage trace, Σ cost of buys ≤ cap.
  it('Σ costUsd6 ≤ maxUsd6PerDay for any positive step price and usage trace', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 5_000_000n }),
        fc.bigInt({ min: 0n, max: 20_000_000n }),
        fc.array(fc.integer({ min: 0, max: 50 }), { maxLength: 300 }),
        (price, cap, usage) => {
          let spent = 0n;
          let total = 300;
          let used = 0;
          for (const u of usage) {
            used = Math.min(total, used + u);
            const v = shouldTopUp(
              entitlement({ mbTotal: total, mbUsed: used }),
              policy({ maxUsd6PerDay: cap, topUpOnExpiry: false }),
              spent,
              T0,
              price,
            );
            if (v.buy) {
              spent += v.costUsd6;
              total += v.mb;
            }
          }
          expect(spent).toBeLessThanOrEqual(cap);
        },
      ),
      { numRuns: 200 },
    );
  });

  // RT-FINDING RT-O-07
  it.each([0n, -400_000n])(
    'a non-positive stepPriceUsd6 (%s) is refused, not a buy that bypasses the cap_RTFINDING',
    (price) => {
      // spent is already AT the cap; the only reason this buys is that the price input was not validated.
      const v = shouldTopUp(entitlement(), policy(), 10_000_000n, T0, price);
      expect(v.buy).toBe(false);
    },
  );

  // RT-FINDING RT-O-07
  it('now = NaN is not a buy (an unparsable clock must not skip the expired check)_RTFINDING', () => {
    const v = shouldTopUp(entitlement({ expiresAt: T0 - 1 }), policy(), 0n, Number.NaN, STEP);
    expect(v.buy).toBe(false);
  });
});

describe('attack: rt decideGiftReclaim', () => {
  // RT-FINDING RT-O-09 (design)
  it('fee ≥ paid → deny, never a zero-value refund (a 0n transfer still costs the treasury gas and writes a gift-reclaim receipt)_RTFINDING', () => {
    const v = decideGiftReclaim({ ...base, feeUsd6: 4_000_000n });
    expect(v.kind).toBe('deny');
  });

  // Property: refund amount for fee < paid is exact and never negative; negative fee is treated as 0.
  it('refund = usd6 − fee; negative fee → full refund', () => {
    expect(decideGiftReclaim({ ...base, feeUsd6: 100_000n })).toMatchObject({
      kind: 'refund',
      usd6: 3_900_000n,
      feeUsd6: 100_000n,
    });
    expect(decideGiftReclaim({ ...base, feeUsd6: -5n })).toMatchObject({
      kind: 'refund',
      usd6: 4_000_000n,
      feeUsd6: 0n,
    });
  });

  // Property: reclaim before claimBy is too-early whether or not the escrow is still readable (T-35 early drop).
  it('before claimBy: too-early with escrow open, with escrow dropped, and at claimBy − 1 ms', () => {
    expect(decideGiftReclaim({ ...base, now: CLAIM_BY - 1, escrow: gift() })).toMatchObject({
      reason: 'too-early',
    });
    expect(decideGiftReclaim({ ...base, now: CLAIM_BY - 1 })).toMatchObject({
      reason: 'too-early',
    });
    expect(decideGiftReclaim({ ...base, now: CLAIM_BY }).kind).toBe('refund');
  });

  // Property: reclaim twice — once a gift-reclaim receipt exists (pending or not) the second is refused.
  it('second reclaim → already-reclaimed; window end is exclusive', () => {
    expect(
      decideGiftReclaim({
        ...base,
        receipts: [receipt(), receipt({ key: 'rcpt:r', kind: 'gift-reclaim' })],
      }),
    ).toMatchObject({ reason: 'already-reclaimed' });
    expect(
      decideGiftReclaim({ ...base, now: CLAIM_BY + GIFT_RECLAIM_WINDOW_S * 1000 }),
    ).toMatchObject({ reason: 'window-closed' });
    expect(
      decideGiftReclaim({ ...base, now: CLAIM_BY + GIFT_RECLAIM_WINDOW_S * 1000 - 1 }).kind,
    ).toBe('refund');
  });

  // Property: an escrow still readable with state 'claimed' (gift-claim receipt write failed) → claimed.
  it('escrow claimed, receipt missing → claimed; claim receipt present, escrow gone → claimed', () => {
    expect(
      decideGiftReclaim({ ...base, escrow: gift({ state: 'claimed', claimedKey: 'giftent:x' }) }),
    ).toMatchObject({ reason: 'claimed' });
    expect(
      decideGiftReclaim({
        ...base,
        receipts: [receipt(), receipt({ key: 'rcpt:c', kind: 'gift-claim' })],
      }),
    ).toMatchObject({ reason: 'claimed' });
  });

  // Property (documents the T-71(a) dependency): once the escrow has expired, the ONLY evidence of a claim the
  // rule sees is the gift-claim receipt. A delivered gift whose receipt write failed is refundable — the API must
  // write the receipt (or markClaimed) before returning the LPA. Recorded, not a new finding (T-71 row).
  it('escrow expired + no gift-claim receipt → refund (receipt-before-LPA is the API’s control)', () => {
    expect(decideGiftReclaim({ ...base, escrow: null }).kind).toBe('refund');
  });

  // Property: payer comparison is case-insensitive for EVM, exact-string for Hedera ids; a missing payer on the
  // receipt or a payer on another network is not-payer.
  it('payer matching', () => {
    expect(
      decideGiftReclaim({ ...base, payer: base.payer.toUpperCase().replace('0X', '0x') }).kind,
    ).toBe('refund');
    expect(decideGiftReclaim({ ...base, receipts: [receipt({ payer: undefined })] })).toMatchObject(
      { reason: 'not-payer' },
    );
    expect(
      decideGiftReclaim({ ...base, payer: '0.0.777', receipts: [receipt({ payer: '0.0.7770' })] }),
    ).toMatchObject({ reason: 'not-payer' });
  });

  // Property (T-79 dependency): with two 'gift' receipts the rule takes the FIRST; a forged receipt naming the
  // attacker as payer, if it were readable, would decide who is refunded. Safe only while the adapter filters
  // $creator (InMemoryLedger and ArkivLedger do); recorded as ledger assumption A-L1.
  it('two gift receipts: first wins (documents the $creator dependency)', () => {
    const forged = receipt({
      key: 'rcpt:forged',
      payer: '0x000000000000000000000000000000000000dEaD',
    });
    expect(
      decideGiftReclaim({ ...base, payer: forged.payer!, receipts: [forged, receipt()] }).kind,
    ).toBe('refund');
    expect(
      decideGiftReclaim({ ...base, payer: forged.payer!, receipts: [receipt(), forged] }),
    ).toMatchObject({ reason: 'not-payer' });
  });
});
