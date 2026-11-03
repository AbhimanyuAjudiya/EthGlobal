/**
 * `@ethglobal/eip3009` — SKELETON (INTERFACES §4, §14). The public surface compiles so dependants can build
 * against it; every function throws until the adapters-live workstream implements it. The type definitions
 * and the ABI below are data and are already final (Circle FiatTokenV2_2 layout, API-FACTS §7).
 */
import type {
  Abi,
  Address,
  Hex,
  PublicClient,
  TypedDataDefinition,
  TypedDataDomain,
  WalletClient,
} from 'viem';

export interface Authorization3009 {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

/**
 * Structural twin of `@ethglobal/protocol` `PaymentAuthorization` (this package is a leaf and cannot import
 * protocol). Wire form: `value`, `validAfter`, `validBefore` are digit strings, as @x402/evm 2.29.0 sends them.
 */
export interface PaymentAuthorizationWire {
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
}

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

export interface Relayer {
  submit(token: Address, data: Hex): Promise<{ hash: Hex; status: 'success' | 'reverted' }>;
}

/** Every stub throws this; the message names the function so a premature call is obvious. */
export class NotImplementedError extends Error {
  override readonly name = 'NotImplementedError';

  constructor(fn: string) {
    super(`@ethglobal/eip3009 ${fn}: not implemented (adapters-live workstream)`);
  }
}

const stub = (fn: string): never => {
  throw new NotImplementedError(fn);
};

/** The domain name is configurable per chain (A-21): Base Sepolia USDC signs as "USDC", mainnets as the other Circle name; take it from accepts[].extra. */
export function domain(
  _token: Address,
  _chainId: number,
  _name: string,
  _version: string,
): TypedDataDomain {
  return stub('domain');
}
/** Domain from accepted.extra.{name,version}, chainId from the eip155 reference, verifyingContract = asset. */
export function domainFromRequirements(_req: {
  network: string;
  asset: string;
  extra?: Record<string, unknown>;
}): TypedDataDomain {
  return stub('domainFromRequirements');
}
/** ERC-5267 eip712Domain(), fallback name()/version(). */
export async function readDomain(
  _publicClient: PublicClient,
  _token: Address,
): Promise<{ name: string; version: string; chainId: number }> {
  return stub('readDomain');
}
export function typedDataTransferWithAuthorization(
  _d: TypedDataDomain,
  _a: Authorization3009,
): TypedDataDefinition {
  return stub('typedDataTransferWithAuthorization');
}
export function typedDataReceiveWithAuthorization(
  _d: TypedDataDomain,
  _a: Authorization3009,
): TypedDataDefinition {
  return stub('typedDataReceiveWithAuthorization');
}
export function digestTransferWithAuthorization(_d: TypedDataDomain, _a: Authorization3009): Hex {
  return stub('digestTransferWithAuthorization');
}
export function digestReceiveWithAuthorization(_d: TypedDataDomain, _a: Authorization3009): Hex {
  return stub('digestReceiveWithAuthorization');
}
/** Rejects high-s and v ∉ {0,1,27,28}; accepts 65-byte and EIP-2098 64-byte forms explicitly (T-17). */
export async function recoverSigner(_digest: Hex, _signature: Hex): Promise<Address> {
  return stub('recoverSigner');
}
export function encodeTransferWithAuthorization(_a: Authorization3009, _signature: Hex): Hex {
  return stub('encodeTransferWithAuthorization');
}
export function encodeReceiveWithAuthorization(_a: Authorization3009, _signature: Hex): Hex {
  return stub('encodeReceiveWithAuthorization');
}
export function fromPaymentAuthorization(_p: PaymentAuthorizationWire): Authorization3009 {
  return stub('fromPaymentAuthorization');
}
export function toPaymentAuthorization(_a: Authorization3009): PaymentAuthorizationWire {
  return stub('toPaymentAuthorization');
}
/** eth_call before send (T-16). */
export function createViemRelayer(_opts: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  simulate?: boolean;
}): Relayer {
  return stub('createViemRelayer');
}
