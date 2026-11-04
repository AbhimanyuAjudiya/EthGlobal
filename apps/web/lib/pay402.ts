/**
 * The ONE 402 client loop is `fetchWithPayment` from @ethglobal/protocol/x402 (INTERFACES §1.8); this module
 * only supplies its PaymentSigner implementations and wires them to the onchain-action reducer:
 *
 * - `EvmWalletSigner` — EIP-3009 `TransferWithAuthorization` signed by an EIP-1193 wallet; the token domain
 *   comes from accepts[].extra via `domainFromRequirements` (A-21: "USDC" on Base Sepolia, "USD Coin" on Anvil),
 *   `validBefore = now + maxTimeoutSeconds`, the nonce is the session nonce on LPA-delivering routes (T-32).
 * - `DemoWalletSigner` — the same signer over the MODE=local demo wallet (Anvil #5), labelled as such.
 * - `HederaWalletSigner` — an interface only: human Hedera payments are in-window work (A-20). The PWA shows the
 *   exact x402 terms in a "pay on Hedera from your wallet" panel instead of a HashPack hand-off.
 */
import { bytesToHex, keccak256, randomBytes } from '@ethglobal/crypto';
import {
  domainFromRequirements,
  fromPaymentAuthorization,
  typedDataTransferWithAuthorization,
} from '@ethglobal/eip3009';
import { HEDERA_MAX_TIMEOUT_S, type Hex } from '@ethglobal/protocol/ids';
import type {
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  PaymentResource,
  SettleResult,
} from '@ethglobal/protocol/schemas';
import {
  decodePaymentRequired,
  fetchWithPayment,
  PAYMENT_REQUIRED_HEADER,
  type PaymentSigner,
} from '@ethglobal/protocol/x402';

import { call, requestId, toApiError, type ApiError } from './api';
import { config } from './env';

import type { Wallet } from './wallet';

/** What the PWA lets a signer pay: the terms /plans advertised (T-56 allow-list). */
export interface AcceptTerm {
  network: string;
  asset: string;
  payTo: string;
}

export interface SignerHooks {
  /** The wallet prompt is about to open (reducer: start → signing). */
  onSigning?: () => void;
  /** MODE=local test hook: sign one base unit less than asked (the "wrong amount" e2e). */
  tamperAmount?: boolean;
}

export class EvmWalletSigner implements PaymentSigner {
  constructor(
    protected readonly wallet: Wallet,
    protected readonly network: string,
    protected readonly allow: readonly AcceptTerm[],
    protected readonly hooks: SignerHooks = {},
  ) {}

  get label(): string {
    return this.wallet.name;
  }

  choose(accepts: PaymentRequirements[]): PaymentRequirements | undefined {
    return accepts.find(
      (a) =>
        a.scheme === 'exact' &&
        a.network === this.network &&
        a.network === this.wallet.network &&
        this.allow.some(
          (t) =>
            t.network === a.network &&
            t.asset.toLowerCase() === a.asset.toLowerCase() &&
            t.payTo.toLowerCase() === a.payTo.toLowerCase(),
        ),
    );
  }

  async sign(
    req: PaymentRequirements,
    ctx: { resource: PaymentResource; nonce?: Hex; now: number },
  ): Promise<PaymentPayload> {
    const value = this.hooks.tamperAmount ? String(BigInt(req.amount) - 1n) : req.amount;
    const authorization = {
      from: this.wallet.address,
      to: req.payTo,
      value,
      validAfter: '0',
      validBefore: String(Math.floor(ctx.now / 1000) + req.maxTimeoutSeconds),
      nonce: ctx.nonce ?? bytesToHex(randomBytes(32)),
    };
    this.hooks.onSigning?.();
    const signature = await this.wallet.signTypedData(
      typedDataTransferWithAuthorization(
        domainFromRequirements(req),
        fromPaymentAuthorization(authorization),
      ),
    );
    return { x402Version: 2, accepted: req, payload: { signature, authorization } };
  }
}

/** MODE=local only: the same EIP-3009 signer over the demo wallet; the UI labels it "demo wallet · Anvil #5". */
export class DemoWalletSigner extends EvmWalletSigner {}

