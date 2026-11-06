/** EvmTreasury (A-31, T-71): ERC-20 `transfer(to, usd6)` from the SEPARATE refund wallet; 6-decimal base units as given. */
import {
  encodeFunctionData,
  getAddress,
  keccak256,
  TransactionReceiptNotFoundError,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';

import { TOKEN_READ_ABI } from '@ethglobal/eip3009';

import { AdapterError } from '../errors.js';
import { assertRefund, type RefundInput } from '../treasury-rules.js';
import { guard } from './errors.js';

import type { PreparedRefund, RefundStatus, Treasury } from '../types.js';

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
      const receipt = await publicClient.waitForTransactionReceipt({ hash }).catch(() => {
        throw new AdapterError('treasury', 'unavailable', 'refund confirmation pending', {
          tx: hash,
          reason: 'refund_pending',
        });
      });
      if (receipt.status !== 'success') {
        throw new AdapterError('treasury', 'unavailable', 'refund transfer reverted', { tx: hash });
      }
      return { tx: hash };
    });
  }

  async prepareRefund(input: RefundInput): Promise<PreparedRefund> {
    assertRefund(input);
    this.#network(input.network);
    const { walletClient, token } = this.#opts;
    return guard('treasury', async () => {
      const request = await walletClient.prepareTransactionRequest({
        account: this.#account,
        chain: walletClient.chain ?? null,
        to: token,
        data: encodeFunctionData({
          abi: TOKEN_READ_ABI,
          functionName: 'transfer',
          args: [getAddress(input.to), input.usd6],
        }),
        value: 0n,
      });
      const signedTransaction = await walletClient.signTransaction(request);
      return {
        v: 1,
        kind: 'evm',
        network: input.network,
        tx: keccak256(signedTransaction),
        signedTransaction,
      };
    });
  }

  #prepared(prepared: PreparedRefund): Hex {
    this.#network(prepared.network);
    if (
      prepared.v !== 1 ||
      prepared.kind !== 'evm' ||
      !/^0x(?:[a-fA-F0-9]{2})+$/.test(prepared.signedTransaction) ||
      keccak256(prepared.signedTransaction as Hex) !== prepared.tx
    )
      throw new AdapterError('treasury', 'invalid_request', 'invalid prepared refund');
    return prepared.tx;
  }

  async refundStatus(prepared: PreparedRefund): Promise<RefundStatus> {
    const hash = this.#prepared(prepared);
    return guard('treasury', async () => {
      try {
        const receipt = await this.#opts.publicClient.getTransactionReceipt({ hash });
        return receipt.status === 'success' ? 'success' : 'failed';
      } catch (error) {
        if (error instanceof TransactionReceiptNotFoundError) return 'pending';
        throw error;
      }
    });
  }

  async submitRefund(prepared: PreparedRefund): Promise<{ tx: string }> {
    const hash = this.#prepared(prepared);
    const { walletClient, publicClient } = this.#opts;
    try {
      // A restarted process may see already-known / nonce-too-low. Only this exact
      // hash can resolve the outcome; never construct or sign a replacement.
      try {
        const sent = await walletClient.sendRawTransaction({
          serializedTransaction: prepared.signedTransaction as Hex,
        });
        if (sent !== hash) throw new Error('unexpected transaction hash');
      } catch {
        const status = await this.refundStatus(prepared);
        if (status === 'success') return { tx: hash };
        if (status === 'failed')
          throw new AdapterError('treasury', 'unavailable', 'refund transfer reverted', {
            tx: hash,
            reason: 'refund_failed',
          });
      }
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success')
        throw new AdapterError('treasury', 'unavailable', 'refund transfer reverted', {
          tx: hash,
          reason: 'refund_failed',
        });
      return { tx: hash };
    } catch (error) {
      if (error instanceof AdapterError && error.details?.reason === 'refund_failed') throw error;
      throw new AdapterError('treasury', 'unavailable', 'refund confirmation pending', {
        tx: hash,
        reason: 'refund_pending',
      });
    }
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
