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
import { paymentRequiredSchema, topUpResponseSchema } from '@ethglobal/protocol/schemas';
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
    const res = await h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=1000`);
    expect(res.status).toBe(402);
    expect(decodePaymentRequired(res.headers.get('PAYMENT-REQUIRED') ?? '')).toEqual(
      await res.json(),
    );
    expect(put).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('signed payment → 200, PAYMENT-RESPONSE, a legacy 300 MB plan +1 GB, expiresAt extended, HCS +1', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    h.clock.advance(DAY);
    const { paid } = await topUp(h, key);
    expect(paid.status).toBe(200);
    const body = topUpResponseSchema.parse(await paid.json());
    expect(decodePaymentResponse(paid.headers.get('PAYMENT-RESPONSE') ?? '')).toEqual(
      body.settlement,
    );
    expect(body.mbTotal).toBe(1300);
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
    const third = await h.get(`/esim/topup?key=${encodeURIComponent(key)}&mb=1000`);
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
    expect((await h.get('/esim/provision?mb=1000')).status).toBe(400);
  });

  it('402 → payment whose nonce = keccak(sessionPubKey) → 201 with a sealed LPA for that key', async () => {
    const h = await harness();
    const { res, quote, keys } = await provisionPaid(h);
    expect(quote.status).toBe(402);
    expect(
      decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED') ?? '').accepts[0]?.extra,
    ).toMatchObject({ sessionKeyRequired: true, mb: 1000 });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      entitlementKey: string;
      sealedLpa: SealedBox;
      kind: string;
      mbTotal: number;
    };
    expect(body).toMatchObject({ kind: 'paid', mbTotal: 1000 });
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
      (await h.get('/esim/provision?mb=1000&planId=nope', { 'x-session-pubkey': spk })).status,
    ).toBe(400);
    const quote = await h.get('/esim/provision?mb=1000&planId=in-1gb-7d', {
      'x-session-pubkey': spk,
    });
    const res = await h.get('/esim/provision?mb=1000&planId=in-1gb-7d', {
      'x-session-pubkey': spk,
      ...(await h.payFor(quote, { sessionPubKey: spk })),
    });
    expect(res.status).toBe(201);
    expect(h.reseller.orders().at(-1)?.profile.planId).toBe('in-1gb-7d');
  });
});

describe('the 1 GB product unit: any other size is refused before any 402 or settlement', () => {
  /** Spies on everything a 402 quote or a paid request would touch. */
  const watch = (h: Awaited<ReturnType<typeof harness>>) => ({
    verify: vi.spyOn(h.adapters.payments, 'verify'),
    settle: vi.spyOn(h.adapters.payments, 'settle'),
    put: vi.spyOn(h.adapters.ledger, 'put'),
    update: vi.spyOn(h.adapters.ledger, 'update'),
    resolve: vi.spyOn(h.adapters.names, 'resolve'),
  });
  const refused = async (res: Response) => {
    expect(res.status).toBe(400);
    expect(res.headers.get('PAYMENT-REQUIRED')).toBeNull();
    expect(await res.json()).toMatchObject({
      error: 'invalid_request',
      details: [{ path: 'mb', message: 'mb must be 1000 (1 GB)' }],
    });
  };
  const untouched = (spies: ReturnType<typeof watch>) => {
    for (const spy of Object.values(spies)) expect(spy).not.toHaveBeenCalled();
  };

  it('GET /esim/topup?mb=300 on a legacy 300 MB plan: 400 with or without a valid 1 GB payment; nothing quoted, verified or settled', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const path = (mb: number) => `/esim/topup?key=${encodeURIComponent(key)}&mb=${mb}`;
    const quote = await h.get(path(1000));
    expect(paymentRequiredSchema.parse(await quote.json()).accepts[0]?.amount).toBe('4000000');
    const pay = await h.payFor(quote);
    const spies = watch(h);
    await refused(await h.get(path(300)));
    await refused(await h.get(path(300), pay));
    untouched(spies);
    // the same payment on the 1 GB top-up it was signed for is served: 300 → 1300 MB
    const served = await h.get(path(1000), pay);
    expect(served.status).toBe(200);
    expect(topUpResponseSchema.parse(await served.json()).mbTotal).toBe(1300);
  });

  it('GET /esim/provision?mb=300 → 400, no 402; POST /gift { mb: 300 } → 400 before the name is resolved', async () => {
    const h = await harness();
    const spk = bytesToHex(generateSessionKeypair().publicKey);
    const spies = watch(h);
    await refused(await h.get('/esim/provision?mb=300', { 'x-session-pubkey': spk }));
    await refused(await h.get('/esim/provision?mb=2000', { 'x-session-pubkey': spk }));
    await refused(await h.json('/gift', { name: 'bob.eth', mb: 300 }));
    untouched(spies);
    const quote = await h.get('/esim/provision?mb=1000', { 'x-session-pubkey': spk });
    expect(quote.status).toBe(402);
    expect(paymentRequiredSchema.parse(await quote.json()).accepts[0]?.amount).toBe('4000000');
  });
});
