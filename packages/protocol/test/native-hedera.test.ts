import { keccak256 } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { example } from './helpers.js';
import {
  planCancelRequestSchema,
  type PaymentPayload,
  type PaymentRequired,
} from '../src/schemas/index.js';
import { nativeCancelMessage, nativePayerBinding, PLAN_CANCEL_TTL_MS } from '../src/typed-data.js';
import {
  encodePaymentRequired,
  fetchWithPayment,
  hederaSessionMemo,
  parseHederaSessionMemo,
  PAYMENT_REQUIRED_HEADER,
  sessionNonce,
  type PaymentSigner,
} from '../src/x402.js';

import type { Hex } from '../src/ids.js';

const H = (byte: string): Hex => `0x${byte.repeat(32)}`;
const spk = H('12');
const nonce = sessionNonce(spk, keccak256);

describe('native purchase session binding', () => {
  it('encodes exactly 81 ASCII bytes and round-trips the session digest', () => {
    const memo = hederaSessionMemo(nonce);
    expect(new TextEncoder().encode(memo)).toHaveLength(81);
    expect(parseHederaSessionMemo(memo)).toBe(nonce);
    expect(hederaSessionMemo(H('AB'))).toBe(hederaSessionMemo(H('ab')));
  });

  it.each([
    '',
    'recharge:session:abc',
    `recharge:session:${'AB'.repeat(32)}`,
    `${hederaSessionMemo(nonce)}\n`,
    ` ${hederaSessionMemo(nonce)}`,
    hederaSessionMemo(nonce).replace('session', 'refund'),
  ])('rejects ambiguous memo %j', (memo) => {
    expect(parseHederaSessionMemo(memo)).toBeUndefined();
  });

  it('rejects a non-digest before constructing a memo', () => {
    expect(() => hederaSessionMemo('0x12')).toThrow();
  });

  function setup(binding: Hex | undefined, advertised = true) {
    const template = example<PaymentRequired>('paymentRequired.hedera');
    const offer = {
      ...template.accepts[0]!,
      extra: {
        ...template.accepts[0]!.extra,
        sessionKeyRequired: true,
        ...(advertised ? { sessionBinding: 'hedera-memo-v1' } : {}),
      },
    };
    const required = { ...template, accepts: [offer] };
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: offer,
      payload: { transaction: 'AAAA' },
    };
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response('{}', {
          status: 402,
          headers: { [PAYMENT_REQUIRED_HEADER]: encodePaymentRequired(required) },
        }),
      )
      .mockResolvedValueOnce(new Response('{}', { status: 200 }));
    const decode = vi.fn(() => binding);
    const sign = vi.fn<PaymentSigner['sign']>(async (_req, ctx) => {
      expect(ctx.nonce).toBe(nonce);
      return payload;
    });
    const signer: PaymentSigner = { choose: (offers) => offers[0], sign, sessionBinding: decode };
    return { fetchMock, signer, decode, payload };
  }

  it('submits a native LPA payment only after decoding its signed binding', async () => {
    const t = setup(nonce);
    const result = await fetchWithPayment({
      fetch: t.fetchMock,
      url: 'https://recharge.test/esim/provision',
      signer: t.signer,
      sessionPubKey: spk,
      keccak256,
      now: () => 123,
    });
    expect(result.response.status).toBe(200);
    expect(t.decode).toHaveBeenCalledWith(t.payload);
    expect(t.fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([undefined, H('34')])(
    'never submits an unbound or substituted native payment (%s)',
    async (binding) => {
      const t = setup(binding);
      await expect(
        fetchWithPayment({
          fetch: t.fetchMock,
          url: 'https://recharge.test/esim/provision',
          signer: t.signer,
          sessionPubKey: spk,
          keccak256,
          now: () => 123,
        }),
      ).rejects.toThrow('does not bind');
      expect(t.fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('fails closed with an old signer or an API that has not advertised native binding', async () => {
    for (const advertised of [true, false]) {
      const t = setup(nonce, advertised);
      if (advertised) delete t.signer.sessionBinding;
      await expect(
        fetchWithPayment({
          fetch: t.fetchMock,
          url: 'https://recharge.test/esim/provision',
          signer: t.signer,
          sessionPubKey: spk,
          keccak256,
          now: () => 123,
        }),
      ).rejects.toThrow('does not bind');
      expect(t.fetchMock).toHaveBeenCalledTimes(1);
    }
  });
});

describe('native cancellation authentication', () => {
  const input = {
    network: 'hedera:testnet' as const,
    payer: '0.0.11334666',
    entitlementHash: H('ab'),
    nonce: H('cd'),
    issuedAt: 1_793_947_200_000,
  };

  it('binds action, audience, network, payer, plan hash, fresh nonce and expiry without exposing a plan capability', () => {
    const message = nativeCancelMessage(input);
    expect(message).toContain('Audience: recharge\nAction: /plan/cancel');
    expect(message).toContain(`Expires at (ms): ${input.issuedAt + PLAN_CANCEL_TTL_MS}`);
    expect(message).not.toContain('paid:');
    for (const changed of [
      { network: 'hedera:mainnet' as const },
      { payer: '0.0.123' },
      { entitlementHash: H('ee') },
      { nonce: H('ff') },
      { issuedAt: input.issuedAt + 1 },
    ])
      expect(nativeCancelMessage({ ...input, ...changed })).not.toBe(message);
    expect(nativePayerBinding('hedera:mainnet', input.payer)).not.toBe(
      nativePayerBinding(input.network, input.payer),
    );
  });

  it.each(['0.0.0', '0.0.0123', '0.0.123\nAction: other', '0x123', '1.0.123'])(
    'rejects non-canonical payer %j',
    (payer) => {
      expect(() => nativeCancelMessage({ ...input, payer })).toThrow();
      expect(() => nativePayerBinding(input.network, payer)).toThrow();
    },
  );

  it('keeps legacy EVM requests and validates bounded native signatures without downgrading authentication', () => {
    const legacy = example<Record<string, unknown>>('planCancelRequestSchema');
    expect(planCancelRequestSchema.safeParse(legacy).success).toBe(true);
    const native = {
      ...legacy,
      authKind: 'hedera',
      payer: input.payer,
      network: input.network,
      signatureMap: 'AAAA',
    };
    expect(planCancelRequestSchema.parse(native)).not.toHaveProperty('signature');
    for (const changed of [
      { network: 'eip155:296' },
      { payer: '0.0.001' },
      { signatureMap: 'not base64' },
      { signatureMap: 'A'.repeat(8196) },
      { authKind: 'evm' },
      { payer: legacy.payer },
    ])
      expect(planCancelRequestSchema.safeParse({ ...native, ...changed }).success).toBe(false);
  });
});
