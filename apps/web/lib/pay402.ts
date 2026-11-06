/**
 * The ONE 402 client loop is `fetchWithPayment` from @ethglobal/protocol/x402 (INTERFACES §1.8); this module
 * only supplies its PaymentSigner implementations and wires them to the onchain-action reducer:
 *
 * - `EvmWalletSigner` — EIP-3009 `TransferWithAuthorization` signed by an EIP-1193 wallet; the token domain
 *   comes from accepts[].extra via `domainFromRequirements` (A-21: "USDC" on Base Sepolia, "USD Coin" on Anvil),
 *   `validBefore = now + maxTimeoutSeconds`, the nonce is the session nonce on LPA-delivering routes (T-32).
 *   MODE=local uses the same signer with the labelled demo wallet (Anvil #5).
 * - Human Hedera payments (A-20) are `HashPackPaySigner` in lib/hedera-wc.ts (WalletConnect, HIP-820), loaded lazily.
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
  decodePaymentResponse,
  encodePaymentPayload,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  fetchWithPayment,
  PAYMENT_REQUIRED_HEADER,
  type PaymentSigner,
} from '@ethglobal/protocol/x402';

import { ApiError, call, ENTITLE_TIMEOUT_MS, requestId, toApiError } from './api';
import { config } from './env';
import { get, set, del, entries } from './store';
import { isUserRejection, type Wallet } from './wallet';

import type { ActionEvent } from './onchain-action';

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

/** The exact x402 terms for the "pay on Hedera with HashPack" panel. */
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
  spk?: Hex;
  recovery?: boolean;
}

interface Attempt {
  q: Quote;
  paid: PaymentPayload;
  spk?: Hex;
}
const ATTEMPTS = 'payment-attempt:';
const requestKey = (url: string, body?: unknown) =>
  `${url}\n${typeof body === 'string' ? body : body === undefined ? '' : JSON.stringify(body)}`;
const attempts = () => entries<Attempt>(ATTEMPTS);
const recoveryQuote = (attempt: Attempt): Quote => ({
  ...attempt.q,
  required: { ...attempt.q.required, accepts: [attempt.paid.accepted] },
  recovery: true,
});
function attemptKey(q: Quote): string {
  const headers = new Headers(q.init.headers);
  let token = headers.get('Idempotency-Key');
  if (!token) {
    token = crypto.randomUUID();
    headers.set('Idempotency-Key', token);
    q.init.headers = Object.fromEntries(headers);
  }
  return `${ATTEMPTS}${token}`;
}
export async function pendingPayment(path: string): Promise<Quote | undefined> {
  const attempt = (await attempts()).find((a) => a.q.url === `${config.apiUrl}${path}`);
  return attempt ? recoveryQuote(attempt) : undefined;
}
export async function completePayment(q: Quote): Promise<void> {
  await del(attemptKey(q));
}

