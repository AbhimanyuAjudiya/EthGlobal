/** Native HIP-820 proof validation and signed payment/session binding. No signing or submission lives here. */
import { proto } from '@hiero-ledger/proto';
import { PublicKey } from '@hiero-ledger/sdk';
import { z } from 'zod';

import { HttpError, httpJson } from '@ethglobal/protocol/http';
import { parseHederaSessionMemo } from '@ethglobal/protocol/x402';

import { checkedBaseUrl, joinUrl } from './http.js';
import { AdapterError } from '../errors.js';

import type { Hex, NativeAccountVerifier } from '../types.js';

type HederaNetwork = 'hedera:testnet' | 'hedera:mainnet';
const MIRRORS: Readonly<Record<HederaNetwork, string>> = {
  'hedera:testnet': 'https://testnet.mirrornode.hedera.com',
  'hedera:mainnet': 'https://mainnet-public.mirrornode.hedera.com',
};
/** Operator-supplied mirrors may be custom hosts; known public mirrors must never cross networks. */
export function checkedHederaMirror(raw: string, network: string): URL {
  const url = checkedBaseUrl(raw);
  const publicNetwork = Object.entries(MIRRORS).find(
    ([, base]) => new URL(base).hostname === url.hostname,
  )?.[0];
  if (publicNetwork && publicNetwork !== network)
    throw new Error('Hedera mirror is configured for another network');
  return url;
}
const ACCOUNT_ID = /^0\.0\.[1-9]\d{0,11}$/;
const MAX_TRANSACTION_BASE64 = 16_384;
const MAX_SIGNATURE_BASE64 = 8_192;
const sameBytes = (left: Uint8Array, right: Uint8Array): boolean =>
  Buffer.from(left).equals(Buffer.from(right));

/** Buffer.from alone accepts ignored characters/truncated padding; require one canonical bounded encoding. */
function base64Bytes(value: string, max: number): Uint8Array | undefined {
  if (
    value.length === 0 ||
    value.length > max ||
    value.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  )
    return undefined;
  const bytes = Buffer.from(value, 'base64');
  return bytes.toString('base64') === value ? bytes : undefined;
}

/**
 * Refuse alternative/legacy envelopes, duplicate fields, and noncanonical protobufs so the checked memo is
 * exactly the one the facilitator submits. Multiple bodies may differ only in their target node.
 * Signature/transfer verification remains the payment rail's job; reading a memo alone never proves payment.
 */
function nativeBodies(transactionBase64: string): proto.TransactionBody[] | undefined {
  try {
    const bytes = base64Bytes(transactionBase64, MAX_TRANSACTION_BASE64);
    if (!bytes) return undefined;
    const list = proto.TransactionList.decode(bytes);
    if (
      list.transactionList.length === 0 ||
      list.transactionList.length > 16 ||
      !sameBytes(proto.TransactionList.encode(list).finish(), bytes)
    )
      return undefined;
    const bodies: proto.TransactionBody[] = [];
    for (const transaction of list.transactionList) {
      if (
        !transaction.signedTransactionBytes?.length ||
        Object.keys(transaction).some((key) => key !== 'signedTransactionBytes')
      )
        return undefined;
      const signed = proto.SignedTransaction.decode(transaction.signedTransactionBytes);
      if (
        !signed.bodyBytes.length ||
        !signed.sigMap?.sigPair?.length ||
        signed.sigMap.sigPair.length > 16 ||
        Object.keys(signed).some((key) => key !== 'bodyBytes' && key !== 'sigMap') ||
        !sameBytes(
          proto.SignedTransaction.encode(signed).finish(),
          transaction.signedTransactionBytes,
        )
      )
        return undefined;
      const body = proto.TransactionBody.decode(signed.bodyBytes);
      const allowed = new Set([
        'transactionID',
        'nodeAccountID',
        'transactionFee',
        'transactionValidDuration',
        'generateRecord',
        'memo',
        'cryptoTransfer',
        'maxCustomFees',
      ]);
      if (
        !body.cryptoTransfer ||
        body.maxCustomFees.length > 0 ||
        Object.keys(body).some((key) => !allowed.has(key)) ||
        !sameBytes(proto.TransactionBody.encode(body).finish(), signed.bodyBytes)
      )
        return undefined;
      bodies.push(body);
    }
    // The SDK may sign the same payment for several nodes. Only the node may
    // differ: a facilitator must not choose between different signed purchases.
    const semanticBytes = (body: proto.TransactionBody) =>
      proto.TransactionBody.encode({ ...body, nodeAccountID: null }).finish();
    if (bodies.some((body) => !sameBytes(semanticBytes(body), semanticBytes(bodies[0]!))))
      return undefined;
    return bodies;
  } catch {
    return undefined;
  }
}

