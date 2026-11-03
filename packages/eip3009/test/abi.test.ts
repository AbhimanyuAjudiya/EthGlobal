import { keccak256, toHex } from 'viem';
import { describe, expect, it } from 'vitest';

import {
  CANCEL_AUTHORIZATION_TYPES,
  EIP3009_ABI,
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from '../src/index.js';

// Typehashes from circlefin/stablecoin-evm@fc85788 contracts/v2/EIP3009.sol (API-FACTS §7).
const typehashes = [
  [
    TRANSFER_WITH_AUTHORIZATION_TYPES,
    'TransferWithAuthorization',
    '0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267',
  ],
  [
    RECEIVE_WITH_AUTHORIZATION_TYPES,
    'ReceiveWithAuthorization',
    '0xd099cc98ef71107a616c4f0f941f04c322d8e254fe26b3c6668db87aae413de8',
  ],
  [
    CANCEL_AUTHORIZATION_TYPES,
    'CancelAuthorization',
    '0x158b0a9edf7a828aad02f63cd515c68ef2f50ba807396f6d12842833a1597429',
  ],
] as const;

describe('eip3009 type definitions and ABI', () => {
  it.each(typehashes)(
    '%# type definitions hash to the Circle typehash',
    (types, primaryType, hash) => {
      const fields =
        (types as Record<string, readonly { name: string; type: string }[]>)[primaryType] ?? [];
      const encoded = `${primaryType}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`;
      expect(keccak256(toHex(encoded))).toBe(hash);
    },
  );

  it('the ABI carries exactly the bytes-signature overloads and the two events', () => {
    const names = EIP3009_ABI.map((item) => `${item.type}:${item.name}`);
    expect(names).toEqual([
      'function:transferWithAuthorization',
      'function:receiveWithAuthorization',
      'function:cancelAuthorization',
      'function:authorizationState',
      'event:Transfer',
      'event:AuthorizationUsed',
    ]);
  });
});
