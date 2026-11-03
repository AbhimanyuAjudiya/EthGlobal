/** Calldata for the bytes-signature overloads (FiatTokenV2_2); the signature is canonicalised first. */
import { encodeFunctionData, type Hex } from 'viem';

import { EIP3009_ABI } from './abi.js';
import { normalizeSignature } from './recover.js';

import type { Authorization3009 } from './typed-data.js';

const args = (a: Authorization3009, signature: Hex) =>
  [a.from, a.to, a.value, a.validAfter, a.validBefore, a.nonce, normalizeSignature(signature)] as const;

export const encodeTransferWithAuthorization = (a: Authorization3009, signature: Hex): Hex =>
  encodeFunctionData({ abi: EIP3009_ABI, functionName: 'transferWithAuthorization', args: args(a, signature) });

export const encodeReceiveWithAuthorization = (a: Authorization3009, signature: Hex): Hex =>
  encodeFunctionData({ abi: EIP3009_ABI, functionName: 'receiveWithAuthorization', args: args(a, signature) });
