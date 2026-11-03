/** Package-private helpers (not exported from any subpath). Browser-safe: no Node built-ins. */
import { RechargeError } from './errors.js';

import type { Hex } from './ids.js';
import type { z } from 'zod';

const encoder = new TextEncoder();
const fatalDecoder = new TextDecoder('utf-8', { fatal: true });

export const utf8Bytes = (s: string): Uint8Array => encoder.encode(s);
export const utf8Length = (s: string): number => encoder.encode(s).length;

/** Strict UTF-8 decode; throws on malformed input. */
export const utf8Decode = (bytes: Uint8Array): string => fatalDecoder.decode(bytes);

/** Parses `value` with `schema`, throwing RechargeError('invalid_request') with the zod issues as details. */
export function parseOrThrow<S extends z.ZodType>(schema: S, value: unknown, label: string): z.output<S> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new RechargeError('invalid_request', `invalid ${label}`, {
      reason: 'schema',
      issues: parsed.error.issues,
    });
  }
  return parsed.data;
}

/** JSON.parse then parseOrThrow; malformed JSON is RechargeError('invalid_request', reason 'json'). */
export function parseJsonOrThrow<S extends z.ZodType>(schema: S, text: string, label: string): z.output<S> {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RechargeError('invalid_request', `${label} is not JSON`, { reason: 'json' });
  }
  return parseOrThrow(schema, json, label);
}

/** `0x`-hex → bytes (even length, hex digits only); used only where protocol must hash an id. */
export function hexBytes(hex: Hex): Uint8Array {
  const body = hex.slice(2);
  if (!/^0x([0-9a-fA-F]{2})*$/.test(hex)) {
    throw new RechargeError('invalid_request', 'not an even-length 0x hex string');
  }
  const out = new Uint8Array(body.length / 2);
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(body.slice(i * 2, i * 2 + 2), 16);
  return out;
}
