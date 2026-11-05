/** Typed-data definitions and digests (viem hashTypedData) for the two authorization kinds. */
import {
  hashTypedData,
  type Address,
  type Hex,
  type TypedDataDefinition,
  type TypedDataDomain,
} from 'viem';

import { RECEIVE_WITH_AUTHORIZATION_TYPES, TRANSFER_WITH_AUTHORIZATION_TYPES } from './abi.js';

export interface Authorization3009 {
  from: Address;
  to: Address;
  value: bigint;
  validAfter: bigint;
  validBefore: bigint;
  nonce: Hex;
}

const message = (a: Authorization3009) => ({
  from: a.from,
  to: a.to,
  value: a.value,
  validAfter: a.validAfter,
  validBefore: a.validBefore,
  nonce: a.nonce,
});

export function typedDataTransferWithAuthorization(
  d: TypedDataDomain,
  a: Authorization3009,
): TypedDataDefinition<typeof TRANSFER_WITH_AUTHORIZATION_TYPES, 'TransferWithAuthorization'> {
  return {
    domain: d,
    types: TRANSFER_WITH_AUTHORIZATION_TYPES,
    primaryType: 'TransferWithAuthorization',
    message: message(a),
  };
}

export function typedDataReceiveWithAuthorization(
  d: TypedDataDomain,
  a: Authorization3009,
): TypedDataDefinition<typeof RECEIVE_WITH_AUTHORIZATION_TYPES, 'ReceiveWithAuthorization'> {
  return {
    domain: d,
    types: RECEIVE_WITH_AUTHORIZATION_TYPES,
    primaryType: 'ReceiveWithAuthorization',
    message: message(a),
  };
}

export const digestTransferWithAuthorization = (d: TypedDataDomain, a: Authorization3009): Hex =>
  hashTypedData(typedDataTransferWithAuthorization(d, a));

export const digestReceiveWithAuthorization = (d: TypedDataDomain, a: Authorization3009): Hex =>
  hashTypedData(typedDataReceiveWithAuthorization(d, a));
