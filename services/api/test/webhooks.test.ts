import { describe, expect, it, vi } from 'vitest';

import type { Reseller, UsageEvent, WebhookVerdict } from '@ethglobal/adapters';

import {
  errorOf,
  harness,
  iccidOf,
  provisioned,
  webhook,
  type Harness,
} from './support/harness.js';

const ready = async (h: Harness) => {
  const p = await provisioned(h);
  await h.get(`/me/${p.path}`);
  return { ...p, iccid: iccidOf(h, p.key) };
};
const me = async (h: Harness, path: string) =>
  (await (await h.get(`/me/${path}`)).json()) as {
    mbUsed: number;
    cached: boolean;
    usageSource: string;
  };

describe('POST /webhooks/reseller/mock (HMAC, T-34)', () => {
  it('valid HMAC updates mbUsed/usageAsOf and invalidates the cache; replay → 409', async () => {
    const h = await harness();
    const { iccid, path } = await ready(h);
    const hook = webhook(h, iccid, 120);
    expect((await hook.send()).status).toBe(204);
    expect(await me(h, path)).toMatchObject({ mbUsed: 120, cached: false, usageSource: 'webhook' });
    expect((await hook.send()).status).toBe(409);
  });

  it('invalid MAC, re-serialised body, missing header, skew 301 s, ms timestamp → 401; ±299 s → 204', async () => {
    const h = await harness();
    const { iccid } = await ready(h);
    const base = webhook(h, iccid, 10).delivery;
    const send = (d: { body: string; headers: Record<string, string> }) =>
      h.request('/webhooks/reseller/mock', { method: 'POST', headers: d.headers, body: d.body });
    expect(
      (await send({ ...base, body: base.body.replace('"usedMb":10', '"usedMb":11') })).status,
    ).toBe(401);
    expect((await send({ ...base, body: ` ${base.body}` })).status).toBe(401);
    const { 'x-recharge-signature': _s, ...unsigned } = base.headers;
    expect((await send({ ...base, headers: unsigned })).status).toBe(401);
    expect((await webhook(h, iccid, 20, { at: h.clock.now() - 301_000 }).send()).status).toBe(401);
    expect((await webhook(h, iccid, 30, { at: h.clock.now() + 301_000 }).send()).status).toBe(401);
    const ms = {
      ...base,
      headers: { ...base.headers, 'x-recharge-timestamp': String(h.clock.now()) },
    };
    expect((await send(ms)).status).toBe(401);
    expect((await webhook(h, iccid, 40, { at: h.clock.now() - 299_000 }).send()).status).toBe(204);
    expect((await webhook(h, iccid, 50, { at: h.clock.now() + 299_000 }).send()).status).toBe(204);
  });

  it('usedMb decrease ignored (monotonic); unknown ICCID → 204 and nothing patched', async () => {
    const h = await harness();
    const { iccid, path } = await ready(h);
    await webhook(h, iccid, 100).send();
    expect((await webhook(h, iccid, 50, { at: h.clock.now() + 1 }).send()).status).toBe(204);
    expect((await me(h, path)).mbUsed).toBe(100);
    const update = vi.spyOn(h.adapters.ledger, 'update');
    expect((await webhook(h, '899100000000000000099', 5).send()).status).toBe(204);
    expect(update).not.toHaveBeenCalled();
  });

  it('garbage body → 400 (never 500); usedMb > totalMb → 400; wrong provider → 404', async () => {
    const h = await harness();
    const { iccid } = await ready(h);
    expect((await webhook(h, iccid, 301, { totalMb: 300 }).send()).status).toBe(400);
    const signed = h.reseller.signedWebhook([], h.clock.now());
    const garbage = await h.request('/webhooks/reseller/mock', {
      method: 'POST',
      headers: signed.headers,
      body: '\u0000￿ not json',
    });
    expect(garbage.status).toBe(401);
    expect(
      (await h.request('/webhooks/reseller/esimaccess', { method: 'POST', body: '{}' })).status,
    ).toBe(404);
  });

  it('a 300 KiB body → 413', async () => {
    const h = await harness();
    const res = await h.request('/webhooks/reseller/mock', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(300 * 1024) },
      body: 'x'.repeat(300 * 1024),
    });
    expect(res.status).toBe(413);
  });
});

