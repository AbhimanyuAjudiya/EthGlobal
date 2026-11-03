import fc from 'fast-check';
import { keccak256 } from 'viem';
import { describe, expect, it } from 'vitest';

import { example, expectRecharge } from './helpers.js';
import {
  decodePaymentPayload,
  decodePaymentRequired,
  decodePaymentResponse,
  encodePaymentPayload,
  encodePaymentRequired,
  encodePaymentResponse,
  fetchWithPayment,
  MAX_X402_HEADER_BYTES,
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  paymentRequired,
  SESSION_PUBKEY_HEADER,
  sessionNonce,
  type PaymentSigner,
} from '../src/x402.js';

import type {
  EvmExactPayload,
  PaymentPayload,
  PaymentRequired,
  SettleResult,
} from '../src/schemas/index.js';

const required = example<PaymentRequired>('paymentRequiredSchema');
const requiredHedera = example<PaymentRequired>('paymentRequired.hedera');
const payload = example<PaymentPayload>('paymentPayloadSchema');
const payloadHedera = example<PaymentPayload>('paymentPayload.hedera');
const settled = example<SettleResult>('settleResultSchema');
const failed = example<SettleResult>('paymentResponseSchema');
const settledHedera = example<SettleResult>('settle.hedera');
const b64 = (text: string): string => btoa(String.fromCharCode(...new TextEncoder().encode(text)));

const codecs = [
  ['PAYMENT-REQUIRED', encodePaymentRequired, decodePaymentRequired, [required, requiredHedera]],
  ['PAYMENT-SIGNATURE', encodePaymentPayload, decodePaymentPayload, [payload, payloadHedera]],
  [
    'PAYMENT-RESPONSE',
    encodePaymentResponse,
    decodePaymentResponse,
    [settled, failed, settledHedera],
  ],
] as const;

describe('header codec', () => {
  it.each(codecs)('%s round-trips every fixture', (_name, encode, decode, values) => {
    for (const value of values) {
      const header = (encode as (v: unknown) => string)(value);
      expect(header).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(decode(header)).toEqual(value);
    }
  });

  it('round-trips non-ASCII text (UTF-8 inside base64)', () => {
    const v = { ...required, error: 'भुगतान आवश्यक — payment required' };
    expect(decodePaymentRequired(encodePaymentRequired(v))).toEqual(v);
  });

  it('property: PAYMENT-RESPONSE round-trips arbitrary valid settlements', () => {
    const arb = fc.record({
      success: fc.constant(true as const),
      transaction: fc.stringMatching(/^0x[0-9a-f]{64}$/),
      network: fc.constantFrom('eip155:31337', 'eip155:84532', 'hedera:testnet'),
      payer: fc.stringMatching(/^0x[0-9a-f]{40}$/),
    });
    fc.assert(
      fc.property(arb, (v) => {
        expect(decodePaymentResponse(encodePaymentResponse(v))).toEqual(v);
      }),
    );
  });

  it.each([
    ['not base64', '%%%', 'base64'],
    ['bad padding', 'abc', 'base64'],
    ['empty', '', 'base64'],
    ['not JSON', b64('{"x402Version":2,'), 'json'],
    ['invalid UTF-8', btoa('\xff\xfe'), 'utf8'],
    ['valid JSON, wrong shape', b64('{"x402Version":1}'), 'schema'],
    [
      'v1 maxAmountRequired',
      b64(
        JSON.stringify({
          ...required,
          accepts: [{ ...required.accepts[0], amount: undefined, maxAmountRequired: '1' }],
        }),
      ),
      'schema',
    ],
  ])('decode rejects %s with RechargeError(invalid_request)', (_label, header, reason) => {
    expectRecharge(() => decodePaymentRequired(header), 'invalid_request', reason);
  });

  it('decodePaymentPayload rejects > 16 KiB before decoding', () => {
    expectRecharge(
      () => decodePaymentPayload('A'.repeat(MAX_X402_HEADER_BYTES + 4)),
      'invalid_request',
      'too_large',
    );
  });

  it('decodePaymentPayload rejects a payload whose accepted.payTo mismatches its network', () => {
    const bad = { ...payload, accepted: { ...payload.accepted, payTo: '0.0.5001234' } };
    expectRecharge(
      () => decodePaymentPayload(b64(JSON.stringify(bad))),
      'invalid_request',
      'schema',
    );
  });

  it('encoders validate, so a malformed body is never sent', () => {
    const bad = { ...required, accepts: [] } as PaymentRequired;
    expectRecharge(() => encodePaymentRequired(bad), 'invalid_request', 'schema');
  });

  it('paymentRequired() builds a validated v2 body', () => {
    const accepts = required.accepts;
    expect(paymentRequired({ resource: required.resource, accepts })).toEqual({
      x402Version: 2,
      resource: required.resource,
      accepts,
    });
    expect(paymentRequired({ resource: required.resource, accepts, error: 'x' }).error).toBe('x');
    expectRecharge(
      () => paymentRequired({ resource: required.resource, accepts: [] }),
      'invalid_request',
    );
  });
});

describe('sessionNonce (T-32)', () => {
  const pub = `0x${'5b'.repeat(32)}` as const;
  it('is keccak256 of the key bytes, lower-cased', () => {
    expect(sessionNonce(pub, keccak256)).toBe(keccak256(pub));
    expect(sessionNonce(`0x${'5B'.repeat(32)}`, keccak256)).toBe(keccak256(pub));
  });
  it('rejects anything but 32 bytes', () => {
    expectRecharge(() => sessionNonce('0x5b', keccak256), 'invalid_request');
  });
});

// ── fetchWithPayment

