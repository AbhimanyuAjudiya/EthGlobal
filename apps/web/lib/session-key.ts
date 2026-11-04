/**
 * The buyer's X25519 session key (T-60): generated in memory where a purchase or claim starts, never written to
 * storage, zeroised right after `openLpa`. A reload loses it on purpose; the sealed LPA is then unreadable.
 */
import {
  bytesToHex,
  generateSessionKeypair,
  lpaAad,
  openLpa,
  zeroize,
  type SealedBox,
} from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

let current: { publicKey: Uint8Array; secretKey: Uint8Array } | undefined;

/** A fresh keypair for one purchase/claim; returns the public key the API binds the delivery to. */
export function beginSession(): Hex {
  if (current) zeroize(current.secretKey);
  current = generateSessionKeypair();
  return bytesToHex(current.publicKey);
}

export const sessionPublicKey = (): Hex | undefined =>
  current ? bytesToHex(current.publicKey) : undefined;

/**
 * Opens the sealed LPA with the session secret and zeroises the secret whatever happens: one delivery, one
 * key. `nonce` is the challenge nonce (free/gift/card) or the payment nonce (paid lanes).
 */
export function openDelivery(box: SealedBox, nonce: Hex, entitlementKey: string): string {
  if (!current) throw new Error('no session key in memory');
  const keys = current;
  current = undefined;
  try {
    return openLpa(box, keys.secretKey, lpaAad(nonce, entitlementKey));
  } finally {
    zeroize(keys.secretKey);
  }
}

/** Drops the keypair without opening anything (a cancelled flow). */
export function endSession(): void {
  if (current) zeroize(current.secretKey);
  current = undefined;
}
