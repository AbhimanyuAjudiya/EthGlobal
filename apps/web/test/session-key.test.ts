import { describe, expect, it } from 'vitest';

import { hexToBytes, lpaAad, sealLpa } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

import { beginSession, openDelivery, sessionPublicKey } from '../lib/session-key';

describe('session key (T-60)', () => {
  it('opens the sealed LPA once, then the secret is gone', () => {
    const spk = beginSession();
    expect(sessionPublicKey()).toBe(spk);
    const nonce: Hex = `0x${'22'.repeat(32)}`;
    const box = sealLpa(
      'LPA:1$local.test$ABCDEF0123456789',
      hexToBytes(spk),
      lpaAad(nonce, 'ent:v1:0x01'),
    );
    expect(openDelivery(box, nonce, 'ent:v1:0x01')).toBe('LPA:1$local.test$ABCDEF0123456789');
    expect(sessionPublicKey()).toBeUndefined();
    expect(() => openDelivery(box, nonce, 'ent:v1:0x01')).toThrow(/no session key/);
  });

  it('a wrong binding fails and still drops the key', () => {
    const spk = beginSession();
    const nonce: Hex = `0x${'33'.repeat(32)}`;
    const box = sealLpa('LPA:1$local.test$X', hexToBytes(spk), lpaAad(nonce, 'ent:v1:0x02'));
    expect(() => openDelivery(box, nonce, 'ent:v1:0xother')).toThrow();
    expect(sessionPublicKey()).toBeUndefined();
  });
});
