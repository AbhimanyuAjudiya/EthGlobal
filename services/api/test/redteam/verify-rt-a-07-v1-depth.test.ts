/**
 * Red-team verification variant for RT-A-07 ("a v1 field anywhere is a 400", own keys at any depth of the parsed
 * header): the regression puts a `\u`-escaped v1 key inside `accepted`. Here: every other container a v2 payload has
 * (top level, payload, payload.authorization, accepted.extra, extensions, resource), escaped spellings, an own
 * `__proto__` container (JSON.parse makes it data), arrays, and nesting beyond hasV1Field's depth bound (32). Property:
 * a header carrying the v1 amount key is never served (and never settled).
 */
import { describe, expect, it, vi } from 'vitest';

import { decodePaymentRequired, PAYMENT_SIGNATURE_HEADER } from '@ethglobal/protocol/x402';

import { exactPayment } from '../support/client.js';
import { HUMAN_KEY, harness, provisioned } from '../support/harness.js';

const b64 = (s: string) => Buffer.from(s, 'utf8').toString('base64');
const topUpPath = (key: string) => `/esim/topup?key=${encodeURIComponent(key)}&mb=100`;
const V1 = '"maxAmount\\u0052equired":"400000"';
const V1_ALT = '"\\u006daxAmountRequired":"400000"';
const nest = (depth: number, inner: string): string =>
  depth === 0 ? `{${inner}}` : `{"n":${nest(depth - 1, inner)}}`;

async function setup() {
  const h = await harness();
  const { key } = await provisioned(h, 'verify-a07');
  const quote = await h.get(topUpPath(key));
  const req = decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED')!).accepts[0]!;
  const payload = await exactPayment(HUMAN_KEY, req, { now: h.clock.now() });
  return { h, key, json: JSON.stringify(payload) };
}

const CASES: [string, (j: string) => string][] = [
  ['top level', (j) => j.replace('{', `{${V1},`)],
  ['payload', (j) => j.replace('"payload":{', `"payload":{${V1},`)],
  ['payload.authorization', (j) => j.replace('"authorization":{', `"authorization":{${V1_ALT},`)],
  ['accepted.extra', (j) => j.replace('"extra":{', `"extra":{${V1},`)],
  ['extensions', (j) => j.replace('{', `{"extensions":{"x":{${V1}}},`)],
  ['extensions array', (j) => j.replace('{', `{"extensions":{"x":[1,{${V1}}]},`)],
  ['own __proto__ container', (j) => j.replace('{', `{"__proto__":{${V1}},`)],
  ['extensions nested 31 deep', (j) => j.replace('{', `{"extensions":{"x":${nest(30, V1)}},`)],
];

describe('verify RT-A-07: the v1 amount key is refused wherever it sits', () => {
  it.each(CASES)('v1 key in %s ⇒ not served, not settled', async (_where, inject) => {
    const { h, key, json } = await setup();
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const res = await h.get(topUpPath(key), { [PAYMENT_SIGNATURE_HEADER]: b64(inject(json)) });
    expect(res.status).not.toBe(200);
    expect(settle).not.toHaveBeenCalled();
  });

  // Regression RT-A-07 (fixed): hasV1Field stopped at depth 32 while the 16 KiB codec cap allows far deeper nesting, and
  // `extensions` is z.record(unknown), so the v1 key was silently dropped. JSON deeper than 16 levels is now refused
  // outright, and the v1 filter walks the whole normalised structure.
  it('v1 key in extensions nested 40 deep ⇒ not served, not settled [RT-A-07]', async () => {
    const { h, key, json } = await setup();
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const header = json.replace('{', `{"extensions":{"x":${nest(40, V1)}},`);
    const res = await h.get(topUpPath(key), { [PAYMENT_SIGNATURE_HEADER]: b64(header) });
    expect(res.status).toBe(400);
    expect(settle).not.toHaveBeenCalled();
  });

  it('any payment JSON deeper than 16 levels ⇒ 400 before settle, v1 key or not; 16 levels still served [RT-A-07]', async () => {
    const { h, key, json } = await setup();
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    // root object (1) → extensions (2) → nest(n) is n + 1 more objects, the innermost at depth n + 3
    const deep = json.replace('{', `{"extensions":{"x":${nest(14, '"k":1')}},`); // 17 levels
    const deepRes = await h.get(topUpPath(key), { [PAYMENT_SIGNATURE_HEADER]: b64(deep) });
    expect(deepRes.status).toBe(400);
    expect(JSON.stringify(await deepRes.json())).toContain('too deep');
    expect(settle).not.toHaveBeenCalled();
    const ok = json.replace('{', `{"extensions":{"x":${nest(13, '"k":1')}},`); // 16 levels
    expect((await h.get(topUpPath(key), { [PAYMENT_SIGNATURE_HEADER]: b64(ok) })).status).toBe(200);
  });

  it.each([
    ['full-width letters', '"ｍａｘＡｍｏｕｎｔＲｅｑｕｉｒｅｄ":"1"'],
    ['a zero-width joiner', '"maxAmount\u200dRequired":"1"'],
    ['another case', '"MAXAMOUNTREQUIRED":"1"'],
  ])('v1 key spelled with %s ⇒ 400 after normalisation [RT-A-07]', async (_how, field) => {
    const { h, key, json } = await setup();
    const res = await h.get(topUpPath(key), {
      [PAYMENT_SIGNATURE_HEADER]: b64(json.replace('{', `{${field},`)),
    });
    expect(res.status).toBe(400);
  });
});
