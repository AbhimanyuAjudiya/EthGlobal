/** EvmTreasury (A-31, T-71): ERC-20 `transfer(to, usd6)` from the SEPARATE refund wallet; 6-decimal base units as given. */
import { getAddress, type Address, type PublicClient, type WalletClient } from 'viem';

import { TOKEN_READ_ABI } from '@ethglobal/eip3009';

import { AdapterError } from '../errors.js';
import { assertRefund, type RefundInput } from '../treasury-rules.js';
import { guard } from './errors.js';

import type { Treasury } from '../types.js';

export interface EvmTreasuryOptions {
  walletClient: WalletClient;
  publicClient: PublicClient;
  token: Address;
  network: string;
}

export class EvmTreasury implements Treasury {
  readonly #opts: EvmTreasuryOptions;
  readonly #account: NonNullable<WalletClient['account']>;

  constructor(opts: EvmTreasuryOptions) {
    if (!opts.walletClient.account)
      throw new Error('EvmTreasury needs a wallet client with the treasury account');
    if (!opts.network.startsWith('eip155:'))
      throw new Error(`EvmTreasury serves eip155 networks, not ${opts.network}`);
    this.#opts = { ...opts, token: getAddress(opts.token) };
    this.#account = opts.walletClient.account;
  }

  #network(network: string): void {
    if (network !== this.#opts.network)
      throw new AdapterError(
        'treasury',
        'unsupported_network',
        `treasury serves ${this.#opts.network}`,
      );
  }

  async refund(input: RefundInput): Promise<{ tx: string }> {
    assertRefund(input);
    this.#network(input.network);
    const { walletClient, publicClient, token } = this.#opts;
    return guard('treasury', async () => {
      const hash = await walletClient.writeContract({
        account: this.#account,
        chain: walletClient.chain ?? null,
        address: token,
        abi: TOKEN_READ_ABI,
        functionName: 'transfer',
        args: [getAddress(input.to), input.usd6], // usd6 IS the token amount (6 decimals): no parseUnits
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success') {
        throw new AdapterError('treasury', 'unavailable', 'refund transfer reverted', { tx: hash });
      }
      return { tx: hash };
    });
  }

  async balanceUsd6(network: string): Promise<bigint> {
    this.#network(network);
    return guard('treasury', () =>
      this.#opts.publicClient.readContract({
        address: this.#opts.token,
        abi: TOKEN_READ_ABI,
        functionName: 'balanceOf',
        args: [this.#account.address],
      }),
    );
  }
}
