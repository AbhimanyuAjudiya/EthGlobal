/** Per-operation X25519 keys. Pending keys are encrypted at rest until activation is safely saved. */
import {
  bytesToHex,
  generateSessionKeypair,
  hexToBytes,
  lpaAad,
  openLpa,
  zeroize,
  type SealedBox,
} from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

import { get, set, del } from './store';

type Session = ReturnType<typeof generateSessionKeypair>;
const sessions = new Map<Hex, Session>();
let current: Hex | undefined;
const storageKey = (publicKey: Hex) => `delivery-key:${publicKey}`;

export function beginSession(): Hex {
  const key = generateSessionKeypair();
  const publicKey = bytesToHex(key.publicKey);
  sessions.set(publicKey, key);
  current = publicKey;
  return publicKey;
}
export const sessionPublicKey = (): Hex | undefined => current;

/** No raw X25519 private bytes are ever written to browser storage. */
export async function persistSession(
  publicKey: Hex,
  expiresAt = Date.now() + 30 * 86_400_000,
): Promise<void> {
  const keys = sessions.get(publicKey);
  if (!keys || !globalThis.crypto?.subtle) return;
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
    'encrypt',
    'decrypt',
  ]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new Uint8Array(hexToBytes(publicKey)) },
    key,
    new Uint8Array(keys.secretKey),
  );
  await set(storageKey(publicKey), { iv, ciphertext, key, expiresAt });
}

export async function restoreSession(publicKey: Hex): Promise<boolean> {
  if (sessions.has(publicKey)) return true;
  const saved = await get<{
    iv: Uint8Array;
    ciphertext: ArrayBuffer;
    key: CryptoKey;
    expiresAt?: number;
  }>(storageKey(publicKey));
  if (!saved || !globalThis.crypto?.subtle) return false;
  if (saved.expiresAt !== undefined && saved.expiresAt <= Date.now()) {
    await del(storageKey(publicKey));
    return false;
  }
  try {
    const secretKey = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(saved.iv),
          additionalData: new Uint8Array(hexToBytes(publicKey)),
        },
        saved.key,
        saved.ciphertext,
      ),
    );
    sessions.set(publicKey, { publicKey: hexToBytes(publicKey), secretKey });
    return true;
  } catch {
    return false;
  }
}

/** Decryption does not consume the key: local storage must commit successfully first. */
export function decryptDelivery(
  box: SealedBox,
  nonce: Hex,
  entitlementKey: string,
  publicKey: Hex,
): string {
  const keys = sessions.get(publicKey);
  if (!keys) throw new Error('no session key in memory');
  return openLpa(box, keys.secretKey, lpaAad(nonce, entitlementKey));
}

/** Compatibility for one-shot callers; production delivery uses decryptDelivery + completeSession. */
export function openDelivery(box: SealedBox, nonce: Hex, entitlementKey: string): string {
  if (!current) throw new Error('no session key in memory');
  const publicKey = current;
  try {
    return decryptDelivery(box, nonce, entitlementKey, publicKey);
  } finally {
    endSession(publicKey);
  }
}

export function endSession(publicKey = current): void {
  if (!publicKey) return;
  const keys = sessions.get(publicKey);
  if (keys) zeroize(keys.secretKey);
  sessions.delete(publicKey);
  if (current === publicKey) current = undefined;
  void del(storageKey(publicKey));
}
export async function completeSession(publicKey: Hex): Promise<void> {
  endSession(publicKey);
  await del(storageKey(publicKey));
}
