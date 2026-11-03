import { describe, expect, it, vi } from 'vitest';

import { createViemRelayer } from '../src/index.js';
import { human, MOCK_USDC } from './helpers.js';

import type { PublicClient, WalletClient } from 'viem';

const HASH = `0x${'aa'.repeat(32)}` as const;

function clients(opts: { callReverts?: boolean; status?: 'success' | 'reverted' } = {}) {
  const call = vi.fn(async () => {
    if (opts.callReverts) throw new Error('execution reverted: FiatTokenV2: authorization is used or canceled\nmore');
    return { data: '0x' };
  });
  const sendTransaction = vi.fn().mockResolvedValue(HASH);
  const waitForTransactionReceipt = vi.fn().mockResolvedValue({ status: opts.status ?? 'success' });
  return {
    call,
    sendTransaction,
    publicClient: { call, waitForTransactionReceipt } as unknown as PublicClient,
    walletClient: { account: human, chain: undefined, sendTransaction } as unknown as WalletClient,
  };
}

describe('createViemRelayer (T-16)', () => {
  it('simulate=true sends nothing when eth_call reverts', async () => {
    const c = clients({ callReverts: true });
    const relayer = createViemRelayer({ ...c });
    await expect(relayer.submit(MOCK_USDC, '0x1234')).rejects.toMatchObject({
      code: 'simulation_reverted',
      message: expect.stringContaining('authorization is used'),
    });
    expect(c.sendTransaction).not.toHaveBeenCalled();
  });

  it('simulates, sends and waits for the receipt', async () => {
    const c = clients({ status: 'reverted' });
    const relayer = createViemRelayer({ ...c });
    expect(relayer.address).toBe(human.address);
    await expect(relayer.submit(MOCK_USDC, '0x1234')).resolves.toEqual({ hash: HASH, status: 'reverted' });
    expect(c.call).toHaveBeenCalledWith({ account: human, to: MOCK_USDC, data: '0x1234' });
    expect(c.sendTransaction).toHaveBeenCalledWith({ account: human, chain: null, to: MOCK_USDC, data: '0x1234' });
  });

  it('simulate=false skips eth_call', async () => {
    const c = clients({ callReverts: true });
    await expect(createViemRelayer({ ...c, simulate: false }).submit(MOCK_USDC, '0x')).resolves.toMatchObject({ status: 'success' });
    expect(c.call).not.toHaveBeenCalled();
  });

  it('a wallet client without an account is refused at construction', () => {
    const c = clients();
    expect(() =>
      createViemRelayer({ publicClient: c.publicClient, walletClient: { account: undefined } as unknown as WalletClient }),
    ).toThrow(expect.objectContaining({ code: 'no_account' }));
  });
});