/** An unsigned provider modelled on eSIM Access (A-27): URL token + sender IP; the body is only a hint. */
class HintReseller implements Partial<Reseller> {
  readonly name = 'esimaccess' as const;
  seen: Record<string, string | undefined>[] = [];
  constructor(private readonly usedMb: () => number) {}
  verifyWebhook(_raw: string, headers: Record<string, string | undefined>): WebhookVerdict {
    this.seen.push(headers);
    if (headers['x-recharge-url-token'] !== 'tok-0123456789abcdef')
      return { ok: false, reason: 'bad_signature' };
    if (headers['x-recharge-remote-ip'] !== '3.1.131.226')
      return { ok: false, reason: 'bad_signature' };
    return { ok: true, eventId: 'e' };
  }
  parseWebhook(raw: string): UsageEvent[] {
    const parsed = JSON.parse(raw) as { iccid?: string; orderUsage?: number };
    if (parsed.iccid === undefined) return [];
    return [
      {
        provider: 'esimaccess',
        eventId: 'e',
        iccid: parsed.iccid,
        usedMb: parsed.orderUsage ?? 0,
        totalMb: 300,
        asOf: 1,
      },
    ];
  }
  usage = vi.fn(async (iccid: string) => ({ iccid, usedMb: this.usedMb(), totalMb: 300, asOf: 7 }));
}

describe('POST /webhooks/reseller/esimaccess (unsigned hints, T-82)', () => {
  const setup = async () => {
    const h = await harness();
    const { iccid, path } = await ready(h);
    const hint = new HintReseller(() => 250);
    Object.assign(h.deps.adapters, {
      reseller: Object.assign(Object.create(h.reseller) as Reseller, {
        name: 'esimaccess',
        verifyWebhook: hint.verifyWebhook.bind(hint),
        parseWebhook: hint.parseWebhook.bind(hint),
        usage: hint.usage,
      }),
    });
    const send = (
      body: unknown,
      o: { query?: string; headers?: Record<string, string>; socket?: string } = {},
    ) =>
      h.request(`/webhooks/reseller/esimaccess${o.query ?? '?token=tok-0123456789abcdef'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...o.headers },
        body: JSON.stringify(body),
        socket: o.socket ?? '3.1.131.226',
      });
    return { h, iccid, path, hint, send };
  };

  it('a valid hint → reseller.usage is called and ITS numbers (not the body’s) are patched', async () => {
    const { h, iccid, path, hint, send } = await setup();
    const res = await send({ iccid, orderUsage: 0 }, { headers: { 'x-forwarded-for': '' } });
    expect(res.status).toBe(204);
    expect(hint.usage).toHaveBeenCalledTimes(1);
    expect((await me(h, path)).mbUsed).toBe(250);
  });

  it('wrong/no token or a foreign IP → 401; client-sent pseudo-headers are stripped; CHECK_HEALTH → 204', async () => {
    const { iccid, hint, send, h } = await setup();
    const trust = h.deps.env.TRUST_PROXY;
    h.deps.env.TRUST_PROXY = false;
    expect((await send({ iccid }, { query: '?token=TOK-0123456789ABCDEF' })).status).toBe(401);
    expect(
      (
        await send(
          { iccid },
          { query: '', headers: { 'x-recharge-url-token': 'tok-0123456789abcdef' } },
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await send(
          { iccid },
          { socket: '198.51.100.9', headers: { 'x-recharge-remote-ip': '3.1.131.226' } },
        )
      ).status,
    ).toBe(401);
    expect(hint.seen.at(-1)?.['x-recharge-remote-ip']).toBe('198.51.100.9');
    expect((await send({ event: 'CHECK_HEALTH' })).status).toBe(204);
    expect(hint.usage).not.toHaveBeenCalled();
    h.deps.env.TRUST_PROXY = trust;
  });

  it('50 hints for one ICCID in a second → reseller.usage at most once (coalesced)', async () => {
    const { iccid, hint, send, h } = await setup();
    h.deps.env.TRUST_PROXY = false;
    for (let i = 0; i < 50; i++) await send({ iccid, orderUsage: i });
    expect(hint.usage).toHaveBeenCalledTimes(1);
  });

  it('the token never reaches the log', async () => {
    const { iccid, send, h } = await setup();
    h.deps.env.TRUST_PROXY = false;
    await send({ iccid });
    expect(h.lines.join('')).not.toMatch(/token=|tok-0123456789abcdef/);
    expect(await errorOf(await send({ iccid }, { query: '?token=x' }))).toBe('unauthorized');
  });
});
