/**
 * The one x402 v2 header codec and the one 402 client loop (INTERFACES §1.8; API-FACTS §1.2). Headers carry
 * base64(JSON) exactly as @x402/core 2.29.0 `safeBase64Encode(JSON.stringify(…))` produces. Signing is
 * injected (`PaymentSigner`); the web payer and the agent payer implement it, nothing else signs.
 */
import { RechargeError } from './errors.js';
import { hexBytes, parseJsonOrThrow, parseOrThrow, utf8Bytes, utf8Decode } from './internal.js';
import {
  isEvmExact,
  paymentPayloadSchema,
  paymentRequiredSchema,
  paymentResponseSchema,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type PaymentResource,
  type SettleResult,
} from './schemas/x402.js';

import type { Hex } from './ids.js';
import type { z } from 'zod';

export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';
/** hex32; required on paid routes that deliver an LPA. */
export const SESSION_PUBKEY_HEADER = 'X-Session-Pubkey';

/** Headers longer than this are rejected before any decoding (16 KiB). */
export const MAX_X402_HEADER_BYTES = 16 * 1024;
/** Standard base64 with padding, the alphabet @x402/core's `Base64EncodedRegex` accepts. */
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function toBase64(text: string): string {
  let binary = '';
  for (const byte of utf8Bytes(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function headerError(label: string, reason: string, message: string): RechargeError {
  return new RechargeError('invalid_request', `${label}: ${message}`, { reason });
}

function fromBase64(header: string, label: string): string {
  if (header.length > MAX_X402_HEADER_BYTES) {
    throw headerError(label, 'too_large', `header exceeds ${MAX_X402_HEADER_BYTES} bytes`);
  }
  if (header.length === 0 || !BASE64.test(header)) {
    throw headerError(label, 'base64', 'header is not base64');
  }
  const binary = atob(header);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  try {
    return utf8Decode(bytes);
  } catch {
    throw headerError(label, 'utf8', 'header is not UTF-8');
  }
}

function encodeWith<S extends z.ZodType>(schema: S, value: z.input<S>, label: string): string {
  return toBase64(JSON.stringify(parseOrThrow(schema, value, label)));
}

function decodeWith<S extends z.ZodType>(schema: S, header: string, label: string): z.output<S> {
  return parseJsonOrThrow(schema, fromBase64(header, label), label);
}

/** base64(JSON); the value is validated first, so a malformed body is never sent. */
export const encodePaymentRequired = (v: PaymentRequired): string =>
  encodeWith(paymentRequiredSchema, v, PAYMENT_REQUIRED_HEADER);
/** base64 → JSON → zod parse; throws RechargeError('invalid_request') with `details.reason`. */
export const decodePaymentRequired = (h: string): PaymentRequired =>
  decodeWith(paymentRequiredSchema, h, PAYMENT_REQUIRED_HEADER);
export const encodePaymentPayload = (v: PaymentPayload): string =>
  encodeWith(paymentPayloadSchema, v, PAYMENT_SIGNATURE_HEADER);
/** Rejects > 16 KiB before decoding. */
export const decodePaymentPayload = (h: string): PaymentPayload =>
  decodeWith(paymentPayloadSchema, h, PAYMENT_SIGNATURE_HEADER);
export const encodePaymentResponse = (v: SettleResult): string =>
  encodeWith(paymentResponseSchema, v, PAYMENT_RESPONSE_HEADER);
export const decodePaymentResponse = (h: string): SettleResult =>
  decodeWith(paymentResponseSchema, h, PAYMENT_RESPONSE_HEADER);

/** Builds (and validates) the 402 body; the same object goes in the PAYMENT-REQUIRED header. */
export function paymentRequired(input: {
  resource: PaymentResource;
  accepts: PaymentRequirements[];
  error?: string;
}): PaymentRequired {
  return parseOrThrow(
    paymentRequiredSchema,
    {
      x402Version: 2,
      resource: input.resource,
      accepts: input.accepts,
      ...(input.error === undefined ? {} : { error: input.error }),
    },
    PAYMENT_REQUIRED_HEADER,
  );
}

/** Binding of an LPA-delivering purchase to the buyer's session key (T-32): the EIP-3009 nonce IS keccak256(sessionPubKey). */
export function sessionNonce(sessionPubKey: Hex, keccak256: (bytes: Uint8Array) => Hex): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(sessionPubKey)) {
    throw new RechargeError('invalid_request', 'sessionPubKey must be 32 bytes of hex');
  }
  return keccak256(hexBytes(sessionPubKey)).toLowerCase() as Hex;
}

export interface PaymentSigner {
  /** Choose the accepts[] entry this wallet can pay, or undefined to give up. Must check network/asset/payTo against its own allow-list (T-56). */
  choose(accepts: PaymentRequirements[]): PaymentRequirements | undefined;
  /** Produce the PAYMENT-SIGNATURE body for the chosen entry. `nonce` is the required EIP-3009 nonce when the route binds a session key. */
  sign(
    req: PaymentRequirements,
    ctx: { resource: PaymentResource; nonce?: Hex; now: number },
  ): Promise<PaymentPayload>;
}

export interface FetchWithPaymentResult {
  response: Response;
  required?: PaymentRequired;
  paid?: PaymentPayload;
  settlement?: SettleResult;
}

export interface FetchWithPaymentInput {
  fetch: typeof fetch;
  url: string;
  /** The body must be replayable (a string or undefined): the same init is sent twice. */
  init?: RequestInit;
  signer: PaymentSigner;
  now: () => number;
  sessionPubKey?: Hex;
  keccak256?: (bytes: Uint8Array) => Hex;
  /** Per request; default 30 s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * GET/POST once; on 402 decode PAYMENT-REQUIRED, let the signer choose and sign, retry once with
 * PAYMENT-SIGNATURE; never signs twice for one call. The second response's PAYMENT-RESPONSE is surfaced as
 * `settlement`. When `sessionPubKey` is given it is sent as X-Session-Pubkey and the signed EIP-3009 nonce
 * must equal `sessionNonce(sessionPubKey)`.
 */
export async function fetchWithPayment(
  input: FetchWithPaymentInput,
): Promise<FetchWithPaymentResult> {
  const { url, signer, sessionPubKey } = input;
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // Call the injected fetch unbound from `input`: browsers throw "Illegal invocation" on `obj.fetch()`.
  const send = (headers: Headers): Promise<Response> => {
    const signals = [
      AbortSignal.timeout(timeoutMs),
      ...(input.init?.signal ? [input.init.signal] : []),
    ];
    return input.fetch.call(globalThis, url, {
      ...input.init,
      headers,
      signal: AbortSignal.any(signals),
    });
  };
  const baseHeaders = (): Headers => {
    const headers = new Headers(input.init?.headers);
    if (sessionPubKey !== undefined) headers.set(SESSION_PUBKEY_HEADER, sessionPubKey);
    return headers;
  };

  const first = await send(baseHeaders());
  if (first.status !== 402) return { response: first };

  const header = first.headers.get(PAYMENT_REQUIRED_HEADER);
  if (header === null) {
    throw new RechargeError('invalid_request', `402 without a ${PAYMENT_REQUIRED_HEADER} header`, {
      reason: 'missing_header',
    });
  }
  const required = decodePaymentRequired(header);
  const chosen = signer.choose(required.accepts);
  if (chosen === undefined) return { response: first, required };

  let nonce: Hex | undefined;
  if (sessionPubKey !== undefined) {
    if (input.keccak256 === undefined) {
      throw new RechargeError('invalid_request', 'sessionPubKey requires keccak256');
    }
    nonce = sessionNonce(sessionPubKey, input.keccak256);
  }
  const paid = await signer.sign(chosen, {
    resource: required.resource,
    now: input.now(),
    ...(nonce === undefined ? {} : { nonce }),
  });
  if (
    nonce !== undefined &&
    !(isEvmExact(paid.payload) && paid.payload.authorization.nonce.toLowerCase() === nonce)
  ) {
    throw new RechargeError('invalid_payment', 'signed nonce is not the session nonce (T-32)');
  }

  const headers = baseHeaders();
  headers.set(PAYMENT_SIGNATURE_HEADER, encodePaymentPayload(paid));
  const response = await send(headers);
  const responseHeader = response.headers.get(PAYMENT_RESPONSE_HEADER);
  return {
    response,
    required,
    paid,
    ...(responseHeader === null ? {} : { settlement: decodePaymentResponse(responseHeader) }),
  };
}
