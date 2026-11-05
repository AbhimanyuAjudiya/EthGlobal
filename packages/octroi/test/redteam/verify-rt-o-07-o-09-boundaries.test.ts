/**
 * Red-team verification variants for RT-O-07 (untrusted numbers never buy / never throw untyped) and RT-O-09 (no
 * zero-value refund). The regressions pin price 0 / −400 000 and now = NaN, and fee == paid. Here:
 *   RT-O-07 — shouldTopUp over the whole bigint range (price up to 2^200, spent at/over the cap, cap 0), now = ±Infinity;
 *             the paid lane with hostile `mb` values (NaN, ±Infinity, −100, 1e21, 100.5, a string) ⇒ deny, no throw;
 *             a wire policy with hostile numbers ⇒ RechargeError, never a domain policy.
 *   RT-O-09 — fuzz paid × fee (incl. negative fees, fee == paid ± 1, 1-µUSD gifts): a refund is always > 0 and
 *             refund + fee == paid; otherwise `nothing-to-refund`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { T0 } from '@ethglobal/adapters/testing';
import { GIFT_CLAIM_WINDOW_S } from '@ethglobal/protocol/ids';

import {
  decide,
  decideGiftReclaim,
  policyFromWire,
  shouldTopUp,
  type TopUpPolicy,
} from '../../src/index.js';
import { deps, entitlement, gift, GIFT_ID, receipt, resource } from '../helpers.js';

const policy = (over: Partial<TopUpPolicy> = {}): TopUpPolicy => ({
  maxUsd6PerDay: 10_000_000n,
  thresholdMb: 50,
  stepMb: 100,
  paused: false,
  topUpOnExpiry: true,
  expiryLeadS: 600,
  ...over,
});

describe('verify RT-O-07: untrusted numbers', () => {
  it('shouldTopUp: a buy never exceeds the cap, never costs ≤ 0, never after expiry (fuzz, 2 000 runs)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -(1n << 200n), max: 1n << 200n }),
        fc.bigInt({ min: -(1n << 64n), max: 1n << 200n }),
        fc.bigInt({ min: 0n, max: 1n << 64n }),
        fc.oneof(
          fc.integer({ min: T0 - 10_000_000, max: T0 + 10_000_000 }),
          fc.constantFrom(Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NaN),
        ),
        fc.integer({ min: 0, max: 400 }),
        (price, spent, cap, now, mbUsed) => {
          const e = entitlement({ mbTotal: 300, mbUsed, expiresAt: T0 + 3_600_000 });
          const v = shouldTopUp(e, policy({ maxUsd6PerDay: cap }), spent, now, price);
          if (v.buy) {
            expect(v.costUsd6).toBeGreaterThan(0n);
            expect(spent + v.costUsd6).toBeLessThanOrEqual(cap);
            expect(spent).toBeGreaterThanOrEqual(0n);
            expect(Number.isFinite(now) && now < e.expiresAt).toBe(true);
          }
        },
      ),
      { numRuns: 2_000, seed: 0x5eed07 },
    );
  });

  it.each([
    Number.NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    -100,
    1e21,
    100.5,
    0,
    '100',
  ])('paid lane with mb = %s ⇒ deny invalid-request, no throw', async (mb) => {
    const d = deps();
    await expect(decide({ resource, mb: mb as number }, d)).resolves.toMatchObject({
      kind: 'deny',
      reason: 'invalid-request',
    });
  });

  it.each([
    { maxUsd6PerDay: '-1' },
    { maxUsd6PerDay: '1e6' },
    { maxUsd6PerDay: ' 100' },
    { stepMb: 0 },
    { stepMb: Number.NaN },
    { thresholdMb: -1 },
    { expiryLeadS: Number.POSITIVE_INFINITY },
  ])('a wire policy with %o ⇒ RechargeError(invalid_request)', (over) => {
    const wire = {
      maxUsd6PerDay: '1000000',
      thresholdMb: 50,
      stepMb: 100,
      paused: false,
      topUpOnExpiry: true,
      expiryLeadS: 600,
      ...over,
    };
    expect(() => policyFromWire(wire as never)).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
  });
});

describe('verify RT-O-09: never a zero-value refund', () => {
  const CLAIM_BY = T0 + GIFT_CLAIM_WINDOW_S * 1000;
  it('paid × fee fuzz: refund > 0 and refund + fee == paid, else nothing-to-refund (5 000 runs)', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 1n, max: 10n ** 12n }),
        fc.oneof(fc.bigInt({ min: -(10n ** 12n), max: 2n * 10n ** 12n }), fc.constantFrom(-1n, 0n)),
        fc.constantFrom(-1n, 0n, 1n, null),
        (paid, feeRaw, nearPaid) => {
          const fee = nearPaid === null ? feeRaw : paid + nearPaid;
          const v = decideGiftReclaim({
            giftId: GIFT_ID,
            payer: gift().payer!,
            now: CLAIM_BY + 1,
            escrow: null,
            receipts: [receipt({ usd6: paid.toString() })],
            ledgerOk: true,
            feeUsd6: fee,
          });
          const effective = fee < 0n ? 0n : fee;
          if (v.kind === 'refund') {
            expect(v.usd6).toBeGreaterThan(0n);
            expect(v.usd6 + v.feeUsd6).toBe(paid);
            expect(effective).toBeLessThan(paid);
          } else {
            expect(v).toMatchObject({ kind: 'deny', reason: 'nothing-to-refund' });
            expect(effective).toBeGreaterThanOrEqual(paid);
          }
        },
      ),
      { numRuns: 5_000, seed: 0x5eed09 },
    );
  });
});
