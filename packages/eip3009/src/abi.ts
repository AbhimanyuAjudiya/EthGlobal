/** Circle FiatTokenV2_2 EIP-3009 typed data and ABI (API-FACTS §7). Data only; final. */
import type { Abi } from 'viem';

const AUTHORIZATION_FIELDS = [
  { name: 'from', type: 'address' },
  { name: 'to', type: 'address' },
  { name: 'value', type: 'uint256' },
  { name: 'validAfter', type: 'uint256' },
  { name: 'validBefore', type: 'uint256' },
  { name: 'nonce', type: 'bytes32' },
] as const;

/** typehash 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267 */
export const TRANSFER_WITH_AUTHORIZATION_TYPES = {
  TransferWithAuthorization: AUTHORIZATION_FIELDS,
} as const;
/** typehash 0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8 */
export const RECEIVE_WITH_AUTHORIZATION_TYPES = {
  ReceiveWithAuthorization: AUTHORIZATION_FIELDS,
} as const;
/** typehash 0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429 */
export const CANCEL_AUTHORIZATION_TYPES = {
  CancelAuthorization: [
    { name: 'authorizer', type: 'address' },
    { name: 'nonce', type: 'bytes32' },
  ],
} as const;

const AUTHORIZATION_INPUTS = [
  ...AUTHORIZATION_FIELDS,
  { name: 'signature', type: 'bytes' },
] as const;

/** transferWithAuthorization(bytes sig), receiveWithAuthorization(bytes sig), cancelAuthorization, authorizationState, Transfer, AuthorizationUsed. */
export const EIP3009_ABI = [
  {
    type: 'function',
    name: 'transferWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: AUTHORIZATION_INPUTS,
    outputs: [],
  },
  {
    type: 'function',
    name: 'receiveWithAuthorization',
    stateMutability: 'nonpayable',
    inputs: AUTHORIZATION_INPUTS,
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelAuthorization',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
      { name: 'v', type: 'uint8' },
      { name: 'r', type: 'bytes32' },
      { name: 's', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'authorizationState',
    stateMutability: 'view',
    inputs: [
      { name: 'authorizer', type: 'address' },
      { name: 'nonce', type: 'bytes32' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
    anonymous: false,
  },
  {
    type: 'event',
    name: 'AuthorizationUsed',
    inputs: [
      { name: 'authorizer', type: 'address', indexed: true },
      { name: 'nonce', type: 'bytes32', indexed: true },
    ],
    anonymous: false,
  },
] as const satisfies Abi;

/** The ERC-20 and ERC-5267 reads the facilitator and readDomain() need. */
export const TOKEN_READ_ABI = [
  {
    type: 'function',
    name: 'eip712Domain',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'fields', type: 'bytes1' },
      { name: 'name', type: 'string' },
      { name: 'version', type: 'string' },
      { name: 'chainId', type: 'uint256' },
      { name: 'verifyingContract', type: 'address' },
      { name: 'salt', type: 'bytes32' },
      { name: 'extensions', type: 'uint256[]' },
    ],
  },
  {
    type: 'function',
    name: 'name',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'version',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'string' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const satisfies Abi;
