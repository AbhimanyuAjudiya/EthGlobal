import { describe, expect, it, vi } from 'vitest';

import { anvilKeys, anvilRoles } from '@ethglobal/adapters/testing';
import {
  bytesToHex,
  generateSessionKeypair,
  keccak256,
  lpaAad,
  openLpa,
  type SealedBox,
} from '@ethglobal/crypto';
import { topUpResponseSchema } from '@ethglobal/protocol/schemas';
import { decodePaymentRequired, decodePaymentResponse } from '@ethglobal/protocol/x402';

import {
  DAY,
  errorOf,
  harness,
  hcsMessages,
  provisioned,
  topUp,
  provisionPaid,
} from './support/harness.js';

describe('GET /esim/topup', () => {
  it('without payment → 402, PAYMENT-REQUIRED decodes to the body, nothing written', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const put = vi.spyOn(h.adapters.ledger, 'put');
    const update = vi.spyOn(h.adapters.ledger, 'update');
    const res = await h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=100`);
    expect(res.status).toBe(402);
    expect(decodePaymentRequired(res.headers.get('PAYMENT-REQUIRED') ?? '')).toEqual(
      await res.json(),
    );
    expect(put).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('signed payment → 200, PAYMENT-RESPONSE, mbTotal +100, expiresAt extended, HCS +1', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    h.clock.advance(DAY);
    const { paid } = await topUp(h, key);
    expect(paid.status).toBe(200);
    const body = topUpResponseSchema.parse(await paid.json());
    expect(decodePaymentResponse(paid.headers.get('PAYMENT-RESPONSE') ?? '')).toEqual(
      body.settlement,
    );
    expect(body.mbTotal).toBe(400);
    expect(body.expiresAt).toBe(h.clock.now() + 7 * DAY);
    expect(hcsMessages(h).map((m) => m.t)).toEqual(['claim', 'settle']);
  });

  it('payment nonce reused → 402 invalid_payment; mb=199 → 400', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const { pay, path } = await topUp(h, key);
    const again = await h.get(path, pay);
    expect([again.status, await errorOf(again)]).toEqual([402, 'invalid_payment']);
    expect((await h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=199`)).status).toBe(400);
  });

  it('21st top-up for one ICCID today → 429 daily_cap before settle', async () => {
    const h = await harness({ env: { TOPUPS_PER_ICCID_PER_DAY: '2' } });
    const { key } = await provisioned(h);
    await topUp(h, key);
    await topUp(h, key);
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const third = await h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=100`);
    expect([third.status, await errorOf(third)]).toEqual([429, 'daily_cap']);
    expect(settle).not.toHaveBeenCalled();
  });

  it('records agent-topup with the uaid only for an allow-listed payer (T-77)', async () => {
    const h = await harness();
    const { key, path } = await provisioned(h);
    await topUp(h, key, { headers: { 'x-agent-uaid': 'uaid:aid:human-forged' } });
    await topUp(h, key, {
      payKey: anvilKeys[anvilRoles.agent],
      headers: { 'x-agent-uaid': 'uaid:aid:agent-1' },
    });
    const { receipts } = (await (await h.get(`/me/${path}/receipts`)).json()) as {
      receipts: { kind: string; uaid?: string }[];
    };
    expect(receipts.map((r) => [r.kind, r.uaid])).toEqual([
      ['claim', undefined],
      ['topup', undefined],
      ['agent-topup', 'uaid:aid:agent-1'],
    ]);
  });
});

describe('GET /esim/provision', () => {
  it('without X-Session-Pubkey → 400', async () => {
    const h = await harness();
    expect((await h.get('/esim/provision?mb=100')).status).toBe(400);
  });

  it('402 → payment whose nonce = keccak(sessionPubKey) → 201 with a sealed LPA for that key', async () => {
    const h = await harness();
    const { res, quote, keys } = await provisionPaid(h, { mb: 300 });
    expect(quote.status).toBe(402);
    expect(
      decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED') ?? '').accepts[0]?.extra,
    ).toMatchObject({ sessionKeyRequired: true, mb: 300 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      entitlementKey: string;
      sealedLpa: SealedBox;
      kind: string;
      mbTotal: number;
    };
    expect(body).toMatchObject({ kind: 'paid', mbTotal: 300 });
    expect(
      openLpa(
        body.sealedLpa,
        keys.secretKey,
        lpaAad(keccak256(keys.publicKey), body.entitlementKey),
      ),
    ).toMatch(/^LPA:1\$local\.test\$/);
    expect(res.headers.get('PAYMENT-RESPONSE')).toBeTruthy();
  });

  it('provision with nonce ≠ keccak(sessionPubKey) → 402 (C4)', async () => {
    const h = await harness();
    const { res } = await provisionPaid(h, { bind: false });
    expect([res.status, await errorOf(res)]).toEqual([402, 'invalid_payment']);
  });

  it('an unknown planId → 400; a known one is ordered', async () => {
    const h = await harness();
    const spk = bytesToHex(generateSessionKeypair().publicKey);
    expect(
      (await h.get('/esim/provision?mb=100&planId=nope', { 'x-session-pubkey': spk })).status,
    ).toBe(400);
    const quote = await h.get('/esim/provision?mb=100&planId=in-1gb-7d', {
      'x-session-pubkey': spk,
    });
    const res = await h.get('/esim/provision?mb=100&planId=in-1gb-7d', {
      'x-session-pubkey': spk,
      ...(await h.payFor(quote, { sessionPubKey: spk })),
    });
    expect(res.status).toBe(201);
    expect(h.reseller.orders().at(-1)?.profile.planId).toBe('in-1gb-7d');
  });
});
