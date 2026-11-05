import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { expectRecharge } from './helpers.js';
import {
  assertMbStep,
  bytesFromMb,
  formatAsOf,
  formatExpiry,
  formatMb,
  formatUsd6,
  mbFromBytes,
  priceUsd6,
  secondsUntil,
  usd6,
  usd6FromWire,
  usd6ToWire,
} from '../src/units.js';

const NBSP = ' ';
const usd6Arb = fc.bigInt({ min: 0n, max: 10n ** 24n });

describe('usd6', () => {
  it('spec vectors', () => {
    expect(usd6('0.40')).toBe(400_000n);
    expect(usd6('0.4')).toBe(400_000n);
    expect(usd6('12')).toBe(12_000_000n);
    expect(usd6('0.000001')).toBe(1n);
  });

  it.each(['-0.40', '1e6', 'NaN', '', '.4', '0.4000001', '1,000', ' 1', '$1', 'Infinity', '0x10'])(
    'rejects %j',
    (bad) => {
      expectRecharge(() => usd6(bad), 'invalid_request');
    },
  );

  it('property: usd6 inverts a 6-dp decimal rendering', () => {
    fc.assert(
      fc.property(usd6Arb, (v) => {
        const text = `${v / 1_000_000n}.${(v % 1_000_000n).toString().padStart(6, '0')}`;
        expect(usd6(text)).toBe(v);
      }),
    );
  });
});

describe('formatUsd6', () => {
  it.each([
    [400_000n, '$0.40'],
    [0n, '$0.00'],
    [1_200_000n, '$1.20'],
    [1_234_567_890_000n, '$1,234,567.89'],
    [1_234_567n, '$1.234567'],
    [10_500n, '$0.0105'],
    [-400_000n, '-$0.40'],
  ])('%s → %s', (value, text) => {
    expect(formatUsd6(value)).toBe(text);
  });

  it('appends the unit', () => {
    expect(formatUsd6(400_000n, { unit: 'USDC' })).toBe('$0.40 USDC');
    expect(formatUsd6(400_000n, { unit: '' })).toBe('$0.40');
  });

  it('property: exact — stripping "$" and "," round-trips through usd6', () => {
    fc.assert(
      fc.property(usd6Arb, (v) => {
        expect(usd6(formatUsd6(v).replace(/[$,]/g, ''))).toBe(v);
      }),
    );
  });
});

describe('wire form', () => {
  it('round-trips (property)', () => {
    fc.assert(
      fc.property(usd6Arb, (v) => {
        expect(usd6FromWire(usd6ToWire(v))).toBe(v);
      }),
    );
    expect(usd6ToWire(400_000n)).toBe('400000');
  });

  it('rejects non-digits, negatives and overflow', () => {
    for (const bad of ['', '1.5', '-1', '1e6', ' 1', '0x1', '1'.repeat(31)]) {
      expectRecharge(() => usd6FromWire(bad), 'invalid_request');
    }
    expectRecharge(() => usd6ToWire(-1n), 'invalid_request');
    expectRecharge(() => usd6ToWire(10n ** 30n), 'invalid_request');
  });
});

describe('data units (1 GB = 1000 MB)', () => {
  it('spec vectors', () => {
    expect(mbFromBytes(1_073_741_824)).toBe(1073);
    expect(mbFromBytes(999_999)).toBe(0);
    expect(mbFromBytes(1_073_741_824n)).toBe(1073);
    expect(bytesFromMb(300)).toBe(300_000_000n);
  });

  it('property: mbFromBytes(bytesFromMb(mb)) === mb and floors partial MB', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1_000_000 }),
        fc.integer({ min: 0, max: 999_999 }),
        (mb, extra) => {
          expect(mbFromBytes(bytesFromMb(mb))).toBe(mb);
          expect(mbFromBytes(bytesFromMb(mb) + BigInt(extra))).toBe(mb);
          expect(mbFromBytes(mb * 1_000_000 + extra)).toBe(mb);
        },
      ),
    );
  });

  it('rejects negative and fractional input', () => {
    for (const bad of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2]) {
      expectRecharge(() => mbFromBytes(bad), 'invalid_request');
    }
    expectRecharge(() => mbFromBytes(-1n), 'invalid_request');
    expectRecharge(() => bytesFromMb(-1), 'invalid_request');
    expectRecharge(() => bytesFromMb(0.5), 'invalid_request');
  });

  it.each([
    [0, `0${NBSP}MB`],
    [300, `300${NBSP}MB`],
    [999, `999${NBSP}MB`],
    [1000, `1${NBSP}GB`],
    [1500, `1.5${NBSP}GB`],
    [1999, `1.9${NBSP}GB`],
    [250_000, `250${NBSP}GB`],
    [1_000_000, `1,000${NBSP}GB`],
  ])('formatMb(%s) → %s', (mb, text) => {
    expect(formatMb(mb)).toBe(text);
  });

  it('formatMb uses en-IN grouping', () => {
    expect(formatMb(123_456_789_000)).toBe(`12,34,56,789${NBSP}GB`);
  });
});