export function hederaTransactionSessionBinding(transactionBase64: string): Hex | undefined {
  const bodies = nativeBodies(transactionBase64);
  return bodies?.length === 1 ? parseHederaSessionMemo(bodies[0]!.memo) : undefined;
}

export interface InspectedNativePayment {
  transactionId: string;
  validStart: string;
  validDurationS: number;
  payer: string;
  feePayer: string;
  payTo: string;
  asset: string;
  amount: string;
  memo: string;
}

/** Canonical numeric identifiers only; aliases and sub-account spellings cannot stand in for an owner. */
function entityId(value: proto.IAccountID | proto.ITokenID | null | undefined): string | undefined {
  if (!value) return undefined;
  const token = 'tokenNum' in value;
  const allowed = new Set(['shardNum', 'realmNum', token ? 'tokenNum' : 'accountNum']);
  if (Object.keys(value).some((key) => !allowed.has(key))) return undefined;
  const part = token ? value.tokenNum : 'accountNum' in value ? value.accountNum : undefined;
  const id = `${value.shardNum?.toString() ?? '0'}.${value.realmNum?.toString() ?? '0'}.${part?.toString() ?? '0'}`;
  return ACCOUNT_ID.test(id) ? id : undefined;
}

/** Exact HTS USDC-style two-leg payment; the debit account is the payer, not transactionID.accountID. */
export function inspectHederaPaymentTransaction(
  transactionBase64: string,
): InspectedNativePayment | undefined {
  try {
    const bodies = nativeBodies(transactionBase64);
    if (!bodies) return undefined;
    const body = bodies[0]!;
    const id = body.transactionID;
    const feePayer = entityId(id?.accountID);
    const start = id?.transactionValidStart;
    const seconds = start?.seconds?.toString() ?? '';
    const nanos = start?.nanos ?? 0;
    const duration = Number(body.transactionValidDuration?.seconds?.toString() ?? 0);
    const fee = BigInt(body.transactionFee.toString());
    if (
      !feePayer ||
      !/^[1-9]\d{0,11}$/.test(seconds) ||
      !Number.isInteger(nanos) ||
      nanos < 0 ||
      nanos > 999_999_999 ||
      id?.scheduled ||
      (id?.nonce ?? 0) !== 0 ||
      !Number.isInteger(duration) ||
      duration <= 0 ||
      duration > 180 ||
      fee < 0n ||
      fee > 100_000_000n ||
      bodies.some((entry) => !entityId(entry.nodeAccountID)) ||
      Buffer.byteLength(body.memo, 'utf8') > 100 ||
      (body.cryptoTransfer?.transfers?.accountAmounts?.length ?? 0) > 0
    )
      return undefined;
    const tokens = body.cryptoTransfer?.tokenTransfers ?? [];
    if (tokens.length !== 1) return undefined;
    const token = tokens[0]!;
    const asset = entityId(token.token);
    const legs = token.transfers ?? [];
    if (
      !asset ||
      (token.nftTransfers?.length ?? 0) > 0 ||
      legs.length !== 2 ||
      legs.some((leg) => leg.isApproval === true || !entityId(leg.accountID))
    )
      return undefined;
    const debit = legs.find((leg) => BigInt(leg.amount?.toString() ?? '0') < 0n);
    const credit = legs.find((leg) => BigInt(leg.amount?.toString() ?? '0') > 0n);
    if (!debit || !credit) return undefined;
    const payer = entityId(debit.accountID)!;
    const payTo = entityId(credit.accountID)!;
    const amount = BigInt(credit.amount!.toString());
    if (payer === payTo || payer === feePayer || BigInt(debit.amount!.toString()) !== -amount)
      return undefined;
    const validStart = `${seconds}.${String(nanos).padStart(9, '0')}`;
    return {
      transactionId: `${feePayer}@${validStart}`,
      validStart,
      validDurationS: duration,
      payer,
      feePayer,
      payTo,
      asset,
      amount: amount.toString(),
      memo: body.memo,
    };
  } catch {
    return undefined;
  }
}

