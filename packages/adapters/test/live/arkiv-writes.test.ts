import { describe, expect, it, vi } from 'vitest';

import { createArkivClient } from '../../src/live/arkiv-sdk.js';

const wallet = vi.hoisted(() => ({
  createEntity: vi.fn(),
  patchEntity: vi.fn(),
  extendEntity: vi.fn(),
}));
vi.mock('@arkiv-network/sdk', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  createWalletClient: () => wallet,
}));

describe('Arkiv account mutations', () => {
  it('serializes writes across entity keys and continues after a rejected mutation', async () => {
    let rejectFirst!: (error: Error) => void;
    const pending = new Promise((_, reject) => {
      rejectFirst = reject;
    });
    wallet.createEntity.mockReturnValueOnce(pending);
    wallet.patchEntity.mockResolvedValueOnce({ txHash: `0x${'a'.repeat(64)}` });
    wallet.extendEntity.mockResolvedValueOnce({ txHash: `0x${'b'.repeat(64)}`, expiresAt: 100n });
    const client = createArkivClient({
      chainId: 7794095,
      rpcUrl: 'https://arkiv.invalid',
      accessKey: '',
      privateKey: `0x${'42'.repeat(32)}`,
    });
    const create = client.createEntity(
      'gift',
      { payload: new Uint8Array([1]) },
      {
        expiration: { kind: 'seconds', seconds: 600 },
      },
    );
    const rejected = expect(create).rejects.toThrow('reverted');
    await vi.waitFor(() => expect(wallet.createEntity).toHaveBeenCalledTimes(1));
    const patch = client.patchEntity('entitlement', `0x${'1'.repeat(64)}`, {
      set: { rev: 2n },
      unset: [],
    });
    const extend = client.extendEntity(`0x${'2'.repeat(64)}`, { kind: 'seconds', seconds: 600 });
    await Promise.resolve();
    expect(wallet.patchEntity).not.toHaveBeenCalled();
    expect(wallet.extendEntity).not.toHaveBeenCalled();
    rejectFirst(new Error('reverted'));
    await rejected;
    await patch;
    await extend;
    expect(wallet.patchEntity).toHaveBeenCalledTimes(1);
    expect(wallet.extendEntity).toHaveBeenCalledTimes(1);
    expect(wallet.patchEntity.mock.invocationCallOrder[0]).toBeLessThan(
      wallet.extendEntity.mock.invocationCallOrder[0]!,
    );
  });
});
