import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { human, PAYOUT } from './helpers.js';
import {
  fromPaymentAuthorization,
  toPaymentAuthorization,
  type PaymentAuthorizationWire,
} from '../src/index.js';

const wire: PaymentAuthorizationWire = {
  from: human.address,
  to: PAYOUT,
  value: '400000',
  validAfter: '1762171140',
  validBefore: '1762171260',
  nonce: `0x${'AB'.repeat(32)}`,
};

describe('wire conversion', () => {
  it('digit strings ⇄ bigint; nonce lower-cased; addresses checksummed', () => {
    const a = fromPaymentAuthorization({ ...wire, to: PAYOUT.toLowerCase() });
    expect(a).toEqual({
      ...wire,
      value: 400_000n,
      validAfter: 1762171140n,
      validBefore: 1762171260n,
      nonce: `0x${'ab'.repeat(32)}`,
    });
    expect(toPaymentAuthorization(a)).toEqual({ ...wire, nonce: `0x${'ab'.repeat(32)}` });
  });

  it.each([
    ['value', '-1'],
    ['value', '1.5'],
    ['value', ''],
    ['validAfter', '0x10'],
    ['validBefore', (1n << 256n).toString()],
    ['from', '0x123'],
    ['nonce', '0x1234'],
  ] as const)('rejects %s = %s', (field, value) => {
    expect(() => fromPaymentAuthorization({ ...wire, [field]: value })).toThrow(
      expect.objectContaining({ code: 'invalid_authorization' }),
    );
  });

  it('toPaymentAuthorization rejects negatives', () => {
    expect(() => toPaymentAuthorization({ ...fromPaymentAuthorization(wire), value: -1n })).toThrow(
      /uint256/,
    );
  });

  it('property: round trip for every uint256', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: 0n, max: (1n << 256n) - 1n }),
        fc.bigInt({ min: 0n, max: 1n << 64n }),
        (value, t) => {
          const a = fromPaymentAuthorization({
            ...wire,
            value: value.toString(),
            validBefore: t.toString(),
          });
          expect(fromPaymentAuthorization(toPaymentAuthorization(a))).toEqual(a);
        },
      ),
    );
  });
});