interface Seen {
  url: string;
  headers: Headers;
  self: unknown;
}

const urlOf = (input: string | URL | Request): string =>
  input instanceof Request ? input.url : input.toString();

function server(opts: { settle?: SettleResult; header?: boolean; status?: number } = {}) {
  const seen: Seen[] = [];
  const fn = function (this: unknown, input: string | URL | Request, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    seen.push({ url: urlOf(input), headers, self: this });
    if (opts.status !== undefined)
      return Promise.resolve(new Response('{}', { status: opts.status }));
    if (!headers.has(PAYMENT_SIGNATURE_HEADER)) {
      const h =
        opts.header === false ? {} : { [PAYMENT_REQUIRED_HEADER]: encodePaymentRequired(required) };
      return Promise.resolve(new Response(JSON.stringify(required), { status: 402, headers: h }));
    }
    const out = opts.settle ?? settled;
    const status = out.success ? 200 : 402;
    return Promise.resolve(
      new Response('{"ok":true}', {
        status,
        headers: { [PAYMENT_RESPONSE_HEADER]: encodePaymentResponse(out) },
      }),
    );
  } as typeof fetch;
  return { fn, seen };
}

function signer(overrides: Partial<PaymentSigner> = {}) {
  const calls: { nonce?: string; now: number }[] = [];
  const s: PaymentSigner = {
    choose: (accepts) => accepts.find((a) => a.network === 'eip155:84532'),
    sign: async (req, ctx) => {
      calls.push({ ...(ctx.nonce ? { nonce: ctx.nonce } : {}), now: ctx.now });
      const evm = payload.payload as EvmExactPayload;
      const nonce = ctx.nonce ?? evm.authorization.nonce;
      return {
        ...payload,
        accepted: req,
        payload: { ...evm, authorization: { ...evm.authorization, nonce } },
      };
    },
    ...overrides,
  };
  return { s, calls };
}

const URL_ = 'http://127.0.0.1:8787/esim/provision?mb=300';

describe('fetchWithPayment', () => {
  it('passes a non-402 response straight through without signing', async () => {
    const { fn, seen } = server({ status: 200 });
    const { s, calls } = signer();
    const result = await fetchWithPayment({ fetch: fn, url: URL_, signer: s, now: () => 1 });
    expect(result.response.status).toBe(200);
    expect(result.required).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(seen).toHaveLength(1);
  });

  it('on 402: decodes, signs once, retries once with PAYMENT-SIGNATURE, surfaces PAYMENT-RESPONSE', async () => {
    const { fn, seen } = server();
    const { s, calls } = signer();
    const result = await fetchWithPayment({
      fetch: fn,
      url: URL_,
      signer: s,
      now: () => 42,
      init: { headers: { 'x-request-id': 'r1' } },
    });
    expect(result.response.status).toBe(200);
    expect(result.required).toEqual(required);
    expect(result.settlement).toEqual(settled);
    expect(calls).toEqual([{ now: 42 }]);
    expect(seen).toHaveLength(2);
    expect(decodePaymentPayload(seen[1]?.headers.get(PAYMENT_SIGNATURE_HEADER) ?? '')).toEqual(
      result.paid,
    );
    expect(seen.every((c) => c.headers.get('x-request-id') === 'r1' && c.self === globalThis)).toBe(
      true,
    );
  });

  it('never signs twice, even when the paid retry is refused', async () => {
    const { fn, seen } = server({ settle: failed });
    const { s, calls } = signer();
    const result = await fetchWithPayment({ fetch: fn, url: URL_, signer: s, now: () => 1 });
    expect(result.response.status).toBe(402);
    expect(result.settlement).toEqual(failed);
    expect(calls).toHaveLength(1);
    expect(seen).toHaveLength(2);
  });

  it('gives up without paying when the signer chooses nothing', async () => {
    const { fn, seen } = server();
    const { s, calls } = signer({ choose: () => undefined });
    const result = await fetchWithPayment({ fetch: fn, url: URL_, signer: s, now: () => 1 });
    expect(result).toMatchObject({ required });
    expect(result.paid).toBeUndefined();
    expect(calls).toHaveLength(0);
    expect(seen).toHaveLength(1);
  });

  it('binds the session key: sends X-Session-Pubkey and requires nonce = sessionNonce', async () => {
    const pub = `0x${'5b'.repeat(32)}` as const;
    const { fn, seen } = server();
    const { s, calls } = signer();
    await fetchWithPayment({
      fetch: fn,
      url: URL_,
      signer: s,
      now: () => 1,
      sessionPubKey: pub,
      keccak256,
    });
    expect(calls[0]?.nonce).toBe(keccak256(pub));
    expect(seen.every((c) => c.headers.get(SESSION_PUBKEY_HEADER) === pub)).toBe(true);
  });

  it('refuses a signer that ignores the session nonce, and a session key without keccak256', async () => {
    const pub = `0x${'5b'.repeat(32)}` as const;
    const rogue = signer({ sign: async () => payload });
    await expect(
      fetchWithPayment({
        fetch: server().fn,
        url: URL_,
        signer: rogue.s,
        now: () => 1,
        sessionPubKey: pub,
        keccak256,
      }),
    ).rejects.toMatchObject({ code: 'invalid_payment' });
    await expect(
      fetchWithPayment({
        fetch: server().fn,
        url: URL_,
        signer: signer().s,
        now: () => 1,
        sessionPubKey: pub,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('a 402 without PAYMENT-REQUIRED is a typed error', async () => {
    await expect(
      fetchWithPayment({
        fetch: server({ header: false }).fn,
        url: URL_,
        signer: signer().s,
        now: () => 1,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request', details: { reason: 'missing_header' } });
  });
});
