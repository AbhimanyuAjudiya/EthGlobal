import { describe, expect, it } from 'vitest';

import { anvilAccounts } from '@ethglobal/adapters/testing';
import { GIFT_CLAIM_WINDOW_S, GIFT_RECLAIM_WINDOW_S } from '@ethglobal/protocol/ids';

import { gift, GIFT_ID, receipt, T0 } from './helpers.js';
import { decideGiftReclaim } from '../src/index.js';

const CLAIM_BY = T0 + GIFT_CLAIM_WINDOW_S * 1000;
const base = {
  giftId: GIFT_ID,
  payer: anvilAccounts[5],
  now: CLAIM_BY + 86_400_000,
  escrow: null,
  receipts: [receipt()],
  ledgerOk: true,
  feeUsd6: 100_000n,
};
type Input = Parameters<typeof decideGiftReclaim>[0];
const verdict = (over: Partial<Input>) => decideGiftReclaim({ ...base, ...over });

describe('decideGiftReclaim', () => {
  it('refund = usd6 − fee to the payer on the paid network', () => {
    expect(verdict({ payer: anvilAccounts[5].toUpperCase().replace('0X', '0x') })).toMatchObject({
      kind: 'refund',
      network: 'eip155:31337',
      usd6: 3_900_000n,
      feeUsd6: 100_000n,
    });
    expect(verdict({ now: CLAIM_BY })).toMatchObject({ kind: 'refund' });
  });

  it('fee ≥ usd6 refunds 0; a negative fee is treated as 0', () => {
    expect(verdict({ feeUsd6: 9_000_000n })).toMatchObject({
      kind: 'refund',
      usd6: 0n,
      feeUsd6: 4_000_000n,
    });
    expect(verdict({ feeUsd6: -5n })).toMatchObject({ usd6: 4_000_000n, feeUsd6: 0n });
  });

  it.each<[string, Partial<Input>, string]>([
    ['ledgerOk false → ledger-unavailable', { ledgerOk: false }, 'ledger-unavailable'],
    ['no gift receipt → unknown-gift', { receipts: [receipt({ kind: 'topup' })] }, 'unknown-gift'],
    [
      'gift receipt without network → unknown-gift',
      { receipts: [receipt({ network: undefined })] },
      'unknown-gift',
    ],
    [
      'gift receipt without usd6 → unknown-gift',
      { receipts: [receipt({ usd6: undefined })] },
      'unknown-gift',
    ],
    ['other payer → not-payer', { payer: anvilAccounts[6] }, 'not-payer'],
    [
      'receipt without payer → not-payer',
      { receipts: [receipt({ payer: undefined })] },
      'not-payer',
    ],
    [
      'gift-claim receipt → claimed',
      { receipts: [receipt(), receipt({ kind: 'gift-claim' })] },
      'claimed',
    ],
    [
      'escrow still readable and claimed → claimed',
      { escrow: gift({ state: 'claimed' }) },
      'claimed',
    ],
    [
      'gift-reclaim receipt → already-reclaimed',
      { receipts: [receipt(), receipt({ kind: 'gift-reclaim' })] },
      'already-reclaimed',
    ],
    ['escrow still present → too-early', { escrow: gift(), now: T0 + 1 }, 'too-early'],
    ['escrow absent but now < claimBy → too-early', { now: CLAIM_BY - 1 }, 'too-early'],
    [
      'after claimBy + 30 d → window-closed',
      { now: CLAIM_BY + GIFT_RECLAIM_WINDOW_S * 1000 },
      'window-closed',
    ],
  ])('%s', (_name, over, reason) => {
    expect(verdict(over)).toEqual({ kind: 'deny', reason });
  });
});
