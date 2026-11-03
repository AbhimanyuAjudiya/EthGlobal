import fc from 'fast-check';
import { getAddress, keccak256, toBytes, verifyTypedData, type TypedData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { example } from './helpers.js';
import vectors from '../../../fixtures/eip3009/vectors.json' with { type: 'json' };
import { USDC_ASSET, USDC_EIP712_DOMAIN } from '../src/ids.js';
import { paymentAuthorizationSchema } from '../src/schemas/index.js';
import {
  AGENT_POLICY_TYPES,
  canonicalJson,
  GIFT_CLAIM_TYPES,
  GIFT_RECLAIM_TYPES,
  rechargeDomain,
  SPONSOR_LOGIN_TYPES,
} from '../src/typed-data.js';

// Anvil account #5 ("human"): a public test key, never funded anywhere real.
const human = privateKeyToAccount(
  '0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba',
);
const stranger = privateKeyToAccount(
  '0x4bbbf85ce3377467afe5d46f804f221813b2bb87f24d81f60f1fcdbf7cbf4356',
);
const H = (b: string) => `0x${b.repeat(32)}` as const;
const domain = rechargeDomain(31337);

const policy = example('topUpPolicySchema');
const cases = [
  {
    types: GIFT_CLAIM_TYPES,
    primaryType: 'GiftClaim',
    message: {
      giftId: H('9a'),
      namehash: H('4a'),
      recipient: human.address,
      audience: 'recharge',
      nonce: H('3c'),
    },
  },
  {
    types: GIFT_RECLAIM_TYPES,
    primaryType: 'GiftReclaim',
    message: { giftId: H('9a'), payer: human.address, nonce: H('3c') },
  },
  {
    types: SPONSOR_LOGIN_TYPES,
    primaryType: 'SponsorLogin',
    message: { campaignId: H('c1'), sponsor: human.address, issuedAt: 1_793_707_200_000n },
  },
  {
    types: AGENT_POLICY_TYPES,
    primaryType: 'AgentPolicy',
    message: {
      entitlementKey: 'ent:v1:0x01',
      owner: human.address,
      policyHash: keccak256(toBytes(canonicalJson(policy))),
      issuedAt: 1_793_707_200_000n,
    },
  },
] as const;

describe('EIP-712 message definitions', () => {
  it('the domain is Recharge v1 on the given chain', () => {
    expect(rechargeDomain(84532)).toEqual({ name: 'Recharge', version: '1', chainId: 84532 });
  });

  it.each(cases)(
    '$primaryType: signed by viem, verified by viem; wrong signer and tampered message fail',
    async (c) => {
      const typed = {
        domain,
        types: c.types as TypedData,
        primaryType: c.primaryType,
        message: c.message,
      } as const;
      const signature = await human.signTypedData(typed);
      await expect(verifyTypedData({ ...typed, address: human.address, signature })).resolves.toBe(
        true,
      );
      await expect(
        verifyTypedData({ ...typed, address: stranger.address, signature }),
      ).resolves.toBe(false);
      const tampered = { ...typed, message: { ...c.message, nonce: H('ff'), issuedAt: 1n } };
      await expect(
        verifyTypedData({ ...tampered, address: human.address, signature }),
      ).resolves.toBe(false);
      const otherChain = { ...typed, domain: rechargeDomain(84532) };
      await expect(
        verifyTypedData({ ...otherChain, address: human.address, signature }),
      ).resolves.toBe(false);
    },
  );
});

describe('canonicalJson', () => {
  it('sorts keys recursively without whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: null } })).toBe(
      '{"a":{"c":null,"d":[3,{"y":2,"z":1}]},"b":1}',
    );
    expect(canonicalJson('x')).toBe('"x"');
  });

  it('follows JSON.stringify for undefined; throws on bigint and non-finite numbers', () => {
    expect(canonicalJson({ a: undefined, b: [undefined] })).toBe('{"b":[null]}');
    expect(() => canonicalJson({ a: 1n })).toThrow(/bigint/);
    expect(() => canonicalJson({ a: Number.NaN })).toThrow(/non-finite/);
    expect(() => canonicalJson(undefined)).toThrow(TypeError);
  });

  it('property: stable under key order and equal to JSON.parse round-trip', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const text = canonicalJson(value);
        const reordered = JSON.parse(JSON.stringify(value), (_k, v: unknown) =>
          v && typeof v === 'object' && !Array.isArray(v)
            ? Object.fromEntries(Object.entries(v).reverse())
            : v,
        ) as unknown;
        expect(canonicalJson(reordered)).toBe(text);
        expect(canonicalJson(JSON.parse(text))).toBe(text);
      }),
    );
  });
});

describe('agreement with the recorded EIP-3009 vectors (fixtures/eip3009/vectors.json)', () => {
  it('USDC_EIP712_DOMAIN matches the recorded per-chain domains (A-21)', () => {
    for (const d of vectors.domains) {
      expect(USDC_EIP712_DOMAIN[`eip155:${d.chainId}`]).toEqual({
        name: d.name,
        version: d.version,
      });
    }
    expect(vectors.domains.find((d) => d.chainId === 84532)?.verifyingContract).toBe(
      USDC_ASSET['eip155:84532'],
    );
  });

  it('every recorded authorization is a valid wire PaymentAuthorization (digit-string times)', () => {
    for (const v of vectors.vectors) {
      const { from, to, value, validAfter, validBefore, nonce } = v;
      const parsed = paymentAuthorizationSchema.safeParse({
        from,
        to,
        value,
        validAfter,
        validBefore,
        nonce,
      });
      expect(parsed.success).toBe(true);
    }
  });

  it('the Hedera USDC long-zero alias is the EIP-55 form viem accepts', () => {
    const alias = `0x${(429274).toString(16).padStart(40, '0')}` as const;
    expect(getAddress(alias)).toBe('0x0000000000000000000000000000000000068cDa');
    expect(USDC_ASSET['hedera:testnet']).toBe('0.0.429274');
  });
});
