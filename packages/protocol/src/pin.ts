/** Gift-card PIN format (INTERFACES §1.13): 16 digits = 15 CSPRNG digits + a Verhoeff check digit. */
import { RechargeError } from './errors.js';

import type { Hex } from './ids.js';

const D = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
] as const;
const P = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
] as const;
const INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9] as const;

const at = (table: readonly (readonly number[])[], row: number, col: number): number =>
  table[row]?.[col] ?? Number.NaN;

/** Verhoeff checksum over `digits` (rightmost first) with `offset` = 1 when computing a check digit. */
function checksum(digits: string, offset: 0 | 1): number {
  let c = 0;
  const n = digits.length;
  for (let i = 0; i < n; i += 1) {
    const digit = digits.charCodeAt(n - 1 - i) - 48;
    c = at(D, c, at(P, (i + offset) % 8, digit));
  }
  return c;
}

/** The Verhoeff check digit for a string of decimal digits. */
export function verhoeffCheckDigit(digits: string): number {
  if (!/^\d+$/.test(digits)) throw new RechargeError('invalid_request', 'digits only');
  return INV[checksum(digits, 1)] ?? Number.NaN;
}

/** True when the last digit of `digits` is its Verhoeff check digit. */
export const verhoeffValid = (digits: string): boolean =>
  /^\d{2,}$/.test(digits) && checksum(digits, 0) === 0;

export const PIN_LENGTH = 16;
const PIN_PATTERN = /^\d{16}$/;

/** 16 digits = 15 CSPRNG digits + Verhoeff check digit; `randomBytes` is injected (crypto.getRandomValues / noble). */
export function generatePin(randomBytes: (n: number) => Uint8Array): string {
  let body = '';
  while (body.length < PIN_LENGTH - 1) {
    for (const byte of randomBytes(32)) {
      // Rejection sampling: 250 = 25 × 10, so bytes 0..249 map to digits without bias.
      if (byte < 250 && body.length < PIN_LENGTH - 1) body += String(byte % 10);
    }
  }
  return body + String(verhoeffCheckDigit(body));
}

/** Length, digits, Verhoeff. */
export const isValidPin = (pin: string): boolean => PIN_PATTERN.test(pin) && verhoeffValid(pin);

/** '4821993011275064' → '4821 9930 1127 5064'. Throws on anything but 16 digits. */
export function formatPin(pin: string): string {
  if (!PIN_PATTERN.test(pin)) throw new RechargeError('invalid_request', 'a PIN is 16 digits');
  return pin.replace(/(\d{4})(?=\d)/g, '$1 ');
}

/** giftId.slice(2, 10), lower-cased: the public serial printed on the card. */
export function serialFromGiftId(giftId: Hex): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(giftId)) {
    throw new RechargeError('invalid_request', 'giftId must be bytes32 hex');
  }
  return giftId.slice(2, 10).toLowerCase();
}
