/**
 * The recorded forge/viem vectors (fixtures/eip3009/vectors.json, contracts workstream): this package's
 * digest functions reproduce every digest, recoverSigner returns the signer (Anvil #5) for every signature,
 * and calldata round-trips — on both domains ("USD Coin" on 31337, "USDC" on Base Sepolia 84532).
 */
import { decodeFunctionData, hashDomain, type Address, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import vectors from '../../../fixtures/eip3009/vectors.json' with { type: 'json' };
import {
  digestReceiveWithAuthorization,
  digestTransferWithAuthorization,
  domain,
  EIP3009_ABI,
  encodeReceiveWithAuthorization,
  encodeTransferWithAuthorization,
  recoverSigner,
  type Authorization3009,
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
  domain: domain(d.verifyingContract as Address, d.chainId, d.name, d.version),
  separator: d.separator as Hex,
}));
const all = vectors.vectors as Vector[];
const cases = all.map((v, i) => [i, v] as const);
const auth = (v: Vector): Authorization3009 => ({
  from: v.from,
  to: v.to,
  value: BigInt(v.value),
  validAfter: BigInt(v.validAfter),
  validBefore: BigInt(v.validBefore),
  nonce: v.nonce,
});

describe('EIP-3009 vectors', () => {
  it('cover both domains (16 vectors), and domain() hashes to the recorded separators', () => {
    expect(all).toHaveLength(16);
    expect(new Set(all.map((v) => v.domain))).toEqual(new Set([0, 1]));
    expect(new Set(vectors.domains.map((d) => `${d.name}|${d.chainId}`))).toEqual(
      new Set(['USD Coin|31337', 'USDC|84532']),
    );
    for (const { domain: d, separator } of domains) {
      expect(
        hashDomain({
          domain: { ...d, chainId: BigInt(d.chainId!) } as never,
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

  it.each(cases)('vector %i: digests, recovery and calldata', async (_i, v) => {
    const d = domains[v.domain]!.domain;
    const a = auth(v);
    expect(digestTransferWithAuthorization(d, a)).toBe(v.transferDigest);
    expect(digestReceiveWithAuthorization(d, a)).toBe(v.receiveDigest);
    await expect(recoverSigner(v.transferDigest, v.transferSignature)).resolves.toBe(
      vectors.signer,
    );
    await expect(recoverSigner(v.receiveDigest, v.receiveSignature)).resolves.toBe(vectors.signer);
    // a signature for one kind never recovers the signer for the other kind's digest
    await expect(recoverSigner(v.receiveDigest, v.transferSignature)).resolves.not.toBe(
      vectors.signer,
    );
    const decoded = decodeFunctionData({
      abi: EIP3009_ABI,
      data: encodeTransferWithAuthorization(a, v.transferSignature),
    });
    expect(decoded.functionName).toBe('transferWithAuthorization');
    expect(decoded.args).toEqual([
      a.from,
      a.to,
      a.value,
      a.validAfter,
      a.validBefore,
      a.nonce,
      v.transferSignature,
    ]);
    const receive = decodeFunctionData({
      abi: EIP3009_ABI,
      data: encodeReceiveWithAuthorization(a, v.receiveSignature),
    });
    expect(receive.functionName).toBe('receiveWithAuthorization');
  });

  it('the same authorization on 31337 and 84532 gives different digests (A14, T-14)', () => {
    const a = auth(all[0]!);
    const local = domains[0]!.domain;
    const foreign = domain(local.verifyingContract!, 84532, local.name!, local.version!);
    expect(digestTransferWithAuthorization(local, a)).not.toBe(
      digestTransferWithAuthorization(foreign, a),
    );
    const renamed = domain(local.verifyingContract!, 31337, 'USDC', '2');
    expect(digestTransferWithAuthorization(local, a)).not.toBe(
      digestTransferWithAuthorization(renamed, a),
    );
  });
});
