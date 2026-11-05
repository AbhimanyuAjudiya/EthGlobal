import { describe, expect, it } from 'vitest';

import { clock, dataAmount, dateTime, duration, formatData, pinGroups, shortHex } from './format';

const NOW = Date.UTC(2026, 10, 8, 8, 32); // Sun 8 Nov 2026 14:02 IST

describe('format', () => {
  it('MB integers below 1 GB, one floored decimal of GB above, en-IN grouping, NBSP before the unit', () => {
    expect(dataAmount(300)).toEqual({ value: '300', unit: 'MB' });
    expect(dataAmount(999)).toEqual({ value: '999', unit: 'MB' });
    expect(dataAmount(1000)).toEqual({ value: '1', unit: 'GB' });
    expect(dataAmount(1599)).toEqual({ value: '1.5', unit: 'GB' });
    expect(dataAmount(1_20_000_000).value).toBe('1,20,000');
    expect(formatData(300)).toBe('300\u00a0MB');
    expect(dataAmount(-5)).toEqual({ value: '0', unit: 'MB' });
  });

  it('24-hour en-IN clock in IST, zone on request', () => {
    expect(clock(NOW)).toBe('14:02');
    expect(clock(Date.UTC(2026, 10, 8, 17, 35))).toBe('23:05');
    expect(clock(NOW, 'Asia/Kolkata', true)).toBe('14:02 IST');
    expect(dateTime(Date.UTC(2026, 10, 15, 3, 42))).toBe('Sun 15 Nov 09:12 IST');
  });

  it('durations: days and hours, hours and minutes, seconds only under an hour', () => {
    expect(duration((6 * 24 + 22) * 3_600_000 + 59_000)).toBe('6 d 22 h');
    expect(duration(3 * 3_600_000 + 12 * 60_000)).toBe('3 h 12 m');
    expect(duration(42 * 60_000 + 10_000)).toBe('42 m 10 s');
    expect(duration(-1)).toBe('0 m 0 s');
  });

  it('PINs split 4 × 4 and reject anything but 16 digits', () => {
    expect(pinGroups('4821993011275064')).toEqual(['4821', '9930', '1127', '5064']);
    expect(pinGroups('4821 9930 1127 5064')).toEqual(['4821', '9930', '1127', '5064']);
    expect(() => pinGroups('482199301127506')).toThrow(RangeError);
    expect(() => pinGroups('48219930112750a4')).toThrow(RangeError);
  });

  it('short 0x form keeps 4 + 4 hex', () => {
    expect(shortHex('0x1a2b80f6cd88a88474e7c4db5d3de758f33eeaf3368b639ab1f4681d81789f3e')).toBe(
      '0x1a2b…9f3e',
    );
    expect(shortHex('0x1234')).toBe('0x1234');
  });
});
