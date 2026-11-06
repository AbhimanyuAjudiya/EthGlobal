import { proto } from '@hiero-ledger/proto';
import { recoverTypedDataAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { keccak256 } from '@ethglobal/crypto';
import {
  typedDataTransferWithAuthorization,
  domainFromRequirements,
  fromPaymentAuthorization,
} from '@ethglobal/eip3009';
import type { PaymentRequirements } from '@ethglobal/protocol/schemas';
import {
  encodePaymentRequired,
  encodePaymentResponse,
  fetchWithPayment,
  PAYMENT_SIGNATURE_HEADER,
  decodePaymentPayload,
  sessionNonce,
} from '@ethglobal/protocol/x402';

import { ApiError } from '../lib/api';
import { HashPackPaySigner, hashPackSigner } from '../lib/hedera-wc';
import { EvmWalletSigner, hederaTerms, paymentFailureReason } from '../lib/pay402';

import type { Wallet } from '../lib/wallet';

// a throwaway key generated for this test file only (not an Anvil key)
const account = privateKeyToAccount(
  '0x4c0883a69102937d6231471b5dbb6204fe5129617082792ae468d01a3f362318',
);
const PAY_TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8';

const req = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  scheme: 'exact',
  network: 'eip155:31337',
  asset: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  amount: '400000',
  payTo: PAY_TO,
  maxTimeoutSeconds: 300,
  extra: { name: 'USD Coin', version: '2' },
  ...over,
});

const wallet = (network = 'eip155:31337'): Wallet =>
  ({
    kind: 'demo',
    name: 'demo wallet · Anvil #5',
    address: account.address,
    chainId: 31337,
    network,
    signTypedData: (td) => account.signTypedData(td),
    sendTransaction: () => Promise.reject(new Error('unused')),
    reader: {} as Wallet['reader'],
  }) satisfies Wallet;

const allow = [{ network: 'eip155:31337', asset: req().asset, payTo: PAY_TO }];