/** Human Hedera payments (A-20): `{ transaction: <base64 partially-signed TransferTransaction> }`. In-window. */
export interface HederaWalletSigner extends PaymentSigner {
  readonly status: 'coming-in-window';
}

/** The exact x402 terms for the "pay on Hedera from your wallet" panel. */
export function hederaTerms(req: PaymentRequirements) {
  return {
    network: req.network,
    asset: req.asset,
    amount: req.amount,
    payTo: req.payTo,
    feePayer: typeof req.extra?.feePayer === 'string' ? req.extra.feePayer : undefined,
    validForS: Math.min(req.maxTimeoutSeconds, HEDERA_MAX_TIMEOUT_S),
  };
}

export interface Quote {
  required: PaymentRequired;
  url: string;
  init: RequestInit;
}

/** The Review state's data: one unpaid request, its 402 decoded with the protocol codec. */
export async function quote(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; sessionPubKey?: Hex } = {},
): Promise<Quote> {
  const headers: Record<string, string> = {};
  if (init.sessionPubKey) headers['X-Session-Pubkey'] = init.sessionPubKey;
  const res = await call(path, {
    method: init.method ?? 'GET',
    ...(init.body === undefined ? {} : { body: init.body }),
    headers,
    accept: [402],
  });
  const header = res.headers.get(PAYMENT_REQUIRED_HEADER);
  if (res.status !== 402 || header === null) throw toApiError(res.status, res.data, res.headers);
  return {
    required: decodePaymentRequired(header),
    url: `${config.apiUrl}${path}`,
    init: {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-Request-Id': requestId(),
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    },
  };
}

export interface PaidResult<T> {
  status: number;
  data?: T;
  settlement?: SettleResult;
  error?: ApiError;
  paid?: PaymentPayload;
}

/** Runs fetchWithPayment once for a quoted request and returns the parsed body or the decoded failure. */
export async function pay<T>(
  q: Quote,
  signer: PaymentSigner,
  sessionPubKey?: Hex,
): Promise<PaidResult<T>> {
  const result = await fetchWithPayment({
    fetch: globalThis.fetch,
    url: q.url,
    init: q.init,
    signer,
    now: () => Date.now(),
    keccak256,
    ...(sessionPubKey ? { sessionPubKey } : {}),
  });
  const text = await result.response.text();
  const body: unknown = text ? JSON.parse(text) : undefined;
  const out: PaidResult<T> = {
    status: result.response.status,
    ...(result.settlement ? { settlement: result.settlement } : {}),
    ...(result.paid ? { paid: result.paid } : {}),
  };
  if (result.response.status >= 400) {
    // a second 402 carries the facilitator's reason in PAYMENT-REQUIRED.error; the body is errorBodySchema
    const again = result.response.headers.get(PAYMENT_REQUIRED_HEADER);
    const reason = again ? safeError(again) : undefined;
    const error = toApiError(result.response.status, body, result.response.headers);
    return { ...out, error: reason ? Object.assign(error, { details: { reason, ...asObject(error.details) } }) : error };
  }
  return { ...out, data: body as T };
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

function safeError(header: string): string | undefined {
  try {
    return decodePaymentRequired(header).error;
  } catch {
    return undefined;
  }
}

/** Plain words for a failed x402 payment, from the API's error code and the facilitator's reason. */
export function paymentFailureReason(error: ApiError | undefined): string {
  const detail = JSON.stringify(error?.details ?? '').toLowerCase();
  if (detail.includes('expired') || detail.includes('valid_before'))
    return 'the facilitator rejected the signature (expired)';
  if (detail.includes('amount') || detail.includes('value'))
    return 'the signed amount did not match the price';
  if (detail.includes('nonce')) return 'this approval was already used';
  if (detail.includes('balance') || detail.includes('insufficient'))
    return 'the account does not hold enough USDC';
  return (error && FAILURE_WORDS[error.code]) ?? 'the payment was not accepted';
}

const FAILURE_WORDS: Partial<Record<ApiError['code'], string>> = {
  invalid_payment: 'the facilitator rejected the signature',
  settlement_failed: 'settlement failed on the network',
  daily_cap: 'the daily top-up limit for this plan is reached',
  expired: 'this plan has expired',
  facilitator_unavailable: 'the facilitator is not answering',
  network: 'the API could not be reached',
};
