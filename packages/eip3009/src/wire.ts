/** x402 wire form (digit strings, as @x402/evm 2.29.0 sends) ⇄ bigint authorization. */
import { getAddress, isAddress, isHex, size, type Address, type Hex } from 'viem';

import { Eip3009Error } from './errors.js';

import type { Authorization3009 } from './typed-data.js';

/**
 * Structural twin of `@ethglobal/protocol` `PaymentAuthorization` (this package is a leaf and cannot import
 * protocol). Wire form: `value`, `validAfter`, `validBefore` are digit strings.
 */
export interface PaymentAuthorizationWire {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

/** What toPaymentAuthorization returns: the wire form with checksummed addresses and a lower-case nonce. */
export interface PaymentAuthorizationOut extends PaymentAuthorizationWire {
  from: Address;
  to: Address;
  nonce: Hex;
}

const UINT256_MAX = (1n << 256n) - 1n;
const DIGITS = /^\d{1,78}$/;

const bad = (message: string): Eip3009Error => new Eip3009Error('invalid_authorization', message);

function uint(name: string, value: string): bigint {
  if (!DIGITS.test(value)) throw bad(`${name} must be a decimal integer string`);
  const n = BigInt(value);
  if (n > UINT256_MAX) throw bad(`${name} exceeds uint256`);
  return n;
}

function address(name: string, value: string): Address {
  if (!isAddress(value, { strict: false })) throw bad(`${name} is not an address`);
  return getAddress(value);
}

function nonce(value: string): Hex {
  if (!isHex(value, { strict: true }) || size(value) !== 32) throw bad('nonce must be 32 bytes');
  return value.toLowerCase() as Hex;
}

export function fromPaymentAuthorization(p: PaymentAuthorizationWire): Authorization3009 {
  return {
    from: address('from', p.from),
    to: address('to', p.to),
    value: uint('value', p.value),
    validAfter: uint('validAfter', p.validAfter),
    validBefore: uint('validBefore', p.validBefore),
    nonce: nonce(p.nonce),
  };
}

export function toPaymentAuthorization(a: Authorization3009): PaymentAuthorizationOut {
  for (const [name, v] of [
    ['value', a.value],
    ['validAfter', a.validAfter],
    ['validBefore', a.validBefore],
  ] as const) {
    if (v < 0n || v > UINT256_MAX) throw bad(`${name} out of uint256 range`);
  }
  return {
    from: address('from', a.from),
    to: address('to', a.to),
    value: a.value.toString(),
    validAfter: a.validAfter.toString(),
    validBefore: a.validBefore.toString(),
    nonce: nonce(a.nonce),
  };
}
