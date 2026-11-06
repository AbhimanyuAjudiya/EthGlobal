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
  });
});
