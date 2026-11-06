import { describe, expect, it, vi } from 'vitest';

import { AdapterError } from '@ethglobal/adapters';
import {
  bytesToHex,
  generateSessionKeypair,
  keccak256,
  lpaAad,
  openLpa,
  sha256Hex,
  type SealedBox,
} from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import type {
  EntitledResponse,
  PaymentPayload,
  PlanCancelResponse,
} from '@ethglobal/protocol/schemas';
import { nativeCancelMessage, nativePayerBinding } from '@ethglobal/protocol/typed-data';
import { decodePaymentRequired, encodePaymentPayload } from '@ethglobal/protocol/x402';

import { harness, type Harness } from './support/harness.js';

const NETWORK = 'hedera:testnet';
const PAYER = '0.0.7001';

/** Mock payment/ownership ports here; adapters test actual protobuf, ED25519 signatures and mirror responses. */
async function nativeHarness() {
  const verifyMessage = vi.fn(async () => true);
  const h = await harness({
    env: {
      X402_NETWORKS: NETWORK,
      PAYOUT_HEDERA_ACCOUNT: '0.0.5005',
      X402_HEDERA_FEE_PAYER: '0.0.9185802',
      GIFT_RECLAIM_FEE_USD6: '10000',
    },
    overrides: { adapters: { nativeAccounts: { verifyMessage } } },
  });
  const keys = generateSessionKeypair();
  const spk = bytesToHex(keys.publicKey);
  const nonce = keccak256(keys.publicKey);
  const transaction = Buffer.from('signed native transfer fixture').toString('base64');
  h.deps.octroi.nativeSessionBinding = (payment) =>
    'transaction' in payment.payload && payment.payload.transaction === transaction
      ? nonce
      : undefined;
  const verify = vi
    .spyOn(h.adapters.payments, 'verify')
    .mockResolvedValue({ isValid: true, payer: PAYER });
  const settle = vi.spyOn(h.adapters.payments, 'settle').mockResolvedValue({
    success: true,
    network: NETWORK,
    payer: PAYER,
    transaction: '0.0.9185802@1760000000.000000001',
  });
  const path = '/esim/provision?mb=1000';
  const quote = await h.get(path, { 'x-session-pubkey': spk });
  const required = decodePaymentRequired(quote.headers.get('payment-required')!);
  expect(required.accepts[0]?.extra).toMatchObject({
    sessionKeyRequired: true,
    sessionBinding: 'hedera-memo-v1',
  });
  const payment: PaymentPayload = {
    x402Version: 2,
    accepted: required.accepts[0]!,
    payload: { transaction },
  };
  const headers = { 'x-session-pubkey': spk, 'payment-signature': encodePaymentPayload(payment) };
  return { ...h, keys, spk, nonce, path, payment, headers, verify, settle, verifyMessage };
}

async function nativeCancel(
  h: Harness,
  entitlementKey: string,
  options: {
    payer?: string;
    network?: 'hedera:testnet' | 'hedera:mainnet';
    issuedAt?: number;
  } = {},
) {
  const payer = options.payer ?? PAYER;
  const network = options.network ?? NETWORK;
  const challenge = await h.challengeFor(
    '/plan/cancel',
    sha256Hex(nativePayerBinding(network, payer)),
  );
  const body = {
    authKind: 'hedera' as const,
    entitlementKey,
    payer,
    network,
    challenge,
    issuedAt: options.issuedAt ?? h.clock.now(),
    signatureMap: Buffer.from('signature-map fixture').toString('base64'),
  };
  return { body, response: await h.json('/plan/cancel', body) };
}