describe('steps and price', () => {
  it('spec vectors', () => {
    expect(priceUsd6(300, 100, 400_000n)).toBe(1_200_000n);
    expectRecharge(() => assertMbStep(199, 100, 3000), 'invalid_request');
    expect(() => assertMbStep(300, 100, 3000)).not.toThrow();
  });

  it.each([
    [0, 100, 3000],
    [3100, 100, 3000],
    [-100, 100, 3000],
    [100.5, 100, 3000],
    [100, 0, 3000],
  ])('assertMbStep(%s, %s, %s) throws', (mb, step, max) => {
    expectRecharge(() => assertMbStep(mb, step, max), 'invalid_request');
  });

  it('property: valid steps pass and price = steps × unit price', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 30 }),
        fc.bigInt({ min: 0n, max: 10n ** 9n }),
        (steps, unit) => {
          const mb = steps * 100;
          expect(() => assertMbStep(mb, 100, 3000)).not.toThrow();
          expect(priceUsd6(mb, 100, unit)).toBe(BigInt(steps) * unit);
        },
      ),
    );
  });

  it('priceUsd6 rounds partial steps up and rejects bad input', () => {
    expect(priceUsd6(150, 100, 400_000n)).toBe(800_000n);
    expectRecharge(() => priceUsd6(100, 100, -1n), 'invalid_request');
    expectRecharge(() => priceUsd6(-100, 100, 1n), 'invalid_request');
    expectRecharge(() => priceUsd6(100, 0, 1n), 'invalid_request');
  });
});

describe('time', () => {
  const T0 = Date.UTC(2026, 10, 3, 12);

  it('secondsUntil rounds up and never goes below 1', () => {
    expect(secondsUntil(T0 + 1_500, T0)).toBe(2);
    expect(secondsUntil(T0 + 7 * 86_400_000, T0)).toBe(604_800);
    expect(secondsUntil(T0, T0)).toBe(1);
    expect(secondsUntil(T0 - 10_000, T0)).toBe(1);
    fc.assert(
      fc.property(fc.integer({ min: -1e9, max: 1e12 }), (delta) => {
        const s = secondsUntil(T0 + delta, T0);
        expect(Number.isInteger(s) && s >= 1).toBe(true);
        expect(T0 + s * 1000).toBeGreaterThanOrEqual(T0 + delta);
      }),
    );
  });

  it('formatAsOf shows IST by default and honours tz', () => {
    expect(formatAsOf(Date.UTC(2026, 10, 3, 8, 32))).toBe('usage as of 14:02');
    expect(formatAsOf(Date.UTC(2026, 10, 3, 8, 32), 'UTC')).toBe('usage as of 08:32');
  });

  it('formatExpiry renders remaining time and the local clock', () => {
    const expires = Date.UTC(2026, 10, 15, 3, 42); // Sun 15 Nov 09:12 IST
    const now = expires - (6 * 86_400_000 + 22 * 3_600_000 + 5 * 60_000);
    expect(formatExpiry(expires, now)).toBe('Expires in 6 d 22 h · Sun 15 Nov 09:12 IST');
    expect(formatExpiry(expires, expires - 2 * 3_600_000 - 30 * 60_000)).toMatch(
      /^Expires in 2 h 30 m · /,
    );
    expect(formatExpiry(expires, expires - 45 * 60_000)).toMatch(/^Expires in 45 m · /);
    expect(formatExpiry(expires, expires - 10_000)).toMatch(/^Expires in under 1 m · /);
    expect(formatExpiry(expires, expires)).toBe('Expired · Sun 15 Nov 09:12 IST');
    expect(formatExpiry(expires, now, 'UTC')).toBe('Expires in 6 d 22 h · Sun 15 Nov 03:42 UTC');
  });
});
