/**
 * RemoteFacilitator (INTERFACES §3.3; A-18, A-20, A-30; T-42, T-78): an x402 v2 facilitator over HTTP —
 * `GET /supported`, `POST /verify`, `POST /settle` with `{ x402Version: 2, paymentPayload, paymentRequirements }`.
 * The facilitator is not trusted to tell the truth: every response is schema-checked, a settlement must carry a
 * plausible transaction for the requested network, `settlement_pending` is polled on chain, and the Hedera fee
 * payer it advertises must equal the pinned one. `/supported` is read as the vendor shape (any version, scheme and
 * network string, any JSON in `extra`; RT-A-16): only the v2 `exact` kind on a configured network is consulted.
 */
import { z } from 'zod';

import { httpJson } from '@ethglobal/protocol/http';
import { RECEIPT_TTL_S } from '@ethglobal/protocol/ids';
import {
  paymentPayloadSchema,
  settleResultSchema,
  supportedResponseSchema,
  verifyResultSchema,
  type SupportedResponse,
} from '@ethglobal/protocol/schemas';

import { AdapterError } from '../errors.js';
import { buildPaymentRequired, sameRequirements } from '../payment-requirements.js';
import { guard } from './errors.js';
import {
  checkedHederaMirror,
  inspectHederaPaymentTransaction,
  type InspectedNativePayment,
} from './hedera-auth.js';
import { checkedBaseUrl, joinUrl, withFetch } from './http.js';

import type {
  PaymentPayload,
  PaymentRail,
  PaymentRequired,
  PaymentRequirementInput,
  PaymentRequirements,
  SettleResult,
  VerifyResult,
} from '../types.js';

/** A-30: the only facilitator hosts a configuration may name. */
export const FACILITATOR_HOSTS = [
  'x402.org',
  'api.testnet.blocky402.com',
  'api.blocky402.com',
  'testnet.facilitator.launa.dev',
  'localhost',
] as const;
export const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator';

const EVM_TX = /^0x[0-9a-fA-F]{64}$/;
const HEDERA_TX_ID = /^0\.0\.\d{1,12}@\d{1,12}\.\d{1,9}$/;
const HEDERA_TX_HASH = /^(0x)?[0-9a-fA-F]{96}$/;
const HEDERA_ACCOUNT = /^0\.0\.\d{1,12}$/;

/** A settlement transaction that can exist on `network` (T-42): EVM 32-byte hash; Hedera `0.0.x@s.n` or a 48-byte hash. */
export function plausibleTransaction(network: string, tx: string | undefined): boolean {
  if (!tx) return false;
  if (network.startsWith('eip155:')) return EVM_TX.test(tx);
  if (network.startsWith('hedera:')) return HEDERA_TX_ID.test(tx) || HEDERA_TX_HASH.test(tx);
  return false;
}

/** `0.0.x@seconds.nanos` → the mirror node path form `0.0.x-seconds-nanos`. */
export const mirrorTransactionId = (tx: string): string =>
  tx.replace('@', '-').replace(/\.(\d+)$/, '-$1');

/** The v2 `exact` kind for `network`; v1 kinds (legacy names) and other schemes are listed too and ignored (RT-A-16). */
const exactKind = (supported: SupportedResponse | undefined, network: string) =>
  supported?.kinds.find(
    (k) => k.network === network && k.scheme === 'exact' && k.x402Version === 2,
  );

const mirrorTransactions = z.object({
  transactions: z
    .array(
      z
        .object({
          result: z.string(),
          transaction_id: z.string().optional(),
          name: z.string().optional(),
          nonce: z.number().int().optional(),
          scheduled: z.boolean().optional(),
          memo_base64: z.string().optional(),
          consensus_timestamp: z.string().optional(),
          token_transfers: z
            .array(
              z.object({
                token_id: z.string(),
                account: z.string(),
                amount: z.union([z.number().int().safe(), z.string().regex(/^-?\d+$/)]),
                is_approval: z.boolean().optional(),
              }),
            )
            .max(20)
            .optional(),
        })
        .loose(),
    )
    .max(20),
});

export interface ReceiptReader {
  /** null while the transaction is not yet mined. */
  receipt(tx: `0x${string}`): Promise<'success' | 'reverted' | null>;
}

