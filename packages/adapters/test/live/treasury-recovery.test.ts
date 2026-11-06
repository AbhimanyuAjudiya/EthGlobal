import { Transaction, TransferTransaction } from '@hiero-ledger/sdk';
import {
  decodeFunctionData,
  keccak256,
  parseTransaction,
  TransactionReceiptNotFoundError,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { TOKEN_READ_ABI } from '@ethglobal/eip3009';

import { EvmTreasury } from '../../src/live/evm-treasury.js';
import { createHederaClient, type HederaClientLike } from '../../src/live/hedera-sdk.js';
import { HederaTreasury } from '../../src/live/hedera-treasury.js';
import { RoutingTreasury } from '../../src/live/routing-treasury.js';
import { anvilAccounts, anvilKeys, TEST_USDC } from '../../src/testing/index.js';

import type { PreparedRefund } from '../../src/types.js';

const account = privateKeyToAccount(anvilKeys[4]);
const refund = { network: 'eip155:31337', to: anvilAccounts[5], usd6: 400_000n, memo: 'cancel' };

function evm() {
  let status: 'pending' | 'success' | 'failed' = 'pending';
  const prepareTransactionRequest = vi.fn(async (request: Record<string, unknown>) => ({
    ...request,
    chainId: 31337,
    nonce: 7,
    gas: 80_000n,
    type: 'eip1559',
    maxFeePerGas: 2n,
    maxPriorityFeePerGas: 1n,
  }));
  const signTransaction = vi.fn(account.signTransaction);
  const sendRawTransaction = vi.fn(
    async ({ serializedTransaction }: { serializedTransaction: Hex }) =>
      keccak256(serializedTransaction),
  );
  const walletClient = {
    account,
    prepareTransactionRequest,
    signTransaction,
    sendRawTransaction,
  } as unknown as WalletClient;
  const publicClient = {
    async getTransactionReceipt({ hash }: { hash: Hex }) {
      if (status === 'pending') throw new TransactionReceiptNotFoundError({ hash });
      return { status: status === 'success' ? 'success' : 'reverted' };
    },
    async waitForTransactionReceipt() {
      if (status === 'pending') throw new Error('timeout');
      return { status: status === 'success' ? 'success' : 'reverted' };
    },
  } as unknown as PublicClient;
  const build = () =>
    new EvmTreasury({ walletClient, publicClient, token: TEST_USDC, network: refund.network });
  return {
    treasury: build(),
    build,
    prepareTransactionRequest,
    signTransaction,
    sendRawTransaction,
    setStatus: (next: typeof status) => {
      status = next;
    },
  };
}

describe('durable signed refunds', () => {
  it('prepares the exact transfer without broadcasting and replays identical bytes across a timeout and restart', async () => {
    const v = evm();
    const prepared = await v.treasury.prepareRefund(refund);
    expect(v.sendRawTransaction).not.toHaveBeenCalled();
    expect(prepared.tx).toBe(keccak256(prepared.signedTransaction as Hex));
    const transaction = parseTransaction(prepared.signedTransaction as Hex);
    expect(transaction).toMatchObject({
      chainId: 31337,
      nonce: 7,
      to: TEST_USDC.toLowerCase(),
    });
    expect(transaction.value ?? 0n).toBe(0n);
    expect(decodeFunctionData({ abi: TOKEN_READ_ABI, data: transaction.data! })).toEqual({
      functionName: 'transfer',
      args: [anvilAccounts[5], refund.usd6],
    });
    await expect(v.treasury.submitRefund(prepared)).rejects.toMatchObject({
      details: { tx: prepared.tx, reason: 'refund_pending' },
    });
    const restored = JSON.parse(JSON.stringify(prepared)) as PreparedRefund;
    await expect(v.build().refundStatus(restored)).resolves.toBe('pending');
    v.setStatus('success');
    await expect(v.build().submitRefund(restored)).resolves.toEqual({ tx: prepared.tx });
    expect(v.prepareTransactionRequest).toHaveBeenCalledTimes(1);
    expect(v.signTransaction).toHaveBeenCalledTimes(1);
    expect(v.sendRawTransaction.mock.calls.map(([call]) => call.serializedTransaction)).toEqual([
      prepared.signedTransaction,
      prepared.signedTransaction,
    ]);
  });

  it('only the exact receipt confirms already-known broadcasts; reverted transactions and tampered identities fail closed', async () => {
    const v = evm();
    const prepared = await v.treasury.prepareRefund(refund);
    v.sendRawTransaction.mockRejectedValue(new Error('nonce too low'));
    v.setStatus('success');
    await expect(v.treasury.submitRefund(prepared)).resolves.toEqual({ tx: prepared.tx });
    v.setStatus('failed');
    await expect(v.treasury.refundStatus(prepared)).resolves.toBe('failed');
    await expect(v.treasury.submitRefund(prepared)).rejects.toMatchObject({
      details: { reason: 'refund_failed' },
    });
    await expect(
      v.treasury.submitRefund({ ...prepared, tx: `0x${'00'.repeat(32)}` }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
    await expect(
      v.treasury.submitRefund({ ...prepared, network: 'eip155:84532' }),
    ).rejects.toMatchObject({ code: 'unsupported_network' });
  });

  it('keeps the known EVM hash when a legacy caller loses the confirmation response', async () => {
    const tx = `0x${'aa'.repeat(32)}`;
    const treasury = new EvmTreasury({
      network: refund.network,
      token: TEST_USDC,
      walletClient: { account, writeContract: async () => tx } as unknown as WalletClient,
      publicClient: {
        waitForTransactionReceipt: async () => {
          throw new Error('timeout');
        },
      } as unknown as PublicClient,
    });
    await expect(treasury.refund(refund)).rejects.toMatchObject({
      details: { tx, reason: 'refund_pending' },
    });
  });

  it('native Hedera preparation signs an offline two-leg transfer with its transaction ID already fixed', async () => {
    const client = createHederaClient({
      network: 'testnet',
      accountId: '0.0.7007',
      privateKey: anvilKeys[4].slice(2),
    });
    const prepared = await client.prepareTokenTransfer!({
      tokenId: '0.0.429274',
      to: '0.0.5005',
      amount: 400_000n,
      memo: 'cancel',
    });
    const decoded = Transaction.fromBytes(Buffer.from(prepared.signedTransaction, 'base64'));
    expect(decoded).toBeInstanceOf(TransferTransaction);
    expect(decoded.transactionId?.toString()).toBe(prepared.txId);
    expect(prepared.txId).toMatch(/^0\.0\.7007@/);
    expect(decoded.transactionMemo).toBe('cancel');
    expect(prepared.expiresAt).toBe(
      decoded.transactionId!.validStart!.toDate().getTime() +
        decoded.transactionValidDuration * 1000,
    );
    expect(Buffer.from(decoded.toBytes()).toString('base64')).toBe(prepared.signedTransaction);
  });

  it('native recovery uses the saved ID and mirror record, tolerates duplicate records, and never infers payment from a balance', async () => {
    const tx = '0.0.7007@1793707200.000000001';
    const id = '0.0.7007-1793707200-000000001';
    let records: { transaction_id: string; result: string }[] = [];
    const prepareTokenTransfer = vi.fn(async () => ({
      txId: tx,
      signedTransaction: 'saved-bytes',
    }));
    const submitTokenTransfer = vi.fn(async () => {
      throw new Error('receipt lost');
    });
    const tokenBalance = vi.fn();
    const client: HederaClientLike = {
      submitTopicMessage: vi.fn(),
      transferToken: vi.fn(),
      tokenBalance,
      prepareTokenTransfer,
      submitTokenTransfer,
    };
    const treasury = new HederaTreasury({
      client,
      network: 'hedera:testnet',
      tokenId: '0.0.429274',
      fetch: async (url) => {
        const target = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
        expect(target).toBe(`https://testnet.mirrornode.hedera.com/api/v1/transactions/${id}`);
        return Response.json({ transactions: records });
      },
    });
    const routing = new RoutingTreasury({ 'hedera:testnet': treasury });
    const prepared = await routing.prepareRefund({
      ...refund,
      network: 'hedera:testnet',
      to: '0.0.5005',
    });
    expect(submitTokenTransfer).not.toHaveBeenCalled();
    await expect(routing.submitRefund(prepared)).rejects.toMatchObject({
      details: { tx, reason: 'refund_pending' },
    });
    records = [{ transaction_id: id, result: 'DUPLICATE_TRANSACTION' }];
    await expect(routing.refundStatus(prepared)).resolves.toBe('pending');
    records.push({ transaction_id: id, result: 'SUCCESS' });
    await expect(
      routing.submitRefund(JSON.parse(JSON.stringify(prepared)) as PreparedRefund),
    ).resolves.toEqual({
      tx,
    });
    expect(prepareTokenTransfer).toHaveBeenCalledTimes(1);
    expect(submitTokenTransfer).toHaveBeenNthCalledWith(2, {
      txId: tx,
      signedTransaction: 'saved-bytes',
    });
    expect(tokenBalance).not.toHaveBeenCalled();
    records = [{ transaction_id: id, result: 'TOKEN_NOT_ASSOCIATED_TO_ACCOUNT' }];
    await expect(routing.refundStatus(prepared)).resolves.toBe('failed');
  });
});
