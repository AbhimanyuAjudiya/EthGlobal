import { describe, expect, it } from 'vitest';

import type { PlansResponse } from '@ethglobal/protocol/schemas';

import {
  clockIst,
  dayLabel,
  formatMb,
  iccidGroups,
  mmss,
  money,
  moneyUsdc,
  priceFor,
  soldPlan,
  usdcBalance,
} from '../lib/format';

// Sun 15 Nov 2026 09:12 IST
const AT = Date.UTC(2026, 10, 15, 3, 42);

describe('format', () => {
  it('MB integers below 1 GB, one decimal GB above, en-IN grouping, no-break space', () => {
    expect(formatMb(300)).toBe('300 MB');
    expect(formatMb(999)).toBe('999 MB');
    expect(formatMb(1000)).toBe('1 GB');
    expect(formatMb(1500)).toBe('1.5 GB');
    expect(formatMb(1599)).toBe('1.5 GB'); // floored, never overstated
    expect(formatMb(120_000)).toBe('120\u00a0GB');
  });

  it('money: two decimals with the unit that moves', () => {
    expect(money('400000')).toBe('$0.40');
    expect(moneyUsdc('400000')).toBe('$0.40 USDC');
    expect(money(1_200_000n)).toBe('$1.20');
    expect(priceFor(300, '400000')).toBe(1_200_000n);
    expect(money(priceFor(1000, '400000'))).toBe('$4.00');
  });

  it('soldPlan: the one size /plans sells per lane, 1 GB · $4.00 before /plans answers', () => {
    expect(soldPlan(undefined)).toEqual({ mb: 1000, usd6: 4_000_000n });
    const plans: Pick<PlansResponse, 'paid' | 'gift'> = {
      paid: { stepMb: 100, priceUsd6PerStep: '400000', validityDays: 7, accepts: [] },
      gift: { sizesMb: [1000], claimWindowS: 3600 },
    };
    // an API from before sizesMb: still the product unit, priced per 100 MB
    expect(soldPlan(plans)).toEqual({ mb: 1000, usd6: 4_000_000n });
    expect(soldPlan({ ...plans, paid: { ...plans.paid, sizesMb: [2000] } })).toEqual({
      mb: 2000,
      usd6: 8_000_000n,
    });
    expect(soldPlan({ ...plans, gift: { sizesMb: [3000], claimWindowS: 1 } }, 'gift').mb).toBe(
      3000,
    );
  });

  it('money groups en-IN (web.md §8): lakhs, not millions', () => {
    expect(money(999_986_800_000n)).toBe('$9,99,986.80');
    expect(moneyUsdc(1_000_000_000n)).toBe('$1,000.00 USDC');
    expect(usdcBalance(999_986_800_000n)).toBe('9,99,986.80 USDC');
  });

  it('times are 24-hour IST; days read "Sun 15 Nov" without a comma', () => {
    expect(clockIst(AT)).toBe('09:12');
    expect(dayLabel(AT)).toBe('Sun 15 Nov');
    // Hindi / Marathi day and month names, numerals stay Latin
    expect(dayLabel(AT, 'hi')).toMatch(/^[\u0900-\u097F]+ 15 [\u0900-\u097F]+/);
    expect(dayLabel(AT, 'mr')).not.toMatch(/[०-९]/);
    expect(mmss(300_000)).toBe('5:00');
    expect(mmss(42_000)).toBe('0:42');
    expect(mmss(-5)).toBe('0:00');
  });

  it('ICCIDs in fives', () => {
    expect(iccidGroups('8991101200003204510')).toBe('89911 01200 00320 4510');
  });
});
