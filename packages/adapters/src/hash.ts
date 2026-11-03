import type { Hex } from './types.js';

const encoder = new TextEncoder();

/** SHA-256 of a UTF-8 string as 0x-prefixed hex (Web Crypto; works in Node 22 and browsers). */
export async function sha256Hex(input: string): Promise<Hex> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
  return `0x${hex}`;
}

export const HEX_PATTERN = /^0x[0-9a-fA-F]+$/;

export function isHex(value: unknown): value is Hex {
  return typeof value === 'string' && HEX_PATTERN.test(value);
}
