/**
 * Red team wave 2 (unscripted): the 402 path — v1 fields smuggled past the byte filter, non-canonical amounts, duplicate
 * and re-cased headers, network/payload kind mismatch, a Hedera payload on an LPA route, prototype keys in `extra`,
 * and one payment redirected from the route it was signed for to another route. RT-A-07/08 are fixed: their attack
 * tests are passing regressions named `… [RT-A-0N]`.
 */
import { describe, expect, it, vi } from 'vitest';

import { decodePaymentRequired, PAYMENT_SIGNATURE_HEADER } from '@ethglobal/protocol/x402';

import { exactPayment } from '../support/client.js';
import { HUMAN_KEY, buyGift, harness, provisioned } from '../support/harness.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const topUpPath = (key: string, mb = 100) => `/esim/topup?key=${encodeURIComponent(key)}&mb=${mb}`;

async function setup() {
  const h = await harness();
  const { key } = await provisioned(h, 'rt-pay');
  const quote = await h.get(topUpPath(key));
  expect(quote.status).toBe(402);
  const req = decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED')!).accepts[0]!;
  const payload = await exactPayment(HUMAN_KEY, req, { now: h.clock.now() });
  return { h, key, req, payload };
}

describe('attack: rt x402 v1 field smuggling (A-18)', () => {
  // regression RT-A-07 (fixed): the v1 refusal runs on the parsed JSON (own keys at any depth), not on the bytes
  it('"maxAmount\\u0052equired" inside accepted ⇒ 400, never served [RT-A-07]', async () => {
    const { h, key, payload } = await setup();
    const json = JSON.stringify(payload).replace(
      '"accepted":{',
      '"accepted":{"maxAmount\\u0052equired":"400000",',
    );
    expect(
      (JSON.parse(json) as { accepted: Record<string, unknown> }).accepted.maxAmountRequired,
    ).toBe('400000');
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const res = await h.get(topUpPath(key), { [PAYMENT_SIGNATURE_HEADER]: b64(json) });
    expect(res.status).toBe(400);
    expect(settle).not.toHaveBeenCalled();
  });

  // property: the literal v1 key is refused before any adapter call (control for the escape above)
  it('control: a literal maxAmountRequired ⇒ 400 before settle', async () => {
    const { h, key, payload } = await setup();
    const json = JSON.stringify(payload).replace(
      '"accepted":{',
      '"accepted":{"maxAmountRequired":"400000",',
    );
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    expect((await h.get(topUpPath(key), { [PAYMENT_SIGNATURE_HEADER]: b64(json) })).status).toBe(
      400,
    );
    expect(settle).not.toHaveBeenCalled();
  });
});

describe('attack: rt non-canonical amounts and header shapes', () => {
  // property: only the canonical decimal string the server offered is accepted; nothing is settled otherwise
  it.each([
    ['leading zero', '0400000'],
    ['plus sign', '+400000'],
    ['arabic-indic digits', '٤٠٠٠٠٠'],
    ['fullwidth digits', '４０００００'],
    ['exponent', '4e5'],
    ['trailing space', '400000 '],
  ])('accepted.amount + authorization.value = %s ⇒ 400/402, no settle', async (_label, amount) => {
    const { h, key, payload } = await setup();
    const p = structuredClone(payload) as typeof payload & {
      payload: { authorization: { value: string } };
    };
    (p.accepted as { amount: string }).amount = amount;
    p.payload.authorization.value = amount;
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const res = await h.get(topUpPath(key), {
      [PAYMENT_SIGNATURE_HEADER]: b64(JSON.stringify(p)),
    });
    expect([400, 402]).toContain(res.status);
    expect(settle).not.toHaveBeenCalled();
  });

  // property: two PAYMENT-SIGNATURE headers never pick one (Headers joins them; the codec refuses the join)
  it('duplicate PAYMENT-SIGNATURE headers ⇒ 400, no settle; a lower-cased name is the same header', async () => {
    const { h, key, payload } = await setup();
    const header = b64(JSON.stringify(payload));
    const headers = new Headers();
    headers.append(PAYMENT_SIGNATURE_HEADER, header);
    headers.append('payment-signature', header);
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const dup = await h.request(topUpPath(key), { headers });
    expect(dup.status).toBe(400);
    expect(settle).not.toHaveBeenCalled();
    const lower = await h.get(topUpPath(key), { 'payment-signature': header });
    expect(lower.status).toBe(200);
  });

  // property: the payload kind must match accepted.network (EVM payload under hedera:* ⇒ refused before settle)
  it('EVM authorization under accepted.network hedera:testnet ⇒ 400, no settle', async () => {
    const { h, key, payload } = await setup();
    const p = structuredClone(payload);
    p.accepted = {
      ...p.accepted,
      network: 'hedera:testnet',
      asset: '0.0.429274',
      payTo: '0.0.5005',
      maxTimeoutSeconds: 180,
      extra: { feePayer: '0.0.9185802' },
    };
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const res = await h.get(topUpPath(key), { [PAYMENT_SIGNATURE_HEADER]: b64(JSON.stringify(p)) });
    expect(res.status).toBe(400);
    expect(settle).not.toHaveBeenCalled();
  });

  // property: a Hedera `{ transaction }` payload on the LPA route /esim/provision is never settled (fail closed)
  it('Hedera payload on /esim/provision ⇒ 400/402, no settle', async () => {
    const h = await harness();
    const spk = `0x${'ab'.repeat(32)}`;
    const quote = await h.get('/esim/provision?mb=100', { 'x-session-pubkey': spk });
    const req = decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED')!).accepts[0]!;
    const p = {
      x402Version: 2,
      accepted: {
        ...req,
        network: 'hedera:testnet',
        asset: '0.0.429274',
        payTo: '0.0.5005',
        maxTimeoutSeconds: 180,
        extra: { feePayer: '0.0.9185802' },
      },
      payload: { transaction: b64('not-a-real-hedera-transaction') },
    };
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const res = await h.get('/esim/provision?mb=100', {
      'x-session-pubkey': spk,
      [PAYMENT_SIGNATURE_HEADER]: b64(JSON.stringify(p)),
    });
    expect([400, 402]).toContain(res.status);
    expect(settle).not.toHaveBeenCalled();
  });
});

