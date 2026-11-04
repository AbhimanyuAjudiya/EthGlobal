import { decodeFunctionData, toFunctionSelector, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import { human, PAYOUT } from './helpers.js';
import {
  EIP3009_ABI,
  encodeReceiveWithAuthorization,
  encodeTransferWithAuthorization,
  type Authorization3009,
} from '../src/index.js';

const auth: Authorization3009 = {
  from: human.address,
  to: PAYOUT,
  value: 400_000n,
  validAfter: 1n,
  validBefore: 2_000_000_000n,
  nonce: `0x${'11'.repeat(32)}`,
};
const r = `0x${'01'.repeat(32)}`;
const s = `${'02'.repeat(32)}`;

describe('calldata', () => {
  it('uses the bytes-signature overload selectors', () => {
    const transfer = encodeTransferWithAuthorization(auth, `${r}${s}1b` as Hex);
    const receive = encodeReceiveWithAuthorization(auth, `${r}${s}1b` as Hex);
    expect(transfer.slice(0, 10)).toBe(
      toFunctionSelector(
        'transferWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)',
      ),
    );
    expect(receive.slice(0, 10)).toBe(
      toFunctionSelector(
        'receiveWithAuthorization(address,address,uint256,uint256,uint256,bytes32,bytes)',
      ),
    );
  });

  it('decodes back with viem and carries the canonical 65-byte signature (v = 0 ⇒ 27)', () => {
    const data = encodeTransferWithAuthorization(auth, `${r}${s}00` as Hex);
    const decoded = decodeFunctionData({ abi: EIP3009_ABI, data });
    expect(decoded.args).toEqual([
      auth.from,
      auth.to,
      auth.value,
      auth.validAfter,
      auth.validBefore,
      auth.nonce,
      `${r}${s}1b`,
    ]);
  });

  it('refuses to encode a malleable signature', () => {
    expect(() => encodeTransferWithAuthorization(auth, `${r}${'ff'.repeat(32)}1b` as Hex)).toThrow(
      /high-s|range/,
    );
  });
});
