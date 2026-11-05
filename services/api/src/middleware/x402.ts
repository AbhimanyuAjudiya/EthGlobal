import { createMiddleware } from 'hono/factory';

import { sha256Hex } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import {
  hex32Schema,
  isEvmExact,
  type PaymentRequired,
  type SettleResult,
} from '@ethglobal/protocol/schemas';
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
const V1_AMOUNT = /^maxamount(?:required)$/;

/** No legitimate v2 payment nests deeper than 4; anything beyond 16 levels is refused outright (RT-A-07). */
export const MAX_PAYMENT_JSON_DEPTH = 16;

/**
 * A key as the filter compares it: NFKC (full-width / compatibility forms fold), format characters (zero-width
 * joiners, BOMs, soft hyphens) removed, lower-cased. JSON.parse has already undone `\u` escapes.
 */
const normalizedKey = (key: string): string =>
  key
    .normalize('NFKC')
    .replace(/\p{Cf}/gu, '')
    .toLowerCase();

/**
 * Walks the WHOLE parsed header iteratively (no recursion, no silent depth cut-off; RT-A-07 variant): a container
 * deeper than MAX_PAYMENT_JSON_DEPTH ⇒ 'too_deep', any object with the v1 amount as an OWN key after normalisation
 * ⇒ 'v1_field'. Work is bounded by the codec's 16 KiB cap.
 */
export function paymentJsonViolation(root: unknown): 'too_deep' | 'v1_field' | undefined {
  const stack: [unknown, number][] = [[root, 1]];
  while (stack.length > 0) {
    const [value, depth] = stack.pop()!;
    if (value === null || typeof value !== 'object') continue;
    if (depth > MAX_PAYMENT_JSON_DEPTH) return 'too_deep';
    for (const [key, item] of Object.entries(value)) {
      if (V1_AMOUNT.test(normalizedKey(key))) return 'v1_field';
      stack.push([item, depth + 1]);
    }
  }
  return undefined;
}

/**
 * x402 v2 only (A-18): `PAYMENT-SIGNATURE` is decoded ONCE here (16 KiB cap and schema in the codec; malformed ⇒
 * 400) and handed down as `c.var.payment`; a v1 payment header is ignored; a v1 field anywhere (after key normalisation)
 * or JSON deeper than 16 levels is a 400. `X-Session-Pubkey` must be hex32.
 */
export const x402 = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header(PAYMENT_SIGNATURE_HEADER);
  const payment = header === undefined ? undefined : decodePaymentPayload(header);
  // the codec's zod parse strips unknown keys; a v1 amount field is refused outright, not silently dropped (A-18).
  // The codec already proved the header is base64 JSON within 16 KiB; the checks run on the parsed structure.
  if (header !== undefined) {
    const violation = paymentJsonViolation(
      JSON.parse(Buffer.from(header, 'base64').toString('utf8')) as unknown,
    );
    if (violation === 'too_deep')
      throw fail('invalid_request', { detail: 'PAYMENT-SIGNATURE nested too deep' });
    if (violation === 'v1_field')
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

/**
 * The 32-byte nonce a settled payment keys its fulfilment by (the top-up's reseller idempotency key, the gift's
 * giftId): the EIP-3009 nonce of an EVM exact payment; for the Hedera exact scheme (`{ transaction }`, no nonce)
 * sha256 of the settled transaction id, which is unique per on-chain payment. Replay is octroi's job either way:
 * its settlement marker serves one transaction once (RT-O-05), so a repeated Hedera transaction never reaches here.
 */
export function paymentNonce(c: Ctx, settlement: { transaction: string }): Hex {
  const payment = c.get('payment');
  return payment !== undefined && isEvmExact(payment.payload)
    ? (payment.payload.authorization.nonce as Hex)
    : sha256Hex(settlement.transaction);
}
