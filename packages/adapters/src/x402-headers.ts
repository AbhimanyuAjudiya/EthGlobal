import type { PaymentPayload, PaymentRequired } from './types.js';

/** Header names of the x402 v2 flow. */
export const PAYMENT_REQUIRED_HEADER = 'PAYMENT-REQUIRED';
export const PAYMENT_SIGNATURE_HEADER = 'PAYMENT-SIGNATURE';
export const PAYMENT_RESPONSE_HEADER = 'PAYMENT-RESPONSE';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64(value: unknown): string {
  const bytes = encoder.encode(JSON.stringify(value));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64<T>(header: string): T {
  const bytes = Uint8Array.from(atob(header), (char) => char.charCodeAt(0));
  return JSON.parse(decoder.decode(bytes)) as T;
}

export const encodePaymentRequired = (value: PaymentRequired): string => toBase64(value);
export const decodePaymentRequired = (header: string): PaymentRequired => fromBase64(header);
export const encodePaymentPayload = (value: PaymentPayload): string => toBase64(value);
export const decodePaymentPayload = (header: string): PaymentPayload => fromBase64(header);
