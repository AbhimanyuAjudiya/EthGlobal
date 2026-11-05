/** HederaTreasury (A-31, T-71): HTS TransferTransaction of the network's USDC (6 dp) from the separate refund account. */
import { AdapterError } from '../errors.js';
import { assertRefund, type RefundInput } from '../treasury-rules.js';
import { guard } from './errors.js';

import type { Treasury } from '../types.js';
import type { HederaClientLike } from './hedera-sdk.js';

export interface HederaTreasuryOptions {
  client: HederaClientLike;
  tokenId: string;
  network: string;
}

export class HederaTreasury implements Treasury {
  constructor(readonly opts: HederaTreasuryOptions) {
    if (!opts.network.startsWith('hedera:'))
      throw new Error(`HederaTreasury serves hedera networks, not ${opts.network}`);
    if (!/^0\.0\.\d{1,12}$/.test(opts.tokenId)) throw new Error('tokenId must be 0.0.x');
  }

  #network(network: string): void {
    if (network !== this.opts.network)
      throw new AdapterError(
        'treasury',
        'unsupported_network',
        `treasury serves ${this.opts.network}`,
      );
  }

  async refund(input: RefundInput): Promise<{ tx: string }> {
    assertRefund(input); // also: `to` is a plain 0.0.x on hedera:* (aliases refused)
    this.#network(input.network);
    try {
      const { txId } = await this.opts.client.transferToken({
        tokenId: this.opts.tokenId,
        to: input.to,
        amount: input.usd6,
        memo: input.memo,
      });
      return { tx: txId };
    } catch (error) {
      const text = error instanceof Error ? error.message : '';
      if (text.includes('TOKEN_NOT_ASSOCIATED_TO_ACCOUNT')) {
        throw new AdapterError(
          'treasury',
          'unavailable',
          'recipient is not associated with the USDC token',
          {
            reason: 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT',
          },
        );
      }
      throw new AdapterError('treasury', 'unavailable', 'Hedera refund failed', {
        reason: error instanceof Error ? error.name : 'unknown',
      });
    }
  }

  async balanceUsd6(network: string): Promise<bigint> {
    this.#network(network);
    return guard('treasury', () => this.opts.client.tokenBalance(this.opts.tokenId));
  }
}
