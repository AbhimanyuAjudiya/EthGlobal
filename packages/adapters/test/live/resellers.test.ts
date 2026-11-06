import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { bytesToHex, hmacSha256, sha256Hex, utf8 } from '@ethglobal/crypto';

import { AdapterError, MockReseller } from '../../src/index.js';
import {
  EsimAccessReseller,
  ESIMACCESS_WEBHOOK_IPS,
  esimStatus,
  WEBHOOK_IP_HEADER,
  WEBHOOK_TOKEN_HEADER,
} from '../../src/live/esimaccess-reseller.js';
import { FallbackReseller } from '../../src/live/fallback-reseller.js';
import {
  InventoryReseller,
  sealInventory,
  type InventoryEntry,
} from '../../src/live/inventory-reseller.js';
import { MegaEsimReseller } from '../../src/live/megaesim-reseller.js';
import { Pacer } from '../../src/live/rate-limit.js';
import {
  describeReseller,
  fakeClock,
  fixtureFetch,
  fixturePath,
  loadFixture,
  T0,
} from '../../src/testing/index.js';

const TOKEN = 'webhook-token-0123456789abcdef';
const IP = ESIMACCESS_WEBHOOK_IPS[0]!;

function esim(
  file: string,
  over: Partial<ConstructorParameters<typeof EsimAccessReseller>[0]> = {},
) {
  const clock = fakeClock();
  let n = 0;
  const reseller = new EsimAccessReseller({
    accessCode: 'test-access-code',
    webhookToken: TOKEN,
    fetch: fixtureFetch(`reseller/esimaccess/${file}.json`, { strictBody: true }),
    now: clock.now,
    sleep: async (ms) => clock.advance(ms),
    uuid: () => `00000000-0000-4000-8000-${String((n += 1)).padStart(12, '0')}`,
    ...over,
  });
  return { reseller, clock };
}
const webhook = (file: string) =>
  loadFixture<{ rawBody: string }>(`reseller/esimaccess/${file}.json`).rawBody;
const routeHeaders = { [WEBHOOK_TOKEN_HEADER]: TOKEN, [WEBHOOK_IP_HEADER]: IP };

describeReseller(
  'EsimAccessReseller over fixtures/reseller/esimaccess/contract-suite.json',
  async () => {
    const { reseller, clock } = esim('contract-suite');
    return {
      reseller,
      now: clock.now,
      deliver: (iccid, now) => ({
        body: JSON.stringify({
          notifyType: 'DATA_USAGE',
          content: { iccid, orderUsage: now % 1000, totalVolume: 10 },
        }),
        headers: routeHeaders,
      }),
      timestamped: false,
      bodyBound: false,
    };
  },
);

describe.skipIf(!existsSync(fixturePath('reseller/megaesim/order.json')))(
  'MegaEsimReseller contract (vendor recording)',
  () => {
    it('runs once a vendor-supplied recording exists', () => undefined);
  },
);