/** The Review state's data: one unpaid request, its 402 decoded with the protocol codec. */
export async function quote(
  path: string,
  init: { method?: 'GET' | 'POST'; body?: unknown; sessionPubKey?: Hex } = {},
): Promise<Quote> {
  const previous = (await attempts()).find(
    (attempt) =>
      requestKey(attempt.q.url, attempt.q.init.body) ===
      requestKey(`${config.apiUrl}${path}`, init.body),
  );
  if (previous) return recoveryQuote(previous);
  const idempotencyKey = crypto.randomUUID();
  const headers: Record<string, string> = { 'Idempotency-Key': idempotencyKey };
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
    ...(init.sessionPubKey ? { spk: init.sessionPubKey } : {}),
    url: `${config.apiUrl}${path}`,
    init: {
      method: init.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'X-Request-Id': requestId(),
        'Idempotency-Key': idempotencyKey,
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
  uncertain?: boolean;
}

/** Runs fetchWithPayment once for a quoted request and returns the parsed body or the decoded failure. */
export async function pay<T>(
  q: Quote,
  signer: PaymentSigner,
  sessionPubKey?: Hex,
  now: number = Date.now(),
  fetcher: typeof fetch = globalThis.fetch,
): Promise<PaidResult<T>> {
  const id = attemptKey(q);
  let attempt = await get<Attempt>(id);
  const recovering = Boolean(attempt);
  let result: { response: Response; settlement?: SettleResult; paid?: PaymentPayload };
  try {
    if (attempt) {
      // Replay the SAME signed authorization. Never ask the wallet for a new nonce after an uncertain send.
      const headers = new Headers(attempt.q.init.headers);
      headers.set(PAYMENT_SIGNATURE_HEADER, encodePaymentPayload(attempt.paid));
      if (attempt.spk) headers.set('X-Session-Pubkey', attempt.spk);
      const response = await fetcher(attempt.q.url, {
        ...attempt.q.init,
        headers,
        signal: AbortSignal.timeout(ENTITLE_TIMEOUT_MS),
      });
      const header = response.headers.get(PAYMENT_RESPONSE_HEADER);
      result = {
        response,
        paid: attempt.paid,
        ...(header ? { settlement: decodePaymentResponse(header) } : {}),
      };
    } else {
      const skew = now - Date.now();
      result = await fetchWithPayment({
        fetch: fetcher,
        url: q.url,
        init: q.init,
        signer: {
          ...(signer.sessionBinding
            ? { sessionBinding: (payment: PaymentPayload) => signer.sessionBinding!(payment) }
            : {}),
          choose: (offers) =>
            signer.choose(
              offers.filter((offer) =>
                q.required.accepts.some(
                  (reviewed) =>
                    reviewed.network === offer.network &&
                    reviewed.asset.toLowerCase() === offer.asset.toLowerCase() &&
                    reviewed.payTo.toLowerCase() === offer.payTo.toLowerCase() &&
                    reviewed.amount === offer.amount,
                ),
              ),
            ),
          sign: async (requirements, context) => {
            const paid = await signer.sign(requirements, context);
            attempt = {
              q: { ...q, ...(sessionPubKey ? { spk: sessionPubKey } : {}) },
              paid,
              ...(sessionPubKey ? { spk: sessionPubKey } : {}),
            };
            await set(id, attempt);
            return paid;
          },
        },
        now: () => Date.now() + skew,
        keccak256,
        ...(sessionPubKey ? { sessionPubKey } : {}),
        timeoutMs: ENTITLE_TIMEOUT_MS,
      });
    }
    const text = await result.response.text();
    const body: unknown = text ? JSON.parse(text) : undefined;
    const out: PaidResult<T> = {
      status: result.response.status,
      ...(result.settlement ? { settlement: result.settlement } : {}),
      ...(result.paid ? { paid: result.paid } : {}),
    };
    if (result.response.status >= 400) {
      const again = result.response.headers.get(PAYMENT_REQUIRED_HEADER);
      const reason = again ? safeError(again) : undefined;
      const error = toApiError(result.response.status, body, result.response.headers);
      const uncertain = Boolean(
        attempt &&
        (recovering ||
          (result.settlement?.success ?? false) ||
          result.response.status >= 500 ||
          error.code === 'replay'),
      );
      if (!uncertain) await completePayment(q);
      return {
        ...out,
        uncertain,
        error: reason
          ? Object.assign(error, { details: { reason, ...asObject(error.details) } })
          : error,
      };
    }
    return { ...out, data: body as T };
  } catch (error) {
    if (!attempt) throw error; // Nothing was signed/sent: a wallet decline remains a normal rejection.
    return {
      status: 0,
      paid: attempt.paid,
      uncertain: true,
      error: new ApiError(0, 'network', error instanceof Error ? error.message : 'network'),
    };
  }
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

/** The reducer event for a throw while the wallet was open: a decline is neutral, anything else decoded. */
export function signingFailure(error: unknown): ActionEvent {
  return isUserRejection(error)
    ? { type: 'rejected' }
    : {
        type: 'preBroadcastError',
        reason: paymentFailureReason(error instanceof ApiError ? error : undefined),
      };
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
  replay: 'this payment was already settled once',
};
