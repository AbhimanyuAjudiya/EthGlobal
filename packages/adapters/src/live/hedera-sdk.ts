/**
 * The one file that touches the Hedera SDK: @hiero-ledger/sdk@2.90.1 through @x402/hedera's re-exports (A-22, one SDK
 * copy), plus TopicMessageSubmitTransaction / AccountBalanceQuery, which @x402/hedera does not re-export — imported
 * from the very same @hiero-ledger/sdk@2.90.1 that @x402/hedera pins (`pnpm why @hiero-ledger/sdk` shows one).
 * Never @hashgraph/sdk. Keys via PrivateKey.fromStringECDSA (fromString/generate are deprecated).
 */
import { AccountBalanceQuery, TopicMessageSubmitTransaction, Transaction } from '@hiero-ledger/sdk';
import { AccountId, Client, PrivateKey, TokenId, TransferTransaction } from '@x402/hedera';

import { AdapterError } from '../errors.js';

export interface TokenTransferInput {
  tokenId: string;
  to: string;
  amount: bigint;
  memo: string;
}

/** The Hedera surface HcsLog and HederaTreasury need, in plain data (tests use a fake). */
export interface HederaClientLike {
  submitTopicMessage(
    topic: string,
    message: string,
  ): Promise<{ sequence: number; consensusAt: number; txId: string }>;
  transferToken(input: TokenTransferInput): Promise<{ txId: string }>;
  prepareTokenTransfer?(
    input: TokenTransferInput,
  ): Promise<{ txId: string; signedTransaction: string; expiresAt?: number }>;
  submitTokenTransfer?(input: {
    txId: string;
    signedTransaction: string;
  }): Promise<{ txId: string }>;
  tokenBalance(tokenId: string): Promise<bigint>;
}

export interface HederaSdkOptions {
  network: 'testnet' | 'mainnet';
  accountId: string;
  /** ECDSA hex (Portal shows the key type; a mismatch is INVALID_SIGNATURE). */
  privateKey: string;
}

/** Builds (does not send) the topic message transaction — the SDK would chunk > 1024 bytes; HcsLog refuses first. */
export const buildTopicMessage = (topic: string, message: string): TopicMessageSubmitTransaction =>
  new TopicMessageSubmitTransaction().setTopicId(topic).setMessage(message);

/** Builds (does not send) the two-leg HTS transfer `payer −amount, to +amount` with a memo. */
export function buildTokenTransfer(input: {
  tokenId: string;
  from: string;
  to: string;
  amount: bigint;
  memo: string;
}): TransferTransaction {
  const token = TokenId.fromString(input.tokenId);
  return new TransferTransaction()
    .addTokenTransfer(token, AccountId.fromString(input.from), -input.amount)
    .addTokenTransfer(token, AccountId.fromString(input.to), input.amount)
    .setTransactionMemo(input.memo);
}

export function createHederaClient(opts: HederaSdkOptions): HederaClientLike {
  const operator = AccountId.fromString(opts.accountId);
  const key = PrivateKey.fromStringECDSA(opts.privateKey);
  const client = (opts.network === 'mainnet' ? Client.forMainnet() : Client.forTestnet())
    .setOperator(operator, key)
    .setDefaultRegenerateTransactionId(false);
  const prepareTokenTransfer = async ({ tokenId, to, amount, memo }: TokenTransferInput) => {
    const transaction = buildTokenTransfer({ tokenId, from: opts.accountId, to, amount, memo })
      .setRegenerateTransactionId(false)
      .freezeWith(client);
    await transaction.sign(key);
    const id = transaction.transactionId!;
    const expiresAt =
      id.validStart!.toDate().getTime() + transaction.transactionValidDuration * 1000;
    return {
      txId: id.toString(),
      signedTransaction: Buffer.from(transaction.toBytes()).toString('base64'),
      expiresAt,
    };
  };
  const submitTokenTransfer = async (input: { txId: string; signedTransaction: string }) => {
    const transaction = Transaction.fromBytes(Buffer.from(input.signedTransaction, 'base64'));
    if (
      !(transaction instanceof TransferTransaction) ||
      transaction.transactionId?.toString() !== input.txId
    )
      throw new AdapterError('treasury', 'invalid_request', 'invalid prepared native refund');
    try {
      const response = await transaction.execute(client);
      await response.getReceipt(client);
      return { txId: input.txId };
    } catch {
      // Unknown receipt / duplicate / expired retry: the durable ID must be
      // reconciled through the mirror. Never generate another transaction ID.
      throw new AdapterError('treasury', 'unavailable', 'Hedera refund confirmation pending', {
        tx: input.txId,
        reason: 'refund_pending',
      });
    }
  };
  return {
    async submitTopicMessage(topic, message) {
      const response = await buildTopicMessage(topic, message).execute(client);
      const receipt = await response.getReceipt(client);
      const record = await response.getRecord(client);
      return {
        sequence: Number(receipt.topicSequenceNumber ?? 0),
        consensusAt: record.consensusTimestamp.toDate().getTime(),
        txId: response.transactionId.toString(),
      };
    },
    async transferToken(input) {
      return submitTokenTransfer(await prepareTokenTransfer(input));
    },
    prepareTokenTransfer,
    submitTokenTransfer,
    async tokenBalance(tokenId) {
      const balance = await new AccountBalanceQuery().setAccountId(operator).execute(client);
      return BigInt(balance.tokens?.get(TokenId.fromString(tokenId))?.toString() ?? '0');
    },
  };
}
