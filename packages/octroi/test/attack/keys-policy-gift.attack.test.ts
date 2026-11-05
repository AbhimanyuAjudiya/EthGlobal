import { describe, expect, it } from 'vitest';

import { hexToBytes, hmacKey } from '@ethglobal/crypto';

import { entitlement, gift, GIFT_ID, NULLIFIER, receipt, SECRET, T0 } from './fixture.js';
import { decideGiftReclaim, quotaKey, shouldTopUp } from '../../src/index.js';

describe('attack: O12 keys (T-18, T-29; A-9)', () => {
  it('quotaKey is the documented construction, nullifier-free; a 16-byte secret is refused', () => {
    expect(quotaKey(SECRET, NULLIFIER)).toBe(hmacKey(SECRET, 'quota', hexToBytes(NULLIFIER)));
    expect(quotaKey(SECRET, NULLIFIER)).not.toContain(NULLIFIER.slice(2, 14));
    expect(() => quotaKey(new Uint8Array(16).fill(7), NULLIFIER)).toThrow();
  });
});

describe('attack: O13 shouldTopUp (T-30; A-13/A-14)', () => {
  const p = {
    maxUsd6PerDay: 10_000_000n,
    thresholdMb: 60,
    stepMb: 100,
    paused: false,
    topUpOnExpiry: true,
    expiryLeadS: 3600,
  };
  it.each<[string, Parameters<typeof shouldTopUp>, Record<string, unknown>]>([
    ['threshold', [entitlement(), p, 0n, T0, 400_000n], { buy: true, reason: 'threshold' }],
    [
      '61 MB remaining',
      [entitlement({ mbUsed: 239 }), p, 0n, T0, 400_000n],
      { buy: false, reason: 'ok' },
    ],
    ['cap crossed', [entitlement(), p, 9_610_000n, T0, 400_000n], { buy: false, reason: 'cap' }],
    ['cap reached exactly', [entitlement(), p, 9_600_000n, T0, 400_000n], { buy: true }],
    [
      'paused wins',
      [entitlement({ mbUsed: 300 }), { ...p, paused: true }, 0n, T0, 400_000n],
      { reason: 'paused' },
    ],
    [
      'expired never topped up',
      [entitlement({ expiresAt: T0 - 1 }), p, 0n, T0, 400_000n],
      { reason: 'expired' },
    ],
    [
      '300 MB step counts the whole cost',
      [entitlement(), { ...p, stepMb: 300 }, 8_900_000n, T0, 1_200_000n],
      { reason: 'cap' },
    ],
  ])('%s', (_n, args, expected) => expect(shouldTopUp(...args)).toMatchObject(expected));
});

describe('attack: G decideGiftReclaim (D-7, T-71)', () => {
  const base = {
    giftId: GIFT_ID,
    payer: receipt().payer!,
    now: T0 + 8 * 86_400_000,
    escrow: null,
    receipts: [receipt()],
    ledgerOk: true,
    feeUsd6: 0n,
  };
  it('never refunds on a ledger error, a live or claimed escrow, or an early-dropped escrow', () => {
    expect(decideGiftReclaim({ ...base, ledgerOk: false }).kind).toBe('deny');
    expect(decideGiftReclaim({ ...base, now: T0 + 1, escrow: gift() })).toMatchObject({
      reason: 'too-early',
    });
    expect(decideGiftReclaim({ ...base, escrow: gift({ state: 'claimed' }) })).toMatchObject({
      reason: 'claimed',
    });
    expect(decideGiftReclaim({ ...base, now: T0 + 6 * 86_400_000 }).kind).toBe('deny');
    expect(decideGiftReclaim(base)).toMatchObject({
      kind: 'refund',
      usd6: 4_000_000n,
      feeUsd6: 0n,
    });
  });
});
