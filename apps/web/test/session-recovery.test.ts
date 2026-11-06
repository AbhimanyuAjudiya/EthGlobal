import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexToBytes, lpaAad, sealLpa } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

const storage = vi.hoisted(() => new Map<string, unknown>());
vi.mock('../lib/store', () => ({
  get: async (key: string) => storage.get(key),
  set: async (key: string, value: unknown) => {
    storage.set(key, structuredClone(value));
  },
  del: async (key: string) => {
    storage.delete(key);
  },
}));
afterEach(() => {
  storage.clear();
  vi.resetModules();
});
const nonce: Hex = `0x${'22'.repeat(32)}`;
const lpa = 'LPA:1$smdp.example$ABC$$0';

describe('pending activation session recovery', () => {
  it('starting another flow does not destroy the first flow private key', async () => {
    const session = await import('../lib/session-key');
    const first = session.beginSession();
    const box = sealLpa(lpa, hexToBytes(first), lpaAad(nonce, 'plan-one'));
    const second = session.beginSession();
    expect(first).not.toBe(second);
    expect(session.decryptDelivery(box, nonce, 'plan-one', first)).toBe(lpa);
  });
  it('restores an encrypted pending key after reload and deletes it only when saved', async () => {
    const first = await import('../lib/session-key');
    const publicKey = first.beginSession();
    await first.persistSession(publicKey);
    const saved = storage.get(`delivery-key:${publicKey}`) as {
      key: CryptoKey;
      ciphertext: ArrayBuffer;
    };
    expect(saved.key.extractable).toBe(false);
    expect(saved.ciphertext.byteLength).toBeGreaterThan(32);
    expect(Object.keys(saved).sort()).toEqual(['ciphertext', 'expiresAt', 'iv', 'key']);
    const box = sealLpa(lpa, hexToBytes(publicKey), lpaAad(nonce, 'plan-two'));
    vi.resetModules();
    const reloaded = await import('../lib/session-key');
    expect(await reloaded.restoreSession(publicKey)).toBe(true);
    expect(() => reloaded.decryptDelivery(box, nonce, 'wrong-plan', publicKey)).toThrow();
    expect(reloaded.decryptDelivery(box, nonce, 'plan-two', publicKey)).toBe(lpa);
    expect(storage.has(`delivery-key:${publicKey}`)).toBe(true);
    await reloaded.completeSession(publicKey);
    expect(storage.has(`delivery-key:${publicKey}`)).toBe(false);
    expect(await reloaded.restoreSession(publicKey)).toBe(false);
  });
});
