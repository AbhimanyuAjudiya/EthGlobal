/**
 * Protocol-side regressions for the octroi red-team findings (INTERFACES §13 A-32…A-37):
 * RT-O-02 strict payment payloads, T-71e receipt lifetime vs the reclaim window, RT-O-04 nonce lifetime.
 */
import { describe, expect, it } from 'vitest';

import { example } from './helpers.js';
import { ADAPTER_CODE_MAP } from '../src/errors.js';
import {
  CHALLENGE_TTL_S,
  GIFT_CLAIM_WINDOW_S,
  GIFT_RECLAIM_WINDOW_S,
  NONCE_TTL_S,
  RECEIPT_TTL_S,
} from '../src/ids.js';
import {
  evmExactPayloadSchema,
  hederaExactPayloadSchema,
  paymentPayloadSchema,
} from '../src/schemas/index.js';

const TX_B64 = Buffer.from('partially-signed-hts-transfer').toString('base64');

describe('RT-O-02: payment payload branches are strict (A-32)', () => {
  it('a Hedera payload with a decoy `authorization` matches neither branch', () => {
    const decoy = { to: '0x' + '1'.repeat(40), value: '1' };
    expect(hederaExactPayloadSchema.safeParse({ transaction: TX_B64 }).success).toBe(true);
    expect(
      hederaExactPayloadSchema.safeParse({ transaction: TX_B64, authorization: decoy }).success,
    ).toBe(false);
  });

  it('an EVM payload with an extra key is refused', () => {
    const evm = example<{ payload: Record<string, unknown> }>('paymentPayloadSchema').payload;
    expect(evmExactPayloadSchema.safeParse(evm).success).toBe(true);
    expect(evmExactPayloadSchema.safeParse({ ...evm, transaction: TX_B64 }).success).toBe(false);
  });

  it('the full payment payload with a hybrid inner payload is refused', () => {
    const p = example<Record<string, unknown> & { payload: Record<string, unknown> }>(
      'paymentPayloadSchema',
    );
    expect(paymentPayloadSchema.safeParse(p).success).toBe(true);
    expect(
      paymentPayloadSchema.safeParse({ ...p, payload: { ...p.payload, transaction: TX_B64 } })
        .success,
    ).toBe(false);
  });

  it('a ledger conflict maps to replay (409)', () => {
    expect(ADAPTER_CODE_MAP.conflict).toBe('replay');
  });
});

describe('T-71e: receipts outlive the reclaim window (A-36)', () => {
  it('RECEIPT_TTL_S ≥ claim window + reclaim window + 1 day', () => {
    expect(RECEIPT_TTL_S).toBeGreaterThanOrEqual(
      GIFT_CLAIM_WINDOW_S + GIFT_RECLAIM_WINDOW_S + 86_400,
    );
    // a reclaim on day 37 (the last day of the window) still finds the receipt written on day 0
    expect(RECEIPT_TTL_S * 1000).toBeGreaterThan(37 * 86_400_000);
  });
});

describe('RT-O-04: the consumed-nonce entity outlives every acceptable challenge (A-37)', () => {
  it('NONCE_TTL_S ≥ TTL + 5 s skew guard, with ≥ 10 % margin for a fast ledger clock', () => {
    expect(NONCE_TTL_S).toBeGreaterThanOrEqual(Math.ceil((CHALLENGE_TTL_S + 5) * 1.1));
    expect(NONCE_TTL_S).toBeGreaterThanOrEqual(300);
  });
});
