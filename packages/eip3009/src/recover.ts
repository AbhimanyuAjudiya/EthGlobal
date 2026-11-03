/** Strict signature handling (T-17): canonical low-s, v ∈ {0,1,27,28}, 65-byte or EIP-2098 64-byte. */
import { recoverAddress, size, sliceHex, hexToBigInt, isHex, numberToHex, type Address, type Hex } from 'viem';

import { Eip3009Error } from './errors.js';

/** secp256k1 group order and its half: s above HALF_N is the malleable twin (EIP-2). */
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const HALF_N = N >> 1n;
const TOP_BIT = 1n << 255n;

export interface ParsedSignature {
  r: Hex;
  s: Hex;
  yParity: 0 | 1;
  /** Canonical 65-byte `r ‖ s ‖ v` with v ∈ {27, 28} — what FiatTokenV2_2's bytes overload expects. */
  serialized: Hex;
}

const reject = (message: string): Eip3009Error => new Eip3009Error('invalid_signature', message);

function yParityOf(v: number): 0 | 1 {
  if (v === 0 || v === 27) return 0;
  if (v === 1 || v === 28) return 1;
  throw reject(`v must be 0, 1, 27 or 28; got ${v}`);
}

/**
 * Parses a 65-byte (`r ‖ s ‖ v`) or EIP-2098 64-byte (`r ‖ yParityAndS`) signature. Rejects any other length,
 * a bad v, r or s of zero or ≥ n, and high s (> n/2) — the token would accept the twin, we never do.
 */
export function parseSignature(signature: Hex): ParsedSignature {
  if (!isHex(signature, { strict: true })) throw reject('signature is not hex');
  const length = size(signature);
  let r: bigint;
  let s: bigint;
  let yParity: 0 | 1;
  if (length === 65) {
    r = hexToBigInt(sliceHex(signature, 0, 32));
    s = hexToBigInt(sliceHex(signature, 32, 64));
    yParity = yParityOf(Number(hexToBigInt(sliceHex(signature, 64, 65))));
  } else if (length === 64) {
    r = hexToBigInt(sliceHex(signature, 0, 32));
    const vs = hexToBigInt(sliceHex(signature, 32, 64));
    yParity = vs & TOP_BIT ? 1 : 0;
    s = vs & (TOP_BIT - 1n);
  } else {
    throw reject(`signature must be 64 or 65 bytes; got ${length}`);
  }
  if (r === 0n || r >= N) throw reject('r out of range');
  if (s === 0n || s >= N) throw reject('s out of range');
  if (s > HALF_N) throw reject('high-s signature (malleable) rejected');
  const rHex = numberToHex(r, { size: 32 });
  const sHex = numberToHex(s, { size: 32 });
  const serialized = `${rHex}${sHex.slice(2)}${yParity ? '1c' : '1b'}` as Hex;
  return { r: rHex, s: sHex, yParity, serialized };
}

/** The canonical 65-byte form of a signature (throws on anything parseSignature rejects). */
export const normalizeSignature = (signature: Hex): Hex => parseSignature(signature).serialized;

/** ecrecover over a 32-byte digest with the strict rules above; returns the EIP-55 address. */
export async function recoverSigner(digest: Hex, signature: Hex): Promise<Address> {
  if (!isHex(digest, { strict: true }) || size(digest) !== 32) throw reject('digest must be 32 bytes');
  const { serialized } = parseSignature(signature);
  try {
    return await recoverAddress({ hash: digest, signature: serialized });
  } catch {
    throw reject('signature does not recover');
  }
}
