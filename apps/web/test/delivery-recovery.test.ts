import { afterEach, describe, expect, it, vi } from 'vitest';

import { hexToBytes, lpaAad, sealLpa } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type { EntitledResponse } from '@ethglobal/protocol/schemas';

import { api } from '../lib/api';
import { deliver, recoverActivation } from '../lib/deliver';
import { beginSession, persistSession } from '../lib/session-key';
import { plans } from '../lib/store';

const nonce: Hex = `0x${'13'.repeat(32)}`;
const pending = (key: string): EntitledResponse => ({
  entitlementKey: key,
  kind: 'paid',
  status: 'pending-profile',
  tier: 'none',
  mbTotal: 1000,
  validityDays: 7,
  expiresAt: Date.now() + 604800000,
  receipt: { arkivKey: `0x${'ab'.repeat(32)}` },
});
afterEach(() => vi.restoreAllMocks());
describe('delayed activation delivery', () => {
  it('delivers a 202 profile later with its original key even after another flow starts', async () => {
    const key = 'pending-plan-one';
    const original = beginSession();
    await persistSession(original);
    await deliver(pending(key), nonce, { you: '$4.00' }, original);
    beginSession();
    const sealedLpa = sealLpa(
      'LPA:1$smdp.example$ABC$$0',
      hexToBytes(original),
      lpaAad(nonce, key),
    );
    const request = vi
      .spyOn(api, 'delivery')
      .mockResolvedValue({ status: 'ready', nonce, sealedLpa });
    expect(await recoverActivation(key)).toBe(true);
    expect(request).toHaveBeenCalledWith(key, original);
    expect(await plans.lpa(key)).toBe('LPA:1$smdp.example$ABC$$0');
  });
  it('a foreign plan URL cannot request its ciphertext without the original device session', async () => {
    const request = vi.spyOn(api, 'delivery');
    expect(await recoverActivation('foreign-plan')).toBe(false);
    expect(request).not.toHaveBeenCalled();
  });
  it('a failed retrieval leaves the local activation session recoverable', async () => {
    const key = 'pending-plan-two';
    const original = beginSession();
    await persistSession(original);
    await deliver(pending(key), nonce, { you: '$4.00' }, original);
    const sealedLpa = sealLpa('LPA:1$smdp.example$DEF', hexToBytes(original), lpaAad(nonce, key));
    vi.spyOn(api, 'delivery')
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'ready', nonce, sealedLpa });
    await expect(recoverActivation(key)).rejects.toThrow('offline');
    expect(await recoverActivation(key)).toBe(true);
    expect(await plans.lpa(key)).toBe('LPA:1$smdp.example$DEF');
  });
});
