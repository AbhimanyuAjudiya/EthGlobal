import { createMiddleware } from 'hono/factory';

import type { Hex } from '@ethglobal/protocol/ids';
import { hex32Schema, type PaymentRequired, type SettleResult } from '@ethglobal/protocol/schemas';
import {
  decodePaymentPayload,
  encodePaymentRequired,
  encodePaymentResponse,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  SESSION_PUBKEY_HEADER,
} from '@ethglobal/protocol/x402';

import { fail } from '../errors.js';

import type { AppEnv, Ctx } from '../context.js';

/** The v1 amount key (A-18), as a pattern so the v1 name never appears as a literal in app code. */
const V1_AMOUNT = /^maxAmount(?:Required)$/;

/**
 * True when any object in the decoded payload has the v1 amount as an OWN key (RT-A-07). It runs on the parsed
 * JSON, so a `\u0052`-escaped spelling is the same key; depth is bounded by the codec's 16 KiB cap.
 */
function hasV1Field(value: unknown, depth = 0): boolean {
  if (depth > 32 || value === null || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, item]) => V1_AMOUNT.test(key) || hasV1Field(item, depth + 1),
  );
}

/**
 * x402 v2 only (A-18): `PAYMENT-SIGNATURE` is decoded ONCE here (16 KiB cap and schema in the codec; malformed ⇒
 * 400) and handed down as `c.var.payment`; a v1 payment header is ignored; a v1 field anywhere is a 400. `X-Session-Pubkey` must be hex32.
 */
export const x402 = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header(PAYMENT_SIGNATURE_HEADER);
  const payment = header === undefined ? undefined : decodePaymentPayload(header);
  // the codec's zod parse strips unknown keys; a v1 amount field is refused outright, not silently dropped (A-18).
  // The codec already proved the header is base64 JSON; the check runs on the parsed structure, not the bytes.
  if (
    header !== undefined &&
    hasV1Field(JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as unknown)
  ) {
    throw fail('invalid_request', { detail: 'x402 v1 field in PAYMENT-SIGNATURE' });
  }
  c.set('payment', payment);
  const spk = c.req.header(SESSION_PUBKEY_HEADER);
  if (spk !== undefined && !hex32Schema.safeParse(spk).success)
    throw fail('invalid_request', { header: SESSION_PUBKEY_HEADER });
  c.set('sessionPubKey', spk === undefined ? undefined : (spk.toLowerCase() as Hex));
  return next();
});

/** 402 with the body AND `PAYMENT-REQUIRED: base64(body)`; nothing has been written. */
export function paymentRequiredResponse(c: Ctx, body: PaymentRequired): Response {
  c.get('deps').metrics.inc('payment_required_total');
  return c.json(body, 402, { [PAYMENT_REQUIRED_HEADER]: encodePaymentRequired(body) });
}

/** Adds `PAYMENT-RESPONSE` (the settlement) to a paid success. */
export function withPaymentResponse(c: Ctx, settlement: SettleResult): void {
  c.header(PAYMENT_RESPONSE_HEADER, encodePaymentResponse(settlement));
}