const mirrorAccountSchema = z.object({
  account: z.string(),
  deleted: z.boolean(),
  key: z.object({ _type: z.string(), key: z.string().max(8_192) }).nullable(),
});

export interface HederaAccountVerifierOptions {
  fetch?: typeof fetch;
  /** Operator configuration only. Each network remains pinned to its own trusted mirror. */
  mirrorUrls?: Partial<Record<HederaNetwork, string>>;
}

/** HIP-820 hedera_signMessage, for simple ED25519/ECDSA account keys; threshold/contract keys fail closed. */
export class HederaAccountVerifier implements NativeAccountVerifier {
  readonly #opts: HederaAccountVerifierOptions;
  readonly #mirrors: Readonly<Record<HederaNetwork, URL>>;

  constructor(opts: HederaAccountVerifierOptions = {}) {
    this.#opts = opts;
    this.#mirrors = {
      'hedera:testnet': checkedHederaMirror(
        opts.mirrorUrls?.['hedera:testnet'] ?? MIRRORS['hedera:testnet'],
        'hedera:testnet',
      ),
      'hedera:mainnet': checkedHederaMirror(
        opts.mirrorUrls?.['hedera:mainnet'] ?? MIRRORS['hedera:mainnet'],
        'hedera:mainnet',
      ),
    };
  }

  async verifyMessage(
    input: Parameters<NativeAccountVerifier['verifyMessage']>[0],
  ): Promise<boolean> {
    const { network, accountId, message, signatureMap } = input;
    if (
      (network !== 'hedera:testnet' && network !== 'hedera:mainnet') ||
      !ACCOUNT_ID.test(accountId) ||
      message.length === 0 ||
      message.length > 4_096 ||
      // Protocol messages are ASCII: JS string length and UTF-8 byte length must be identical for HIP-820.
      !/^[\x20-\x7e\n]+$/.test(message)
    )
      return false;
    const bytes = base64Bytes(signatureMap, MAX_SIGNATURE_BASE64);
    if (!bytes) return false;
    let signatures: proto.ISignaturePair[];
    try {
      const decoded = proto.SignatureMap.decode(bytes);
      if (
        decoded.sigPair.length === 0 ||
        decoded.sigPair.length > 16 ||
        !sameBytes(proto.SignatureMap.encode(decoded).finish(), bytes)
      )
        return false;
      signatures = decoded.sigPair;
    } catch {
      return false;
    }
    let account: z.infer<typeof mirrorAccountSchema>;
    try {
      const response = await httpJson(
        joinUrl(this.#mirrors[network], `/api/v1/accounts/${accountId}`),
        {
          schema: mirrorAccountSchema,
          timeoutMs: 10_000,
          ...(this.#opts.fetch ? { fetch: this.#opts.fetch } : {}),
        },
      );
      account = response.data;
    } catch (error) {
      if (error instanceof HttpError && error.status === 404) return false;
      throw new AdapterError(
        'nativeAccounts',
        'unavailable',
        'Native account verification unavailable',
      );
    }
    if (account.account !== accountId || account.deleted || !account.key) return false;
    const kind = account.key._type;
    let key: PublicKey;
    try {
      if (kind === 'ED25519' && /^[0-9a-fA-F]{64}$/.test(account.key.key))
        key = PublicKey.fromStringED25519(account.key.key);
      else if (kind === 'ECDSA_SECP256K1' && /^(02|03)[0-9a-fA-F]{64}$/.test(account.key.key))
        key = PublicKey.fromStringECDSA(account.key.key);
      else return false;
    } catch {
      return false;
    }
    const publicBytes = key.toBytesRaw();
    const prefixed = Buffer.from(`\x19Hedera Signed Message:\n${message.length}${message}`, 'utf8');
    return signatures.some((pair) => {
      const prefix = pair.pubKeyPrefix ?? new Uint8Array();
      const signature = kind === 'ED25519' ? pair.ed25519 : pair.ECDSASecp256k1;
      if (
        signature?.length !== 64 ||
        prefix.length > publicBytes.length ||
        !sameBytes(prefix, publicBytes.subarray(0, prefix.length))
      )
        return false;
      try {
        return key.verify(prefixed, signature);
      } catch {
        return false;
      }
    });
  }
}
