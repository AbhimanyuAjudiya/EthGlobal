/** describeTreasury: the refund-wallet port contract (L14, T-71). */
import { describe, expect, it } from 'vitest';

import type { Treasury } from '../../types.js';

export interface TreasurySubject {
  treasury: Treasury;
  network: string;
  /** A valid recipient on `network`. */
  to: string;
}

export function describeTreasury(name: string, make: () => Promise<TreasurySubject>): void {
  describe(`Treasury contract: ${name}`, () => {
    it('refund returns a tx and moves exactly usd6 out of the float', async () => {
      const { treasury, network, to } = await make();
      const before = await treasury.balanceUsd6(network);
      const { tx } = await treasury.refund({ network, to, usd6: 400_000n, memo: 'gift reclaim' });
      expect(tx).toMatch(/^(0x[0-9a-f]{64}|0\.0\.\d+@\d+\.\d+)$/);
      expect(await treasury.balanceUsd6(network)).toBe(before - 400_000n);
    });

    it('rejects usd6 ≤ 0, a recipient of another network, and a memo over 100 bytes', async () => {
      const { treasury, network, to } = await make();
      for (const usd6 of [0n, -1n]) {
        await expect(treasury.refund({ network, to, usd6, memo: '' })).rejects.toMatchObject({
          code: 'invalid_amount',
        });
      }
      const foreign = network.startsWith('hedera:')
        ? '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
        : '0.0.1234';
      await expect(
        treasury.refund({ network, to: foreign, usd6: 1n, memo: '' }),
      ).rejects.toMatchObject({
        code: 'invalid_request',
      });
      await expect(
        treasury.refund({ network, to, usd6: 1n, memo: 'm'.repeat(101) }),
      ).rejects.toMatchObject({
        code: 'invalid_request',
      });
    });
  });
}
