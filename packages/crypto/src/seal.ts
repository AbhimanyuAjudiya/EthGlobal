/**
 * LPA sealing to the buyer's session key and server-side sealing at rest (INTERFACES §2, T-31/T-33).
 * X25519 + HKDF-SHA256 + XChaCha20-Poly1305, all @noble; nothing hand-rolled.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';

import { bytesToHex, concat, hexToBytes, randomBytes, utf8, zeroize, type Hex } from './bytes.js';

/** Same shape as `@ethglobal/protocol` `SealedBox` (`sealedBoxSchema`); crypto is a leaf and cannot import it. */
export interface SealedBox {
  v: 1;
  /** X25519 ephemeral public key (zero-filled for server sealing). */
  epk: Hex;
  /** 24-byte XChaCha20 nonce. */
  nonce: Hex;
  /** ciphertext ‖ 16-byte Poly1305 tag. */
  ct: Hex;
}

/** Thrown for every failure to open a box: wrong key, wrong AAD, tampering, malformed box. */
export class SealError extends Error {
  override readonly name = 'SealError';
}

export interface SessionKeypair {
  publicKey: Uint8Array /* 32 */;
  secretKey: Uint8Array /* 32 */;
}

export const LPA_INFO = 'recharge/lpa/v1';
export const SERVER_INFO = 'recharge/server/v1';
const KEY_BYTES = 32;
const NONCE_BYTES = 24;
const TAG_BYTES = 16;
const ZERO_EPK = new Uint8Array(KEY_BYTES);
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

/** X25519; the PWA keeps it in memory only (T-60). */
export function generateSessionKeypair(): SessionKeypair {
  const secretKey = x25519.utils.randomSecretKey();
  return { publicKey: x25519.getPublicKey(secretKey), secretKey };
}

function assertKey(key: Uint8Array, what: string): void {
  if (!(key instanceof Uint8Array) || key.length !== KEY_BYTES) {
    throw new SealError(`${what} must be ${KEY_BYTES} bytes`);
  }
}

function encrypt(key: Uint8Array, epk: Uint8Array, plaintext: string, aad: Uint8Array): SealedBox {
  const nonce = randomBytes(NONCE_BYTES);
  const ct = xchacha20poly1305(key, nonce, aad).encrypt(utf8(plaintext));
  return { v: 1, epk: bytesToHex(epk), nonce: bytesToHex(nonce), ct: bytesToHex(ct) };
}

/** Parses the hex fields of a box; any malformation is a SealError. */
function unpack(box: SealedBox): { epk: Uint8Array; nonce: Uint8Array; ct: Uint8Array } {
  try {
    const epk = hexToBytes(box.epk);
    const nonce = hexToBytes(box.nonce);
    const ct = hexToBytes(box.ct);
    if (box.v !== 1 || epk.length !== KEY_BYTES || nonce.length !== NONCE_BYTES || ct.length < TAG_BYTES) {
      throw new SealError('malformed sealed box');
    }
    return { epk, nonce, ct };
  } catch {
    throw new SealError('malformed sealed box');
  }
}

function decrypt(key: Uint8Array, nonce: Uint8Array, ct: Uint8Array, aad: Uint8Array): string {
  try {
    return fatalDecoder.decode(xchacha20poly1305(key, nonce, aad).decrypt(ct));
  } catch {
    throw new SealError('cannot open sealed box');
  } finally {
    zeroize(key);
  }
}

function lpaKey(shared: Uint8Array, epk: Uint8Array, recipientPk: Uint8Array): Uint8Array {
  try {
    return hkdf(sha256, shared, concat(epk, recipientPk), utf8(LPA_INFO), KEY_BYTES);
  } finally {
    zeroize(shared);
  }
}

/** X25519(ephemeral, recipient) → HKDF-SHA256(salt = epk ‖ recipientPk, info = 'recharge/lpa/v1', 32) → XChaCha20-Poly1305 with a fresh 24-byte nonce. */
export function sealLpa(lpa: string, recipientPublicKey: Uint8Array, aad: Uint8Array): SealedBox {
  assertKey(recipientPublicKey, 'recipient public key');
  const ephemeral = x25519.utils.randomSecretKey();
  try {
    const epk = x25519.getPublicKey(ephemeral);
    let shared: Uint8Array;
    try {
      shared = x25519.getSharedSecret(ephemeral, recipientPublicKey);
    } catch {
      throw new SealError('invalid recipient public key');
    }
    const key = lpaKey(shared, epk, recipientPublicKey);
    try {
      return encrypt(key, epk, lpa, aad);
    } finally {
      zeroize(key);
    }
  } finally {
    zeroize(ephemeral);
  }
}

/** Throws SealError on any mismatch. */
export function openLpa(box: SealedBox, secretKey: Uint8Array, aad: Uint8Array): string {
  assertKey(secretKey, 'secret key');
  const { epk, nonce, ct } = unpack(box);
  let shared: Uint8Array;
  try {
    shared = x25519.getSharedSecret(secretKey, epk);
  } catch {
    throw new SealError('cannot open sealed box');
  }
  return decrypt(lpaKey(shared, epk, x25519.getPublicKey(secretKey)), nonce, ct, aad);
}

/** aad = utf8(`${nonce}|${entitlementKey}`): nonce = payment nonce (paid lanes) or challenge nonce (free/gift/card). Nonce lower-cased. */
export const lpaAad = (nonce: Hex, entitlementKey: string): Uint8Array =>
  utf8(`${nonce.toLowerCase()}|${entitlementKey}`);

function serverKey(key: Uint8Array): Uint8Array {
  if (!(key instanceof Uint8Array) || key.length < KEY_BYTES) {
    throw new SealError(`server seal key must be at least ${KEY_BYTES} bytes`);
  }
  return hkdf(sha256, key, undefined, utf8(SERVER_INFO), KEY_BYTES);
}

/** Server-side symmetric sealing (ICCID at rest on the public ledger). key = HKDF(serverSealKey, info 'recharge/server/v1'); epk is zero-filled. */
export function sealToServer(key: Uint8Array, plaintext: string, aad: Uint8Array): SealedBox {
  const k = serverKey(key);
  try {
    return encrypt(k, ZERO_EPK, plaintext, aad);
  } finally {
    zeroize(k);
  }
}

export function openFromServer(key: Uint8Array, box: SealedBox, aad: Uint8Array): string {
  const { epk, nonce, ct } = unpack(box);
  if (epk.some((byte) => byte !== 0)) throw new SealError('not a server-sealed box');
  return decrypt(serverKey(key), nonce, ct, aad);
}
