/**
 * A-19: our x402 codec ⇄ the reference @x402/core 2.29.0, both directions, on every x402 fixture.
 * Run alone with `pnpm --filter @ethglobal/protocol exec vitest run test/conformance`.
 */
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  decodePaymentSignatureHeader,
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from '@x402/core/http';
import { PaymentPayloadV2Schema, PaymentRequiredV2Schema } from '@x402/core/schemas';
import { describe, expect, it } from 'vitest';

import { example } from './helpers.js';
import {
  decodePaymentPayload,
  decodePaymentRequired,
  decodePaymentResponse,
  encodePaymentPayload,
  encodePaymentRequired,
  encodePaymentResponse,
} from '../src/x402.js';

import type { PaymentPayload, PaymentRequired, SettleResult } from '../src/schemas/index.js';

/** Their encoders are typed against their own (wider) types; ours are a structural subset. */
type Theirs<F> = F extends (value: infer V) => string ? V : never;

const kinds = [
  {
    header: 'PAYMENT-REQUIRED',
    fixtures: ['paymentRequiredSchema', 'paymentRequired.hedera'],
    ours: { encode: encodePaymentRequired, decode: decodePaymentRequired },
    theirs: {
      encode: (v: PaymentRequired) =>
        encodePaymentRequiredHeader(v as Theirs<typeof encodePaymentRequiredHeader>),
      decode: decodePaymentRequiredHeader,
    },
    schema: PaymentRequiredV2Schema,
  },
  {
    header: 'PAYMENT-SIGNATURE',
    fixtures: ['paymentPayloadSchema', 'paymentPayload.hedera'],
    ours: { encode: encodePaymentPayload, decode: decodePaymentPayload },
    theirs: {
      encode: (v: PaymentPayload) =>
        encodePaymentSignatureHeader(v as Theirs<typeof encodePaymentSignatureHeader>),
      decode: decodePaymentSignatureHeader,
    },
    schema: PaymentPayloadV2Schema,
  },
  {
    header: 'PAYMENT-RESPONSE',
    fixtures: ['settleResultSchema', 'paymentResponseSchema', 'settle.hedera', 'settle.pending'],
    ours: { encode: encodePaymentResponse, decode: decodePaymentResponse },
    theirs: {
      encode: (v: SettleResult) =>
        encodePaymentResponseHeader(v as Theirs<typeof encodePaymentResponseHeader>),
      decode: decodePaymentResponseHeader,
    },
    schema: undefined,
  },
] as const;

const cases = kinds.flatMap((kind) =>
  kind.fixtures.map((fixture) => [kind.header, fixture, kind] as const),
);

describe('x402 conformance with @x402/core 2.29.0', () => {
  it.each(cases)('%s %s: ours → theirs (and their v2 schema accepts it)', (_h, fixture, kind) => {
    const value = example(fixture);
    const header = (kind.ours.encode as (v: unknown) => string)(value);
    const decoded: unknown = kind.theirs.decode(header);
    expect(decoded).toEqual(value);
    if (kind.schema) expect(kind.schema.safeParse(decoded).error?.issues ?? []).toEqual([]);
  });

  it.each(cases)('%s %s: theirs → ours, byte-identical headers', (_h, fixture, kind) => {
    const value = example(fixture);
    const theirs = (kind.theirs.encode as (v: unknown) => string)(value);
    expect((kind.ours.decode as (h: string) => unknown)(theirs)).toEqual(value);
    expect(theirs).toBe((kind.ours.encode as (v: unknown) => string)(value));
  });
});
