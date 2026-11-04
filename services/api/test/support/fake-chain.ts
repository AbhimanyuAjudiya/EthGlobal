/** A self-run facilitator over FakeUsdc3009 (real EIP-3009 recovery, no node) for the facilitator and x402 tests. */
import { getAddress } from 'viem';

import { SelfRunFacilitator } from '@ethglobal/adapters/live';
import { anvilAccounts, anvilRoles, FakeUsdc3009, TEST_USDC } from '@ethglobal/adapters/testing';

import type { DepsOverrides } from '../../src/deps.js';

export function fakeUsdcRail(now: () => number): { usdc: FakeUsdc3009; overrides: DepsOverrides } {
  const usdc = new FakeUsdc3009({
    address: getAddress(TEST_USDC),
    chainId: 31337,
    name: 'USD Coin',
    version: '2',
    now,
    balances: {
      [anvilAccounts[anvilRoles.human]]: 100_000_000n,
      [anvilAccounts[anvilRoles.agent]]: 100_000_000n,
    },
  });
  const relayer = anvilAccounts[anvilRoles.relayer];
  const rail = new SelfRunFacilitator({
    publicClient: usdc.publicClient(),
    relayer: usdc.relayer(relayer),
    token: usdc.address,
    chainId: 31337,
    network: 'eip155:31337',
    now,
  });
  return { usdc, overrides: { payments: rail, facilitator: { rail, relayer } } };
}
