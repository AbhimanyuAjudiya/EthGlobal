/** Byte, hex and text helpers. Synchronous and browser-safe; no Node built-ins. */
import {
  bytesToHex as nobleBytesToHex,
  concatBytes,
  hexToBytes as nobleHexToBytes,
  randomBytes as nobleRandomBytes,
  utf8ToBytes,
} from '@noble/hashes/utils.js';

/** `0x`-prefixed hex. Structurally the same type as `@ethglobal/protocol` `Hex` and viem's `Hex`. */
export type Hex = `0x${string}`;

const EVEN_HEX = /^0x(?:[0-9a-fA-F]{2})*$/;

/** '0x…' (even length, any case) → bytes; throws TypeError on anything else. */
export function hexToBytes(hex: Hex): Uint8Array {
  if (typeof hex !== 'string' || !EVEN_HEX.test(hex)) {
    throw new TypeError('expected an even-length 0x-prefixed hex string');
  }
  return nobleHexToBytes(hex.slice(2));
}

/** bytes → lower-case '0x…'. */
export const bytesToHex = (bytes: Uint8Array): Hex => `0x${nobleBytesToHex(bytes)}`;

export const utf8 = (s: string): Uint8Array => utf8ToBytes(s);

export const concat = (...parts: Uint8Array[]): Uint8Array => concatBytes(...parts);

/** `Uint8Array | string` → bytes (strings are UTF-8). */
export const toBytes = (data: Uint8Array | string): Uint8Array =>
  typeof data === 'string' ? utf8(data) : data;

/** CSPRNG (crypto.getRandomValues). */
export function randomBytes(n: number): Uint8Array {
  if (!Number.isSafeInteger(n) || n < 0) throw new RangeError('n must be a non-negative integer');
  return nobleRandomBytes(n);
}

/** Overwrites `bytes` with zeros (best effort: JS gives no guarantee about copies elsewhere). */
export function zeroize(bytes: Uint8Array): void {
  bytes.fill(0);
}

/** Constant-time for equal lengths; different lengths are unequal (length is not secret here). */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}