export interface RemoteFacilitatorOptions {
  url: string;
  fetch?: typeof fetch;
  allowedHosts: string[];
  networks: string[];
  /** network → the fee payer `/supported` must advertise (X402_HEDERA_FEE_PAYER, A-20). */
  expectFeePayer?: Record<string, string>;
  /** Polls `settlement_pending` on EVM networks. */
  evmReceipts?: ReceiptReader;
  /** Polls `settlement_pending` on Hedera: `GET {mirrorUrl}/api/v1/transactions/{id}`. */
  mirrorUrl?: string;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  pendingTimeoutMs?: number;
  pollMs?: number;
  logger?: Pick<Console, 'warn'>;
}

export class RemoteFacilitator implements PaymentRail {
  readonly #opts: RemoteFacilitatorOptions;
  readonly #base: URL;
  readonly #mirror: URL | undefined;
  #supported: Promise<SupportedResponse> | undefined;
  #supportedValue: SupportedResponse | undefined;

  constructor(opts: RemoteFacilitatorOptions) {
    const allowed = opts.allowedHosts.filter((h) =>
      (FACILITATOR_HOSTS as readonly string[]).includes(h),
    );
    this.#base = checkedBaseUrl(opts.url, allowed);
    this.#mirror = opts.mirrorUrl ? checkedBaseUrl(opts.mirrorUrl) : undefined;
    if (opts.mirrorUrl)
      for (const network of opts.networks.filter((value) => value.startsWith('hedera:')))
        checkedHederaMirror(opts.mirrorUrl, network);
    if (opts.networks.length === 0) throw new Error('RemoteFacilitator needs at least one network');
    this.#opts = opts;
  }

