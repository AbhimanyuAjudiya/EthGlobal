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