describe('pay402 — the PaymentSigner implementations over the ONE loop (fetchWithPayment)', () => {
  it('chooses only an accepts[] entry on the wallet’s network that matches the advertised allow-list (T-56)', () => {
    const s = new EvmWalletSigner(wallet(), 'eip155:31337', allow);
    expect(s.choose([req()])).toEqual(req());
    expect(
      s.choose([req({ payTo: '0x000000000000000000000000000000000000dEaD' })]),
    ).toBeUndefined();
    expect(
      s.choose([req({ network: 'eip155:84532', extra: { name: 'USDC', version: '2' } })]),
    ).toBeUndefined();
    expect(
      new EvmWalletSigner(wallet('eip155:84532'), 'eip155:31337', allow).choose([req()]),
    ).toBeUndefined();
  });

  it('signs EIP-3009 with the domain from accepts[].extra, validBefore = now + maxTimeoutSeconds, the session nonce', async () => {
    const s = new EvmWalletSigner(wallet(), 'eip155:31337', allow);
    const spk: Hex = `0x${'11'.repeat(32)}`;
    const nonce = sessionNonce(spk, keccak256);
    const paid = await s.sign(req(), {
      resource: { url: 'http://x/esim/provision' } as never,
      nonce,
      now: 1_000_000,
    });
    const auth = (paid.payload as { authorization: Record<string, string>; signature: Hex })
      .authorization;
    expect(auth).toMatchObject({
      from: account.address,
      to: PAY_TO,
      value: '400000',
      validAfter: '0',
      validBefore: String(1000 + 300),
      nonce,
    });
    for (const extra of [
      { name: 'USD Coin', version: '2' },
      { name: 'USDC', version: '2' },
    ]) {
      const r = req({ extra });
      const signed = await s.sign(r, { resource: {} as never, now: 0 });
      const p = signed.payload as {
        authorization: Parameters<typeof fromPaymentAuthorization>[0];
        signature: Hex;
      };
      const signer = await recoverTypedDataAddress({
        ...typedDataTransferWithAuthorization(
          domainFromRequirements(r),
          fromPaymentAuthorization(p.authorization),
        ),
        signature: p.signature,
      });
      expect(signer).toBe(account.address);
    }
  });

  it('the local test hook signs one base unit short (the wrong-amount e2e)', async () => {
    const s = new EvmWalletSigner(wallet(), 'eip155:31337', allow, { tamperAmount: true });
    const paid = await s.sign(req(), { resource: {} as never, now: 0 });
    expect((paid.payload as { authorization: { value: string } }).authorization.value).toBe(
      '399999',
    );
  });

  it('runs inside fetchWithPayment: 402 → onSigning → retry with PAYMENT-SIGNATURE → 200 + settlement', async () => {
    const onSigning = vi.fn();
    const s = new EvmWalletSigner(wallet(), 'eip155:31337', allow, { onSigning });
    const required = encodePaymentRequired({
      x402Version: 2,
      resource: {
        url: 'http://api/esim/topup',
        description: 'Recharge top-up',
        mimeType: 'application/json',
      },
      accepts: [req()],
    });
    const settlement = encodePaymentResponse({
      success: true,
      transaction: `0x${'ab'.repeat(32)}`,
      network: 'eip155:31337',
      payer: account.address,
    });
    const calls: Headers[] = [];
    const fake = vi.fn((_url: string, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push(headers);
      return Promise.resolve(
        headers.has(PAYMENT_SIGNATURE_HEADER)
          ? new Response('{}', { status: 200, headers: { 'PAYMENT-RESPONSE': settlement } })
          : new Response('{}', { status: 402, headers: { 'PAYMENT-REQUIRED': required } }),
      );
    });
    const out = await fetchWithPayment({
      fetch: fake as unknown as typeof fetch,
      url: 'http://api/esim/topup',
      signer: s,
      now: () => 0,
    });
    expect(out.response.status).toBe(200);
    expect(out.settlement).toMatchObject({ success: true });
    expect(onSigning).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(2);
    expect(decodePaymentPayload(calls[1]?.get(PAYMENT_SIGNATURE_HEADER) ?? '').accepted).toEqual(
      req(),
    );
  });

  it('Hedera terms are shown exactly, capped at 180 s', () => {
    const r = req({
      network: 'hedera:testnet',
      asset: '0.0.429274',
      payTo: '0.0.1234',
      maxTimeoutSeconds: 180,
      extra: { feePayer: '0.0.9185802' },
    });
    expect(hederaTerms(r)).toEqual({
      network: 'hedera:testnet',
      asset: '0.0.429274',
      amount: '400000',
      payTo: '0.0.1234',
      feePayer: '0.0.9185802',
      validForS: 180,
    });
  });

  it('decodes failures into plain words, never "Something went wrong"', () => {
    expect(
      paymentFailureReason(
        new ApiError(402, 'invalid_payment', 'x', { reason: 'authorization expired' }),
      ),
    ).toBe('the facilitator rejected the signature (expired)');
    expect(
      paymentFailureReason(
        new ApiError(402, 'invalid_payment', 'x', {
          reason: 'invalid_exact_evm_payload_authorization_value',
        }),
      ),
    ).toBe('the signed amount did not match the price');
    expect(paymentFailureReason(new ApiError(429, 'daily_cap', 'x'))).toBe(
      'the daily top-up limit for this plan is reached',
    );
    expect(paymentFailureReason(undefined)).toBe('the payment was not accepted');
  });
});

