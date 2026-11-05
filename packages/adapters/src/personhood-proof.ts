/**
 * IDKit 4 result helpers shared by MockPersonhood, `fixtureProof` and the live World verifier (A-25), so the
 * mock enforces exactly what production enforces (T-19). Browser-safe.
 */
import { hashToField, hexToBytes } from '@ethglobal/crypto';
import { isHex } from '@ethglobal/protocol/ids';

import type { Hex } from './types.js';

/** IDKit's signal_hash for a signal: hash_to_field of its bytes (0x-hex) or of its UTF-8 text. */
export const signalHash = (signal: string): Hex =>
  hashToField(isHex(signal) && signal.length % 2 === 0 ? hexToBytes(signal) : signal);

/** A V4 decimal or V3 hex nullifier as hex32 (lower-case, left-padded); undefined when it is neither. */
export function nullifierHex(nullifier: string): Hex | undefined {
  if (!/^(\d{1,78}|0x[0-9a-fA-F]{1,64})$/.test(nullifier)) return undefined;
  const value = BigInt(nullifier);
  return value < 1n << 256n ? `0x${value.toString(16).padStart(64, '0')}` : undefined;
}
