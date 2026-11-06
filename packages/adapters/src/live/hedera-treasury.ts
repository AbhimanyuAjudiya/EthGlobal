/** HederaTreasury (A-31, T-71): HTS TransferTransaction of the network's USDC (6 dp) from the separate refund account. */
import { z } from 'zod';

import { httpJson } from '@ethglobal/protocol/http';

import { AdapterError } from '../errors.js';
import { assertRefund, type RefundInput } from '../treasury-rules.js';
import { guard } from './errors.js';
import { HEDERA_MIRROR } from './hcs-log.js';
import { checkedBaseUrl, joinUrl, withFetch } from './http.js';

import type { PreparedRefund, RefundStatus, Treasury } from '../types.js';
import type { HederaClientLike } from './hedera-sdk.js';

export interface HederaTreasuryOptions {
  client: HederaClientLike;
  tokenId: string;
  network: string;
  mirrorUrl?: string;
  fetch?: typeof fetch;
}

const mirrorTransactions = z.object({
  transactions: z.array(
    z.object({
      transaction_id: z.string(),
      result: z.string(),
    }),
  ),
});

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
      if (error instanceof AdapterError) throw error;
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

  async prepareRefund(input: RefundInput): Promise<PreparedRefund> {
    assertRefund(input);
    this.#network(input.network);
    const prepare = this.opts.client.prepareTokenTransfer?.bind(this.opts.client);
    if (!prepare)
      throw new AdapterError('treasury', 'unavailable', 'native refund preparation unavailable');
    return guard('treasury', async () => {
      const result = await prepare({
        tokenId: this.opts.tokenId,
        to: input.to,
        amount: input.usd6,
        memo: input.memo,
      });
      return {
        v: 1,
        kind: 'hedera',
        network: input.network,
        tx: result.txId,
        signedTransaction: result.signedTransaction,
        ...(result.expiresAt === undefined ? {} : { expiresAt: result.expiresAt }),
      };
    });
  }

  #prepared(prepared: PreparedRefund): string {
    this.#network(prepared.network);
    const match = /^(0\.0\.\d{1,12})@(\d{1,12})\.(\d{1,9})$/.exec(prepared.tx);
    if (prepared.v !== 1 || prepared.kind !== 'hedera' || !match || !prepared.signedTransaction)
      throw new AdapterError('treasury', 'invalid_request', 'invalid prepared native refund');
    return `${match[1]}-${match[2]}-${match[3]!.padStart(9, '0')}`;
  }

  async refundStatus(prepared: PreparedRefund): Promise<RefundStatus> {
    const id = this.#prepared(prepared);
    const mirror = checkedBaseUrl(
      this.opts.mirrorUrl ??
        HEDERA_MIRROR[this.opts.network === 'hedera:mainnet' ? 'mainnet' : 'testnet'],
    );
    return guard('treasury', async () => {
      const { status, data } = await httpJson(
        joinUrl(mirror, `/api/v1/transactions/${encodeURIComponent(id)}`),
        {
          ...withFetch(this.opts.fetch),
          allowStatus: [404],
        },
      );
      if (status === 404) return 'pending';
      const parsed = mirrorTransactions.safeParse(data);
      if (!parsed.success)
        throw new AdapterError('treasury', 'invalid_response', 'unexpected refund mirror response');
      const transactions = parsed.data.transactions.filter((row) => row.transaction_id === id);
      if (transactions.some((row) => row.result === 'SUCCESS')) return 'success';
      // Duplicates can precede the original record in the mirror response.
      const unsettled = new Set([
        'DUPLICATE_TRANSACTION',
        'UNKNOWN',
        'BUSY',
        'INVALID_NODE_ACCOUNT',
        'INVALID_PAYER_SIGNATURE',
      ]);
      return transactions.some((row) => !unsettled.has(row.result)) ? 'failed' : 'pending';
    });
  }

  async submitRefund(prepared: PreparedRefund): Promise<{ tx: string }> {
    this.#prepared(prepared);
    const submit = this.opts.client.submitTokenTransfer?.bind(this.opts.client);
    if (!submit)
      throw new AdapterError('treasury', 'unavailable', 'native refund submission unavailable');
    try {
      const result = await submit({
        txId: prepared.tx,
        signedTransaction: prepared.signedTransaction,
      });
      if (result.txId !== prepared.tx) throw new Error('unexpected native transaction ID');
      return { tx: result.txId };
    } catch {
      const status = await this.refundStatus(prepared).catch(() => 'pending' as const);
      if (status === 'success') return { tx: prepared.tx };
      throw new AdapterError(
        'treasury',
        'unavailable',
        status === 'failed'
          ? 'Hedera refund transfer failed'
          : 'Hedera refund confirmation pending',
        {
          tx: prepared.tx,
          reason: status === 'failed' ? 'refund_failed' : 'refund_pending',
        },
      );
    }
  }

  async balanceUsd6(network: string): Promise<bigint> {
    this.#network(network);
    return guard('treasury', () => this.opts.client.tokenBalance(this.opts.tokenId));
  }
}