describe('signed payment recovery', () => {
  it('retains independent recovery tokens when two operations are signed concurrently', async () => {
    const { pay, quote, completePayment } = await import('../lib/pay402');
    const { config } = await import('../lib/env');
    const operation = (name: string) => ({
      url: `${config.apiUrl}/gift`,
      init: {
        method: 'POST',
        body: JSON.stringify({ name, mb: 1000 }),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      },
      required: {
        x402Version: 2 as const,
        resource: {
          url: `${config.apiUrl}/gift`,
          description: 'gift',
          mimeType: 'application/json',
        },
        accepts: [req()],
      },
    });
    const first = operation('first.eth');
    const second = operation('second.eth');
    const fetcher: typeof fetch = async (_input, init) => {
      if (new Headers(init?.headers).has(PAYMENT_SIGNATURE_HEADER))
        throw new TypeError('Response lost');
      return new Response('{}', {
        status: 402,
        headers: { 'PAYMENT-REQUIRED': encodePaymentRequired(first.required) },
      });
    };
    try {
      const results = await Promise.all(
        [first, second].map((q) =>
          pay(
            q,
            new EvmWalletSigner(wallet(), 'eip155:31337', allow),
            undefined,
            Date.now(),
            fetcher,
          ),
        ),
      );
      expect(results.every((result) => result.uncertain)).toBe(true);
      const recoveredFirst = await quote('/gift', {
        method: 'POST',
        body: { name: 'first.eth', mb: 1000 },
      });
      const recoveredSecond = await quote('/gift', {
        method: 'POST',
        body: { name: 'second.eth', mb: 1000 },
      });
      expect(new Headers(recoveredFirst.init.headers).get('Idempotency-Key')).toBe(
        first.init.headers['Idempotency-Key'],
      );
      expect(new Headers(recoveredSecond.init.headers).get('Idempotency-Key')).toBe(
        second.init.headers['Idempotency-Key'],
      );
      await completePayment(first);
      expect(
        (await quote('/gift', { method: 'POST', body: { name: 'second.eth', mb: 1000 } })).recovery,
      ).toBe(true);
    } finally {
      await completePayment(first);
      await completePayment(second);
    }
  });

  it('replays the exact signed authorization and private idempotency key after a lost response', async () => {
    const { pay, quote, completePayment } = await import('../lib/pay402');
    const { config } = await import('../lib/env');
    const q = {
      url: `${config.apiUrl}/gift`,
      init: {
        method: 'POST',
        body: JSON.stringify({ name: 'recovery.eth', mb: 1000 }),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      },
      required: {
        x402Version: 2 as const,
        resource: {
          url: `${config.apiUrl}/gift`,
          description: 'gift',
          mimeType: 'application/json',
        },
        accepts: [req()],
      },
    };
    const signer = new EvmWalletSigner(wallet(), 'eip155:31337', allow);
    const sign = vi.spyOn(signer, 'sign');
    const requests: RequestInit[] = [];
    let paidAttempts = 0;
    const fetch = vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(init!);
      if (!new Headers(init?.headers).has(PAYMENT_SIGNATURE_HEADER))
        return new Response('{}', {
          status: 402,
          headers: { 'PAYMENT-REQUIRED': encodePaymentRequired(q.required) },
        });
      paidAttempts++;
      if (paidAttempts === 1) throw new TypeError('connection lost after settlement');
      return new Response(JSON.stringify({ giftId: 'same-gift' }), {
        status: 201,
        headers: {
          'PAYMENT-RESPONSE': encodePaymentResponse({
            success: true,
            transaction: `0x${'ab'.repeat(32)}`,
            network: 'eip155:31337',
            payer: account.address,
          }),
        },
      });
    });
    vi.stubGlobal('fetch', fetch);
    try {
      expect((await pay(q, signer)).uncertain).toBe(true);
      const restored = await quote('/gift', {
        method: 'POST',
        body: { name: 'recovery.eth', mb: 1000 },
      });
      const result = await pay<{ giftId: string }>(restored, signer);
      expect(result.data?.giftId).toBe('same-gift');
      expect(sign).toHaveBeenCalledTimes(1);
      expect(new Headers(requests[1]!.headers).get(PAYMENT_SIGNATURE_HEADER)).toBe(
        new Headers(requests[2]!.headers).get(PAYMENT_SIGNATURE_HEADER),
      );
      expect(new Headers(requests[2]!.headers).get('Idempotency-Key')).toBe(
        new Headers(q.init.headers).get('Idempotency-Key'),
      );
      await completePayment(q);
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it('preserves a native purchase memo, original activation session, and exact transfer across response loss', async () => {
    const { pay, quote, completePayment } = await import('../lib/pay402');
    const { config } = await import('../lib/env');
    const spk: Hex = `0x${'61'.repeat(32)}`;
    const bound = req({
      network: 'hedera:testnet',
      asset: '0.0.429274',
      payTo: '0.0.5005',
      maxTimeoutSeconds: 180,
      extra: {
        feePayer: '0.0.9185802',
        sessionKeyRequired: true,
        sessionBinding: 'hedera-memo-v1',
      },
    });
    const q = {
      url: `${config.apiUrl}/esim/provision`,
      spk,
      init: {
        method: 'POST',
        body: JSON.stringify({ mb: 1000 }),
        headers: { 'Idempotency-Key': crypto.randomUUID() },
      },
      required: {
        x402Version: 2 as const,
        resource: {
          url: `${config.apiUrl}/esim/provision`,
          description: 'new plan',
          mimeType: 'application/json',
        },
        accepts: [bound],
      },
    };
    const nativeWallet = vi.fn(async () => ({
      signatureMap: Buffer.from(
        proto.SignatureMap.encode({ sigPair: [{ ed25519: new Uint8Array(64) }] }).finish(),
      ).toString('base64'),
    }));
    const signer = new HashPackPaySigner(
      hashPackSigner(
        { topic: 'native', chain: 'hedera:testnet', accountId: '0.0.7001' },
        nativeWallet,
      ),
      'hedera:testnet',
      [bound],
    );
    const attempts: Headers[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      if (!headers.has(PAYMENT_SIGNATURE_HEADER))
        return new Response('{}', {
          status: 402,
          headers: { 'PAYMENT-REQUIRED': encodePaymentRequired(q.required) },
        });
      attempts.push(headers);
      if (attempts.length === 1) throw new TypeError('lost native settlement response');
      return new Response(JSON.stringify({ entitlementKey: 'native-plan' }), {
        status: 201,
        headers: {
          'PAYMENT-RESPONSE': encodePaymentResponse({
            success: true,
            transaction: '0.0.9185802@1790000000.000000001',
            network: 'hedera:testnet',
            payer: '0.0.7001',
          }),
        },
      });
    };
    vi.stubGlobal('fetch', fetcher);
    try {
      expect((await pay(q, signer, spk)).uncertain).toBe(true);
      const restored = await quote('/esim/provision', {
        method: 'POST',
        body: { mb: 1000 },
        sessionPubKey: `0x${'62'.repeat(32)}`,
      });
      expect(restored.spk).toBe(spk);
      expect(
        (await pay<{ entitlementKey: string }>(restored, signer, restored.spk)).data
          ?.entitlementKey,
      ).toBe('native-plan');
      expect(nativeWallet).toHaveBeenCalledTimes(1);
      expect(attempts[0]!.get(PAYMENT_SIGNATURE_HEADER)).toBe(
        attempts[1]!.get(PAYMENT_SIGNATURE_HEADER),
      );
      expect(attempts[1]!.get('X-Session-Pubkey')).toBe(spk);
      expect(attempts[1]!.get('Idempotency-Key')).toBe(q.init.headers['Idempotency-Key']);
      expect(
        signer.sessionBinding(decodePaymentPayload(attempts[1]!.get(PAYMENT_SIGNATURE_HEADER)!)),
      ).toBe(sessionNonce(spk, keccak256));
    } finally {
      await completePayment(q);
      vi.unstubAllGlobals();
    }
  });
  it('preserves a successful settlement even when fulfilment returns an HTTP error', async () => {
    const { pay, completePayment } = await import('../lib/pay402');
    const q = {
      url: 'http://api/paid-error',
      init: {},
      required: {
        x402Version: 2 as const,
        resource: {
          url: 'http://api/paid-error',
          description: 'topup',
          mimeType: 'application/json',
        },
        accepts: [req()],
      },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init?: RequestInit) =>
        new Headers(init?.headers).has(PAYMENT_SIGNATURE_HEADER)
          ? new Response(
              JSON.stringify({
                error: 'internal_error',
                message: 'provider unavailable',
                requestId: 'request-test',
              }),
              {
                status: 503,
                headers: {
                  'PAYMENT-RESPONSE': encodePaymentResponse({
                    success: true,
                    transaction: `0x${'ab'.repeat(32)}`,
                    network: 'eip155:31337',
                    payer: account.address,
                  }),
                },
              },
            )
          : new Response('{}', {
              status: 402,
              headers: { 'PAYMENT-REQUIRED': encodePaymentRequired(q.required) },
            }),
      ),
    );
    try {
      const result = await pay(q, new EvmWalletSigner(wallet(), 'eip155:31337', allow));
      expect(result.settlement?.success).toBe(true);
      expect(result.uncertain).toBe(true);
    } finally {
      await completePayment(q);
      vi.unstubAllGlobals();
    }
  });
});