describe('EsimAccessReseller (A-27; T-34, T-39, T-40, T-82, T-83)', () => {
  it('RT-Signature = HMAC(accessCode, timestamp+requestId+accessCode+rawBody), lower-case hex, over the exact body sent', async () => {
    const seen: { headers: Headers; body: string }[] = [];
    const replay = fixtureFetch('reseller/esimaccess/plans.json', { strictBody: true });
    const spy: typeof fetch = async (input, init) => {
      seen.push({ headers: new Headers(init?.headers), body: init?.body as string });
      return replay(input, init);
    };
    const { reseller } = esim('plans', { fetch: spy });
    await reseller.plans('IN');
    await reseller.plans('IN');
    const [a, b] = seen;
    const ts = a!.headers.get('RT-Timestamp')!;
    const id = a!.headers.get('RT-RequestID')!;
    expect(Number(ts)).toBe(T0); // milliseconds, not seconds
    expect(Number(ts)).toBeGreaterThan(1e12);
    const expected = bytesToHex(
      hmacSha256(utf8('test-access-code'), `${ts}${id}test-access-code${a!.body}`),
    ).slice(2);
    expect(a!.headers.get('RT-Signature')).toBe(expected);
    expect(expected).toMatch(/^[0-9a-f]{64}$/);
    expect(a!.headers.get('RT-AccessCode')).toBe('test-access-code');
    expect(b!.headers.get('RT-RequestID')).not.toBe(id); // fresh uuid per call
    const keyed = esim('plans', { signingKey: 'console-secret' }).reseller.signHeaders(
      '{}',
      '1',
      'r',
    );
    expect(keyed['RT-Signature']).toBe(
      bytesToHex(hmacSha256(utf8('console-secret'), '1rtest-access-code{}')).slice(2),
    );
  });

  it('price ×100 ⇒ Usd6, volume bytes ⇒ MB, non-DAY packages skipped, names sanitised (L7)', async () => {
    const plans = await esim('plans').reseller.plans('IN');
    expect(plans.map((p) => p.id)).toEqual(['P-IN-1G-7D', 'P-IN-3G-30D', 'P-IN-ODD']);
    expect(plans[0]).toEqual({
      id: 'P-IN-1G-7D',
      provider: 'esimaccess',
      name: 'India 1GB 7Days',
      country: 'IN',
      dataMb: 1073,
      validityDays: 7,
      wholesaleUsd6: 1_140_000n,
      activation: { startsOn: 'unknown' },
      cancellation: 'never-installed',
    });
    expect(plans[2]!.name).not.toMatch(/[<>]/);
    expect(plans[2]!.name.length).toBeLessThanOrEqual(64);
  });

  it('order polls /esim/query every 3 s until ac fills; the LPA matches the pattern; qrCodeUrl never returned', async () => {
    const { reseller, clock } = esim('order');
    const [plan] = await reseller.plans('IN');
    const profile = await reseller.order(plan!.id, { idempotencyKey: 'order-key-1' });
    expect(profile).toEqual({
      iccid: '89852240000000000001',
      lpa: 'LPA:1$rsp.esimaccess.example$MATCH1ID',
      providerRef: 'ESIM-TRAN-1',
      lifecycle: { installBy: 1794312000000, startsOn: 'unknown' },
      planId: 'P-IN-1G-7D',
      provider: 'esimaccess',
      orderId: 'B26110300001',
      status: 'ready',
    });
    expect(clock.now()).toBe(T0 + 3_000);
    expect(JSON.stringify(profile)).not.toContain('qrsim');
  });

  it('empty ac for 30 s ⇒ unavailable (pending-profile); a retry with the same key re-polls, never re-orders twice in flight', async () => {
    const { reseller, clock } = esim('query-pending');
    await expect(
      reseller.order('P-IN-1G-7D', { idempotencyKey: 'pending-key' }),
    ).rejects.toMatchObject({
      code: 'unavailable',
      details: { reason: 'pending_profile' },
    });
    expect(clock.now()).toBeGreaterThanOrEqual(T0 + 30_000);
  });

  it('duplicate transactionId (310402) ⇒ the same profile by re-query, never a second order (L8)', async () => {
    await expect(
      esim('order-duplicate').reseller.order('P-IN-1G-7D', { idempotencyKey: 'dup-key' }),
    ).resolves.toMatchObject({
      iccid: '89852240000000000005',
      orderId: 'B26110300005',
    });
  });

  it('LPA not matching the pattern ⇒ invalid_response (L7, T-39)', async () => {
    await expect(
      esim('order-bad-lpa').reseller.order('P-IN-1G-7D', { idempotencyKey: 'bad-lpa' }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('usage: bytes ⇒ MB, status from smdp/esim status; another ICCID or used > total ⇒ invalid_response', async () => {
    await expect(esim('query').reseller.usage('89852240000000000001')).resolves.toEqual({
      iccid: '89852240000000000001',
      usedMb: 250,
      totalMb: 1073,
      asOf: T0,
      status: 'active',
      providerRef: 'ESIM-TRAN-1',
      lifecycle: { serviceExpiresAt: 1794312000000, startsOn: 'unknown' },
    });
    await expect(
      esim('query-other-iccid').reseller.usage('89852240000000000001'),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(
      esim('query-overflow').reseller.usage('89852240000000000001'),
    ).rejects.toMatchObject({ code: 'invalid_response' });
    await expect(esim('query').reseller.usage('8991')).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('topUp resolves esimTranNo and a top-up packageCode of the asked size, then re-reads the total', async () => {
    const { reseller } = esim('topup');
    await expect(
      reseller.topUp('89852240000000000001', 1073, { idempotencyKey: 'topup-key-1' }),
    ).resolves.toEqual({
      orderId: sha256Hex('topup:topup-key-1').slice(2, 34),
      totalMb: 2147,
    });
    // the plan still fits the profile's own 1 GB: no vendor purchase, only the profile read
    await expect(
      esim('topup').reseller.topUp('89852240000000000001', 100, {
        idempotencyKey: 'k3',
        totalMb: 400,
      }),
    ).resolves.toEqual({ orderId: sha256Hex('topup:k3').slice(2, 34), totalMb: 1073 });
    await expect(
      esim('topup').reseller.topUp('89852240000000000001', 0, { idempotencyKey: 'k2' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('cancel: an unused profile ⇒ /esim/cancel { esimTranNo }, then it reads CANCEL (expired); again ⇒ no second call; in use ⇒ refused without a call', async () => {
    const calls: string[] = [];
    const replay = fixtureFetch('reseller/esimaccess/cancel.json', { strictBody: true });
    const spy: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : input.toString();
      calls.push(new URL(url).pathname.replace('/api/v1/open', ''));
      return replay(input, init);
    };
    const { reseller } = esim('cancel', { fetch: spy });
    await expect(
      reseller.cancel('89852240000000000001', { idempotencyKey: 'c1' }),
    ).resolves.toBeUndefined();
    // the eligibility read, the cancel, then the confirmation read by esimTranNo
    expect(calls).toEqual(['/esim/query', '/esim/cancel', '/esim/query']);
    await expect(reseller.usage('89852240000000000001')).resolves.toMatchObject({
      status: 'expired',
    });
    await reseller.cancel('89852240000000000001', { idempotencyKey: 'c1' });
    expect(calls.filter((c) => c === '/esim/cancel')).toHaveLength(1);
    // IN_USE: refused before any /esim/cancel (the 'query' recording has none: a call would be fixture_miss)
    await expect(
      esim('query').reseller.cancel('89852240000000000001', { idempotencyKey: 'c2' }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });

  it('error codes: 101003 ⇒ unauthorized, 200007 ⇒ unavailable (alarm), 400001 ⇒ invalid_response, unknown ⇒ unavailable; no credential in errors', async () => {
    const warn = vi.fn();
    const { reseller } = esim('errors', { logger: { warn } });
    const errors: unknown[] = [];
    for (const code of ['unauthorized', 'unavailable', 'invalid_response', 'unavailable']) {
      const e = await reseller.plans('IN').catch((x: unknown) => x);
      expect(e).toMatchObject({ code });
      errors.push(e);
    }
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/insufficient balance/));
    const dump = JSON.stringify(
      errors.map((e) => ({ ...(e as object), message: (e as Error).message })),
    );
    expect(dump).not.toContain('test-access-code');
    expect(dump).not.toMatch(/RT-Signature/i);
  });

  it('a transport failure is unavailable; an unmatched request is fixture_miss', async () => {
    const down = esim('plans', {
      fetch: () => Promise.reject(new TypeError('fetch failed')),
    }).reseller;
    await expect(down.plans('IN')).rejects.toMatchObject({ code: 'unavailable' });
    await expect(esim('plans').reseller.usage('89852240000000000001')).rejects.toMatchObject({
      code: 'fixture_miss',
    });
    await expect(esim('plans').reseller.order('x', { idempotencyKey: '' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('webhook: wrong token / foreign IP / missing headers / replayed body ⇒ rejected; CHECK_HEALTH and ORDER_STATUS ⇒ []', () => {
    const { reseller } = esim('plans');
    const body = webhook('webhook-data-usage');
    const verdict = reseller.verifyWebhook(body, routeHeaders, T0);
    expect(verdict).toEqual({ ok: true, eventId: sha256Hex(body) });
    expect(reseller.verifyWebhook(body, routeHeaders, T0)).toEqual({ ok: false, reason: 'replay' });
    const fresh = `${body} `;
    for (const token of [TOKEN.slice(0, -1), TOKEN.toUpperCase(), `${TOKEN}x`]) {
      expect(
        reseller.verifyWebhook(fresh, { ...routeHeaders, [WEBHOOK_TOKEN_HEADER]: token }, T0),
      ).toEqual({ ok: false, reason: 'bad_signature' });
    }
    expect(
      reseller.verifyWebhook(fresh, { ...routeHeaders, [WEBHOOK_IP_HEADER]: '10.0.0.1' }, T0),
    ).toEqual({ ok: false, reason: 'bad_signature' });
    expect(reseller.verifyWebhook(fresh, { [WEBHOOK_IP_HEADER]: IP }, T0)).toEqual({
      ok: false,
      reason: 'missing_headers',
    });
    // RT-* headers that "look signed" never substitute for the token
    const looksSigned = {
      'RT-Signature': 'ab'.repeat(32),
      'RT-Timestamp': String(T0),
      [WEBHOOK_IP_HEADER]: IP,
      [WEBHOOK_TOKEN_HEADER]: 'wrong-token-0000000',
    };
    expect(reseller.verifyWebhook(fresh, looksSigned, T0)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(
      reseller.verifyWebhook(fresh, { ...routeHeaders, 'RT-Timestamp': String(T0 - 301_000) }, T0),
    ).toEqual({ ok: false, reason: 'skew' });
    expect(
      reseller.verifyWebhook(fresh, { ...routeHeaders, 'RT-Timestamp': String(T0 / 1000) }, T0),
    ).toEqual({ ok: false, reason: 'skew' });
    expect(
      reseller.verifyWebhook(fresh, { ...routeHeaders, [WEBHOOK_IP_HEADER]: `::ffff:${IP}` }, T0),
    ).toMatchObject({ ok: true });
    expect(reseller.parseWebhook(webhook('webhook-check-health'))).toEqual([]);
    expect(reseller.parseWebhook(webhook('webhook-order-status'))).toEqual([]);
  });

  it('DATA_USAGE / ESIM_STATUS are hints: iccid only, the body numbers never become usedMb/totalMb (T-82)', () => {
    const { reseller } = esim('plans');
    const [event] = reseller.parseWebhook(webhook('webhook-data-usage'));
    expect(event).toEqual({
      provider: 'esimaccess',
      eventId: sha256Hex(webhook('webhook-data-usage')),
      iccid: '89852240000000000001',
      usedMb: 0,
      totalMb: 0,
      asOf: T0,
    });
    expect(reseller.parseWebhook(webhook('webhook-esim-status'))[0]).toMatchObject({
      status: 'active',
    });
    expect(() => reseller.parseWebhook('{')).toThrow(
      expect.objectContaining({ code: 'invalid_response' }),
    );
    expect(() => reseller.parseWebhook('[]')).toThrow(
      expect.objectContaining({ code: 'invalid_response' }),
    );
  });

  it('status mapping and constructor guards', () => {
    expect(esimStatus({ smdpStatus: 'RELEASED', esimStatus: 'GOT_RESOURCE' })).toBe('ready');
    expect(esimStatus({ smdpStatus: 'ENABLED' })).toBe('installed');
    expect(esimStatus({ esimStatus: 'USED_UP' })).toBe('active');
    for (const smdpStatus of ['DOWNLOAD', 'DOWNLOADED', 'INSTALLATION', 'ENABLED', 'DISABLED'])
      expect(esimStatus({ smdpStatus, esimStatus: 'GOT_RESOURCE' })).toBe('installed');
    for (const esimState of ['UNUSED_EXPIRED', 'USED_EXPIRED', 'CANCEL', 'REVOKE'])
      expect(esimStatus({ smdpStatus: 'RELEASED', esimStatus: esimState })).toBe('expired');
    expect(
      esimStatus({ smdpStatus: 'RELEASED', esimStatus: 'GOT_RESOURCE', eid: '89000001' }),
    ).toBe('installed');
    for (const esimState of ['SUSPENDED', 'CREATE', 'GETTING_RESOURCE', 'NEW_UNKNOWN_STATE'])
      expect(() => esimStatus({ smdpStatus: 'RELEASED', esimStatus: esimState })).toThrow();
    expect(esimStatus({ smdpStatus: 'DELETED' })).toBe('expired');
    expect(esimStatus({ smdpStatus: 'RELEASED', esimStatus: 'CANCEL' })).toBe('expired');
    expect(
      () => new EsimAccessReseller({ accessCode: '', webhookToken: TOKEN, now: () => T0 }),
    ).toThrow(/ACCESS_CODE/);
    expect(
      () => new EsimAccessReseller({ accessCode: 'a', webhookToken: 'short', now: () => T0 }),
    ).toThrow(/16/);
    expect(
      () =>
        new EsimAccessReseller({
          accessCode: 'a',
          webhookToken: TOKEN,
          now: () => T0,
          baseUrl: 'http://api.esimaccess.com',
        }),
    ).toThrow(/https/);
  });

  it('8 req/s limiter: the 9th call in one second waits', async () => {
    const clock = fakeClock();
    const sleeps: number[] = [];
    const pacer = new Pacer(8, clock.now, async (ms) => {
      sleeps.push(ms);
      clock.advance(ms);
    });
    for (let i = 0; i < 8; i += 1) await pacer.acquire();
    expect(sleeps).toEqual([]);
    clock.advance(400);
    await pacer.acquire();
    expect(sleeps).toEqual([600]);
    expect(clock.now()).toBe(T0 + 1000);
  });
});

describe('MegaEsimReseller (A-28)', () => {
  it('every method throws unavailable; webhooks are never accepted', async () => {
    const m = new MegaEsimReseller({ now: () => T0 });
    expect(m.name).toBe('megaesim');
    for (const call of [
      () => m.plans('IN'),
      () => m.order('p', { idempotencyKey: 'k' }),
      () => m.topUp('1', 1, { idempotencyKey: 'k' }),
      () => m.usage('1'),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: 'unavailable' });
    }
    await expect(m.cancel('1', { idempotencyKey: 'k' })).rejects.toMatchObject({
      code: 'not_implemented',
    });
    expect(m.verifyWebhook('{}', {}, T0)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(() => m.parseWebhook('{}')).toThrow(expect.objectContaining({ code: 'unavailable' }));
  });
});

describe('InventoryReseller (T-41, L9)', () => {
  const key = new Uint8Array(32).fill(7);
  const entries = loadFixture<{ entries: InventoryEntry[] }>('inventory.example.json').entries;
  function setup() {
    const file = join(mkdtempSync(join(tmpdir(), 'inv-')), 'inventory.enc');
    writeFileSync(file, sealInventory(entries, key));
    return { file, reseller: new InventoryReseller({ file, sealKey: key, now: () => T0 }) };
  }

  describeReseller('InventoryReseller', async () => ({
    reseller: setup().reseller,
    now: () => T0,
    timestamped: false,
    bodyBound: false,
    topUps: false,
  }));

  it('two concurrent orders ⇒ two distinct profiles; a repeat key ⇒ the same profile; consumed before returning', async () => {
    const { file, reseller } = setup();
    const [a, b] = await Promise.all([
      reseller.order('P-IN-1G-7D', { idempotencyKey: 'a' }),
      reseller.order('P-IN-1G-7D', { idempotencyKey: 'b' }),
    ]);
    expect(a.iccid).not.toBe(b.iccid);
    await expect(reseller.order('P-IN-1G-7D', { idempotencyKey: 'a' })).resolves.toEqual(a);
    // a fresh process (crash after consume) never re-issues a consumed profile
    const restarted = new InventoryReseller({ file, sealKey: key, now: () => T0 });
    await expect(restarted.canTopUp(a.iccid)).resolves.toBe(false);
    await expect(restarted.canTopUp('8991000000000000003')).rejects.toMatchObject({
      code: 'not_found',
    });
    await expect(restarted.order('P-IN-1G-7D', { idempotencyKey: 'c' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(restarted.usage(a.iccid)).resolves.toMatchObject({ usedMb: 0, totalMb: 1073 });
    await expect(restarted.usage('8991000000000000003')).rejects.toMatchObject({
      code: 'not_found',
    });
    expect((await restarted.plans('IN')).map((p) => p.id)).toEqual(['P-IN-3G-30D']);
  });

  it('the file never contains "LPA:" in clear; a wrong key fails at construction; topUp ⇒ unavailable', async () => {
    const { file, reseller } = setup();
    await reseller.order('P-IN-3G-30D', { idempotencyKey: 'x' });
    expect(readFileSync(file, 'utf8')).not.toContain('LPA:');
    expect(
      () => new InventoryReseller({ file, sealKey: new Uint8Array(32).fill(8), now: () => T0 }),
    ).toThrow(/INVENTORY_SEAL_KEY/);
    expect(
      () => new InventoryReseller({ file: `${file}.missing`, sealKey: key, now: () => T0 }),
    ).toThrow(/not readable/);
    await expect(
      reseller.topUp('8991000000000000003', 100, { idempotencyKey: 't' }),
    ).rejects.toMatchObject({ code: 'unavailable' });
    // pre-bought stock is never refunded
    await expect(
      reseller.cancel('8991000000000000003', { idempotencyKey: 'x' }),
    ).rejects.toMatchObject({ code: 'not_implemented' });
    await expect(reseller.order('P-IN-1G-7D', { idempotencyKey: '' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(reseller.verifyWebhook('{}', {}, T0)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(reseller.parseWebhook('{}')).toEqual([]);
  });
});

describe('FallbackReseller', () => {
  it('an accepted primary order with a pending profile never consumes a fallback profile', async () => {
    const fallback = new MockReseller();
    const primary = esim('query-pending').reseller;
    await expect(
      new FallbackReseller(primary, fallback).order('P-IN-1G-7D', {
        idempotencyKey: 'pending-key',
      }),
    ).rejects.toMatchObject({ code: 'unavailable', details: { orderMayExist: true } });
    expect(fallback.orders()).toHaveLength(0);
  });

  it('a primary transport failure has an unknown order outcome and cannot allocate fallback stock', async () => {
    const fallback = new MockReseller();
    const primary = esim('plans', {
      fetch: async () => {
        throw new TypeError('connection reset');
      },
    }).reseller;
    await expect(
      new FallbackReseller(primary, fallback).order('P-IN-1G-7D', {
        idempotencyKey: 'unknown-order',
      }),
    ).rejects.toMatchObject({ details: { orderMayExist: true } });
    expect(fallback.orders()).toHaveLength(0);
  });

  it('a fallback allocation stays pinned after the primary recovers and the process restarts', async () => {
    const key = new Uint8Array(32).fill(7);
    const entries = loadFixture<{ entries: InventoryEntry[] }>('inventory.example.json').entries;
    const file = join(mkdtempSync(join(tmpdir(), 'fallback-')), 'inventory.enc');
    writeFileSync(file, sealInventory(entries, key));
    const primary = new MockReseller();
    vi.spyOn(primary, 'order').mockRejectedValueOnce(
      new AdapterError('reseller', 'unavailable', 'out of stock'),
    );
    const inventory = () => new InventoryReseller({ file, sealKey: key, now: () => T0 });
    const first = await new FallbackReseller(primary, inventory()).order('P-IN-1G-7D', {
      idempotencyKey: 'same-order',
    });
    const primaryOrder = vi.spyOn(primary, 'order');
    primaryOrder.mockClear();
    await expect(
      new FallbackReseller(primary, inventory()).order('P-IN-1G-7D', {
        idempotencyKey: 'same-order',
      }),
    ).resolves.toEqual(first);
    expect(primaryOrder).not.toHaveBeenCalled();
    const restarted = new FallbackReseller(primary, inventory());
    await expect(restarted.canTopUp(first.iccid)).resolves.toBe(false);
    await expect(restarted.canTopUp('89852240000000000099')).resolves.toBe(true);
  });

  it('order falls back when the primary is unavailable; usage/topUp/webhooks never do', async () => {
    const primary = new MockReseller({ failNextOrder: true });
    const fallback = new MockReseller();
    const warn = vi.fn();
    const chain = new FallbackReseller(primary, fallback, { warn });
    expect(chain.name).toBe('mock');
    const profile = await chain.order('in-1gb-7d', { idempotencyKey: 'k' });
    expect(fallback.orders()).toHaveLength(1);
    await expect(chain.order('in-1gb-7d', { idempotencyKey: 'k' })).resolves.toEqual(profile);
    expect(fallback.orders()).toHaveLength(1);
    expect(warn).toHaveBeenCalled();
    await expect(chain.usage(profile.iccid)).rejects.toMatchObject({ code: 'not_found' }); // primary never issued it
    await expect(chain.topUp(profile.iccid, 100, { idempotencyKey: 't' })).rejects.toMatchObject({
      code: 'not_found',
    });
    // cancel never reaches the fallback: its evidence is never eligible, so the chain refuses before any cancel call
    await expect(chain.cancel(profile.iccid, { idempotencyKey: 'c' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(fallback.usage(profile.iccid)).resolves.toMatchObject({ status: 'ready' });
    await expect(chain.order('nope', { idempotencyKey: 'z' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(chain.verifyWebhook('{}', {}, T0)).toEqual({ ok: false, reason: 'missing_headers' });
    expect(() => chain.parseWebhook('{')).toThrow();
    const down = new FallbackReseller(new MegaEsimReseller({ now: () => T0 }), fallback);
    await expect(down.plans('IN')).resolves.toHaveLength(2);
    await expect(new FallbackReseller(fallback, primary).plans('IN')).resolves.toHaveLength(2);
    const broken = {
      ...fallback,
      plans: () => Promise.reject(new Error('boom')),
    } as unknown as MockReseller;
    await expect(new FallbackReseller(broken, fallback).plans('IN')).rejects.toThrow('boom');
  });
});
