import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { expectRecharge } from './helpers.js';
import {
  formatPin,
  generatePin,
  isValidPin,
  serialFromGiftId,
  verhoeffCheckDigit,
  verhoeffValid,
} from '../src/pin.js';

const csprng = (n: number): Uint8Array => globalThis.crypto.getRandomValues(new Uint8Array(n));

describe('Verhoeff', () => {
  it.each([
    ['236', 3],
    ['12345', 1],
    ['142857', 0],
    ['0', 4],
  ])('check digit of %s is %s', (digits, check) => {
    expect(verhoeffCheckDigit(digits)).toBe(check);
    expect(verhoeffValid(`${digits}${check}`)).toBe(true);
  });

  it('rejects wrong check digits and non-digits', () => {
    expect(verhoeffValid('2364')).toBe(false);
    expect(verhoeffValid('2')).toBe(false);
    expect(verhoeffValid('23a3')).toBe(false);
    expectRecharge(() => verhoeffCheckDigit('12a'), 'invalid_request');
  });

  it('property: detects every single-digit substitution and adjacent transposition', () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^\d{15}$/),
        fc.nat(15),
        fc.integer({ min: 1, max: 9 }),
        (body, i, delta) => {
          const pin = body + String(verhoeffCheckDigit(body));
          const chars = [...pin];
          chars[i] = String((Number(chars[i]) + delta) % 10);
          expect(verhoeffValid(chars.join(''))).toBe(false);
          const j = i % 15;
          const swapped = [...pin];
          [swapped[j], swapped[j + 1]] = [swapped[j + 1] ?? '', swapped[j] ?? ''];
          if (swapped[j] !== swapped[j + 1]) expect(verhoeffValid(swapped.join(''))).toBe(false);
        },
      ),
    );
  });
});

describe('PINs', () => {
  it('10^4 generated PINs are all valid and distinct', () => {
    const pins = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const pin = generatePin(csprng);
      expect(isValidPin(pin)).toBe(true);
      pins.add(pin);
    }
    expect(pins.size).toBe(10_000);
  });

  it('rejection-samples: bytes ≥ 250 never become digits', () => {
    let call = 0;
    const biased = (n: number): Uint8Array =>
      Uint8Array.from({ length: n }, (_, i) => (call++ === 0 && i < 20 ? 255 : 7));
    expect(generatePin(biased).slice(0, 15)).toBe('7'.repeat(15));
  });

  it('isValidPin checks length, digits and the check digit', () => {
    const pin = generatePin(csprng);
    expect(isValidPin(pin.slice(0, 15))).toBe(false);
    expect(isValidPin(`${pin}0`)).toBe(false);
    expect(isValidPin(`${pin.slice(0, 15)}x`)).toBe(false);
    expect(isValidPin(pin.slice(0, 15) + String((Number(pin[15]) + 1) % 10))).toBe(false);
  });

  it('formatPin groups by four', () => {
    expect(formatPin('4821993011275064')).toBe('4821 9930 1127 5064');
    expectRecharge(() => formatPin('4821 9930'), 'invalid_request');
  });

  it('serialFromGiftId is the lower-cased first four bytes', () => {
    expect(serialFromGiftId(`0x9A9A9A9A${'00'.repeat(28)}`)).toBe('9a9a9a9a');
    expectRecharge(() => serialFromGiftId('0x9a9a'), 'invalid_request');
  });
});
