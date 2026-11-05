import { decodeFunctionData, type PublicClient, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { TOKEN_READ_ABI } from '@ethglobal/eip3009';

import { EvmTreasury } from '../../src/live/evm-treasury.js';
import { HederaTreasury } from '../../src/live/hedera-treasury.js';
import { RoutingTreasury } from '../../src/live/routing-treasury.js';
import {
  anvilAccounts,
  anvilKeys,
  anvilRoles,
  describeTreasury,
  TEST_USDC,
} from '../../src/testing/index.js';

import type { HederaClientLike } from '../../src/live/hedera-sdk.js';

const treasuryAccount = privateKeyToAccount(anvilKeys[anvilRoles.treasury]);

function evm(status: 'success' | 'reverted' = 'success') {
  let balance = 50_000_000n;
  const writes: unknown[] = [];
  const walletClient = {
    account: treasuryAccount,
    chain: undefined,
    writeContract: vi.fn(async (args: { args: [string, bigint] }) => {
      writes.push(args);
      if (status === 'success') balance -= args.args[1];
      return `0x${'4e'.repeat(32)}`;
    }),
  } as unknown as WalletClient;
  const publicClient = {
    waitForTransactionReceipt: vi.fn(async () => ({ status })),
    readContract: vi.fn(async () => balance),
  } as unknown as PublicClient;
  return {
    treasury: new EvmTreasury({
      walletClient,
      publicClient,
      token: TEST_USDC,
      network: 'eip155:31337',
    }),
    writes,
    walletClient,
  };
}

function hedera(fail?: string) {
  let balance = 50_000_000n;
  const transferToken = vi.fn(async ({ amount }: { amount: bigint }) => {
    if (fail) throw new Error(fail);
    balance -= amount;
    return { txId: '0.0.7007@1793707200.000000001' };
  });
  const client: HederaClientLike = {
    submitTopicMessage: vi.fn(),
    transferToken,
    tokenBalance: vi.fn(async () => balance),
  };
  const treasury = new HederaTreasury({ client, tokenId: '0.0.429274', network: 'hedera:testnet' });
  return { treasury, client, transferToken };
}

describeTreasury('EvmTreasury (viem stubs)', async () => ({
  treasury: evm().treasury,
  network: 'eip155:31337',
  to: anvilAccounts[5],
}));
describeTreasury('HederaTreasury (fake client)', async () => ({
  treasury: hedera().treasury,
  network: 'hedera:testnet',
  to: '0.0.5005',
}));
describeTreasury('RoutingTreasury', async () => ({
  treasury: new RoutingTreasury({
    'eip155:31337': evm().treasury,
    'hedera:testnet': hedera().treasury,
  }),
  network: 'hedera:testnet',
  to: '0.0.5005',
}));

describe('treasuries (A-31, T-71, L14)', () => {
  it('EvmTreasury encodes ERC-20 transfer(to, usd6) with the 6-decimal value unchanged', async () => {
    const { treasury, writes } = evm();
    await treasury.refund({
      network: 'eip155:31337',
      to: anvilAccounts[5].toLowerCase(),
      usd6: 400_000n,
      memo: 'gift',
    });
    expect(writes[0]).toMatchObject({
      address: TEST_USDC,
      functionName: 'transfer',
      args: [anvilAccounts[5], 400_000n],
      account: treasuryAccount,
    });
    expect(TOKEN_READ_ABI.find((f) => f.name === 'transfer')).toBeDefined();
    expect(() => decodeFunctionData).not.toThrow();
  });

  it('EvmTreasury: reverted transfer ⇒ unavailable; other network ⇒ unsupported_network; constructor guards', async () => {
    await expect(
      evm('reverted').treasury.refund({
        network: 'eip155:31337',
        to: anvilAccounts[5],
        usd6: 1n,
        memo: '',
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    await expect(
      evm().treasury.refund({ network: 'eip155:84532', to: anvilAccounts[5], usd6: 1n, memo: '' }),
    ).rejects.toMatchObject({ code: 'unsupported_network' });
    await expect(evm().treasury.balanceUsd6('eip155:1')).rejects.toMatchObject({
      code: 'unsupported_network',
    });
    const { walletClient } = evm();
    const publicClient = {} as PublicClient;
    expect(
      () =>
        new EvmTreasury({
          walletClient: { ...walletClient, account: undefined },
          publicClient,
          token: TEST_USDC,
          network: 'eip155:1',
        }),
    ).toThrow(/treasury account/);
    expect(
      () =>
        new EvmTreasury({
          walletClient,
          publicClient,
          token: TEST_USDC,
          network: 'hedera:testnet',
        }),
    ).toThrow(/eip155/);
  });

  it('HederaTreasury: TOKEN_NOT_ASSOCIATED_TO_ACCOUNT ⇒ unavailable with the reason; aliases refused; guards', async () => {
    await expect(
      hedera(
        'receipt for transaction failed with status TOKEN_NOT_ASSOCIATED_TO_ACCOUNT',
      ).treasury.refund({ network: 'hedera:testnet', to: '0.0.5005', usd6: 1n, memo: '' }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      details: { reason: 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT' },
    });
    await expect(
      hedera('INSUFFICIENT_TOKEN_BALANCE').treasury.refund({
        network: 'hedera:testnet',
        to: '0.0.5005',
        usd6: 1n,
        memo: '',
      }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    const { treasury, client, transferToken: transfer } = hedera();
    await expect(
      treasury.refund({
        network: 'hedera:testnet',
        to: '0x0000000000000000000000000000000000068cDa',
        usd6: 1n,
        memo: '',
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      treasury.refund({ network: 'hedera:mainnet', to: '0.0.5005', usd6: 1n, memo: '' }),
    ).rejects.toMatchObject({ code: 'unsupported_network' });
    expect(transfer).not.toHaveBeenCalled();
    await expect(treasury.balanceUsd6('hedera:mainnet')).rejects.toMatchObject({
      code: 'unsupported_network',
    });
    expect(
      () => new HederaTreasury({ client, tokenId: '0.0.429274', network: 'eip155:1' }),
    ).toThrow(/hedera/);
    expect(
      () => new HederaTreasury({ client, tokenId: 'usdc', network: 'hedera:testnet' }),
    ).toThrow(/0.0.x/);
  });

  it('RoutingTreasury: an unknown network is unsupported_network — never a transfer on a default rail', async () => {
    const { treasury, writes } = evm();
    const routing = new RoutingTreasury({ 'eip155:31337': treasury });
    await expect(
      routing.refund({ network: 'eip155:1', to: anvilAccounts[5], usd6: 1n, memo: '' }),
    ).rejects.toMatchObject({ code: 'unsupported_network' });
    await expect(routing.balanceUsd6('hedera:testnet')).rejects.toMatchObject({
      code: 'unsupported_network',
    });
    expect(writes).toEqual([]);
  });
});
