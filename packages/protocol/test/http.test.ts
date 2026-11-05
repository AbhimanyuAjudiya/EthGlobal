import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { HttpError, httpJson } from '../src/http.js';

interface Call {
  url: string;
  init: RequestInit | undefined;
  self: unknown;
}

const urlOf = (input: string | URL | Request): string =>
  input instanceof Request ? input.url : input.toString();

/** A recording fake `fetch` that answers with `respond`. */
function fakeFetch(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fn = function (this: unknown, input: string | URL | Request, init?: RequestInit) {
    calls.push({ url: urlOf(input), init, self: this });
    return Promise.resolve(respond(urlOf(input), init));
  } as typeof fetch;
  return { fn, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('httpJson', () => {
  it('GETs JSON, validates with the schema and returns status + headers', async () => {
    const { fn, calls } = fakeFetch(() => json({ ok: true, mode: 'local' }));
    const res = await httpJson('https://api.test/healthz', {
      fetch: fn,
      schema: z.object({ ok: z.boolean(), mode: z.string() }),
    });
    expect(res).toMatchObject({ status: 200, data: { ok: true, mode: 'local' } });
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(calls[0]?.init?.method).toBe('GET');
    expect(calls[0]?.self).toBe(globalThis);
  });

  it('POSTs a JSON body with content-type and custom headers', async () => {
    const { fn, calls } = fakeFetch(() => json({ id: 1 }, 201));
    await httpJson('https://api.test/x', {
      fetch: fn,
      body: { a: 1 },
      headers: { 'x-request-id': 'r1' },
    });
    const init = calls[0]?.init;
    expect(init?.method).toBe('POST');
    expect(init?.body).toBe('{"a":1}');
    expect(init?.headers).toMatchObject({
      'content-type': 'application/json',
      'x-request-id': 'r1',
    });
  });

  it('throws HttpError(status) with the body on non-2xx, unless allowed', async () => {
    const { fn } = fakeFetch(() => json({ error: 'payment_required' }, 402));
    await expect(httpJson('https://api.test/p', { fetch: fn })).rejects.toMatchObject({
      name: 'HttpError',
      status: 402,
      reason: 'status',
      body: { error: 'payment_required' },
      url: 'https://api.test/p',
    });
    await expect(
      httpJson('https://api.test/p', { fetch: fn, allowStatus: [402] }),
    ).resolves.toMatchObject({
      status: 402,
      data: { error: 'payment_required' },
    });
  });

  it('throws HttpError(schema) when the body does not match', async () => {
    const { fn } = fakeFetch(() => json({ ok: 'yes' }));
    const error = await httpJson('https://api.test/h', {
      fetch: fn,
      schema: z.object({ ok: z.boolean() }),
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error).toMatchObject({ reason: 'schema', status: 200 });
  });

  it('returns text bodies as strings and empty bodies as undefined', async () => {
    const text = fakeFetch(() => new Response('plain', { status: 200 }));
    await expect(httpJson('https://api.test/t', { fetch: text.fn })).resolves.toMatchObject({
      data: 'plain',
    });
    const empty = fakeFetch(() => new Response(null, { status: 204 }));
    await expect(httpJson('https://api.test/e', { fetch: empty.fn })).resolves.toMatchObject({
      status: 204,
      data: undefined,
    });
  });

  it('maps a timeout and a network failure to status 0', async () => {
    const slow = fakeFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason as Error));
        }),
    );
    await expect(
      httpJson('https://api.test/slow', { fetch: slow.fn, timeoutMs: 20 }),
    ).rejects.toMatchObject({
      status: 0,
      reason: 'timeout',
    });
    const down = fakeFetch(() => Promise.reject(new TypeError('fetch failed')));
    await expect(httpJson('https://api.test/down', { fetch: down.fn })).rejects.toMatchObject({
      status: 0,
      reason: 'network',
    });
  });

  it('sends a raw body as is and returns bytes with responseType bytes', async () => {
    const bytes = new Uint8Array([0, 1, 254, 255]);
    const echo = fakeFetch(async (_url, init) => new Response(init?.body, { status: 201 }));
    const { status, data } = await httpJson<Uint8Array>('https://api.test/bzz', {
      fetch: echo.fn,
      rawBody: bytes,
      headers: { 'content-type': 'application/octet-stream' },
      responseType: 'bytes',
    });
    expect(status).toBe(201);
    expect(data).toEqual(bytes);
    expect(echo.calls[0]?.init?.method).toBe('POST');
  });

  it('keeps the transport failure as the cause', async () => {
    const boom = new TypeError('fetch failed');
    const down = fakeFetch(() => Promise.reject(boom));
    await expect(httpJson('https://api.test/down', { fetch: down.fn })).rejects.toMatchObject({
      cause: boom,
    });
  });
});
