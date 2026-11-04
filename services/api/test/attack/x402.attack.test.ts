/** AP7 — 402 bypass and payment tampering (T-26, T-27, T-28, T-32, T-15). */
import { describe, expect, it, vi } from 'vitest';

import { anvilAccounts, anvilRoles } from '@ethglobal/adapters/testing';
import { encodeTransferWithAuthorization, fromPaymentAuthorization } from '@ethglobal/eip3009';
import { isEvmExact } from '@ethglobal/protocol/schemas';
import {
  encodePaymentPayload,
  PAYMENT_SIGNATURE_HEADER,
  decodePaymentPayload,
} from '@ethglobal/protocol/x402';

import { DAY, errorOf, harness, provisioned, topUp, type Harness } from './fixture.js';
import { fakeUsdcRail } from '../support/fake-chain.js';

const quoteOf = async (h: Harness, key: string, mb = 100) =>
  h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=${mb}`);
const paidWith = async (h: Harness, key: string, headers: Record<string, string>, mb = 100) =>
  h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=${mb}`, headers);

describe('attack: 402 bypass and payment tampering (AP7)', () => {
  it.each([
    ['amount 1', { amount: '1' }],
    ['payTo stranger', { payTo: anvilAccounts[anvilRoles.stranger] }],
    ['another asset', { asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' }],
    ['network eip155:1', { network: 'eip155:1' }],
    [
      'extra.name Fake',
      { extra: { name: 'Fake', version: '2', mb: 100, stepMb: 100, sessionKeyRequired: false } },
    ],
    ['maxTimeoutSeconds 3600', { maxTimeoutSeconds: 3600 }],
  ])('a tampered accepted (%s) ⇒ 402 invalid_payment, never served', async (_name, patch) => {
    const h = await harness();
    const { key } = await provisioned(h);
    const reseller = vi.spyOn(h.reseller, 'topUp');
    const pay = await h.payFor(await quoteOf(h, key), { mutate: (r) => ({ ...r, ...patch }) });
    const res = await paidWith(h, key, pay);
    expect([res.status, await errorOf(res)]).toEqual([402, 'invalid_payment']);
    expect(reseller).not.toHaveBeenCalled();
  });

  it('x402Version 1 or a v1 network name in PAYMENT-SIGNATURE ⇒ 400, never 200', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const pay = await h.payFor(await quoteOf(h, key));
    const payload = decodePaymentPayload(pay[PAYMENT_SIGNATURE_HEADER]);
    const raw = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64');
    expect(
      (await paidWith(h, key, { [PAYMENT_SIGNATURE_HEADER]: raw({ ...payload, x402Version: 1 }) }))
        .status,
    ).toBe(400);
    expect(
      (
        await paidWith(h, key, {
          [PAYMENT_SIGNATURE_HEADER]: raw({
            ...payload,
            accepted: { ...payload.accepted, network: 'base-sepolia' },
          }),
        })
      ).status,
    ).toBe(400);
    // the codec strips unknown keys, so a v1 `maxAmountRequired` is refused at the header, not silently dropped
    expect(
      (
        await paidWith(h, key, {
          [PAYMENT_SIGNATURE_HEADER]: raw({
            ...payload,
            accepted: { ...payload.accepted, maxAmountRequired: '400000' },
          }),
        })
      ).status,
    ).toBe(400);
  });

  it('exact amount: a one-step payment for mb=200 and an over-payment (value ≠ amount) ⇒ 402', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const one = await h.payFor(await quoteOf(h, key, 100));
    expect((await paidWith(h, key, one, 200)).status).toBe(402);
    const over = await h.payFor(await quoteOf(h, key, 100), { value: '800000' });
    expect((await paidWith(h, key, over)).status).toBe(402);
  });

  it.each(['199', '0', '-100', '1e3', '3100', '0x64'])('mb=%s ⇒ 400', async (mb) => {
    const h = await harness();
    const { path } = await provisioned(h);
    expect((await h.get(`/esim/topup?key=${path}&mb=${mb}`)).status).toBe(400);
  });

  it('a duplicate mb parameter ⇒ 400 (price and grant can never read different values)', async () => {
    const h = await harness();
    const { path } = await provisioned(h);
    expect((await h.get(`/esim/topup?key=${path}&mb=100&mb=200`)).status).toBe(400);
  });

  it('a payment for key A sent to ?key=B tops up B only (payments are not key-bound by design; recorded Low)', async () => {
    const h = await harness();
    const a = await provisioned(h, 'key-a');
    const b = await provisioned(h, 'key-b');
    const pay = await h.payFor(await quoteOf(h, a.key));
    expect((await paidWith(h, b.key, pay)).status).toBe(200);
    expect(((await (await h.get(`/me/${a.path}`)).json()) as { mbTotal: number }).mbTotal).toBe(
      300,
    );
  });

  it('serve-before-settle: settlement_pending ⇒ 402 and no reseller call; the same payment later settles once', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const reseller = vi.spyOn(h.reseller, 'topUp');
    vi.spyOn(h.adapters.payments, 'settle').mockResolvedValueOnce({
      success: false,
      errorReason: 'settlement_pending',
      transaction: `0x${'ee'.repeat(32)}`,
      network: 'eip155:31337',
    });
    const pay = await h.payFor(await quoteOf(h, key));
    expect((await paidWith(h, key, pay)).status).toBe(402);
    expect(reseller).not.toHaveBeenCalled();
    expect((await paidWith(h, key, pay)).status).toBe(200);
    expect(reseller).toHaveBeenCalledTimes(1);
  });

  it('an expired entitlement with a valid payment ⇒ 410 and the payment is not settled', async () => {
    const h = await harness();
    const { key, path } = await provisioned(h);
    await h.get(`/me/${path}`);
    const pay = await h.payFor(await quoteOf(h, key));
    h.clock.advance(7 * DAY + 1);
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    expect(await errorOf(await paidWith(h, key, pay))).toBe('expired');
    expect(settle).not.toHaveBeenCalled();
  });

  // T-15 fixed (octroi): verify(nonce_already_used) no longer ends the paid lane — settle()'s front-run recovery
  // returns the executed transfer and the settlement marker (A-33) serves it exactly once.
  it('front-run: a stranger submits the human’s transferWithAuthorization first ⇒ served exactly once, never twice', async () => {
    const fake = fakeUsdcRail(() => h.clock.now());
    const h = await harness({ overrides: fake.overrides });
    const { key } = await provisioned(h);
    const pay = await h.payFor(await quoteOf(h, key));
    const payload = decodePaymentPayload(pay[PAYMENT_SIGNATURE_HEADER]);
    if (!isEvmExact(payload.payload)) throw new Error('evm');
    const data = encodeTransferWithAuthorization(
      fromPaymentAuthorization(payload.payload.authorization),
      payload.payload.signature as `0x${string}`,
    );
    const { hash } = await fake.usdc
      .relayer(anvilAccounts[anvilRoles.stranger])
      .submit(fake.usdc.address, data);
    const headers = { [PAYMENT_SIGNATURE_HEADER]: encodePaymentPayload(payload) };
    expect((await paidWith(h, key, headers)).status).toBe(200);
    const again = await paidWith(h, key, headers);
    expect([
      again.status,
      ((await again.json()) as { details: { detail: string } }).details.detail,
    ]).toEqual([402, 'nonce_already_used']);
    expect(fake.usdc.transfers.map((t) => t.transactionHash)).toEqual([hash]);
    expect(
      ((await (await h.get(`/me/${encodeURIComponent(key)}`)).json()) as { mbTotal: number })
        .mbTotal,
    ).toBe(400);
  });

  it('the base 402 writes nothing and calls no reseller (spies at zero); the paid leg writes only receipts and its settlement marker', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const put = vi.spyOn(h.adapters.ledger, 'put');
    const order = vi.spyOn(h.reseller, 'order');
    await topUp(h, key, { mb: 100 }).then(() => undefined);
    expect(order).not.toHaveBeenCalled();
    expect(
      put.mock.calls.every(([input]) =>
        /"receipt"|"claim"/.test(JSON.stringify(input.annotations)),
      ),
    ).toBe(true);
  });
});
