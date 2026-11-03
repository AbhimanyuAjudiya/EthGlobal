/** SHA-256, keccak-256 and HMAC-SHA256 (@noble/hashes). */
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { keccak_256 } from '@noble/hashes/sha3.js';

import { bytesToHex, concat, toBytes, type Hex } from './bytes.js';

export const sha256 = (data: Uint8Array | string): Uint8Array => nobleSha256(toBytes(data));

export const sha256Hex = (data: Uint8Array | string): Hex => bytesToHex(sha256(data));

export const keccak256 = (data: Uint8Array): Hex => bytesToHex(keccak_256(data));

/** HMAC-SHA256(key, part₁ ‖ part₂ ‖ …); string parts are UTF-8. Plain concatenation, no length prefixes. */
export const hmacSha256 = (key: Uint8Array, ...parts: (Uint8Array | string)[]): Uint8Array =>
  hmac(nobleSha256, key, concat(...parts.map(toBytes)));

/** hex32 of hmacSha256: the lookup/pseudonym keys (quota, audit, pin). */
export const hmacKey = (secret: Uint8Array, ...parts: (Uint8Array | string)[]): Hex =>
  bytesToHex(hmacSha256(secret, ...parts));

/**
 * World ID `hash_to_field`: keccak256(bytes) >> 8, as 0x-hex of 32 bytes (API-FACTS §4.2). Strings are
 * UTF-8; a 0x-hex signal is hashed as its bytes by passing `hexToBytes(signal)`.
 */
export function hashToField(data: Uint8Array | string): Hex {
  const digest = keccak_256(toBytes(data));
  const shifted = new Uint8Array(32);
  shifted.set(digest.subarray(0, 31), 1);
  return bytesToHex(shifted);
}
