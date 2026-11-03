import { describe, expect, it, vi } from 'vitest';

import { domain, domainFromRequirements, readDomain } from '../src/index.js';
import { BASE_SEPOLIA_USDC, MOCK_USDC } from './helpers.js';

import type { PublicClient } from 'viem';

describe('domain', () => {
  it('checksums the token and keeps name/version as given', () => {
    expect(domain(MOCK_USDC.toLowerCase() as `0x${string}`, 31337, 'USD Coin', '2')).toEqual({
      name: 'USD Coin',
      version: '2',
      chainId: 31337,
      verifyingContract: MOCK_USDC,
    });
  });

  it.each([
    ['0x1234', 1, 'USDC', '2'],
    [MOCK_USDC, 0, 'USDC', '2'],
    [MOCK_USDC, 1.5, 'USDC', '2'],
    [MOCK_USDC, 1, '', '2'],
    [MOCK_USDC, 1, 'USDC', ''],
  ] as const)('rejects %s / %s / %s / %s', (token, chainId, name, version) => {
    expect(() => domain(token, chainId, name, version)).toThrow(expect.objectContaining({ code: 'invalid_domain' }));
  });
});

describe('domainFromRequirements (A-21)', () => {
  it('Base Sepolia: name "USDC" from extra, chain 84532 from the network', () => {
    expect(
      domainFromRequirements({
        network: 'eip155:84532',
        asset: BASE_SEPOLIA_USDC,
        extra: { name: 'USDC', version: '2' },
      }),
    ).toEqual({ name: 'USDC', version: '2', chainId: 84532, verifyingContract: BASE_SEPOLIA_USDC });
  });

  it.each([
    [{ network: 'hedera:testnet', asset: MOCK_USDC, extra: { name: 'USDC', version: '2' } }],
    [{ network: 'eip155:', asset: MOCK_USDC, extra: { name: 'USDC', version: '2' } }],
    [{ network: 'eip155:31337', asset: MOCK_USDC }],
    [{ network: 'eip155:31337', asset: MOCK_USDC, extra: { name: 'USDC' } }],
    [{ network: 'eip155:31337', asset: MOCK_USDC, extra: { name: 7, version: '2' } }],
  ])('throws on %j', (req) => {
    expect(() => domainFromRequirements(req)).toThrow(expect.objectContaining({ code: 'invalid_domain' }));
  });
});

describe('readDomain', () => {
  it('uses ERC-5267 eip712Domain() when the token has it', async () => {
    const readContract = vi.fn().mockResolvedValue(['0x0f', 'USD Coin', '2', 31337n, MOCK_USDC, `0x${'0'.repeat(64)}`, []]);
    const client = { readContract, getChainId: vi.fn() } as unknown as PublicClient;
    await expect(readDomain(client, MOCK_USDC)).resolves.toEqual({ name: 'USD Coin', version: '2', chainId: 31337 });
    expect(readContract).toHaveBeenCalledTimes(1);
    expect(readContract.mock.calls[0]?.[0]).toMatchObject({ functionName: 'eip712Domain' });
  });

  it('falls back to name()/version() and the client chain id', async () => {
    const readContract = vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'eip712Domain') throw new Error('execution reverted');
      return functionName === 'name' ? 'USDC' : '2';
    });
    const client = { readContract, getChainId: vi.fn().mockResolvedValue(84532) } as unknown as PublicClient;
    await expect(readDomain(client, BASE_SEPOLIA_USDC)).resolves.toEqual({ name: 'USDC', version: '2', chainId: 84532 });
  });
});