describe('native Hedera purchase and payer-authorized cancellation', () => {
  it('binds delivery AAD to the signed session and recovers the same settled operation without another order', async () => {
    const h = await nativeHarness();
    const first = await h.get(h.path, h.headers);
    expect(first.status).toBe(201);
    const body = (await first.json()) as EntitledResponse;
    expect(
      openLpa(body.sealedLpa as SealedBox, h.keys.secretKey, lpaAad(h.nonce, body.entitlementKey)),
    ).toMatch(/^LPA:/);
    expect((await h.deps.stores.entitlements.getByKey(body.entitlementKey))?.payload).toMatchObject(
      {
        network: NETWORK,
        payer: PAYER,
      },
    );
    h.clock.advance(180_001);
    expect((await h.get(h.path, h.headers)).status).toBe(201);
    expect(h.settle).toHaveBeenCalledTimes(1);
    expect(h.reseller.orders()).toHaveLength(1);
    const wrongSession = bytesToHex(generateSessionKeypair().publicKey);
    expect((await h.get(h.path, { ...h.headers, 'x-session-pubkey': wrongSession })).status).toBe(
      402,
    );
    expect(h.settle).toHaveBeenCalledTimes(1);
    const delivery = await h.json(`/me/${encodeURIComponent(body.entitlementKey)}/delivery`, {
      sessionPubKey: h.spk,
    });
    expect(delivery.status).toBe(200);
    expect(await delivery.json()).toMatchObject({ status: 'ready', nonce: h.nonce });
  });

  it('refuses an unbound native transfer before verification or settlement', async () => {
    const h = await nativeHarness();
    h.deps.octroi.nativeSessionBinding = () => undefined;
    expect((await h.get(h.path, h.headers)).status).toBe(402);
    expect(h.verify).not.toHaveBeenCalled();
    expect(h.settle).not.toHaveBeenCalled();
    expect(h.reseller.orders()).toHaveLength(0);
  });

  it('recovers a delayed native profile using its original session nonce', async () => {
    const h = await nativeHarness();
    vi.spyOn(h.reseller, 'order').mockRejectedValueOnce(
      new AdapterError('reseller', 'unavailable', 'pending'),
    );
    const first = await h.get(h.path, h.headers);
    expect(first.status).toBe(202);
    const body = (await first.json()) as EntitledResponse;
    const delivery = await h.json(`/me/${encodeURIComponent(body.entitlementKey)}/delivery`, {
      sessionPubKey: h.spk,
    });
    expect(delivery.status).toBe(200);
    const recovered = (await delivery.json()) as { nonce: Hex; sealedLpa: SealedBox };
    expect(recovered.nonce).toBe(h.nonce);
    expect(
      openLpa(recovered.sealedLpa, h.keys.secretKey, lpaAad(recovered.nonce, body.entitlementKey)),
    ).toMatch(/^LPA:/);
    expect(h.settle).toHaveBeenCalledTimes(1);
    expect(h.reseller.orders()).toHaveLength(1);
  });

  it('offers and refunds only the original native payer on the original network after a fresh wallet proof', async () => {
    const h = await nativeHarness();
    const { entitlementKey: key } = (await (
      await h.get(h.path, h.headers)
    ).json()) as EntitledResponse;
    const me = await h.get(`/me/${encodeURIComponent(key)}`);
    expect(await me.json()).toMatchObject({
      network: NETWORK,
      refundable: { to: PAYER, network: NETWORK, usd6: '3990000' },
    });
    const result = await nativeCancel(h, key);
    expect(result.response.status).toBe(200);
    expect(h.verifyMessage).toHaveBeenCalledWith({
      network: NETWORK,
      accountId: PAYER,
      signatureMap: result.body.signatureMap,
      message: nativeCancelMessage({
        network: NETWORK,
        payer: PAYER,
        entitlementHash: sha256Hex(key),
        nonce: result.body.challenge.nonce as Hex,
        issuedAt: result.body.issuedAt,
      }),
    });
    expect(((await result.response.json()) as PlanCancelResponse).refund).toMatchObject({
      network: NETWORK,
      usd6: '3990000',
    });
    expect(h.treasury.refunds()).toEqual([
      expect.objectContaining({ network: NETWORK, to: PAYER, usd6: 3_990_000n }),
    ]);
    expect((await h.json('/plan/cancel', result.body)).status).toBe(409);
    expect(h.treasury.refunds()).toHaveLength(1);
  });

  it('denies forged proofs, another native account, a different network and expired proofs before cancellation', async () => {
    const h = await nativeHarness();
    const { entitlementKey: key } = (await (
      await h.get(h.path, h.headers)
    ).json()) as EntitledResponse;
    const vendorCancel = vi.spyOn(h.reseller, 'cancel');
    h.verifyMessage.mockResolvedValueOnce(false);
    expect((await nativeCancel(h, key)).response.status).toBe(401);
    expect((await nativeCancel(h, key, { payer: '0.0.7002' })).response.status).toBe(401);
    expect((await nativeCancel(h, key, { network: 'hedera:mainnet' })).response.status).toBe(401);
    expect(
      (await nativeCancel(h, key, { issuedAt: h.clock.now() - 11 * 60_000 })).response.status,
    ).toBe(410);
    delete h.adapters.nativeAccounts;
    expect((await nativeCancel(h, key)).response.status).toBe(401);
    expect(vendorCancel).not.toHaveBeenCalled();
    expect(h.treasury.refunds()).toHaveLength(0);
  });

  it('fails closed if the accounting receipt disagrees with the purchased network or payer', async () => {
    const h = await nativeHarness();
    const { entitlementKey: key } = (await (
      await h.get(h.path, h.headers)
    ).json()) as EntitledResponse;
    const [receipt] = await h.deps.stores.receipts.forEntitlement(sha256Hex(key));
    await h.deps.stores.receipts.patch(receipt!.key, { network: 'hedera:mainnet' });
    expect((await nativeCancel(h, key)).response.status).toBe(404);
    expect(h.treasury.refunds()).toHaveLength(0);
    await h.deps.stores.receipts.patch(receipt!.key, { network: NETWORK, payer: '0.0.7002' });
    expect((await nativeCancel(h, key)).response.status).toBe(404);
    expect(h.treasury.refunds()).toHaveLength(0);
  });
});