  /** `GET /supported`, cached; a failed read is retried on the next call. */
  supported(): Promise<SupportedResponse> {
    this.#supported ??= guard('payments', async () => {
      const { data } = await httpJson(joinUrl(this.#base, '/supported'), {
        ...withFetch(this.#opts.fetch),
        schema: supportedResponseSchema,
      });
      this.#supportedValue = data;
      return data;
    }).catch((error: unknown) => {
      this.#supported = undefined;
      throw error;
    });
    return this.#supported;
  }

  /** The facilitator's Hedera fee payer for `network`, checked against the pin (T-42). Call at boot. */
  async feePayer(network: string): Promise<string> {
    const kind = await this.#kind(network);
    const feePayer = kind.extra?.feePayer;
    if (typeof feePayer !== 'string' || !HEDERA_ACCOUNT.test(feePayer)) {
      throw new AdapterError(
        'payments',
        'invalid_response',
        `facilitator lists no fee payer for ${network}`,
      );
    }
    const pinned = this.#opts.expectFeePayer?.[network];
    if (pinned !== undefined && pinned !== feePayer) {
      throw new AdapterError(
        'payments',
        'invalid_response',
        `facilitator fee payer ${feePayer} ≠ pinned ${pinned}`,
        {
          feePayer,
          pinned,
        },
      );
    }
    return feePayer;
  }

  createPaymentRequirement(input: PaymentRequirementInput): PaymentRequired {
    if (!this.#opts.networks.includes(input.network)) {
      throw new AdapterError(
        'payments',
        'unsupported_scheme',
        `facilitator not configured for ${input.network}`,
      );
    }
    if (input.network.startsWith('hedera:')) {
      const advertised = exactKind(this.#supportedValue, input.network)?.extra?.feePayer;
      const given = input.extra?.feePayer;
      if (given !== undefined && advertised !== undefined && given !== advertised) {
        throw new AdapterError(
          'payments',
          'invalid_request',
          'extra.feePayer differs from the facilitator',
        );
      }
      if (given === undefined && typeof advertised === 'string') {
        return buildPaymentRequired({ ...input, extra: { ...input.extra, feePayer: advertised } });
      }
    }
    return buildPaymentRequired(input);
  }

  async verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult> {
    const refused = this.#precheck(payload, requirements);
    if (refused) return { isValid: false, invalidReason: refused };
    const native = this.#native(payload, requirements);
    if (native && this.#mirror) {
      const state = await this.#chainState(requirements.network, native.transactionId, native);
      if (state === 'success')
        return { isValid: false, invalidReason: 'nonce_already_used', payer: native.payer };
      if (state !== 'pending')
        return { isValid: false, invalidReason: 'invalid_transaction_state' };
    }
    await this.#kind(requirements.network);
    if (native && native.feePayer !== (await this.feePayer(requirements.network)))
      return { isValid: false, invalidReason: 'requirements_mismatch' };
    const { data } = await guard('payments', () =>
      httpJson(joinUrl(this.#base, '/verify'), {
        method: 'POST',
        body: { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements },
        ...withFetch(this.#opts.fetch),
        schema: verifyResultSchema,
        allowStatus: [400],
      }),
    );
    if (native && data.isValid && data.payer !== native.payer)
      return { isValid: false, invalidReason: 'payer_mismatch' };
    return data;
  }

  async settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult> {
    const { network } = requirements;
    const fail = (errorReason: string): SettleResult => ({
      success: false,
      errorReason,
      network,
      transaction: '',
    });
    const refused = this.#precheck(payload, requirements);
    if (refused) return fail(refused);
    const native = this.#native(payload, requirements);
    if (native && this.#mirror) {
      const state = await this.#chainState(network, native.transactionId, native);
      if (state === 'success')
        return { success: true, network, payer: native.payer, transaction: native.transactionId };
      if (state !== 'pending') return fail('invalid_transaction_state');
    }
    await this.#kind(network);
    if (native && native.feePayer !== (await this.feePayer(network)))
      return fail('requirements_mismatch');
    const { data } = await guard('payments', () =>
      httpJson<unknown>(joinUrl(this.#base, '/settle'), {
        method: 'POST',
        body: { x402Version: 2, paymentPayload: payload, paymentRequirements: requirements },
        ...withFetch(this.#opts.fetch),
        allowStatus: [400],
      }),
    );
    const parsed = settleResultSchema.safeParse(normaliseSettle(data));
    if (!parsed.success)
      return this.#lie(
        network,
        'invalid_response',
        'settle response does not match the x402 v2 schema',
      );
    const result = parsed.data;
    if (result.network !== network)
      return this.#lie(
        network,
        'network_mismatch',
        `settled on ${result.network}, asked ${network}`,
      );
    if (native && (result.success || result.errorReason === 'settlement_pending')) {
      if (result.payer !== native.payer || result.transaction !== native.transactionId)
        return this.#lie(
          network,
          'invalid_response',
          'native settlement identity does not match signed transfer',
        );
      // Even a claimed SUCCESS must be corroborated on the native ledger. The
      // facilitator's assertion cannot decide who owns a plan or its refund.
      return this.#awaitPending(network, native.transactionId, native.payer, native);
    }
    if (result.success) {
      return plausibleTransaction(network, result.transaction)
        ? result
        : this.#lie(network, 'invalid_response', 'success without a plausible transaction');
    }
    if (result.errorReason !== 'settlement_pending')
      return { ...result, transaction: result.transaction ?? '' };
    if (!plausibleTransaction(network, result.transaction))
      return this.#lie(network, 'invalid_response', 'pending without a transaction');
    return this.#awaitPending(network, result.transaction!, result.payer ?? '');
  }

  #precheck(payload: PaymentPayload, requirements: PaymentRequirements): string | undefined {
    const network = requirements.network;
    if (!this.#opts.networks.includes(network)) return 'unsupported_scheme';
    const body = payload.payload as Record<string, unknown> | undefined;
    const evm = body !== undefined && 'authorization' in body;
    const hedera = body !== undefined && 'transaction' in body;
    if ((network.startsWith('eip155:') && hedera) || (network.startsWith('hedera:') && evm))
      return 'unsupported_scheme';
    if (!paymentPayloadSchema.safeParse(payload).success) return 'invalid_payload';
    if (!sameRequirements(payload.accepted, requirements)) return 'requirements_mismatch';
    if (network.startsWith('hedera:')) {
      const native = this.#native(payload, requirements);
      if (!native) return 'invalid_payload';
      if (
        native.asset !== requirements.asset ||
        native.payTo !== requirements.payTo ||
        native.amount !== requirements.amount ||
        native.feePayer !== requirements.extra?.feePayer
      )
        return 'requirements_mismatch';
    }
    return undefined;
  }

  #native(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): InspectedNativePayment | undefined {
    return requirements.network.startsWith('hedera:') && 'transaction' in payload.payload
      ? inspectHederaPaymentTransaction(payload.payload.transaction)
      : undefined;
  }

  async #kind(network: string) {
    const kind = exactKind(await this.supported(), network);
    if (!kind) {
      this.#opts.logger?.warn(
        `x402: facilitator ${this.#base.host} does not list exact on ${network}`,
      );
      throw new AdapterError('payments', 'unavailable', `facilitator does not support ${network}`);
    }
    return kind;
  }

  #lie(network: string, errorReason: string, message: string): SettleResult {
    this.#opts.logger?.warn(`x402: facilitator ${this.#base.host}: ${message} (T-42)`);
    return { success: false, errorReason, network, transaction: '' };
  }

  /** `settlement_pending` is non-terminal (A-18): poll the chain ≤ 30 s, then success with that tx or unavailable. */
  async #awaitPending(
    network: string,
    tx: string,
    payer: string,
    native?: InspectedNativePayment,
  ): Promise<SettleResult> {
    const now = this.#opts.now ?? Date.now;
    const sleep = this.#opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const deadline = now() + (this.#opts.pendingTimeoutMs ?? 30_000);
    for (;;) {
      const state = await this.#chainState(network, tx, native);
      if (state === 'success') return { success: true, transaction: tx, network, payer };
      if (state === 'mismatch')
        return this.#lie(
          network,
          'invalid_response',
          'native consensus transfer does not match signed payment',
        );
      if (state === 'failed')
        return { success: false, errorReason: 'settle_reverted', network, transaction: tx };
      if (now() >= deadline)
        throw new AdapterError('payments', 'unavailable', 'settlement still pending after 30 s', {
          tx,
        });
      await sleep(this.#opts.pollMs ?? 3_000);
    }
  }

  async #chainState(
    network: string,
    tx: string,
    native?: InspectedNativePayment,
  ): Promise<'success' | 'failed' | 'pending' | 'mismatch'> {
    if (network.startsWith('eip155:')) {
      const reader = this.#opts.evmReceipts;
      if (!reader)
        throw new AdapterError('payments', 'unavailable', 'no RPC to confirm a pending settlement');
      const status = await guard('payments', () => reader.receipt(tx as `0x${string}`));
      return status === null ? 'pending' : status === 'success' ? 'success' : 'failed';
    }
    if (!this.#mirror)
      throw new AdapterError(
        'payments',
        'unavailable',
        'no mirror node to confirm a pending settlement',
      );
    const url = joinUrl(
      this.#mirror,
      `/api/v1/transactions/${encodeURIComponent(mirrorTransactionId(tx))}`,
    );
    const found = await guard('payments', () =>
      httpJson(url, {
        ...withFetch(this.#opts.fetch),
        schema: mirrorTransactions,
        allowStatus: [404],
      }),
    ).catch((error: unknown) => {
      if (error instanceof AdapterError && error.code === 'invalid_response')
        return { status: 404, data: undefined };
      throw error;
    });
    const transactions = found.status === 404 ? [] : (found.data?.transactions ?? []);
    // The mirror can return duplicate submissions before the original consensus
    // record. A duplicate alone does not establish whether the transfer succeeded.
    const succeeded = transactions.filter((entry) => entry.result === 'SUCCESS');
    if (succeeded.length > 0) {
      if (!native) return 'mismatch';
      const matches = succeeded.some((entry) => {
        const timestamp = Number(entry.consensus_timestamp);
        const now = (this.#opts.now ?? Date.now)() / 1000;
        const validStart = Number(native.validStart);
        const transfers = entry.token_transfers ?? [];
        return (
          entry.transaction_id === mirrorTransactionId(native.transactionId) &&
          entry.name === 'CRYPTOTRANSFER' &&
          entry.nonce === 0 &&
          entry.scheduled === false &&
          entry.memo_base64 === Buffer.from(native.memo, 'utf8').toString('base64') &&
          Number.isFinite(timestamp) &&
          timestamp > 0 &&
          timestamp <= now + 60 &&
          timestamp >= validStart &&
          timestamp <= validStart + native.validDurationS &&
          now - timestamp < RECEIPT_TTL_S - 86_400 &&
          transfers.length === 2 &&
          transfers.every((leg) => leg.token_id === native.asset && !leg.is_approval) &&
          transfers.some(
            (leg) => leg.account === native.payer && BigInt(leg.amount) === -BigInt(native.amount),
          ) &&
          transfers.some(
            (leg) => leg.account === native.payTo && BigInt(leg.amount) === BigInt(native.amount),
          )
        );
      });
      return matches ? 'success' : 'mismatch';
    }
    const unsettled = new Set([
      'DUPLICATE_TRANSACTION',
      'UNKNOWN',
      'BUSY',
      'INVALID_NODE_ACCOUNT',
      'INVALID_PAYER_SIGNATURE',
    ]);
    return transactions.some((entry) => !unsettled.has(entry.result)) ? 'failed' : 'pending';
  }
}

/** A Hedera facilitator that returns only `transactionId` gets it moved into `transaction` (A-20). */
function normaliseSettle(body: unknown): unknown {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const o = body as Record<string, unknown>;
    if (
      (o.transaction === undefined || o.transaction === '') &&
      typeof o.transactionId === 'string'
    ) {
      const { transactionId, ...rest } = o;
      return { ...rest, transaction: transactionId };
    }
  }
  return body;
}
