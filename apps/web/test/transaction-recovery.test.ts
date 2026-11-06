import { afterEach, describe, expect, it, vi } from 'vitest';

import { pending, del } from '../lib/store';
import { followTransaction } from '../lib/use-onchain';

import type { PublicClient } from 'viem';

const hash = `0x${'ab'.repeat(32)}`;
afterEach(async () => {
  vi.useRealTimers();
  await del('pending');
});
describe('broadcast recovery', () => {
  it('keeps an unresolved broadcast after polling expires and reports uncertainty', async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn();
    const reader = {
      getTransactionReceipt: vi.fn().mockRejectedValue(new Error('RPC unavailable')),
      getTransaction: vi.fn().mockRejectedValue(new Error('RPC unavailable')),
    } as unknown as PublicClient;
    const follow = followTransaction({
      hash,
      network: 'eip155:84532',
      label: 'top-up',
      reader,
      dispatch,
    });
    await vi.runAllTimersAsync();
    expect(await follow).toBe('pending');
    expect(await pending.list()).toHaveLength(1);
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'uncertain' }));
  });
  it('a hash the Hedera relay reports as refused is a failure, not a receipt still on its way', async () => {
    const dispatch = vi.fn();
    const refused = new Error(
      '[Request ID: 1] Transaction rejected: INSUFFICIENT_TX_FEE',
    ) as Error & { cause?: unknown };
    refused.cause = { code: -32003, data: { hederaStatus: 'INSUFFICIENT_TX_FEE' } };
    const reader = {
      getTransactionReceipt: vi.fn().mockRejectedValue(refused),
      getTransaction: vi.fn().mockResolvedValue(null),
    } as unknown as PublicClient;
    expect(
      await followTransaction({ hash, network: 'eip155:296', label: 'approve', reader, dispatch }),
    ).toBe('failed');
    expect(dispatch).toHaveBeenLastCalledWith({
      type: 'revert',
      reason: 'the network refused it: INSUFFICIENT_TX_FEE',
    });
    expect(await pending.list()).toHaveLength(0);
  });
  it('can recover the saved hash and regards the receipt block itself as safe', async () => {
    await pending.add({ hash, network: 'eip155:84532', label: 'top-up', at: 1 });
    const reader = {
      getTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', blockNumber: 42n }),
      getBlock: vi.fn().mockResolvedValue({ number: 42n }),
    } as unknown as PublicClient;
    const dispatch = vi.fn();
    expect(
      await followTransaction({ hash, network: 'eip155:84532', label: 'top-up', reader, dispatch }),
    ).toBe('finalized');
    expect(await pending.list()).toEqual([]);
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'finalized' });
    expect(reader.getBlock).toHaveBeenCalledWith({ blockTag: 'safe' });
  });
  it.each(['eip155:295', 'eip155:296'])(
    'finalizes %s from its consensus receipt despite a stale wallet safe block',
    async (network) => {
      const getBlock = vi.fn().mockResolvedValue({ number: 1n });
      const reader = {
        getTransactionReceipt: vi.fn().mockResolvedValue({ status: 'success', blockNumber: 42n }),
        getBlock,
      } as unknown as PublicClient;
      const dispatch = vi.fn();
      expect(
        await followTransaction({
          hash,
          network,
          label: 'approve campaign USDC',
          reader,
          dispatch,
        }),
      ).toBe('finalized');
      expect(getBlock).not.toHaveBeenCalled();
      expect(dispatch.mock.calls).toEqual([
        [{ type: 'seen' }],
        [{ type: 'confirmed', confirmations: 1 }],
        [{ type: 'finalized' }],
      ]);
      expect(await pending.list()).toEqual([]);
    },
  );
  it('never treats a reverted Hedera consensus receipt as successful', async () => {
    const getBlock = vi.fn();
    const reader = {
      getTransactionReceipt: vi.fn().mockResolvedValue({
        status: 'reverted',
        blockNumber: 42n,
        gasUsed: 100n,
        effectiveGasPrice: 100n,
      }),
      getBlock,
    } as unknown as PublicClient;
    const dispatch = vi.fn();
    expect(
      await followTransaction({
        hash,
        network: 'eip155:296',
        label: 'create campaign',
        reader,
        dispatch,
      }),
    ).toBe('failed');
    expect(dispatch).toHaveBeenLastCalledWith(expect.objectContaining({ type: 'revert' }));
    expect(dispatch).not.toHaveBeenCalledWith({ type: 'finalized' });
    expect(getBlock).not.toHaveBeenCalled();
    expect(await pending.list()).toEqual([]);
  });
});
