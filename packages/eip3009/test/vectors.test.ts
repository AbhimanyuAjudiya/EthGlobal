/**
 * The recorded forge/viem vectors (fixtures/eip3009/vectors.json, contracts workstream) against this
 * package's type definitions: every digest is reproduced and every signature verifies for the signer, on both
 * domains ("USD Coin" on 31337, "USDC" on Base Sepolia 84532).
 */
import { hashDomain, hashTypedData, verifyTypedData, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import vectors from '../../../fixtures/eip3009/vectors.json' with { type: 'json' };
import {
  RECEIVE_WITH_AUTHORIZATION_TYPES,
  TRANSFER_WITH_AUTHORIZATION_TYPES,
} from '../src/index.js';

interface Vector {
  domain: number;
  from: Address;
  to: Address;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
  transferDigest: Hex;
  receiveDigest: Hex;
  transferSignature: Hex;
  receiveSignature: Hex;
}

const domains = vectors.domains.map((d) => ({
  name: d.name,
  version: d.version,
  chainId: d.chainId,
  verifyingContract: d.verifyingContract as Address,
  separator: d.separator as Hex,
}));
const cases = (vectors.vectors as Vector[]).map((v, i) => [i, v] as const);

describe('EIP-3009 vectors', () => {
  it('cover both domains, and our domains hash to the recorded separators', () => {
    expect(new Set(domains.map((d) => `${d.name}|${d.chainId}`))).toEqual(
      new Set(['USD Coin|31337', 'USDC|84532']),
    );
    for (const { separator, ...domain } of domains) {
      expect(
        hashDomain({
          domain: { ...domain, chainId: BigInt(domain.chainId) },
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
          },
        }),
      ).toBe(separator);
    }
  });

  it.each(cases)('vector %i: digests reproduce and signatures verify', async (_i, v) => {
    const { separator: _s, ...domain } = domains[v.domain] ?? domains[0]!;
    const message = {
      from: v.from,
      to: v.to,
      value: BigInt(v.value),
      validAfter: BigInt(v.validAfter),
      validBefore: BigInt(v.validBefore),
      nonce: v.nonce,
    };
    const transfer = {
      domain,
      types: TRANSFER_WITH_AUTHORIZATION_TYPES,
      primaryType: 'TransferWithAuthorization',
      message,
    } as const;
    const receive = {
      domain,
      types: RECEIVE_WITH_AUTHORIZATION_TYPES,
      primaryType: 'ReceiveWithAuthorization',
      message,
    } as const;
    expect(hashTypedData(transfer)).toBe(v.transferDigest);
    expect(hashTypedData(receive)).toBe(v.receiveDigest);
    const signer = vectors.signer as Address;
    await expect(
      verifyTypedData({ ...transfer, address: signer, signature: v.transferSignature }),
    ).resolves.toBe(true);
    await expect(
      verifyTypedData({ ...receive, address: signer, signature: v.receiveSignature }),
    ).resolves.toBe(true);
    await expect(
      verifyTypedData({ ...transfer, address: v.to, signature: v.transferSignature }),
    ).resolves.toBe(false);
  });
});
