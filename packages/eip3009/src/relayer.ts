/** Submits authorization calldata from the relayer key; simulates with eth_call first (T-16). */
import { Eip3009Error } from './errors.js';

import type { Address, Hex, PublicClient, WalletClient } from 'viem';

export interface Relayer {
  /** The relayer's own address (receiveWithAuthorization is only submittable when `to` equals it). */
  readonly address?: Address;
  submit(token: Address, data: Hex): Promise<{ hash: Hex; status: 'success' | 'reverted' }>;
}

/**
 * A relayer over viem clients. With `simulate` (the default) a reverting `eth_call` throws
 * `Eip3009Error('simulation_reverted')` and nothing is sent, so an authorization from an empty or used
 * account costs no gas.
 */
export function createViemRelayer(opts: {
  walletClient: WalletClient;
  publicClient: PublicClient;
  simulate?: boolean;
}): Relayer {
  const { walletClient, publicClient } = opts;
  const simulate = opts.simulate ?? true;
  const account = walletClient.account;
  if (!account) throw new Eip3009Error('no_account', 'walletClient has no account');
  return {
    address: account.address,
    async submit(token, data) {
      if (simulate) {
        try {
          await publicClient.call({ account, to: token, data });
        } catch (error) {
          const reason = error instanceof Error ? error.message.split('\n')[0] : 'reverted';
          throw new Eip3009Error('simulation_reverted', `eth_call reverted: ${reason}`);
        }
      }
      const hash = await walletClient.sendTransaction({
        account,
        chain: walletClient.chain ?? null,
        to: token,
        data,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, status: receipt.status };
    },
  };
}