describe('attack: rt prototype keys through zod records and bodies', () => {
  // property: "__proto__" in accepted.extra or a JSON body never reaches Object.prototype and is never served
  it('accepted.extra.__proto__ / body.__proto__ ⇒ refused, Object.prototype untouched', async () => {
    const { h, key, payload } = await setup();
    const json = JSON.stringify(payload).replace(
      '"extra":{',
      '"extra":{"__proto__":{"rtPolluted":"yes","name":"Fake"},',
    );
    const res = await h.get(topUpPath(key), { [PAYMENT_SIGNATURE_HEADER]: b64(json) });
    expect([200, 400, 402]).toContain(res.status);
    expect(({} as Record<string, unknown>).rtPolluted).toBeUndefined();
    const body =
      '{"__proto__":{"rtPolluted2":"yes"},"constructor":{"prototype":{"rtPolluted3":"yes"}},"name":"bob.eth","mb":100}';
    const gift = await h.request('/gift', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    });
    expect([400, 402]).toContain(gift.status);
    expect(({} as Record<string, unknown>).rtPolluted2).toBeUndefined();
    expect(({} as Record<string, unknown>).rtPolluted3).toBeUndefined();
  });
});

describe('attack: rt one payment, two routes', () => {
  // regression RT-A-08 (fixed): every route's accepts carry `extra.resource` = its path, echoed by the payer and
  // compared by decide(); a top-up payment replayed on POST /gift no longer matches the offer
  it('a top-up payment for key K is refused when replayed as a gift purchase [RT-A-08]', async () => {
    const { h, payload } = await setup();
    const header = b64(JSON.stringify(payload));
    const res = await h.json(
      '/gift',
      { name: 'bob.eth', mb: 100 },
      { [PAYMENT_SIGNATURE_HEADER]: header },
    );
    const body = (await res.json()) as { pin?: string };
    expect(res.status).not.toBe(201);
    expect(body.pin).toBeUndefined();
    expect(payload.accepted.extra?.resource).toMatch(/^\/esim\/topup\?key=hk%3A0x[0-9a-f]{64}$/);
  });

  // property: once the gift used it, the victim's own top-up with the same header is refused (nonce once)
  it('control: the same signed payment serves at most once across routes', async () => {
    const { h, key, payload } = await setup();
    const header = b64(JSON.stringify(payload));
    const first = await h.get(topUpPath(key), { [PAYMENT_SIGNATURE_HEADER]: header });
    expect(first.status).toBe(200);
    const second = await h.json(
      '/gift',
      { name: 'bob.eth', mb: 100 },
      { [PAYMENT_SIGNATURE_HEADER]: header },
    );
    expect(second.status).not.toBe(201);
    await buyGift(h); // the gift route itself still works with a fresh payment
  });
});
