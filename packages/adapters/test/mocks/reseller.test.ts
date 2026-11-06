import { describe, expect, it } from 'vitest';

import { MOCK_WEBHOOK_HEADERS } from '@ethglobal/protocol/schemas';

import { MockReseller, type UsageEvent } from '../../src/index.js';
import { describeReseller, fakeClock, T0 } from '../../src/testing/index.js';

const event = (iccid: string, usedMb = 10): UsageEvent => ({
  provider: 'mock',
  eventId: `evt-${usedMb}`,
  iccid,
  usedMb,
  totalMb: 1000,
  asOf: T0,
});

describeReseller('MockReseller', async () => {
  const clock = fakeClock();
  const reseller = new MockReseller({ now: clock.now });
  return {
    reseller,
    now: clock.now,
    deliver: (iccid, now) =>
      reseller.signedWebhook([event(iccid, Math.floor(now / 1000) % 500)], now),
    timestamped: true,
    bodyBound: true,
  };
});

describe('MockReseller specifics', () => {
  it('simulated usage advances with the clock', async () => {
    const clock = fakeClock();
    const reseller = new MockReseller({ now: clock.now, usageMbPerMinute: 5 });
    const { iccid } = await reseller.order('in-1gb-7d', { idempotencyKey: 'k' });
    expect((await reseller.usage(iccid)).usedMb).toBe(0);
    clock.advance(60_000 * 10);
    expect(await reseller.usage(iccid)).toMatchObject({
      usedMb: 50,
      totalMb: 1000,
      status: 'active',
    });
    reseller.advanceUsage(iccid, 100);
    expect((await reseller.usage(iccid)).usedMb).toBe(150);
    clock.advance(60_000 * 1000);
    expect(await reseller.usage(iccid)).toMatchObject({ usedMb: 1000, status: 'expired' });
    await reseller.topUp(iccid, 300, { idempotencyKey: 't' });
    expect((await reseller.usage(iccid)).totalMb).toBe(1300);
  });

  it('cancel: only an unused line, which then reads expired; a second cancel resolves; a used line is refused', async () => {
    const clock = fakeClock();
    const reseller = new MockReseller({ now: clock.now });
    const { iccid } = await reseller.order('in-300mb-7d', { idempotencyKey: 'a' });
    await reseller.cancel(iccid, { idempotencyKey: 'c' });
    expect((await reseller.usage(iccid)).status).toBe('expired');
    await expect(reseller.cancel(iccid, { idempotencyKey: 'c' })).resolves.toBeUndefined();
    const used = await reseller.order('in-300mb-7d', { idempotencyKey: 'b' });
    reseller.advanceUsage(used.iccid, 1);
    await expect(reseller.cancel(used.iccid, { idempotencyKey: 'd' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(reseller.cancel('8991000', { idempotencyKey: 'e' })).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('failNextOrder throws exactly once', async () => {
    const reseller = new MockReseller({ failNextOrder: true });
    await expect(reseller.order('in-300mb-7d', { idempotencyKey: 'a' })).rejects.toMatchObject({
      adapter: 'reseller',
      code: 'unavailable',
    });
    await expect(reseller.order('in-300mb-7d', { idempotencyKey: 'a' })).resolves.toMatchObject({
      planId: 'in-300mb-7d',
    });
    expect(reseller.orders()).toHaveLength(1);
  });

  it('signedWebhook verifies and a replay is rejected; every malformed header is a verdict, never a throw', async () => {
    const reseller = new MockReseller();
    const { iccid } = await reseller.order('in-1gb-7d', { idempotencyKey: 'k' });
    const { body, headers } = reseller.signedWebhook([event(iccid)], T0);
    expect(reseller.verifyWebhook(body, headers, T0 + 299_000)).toEqual({
      ok: true,
      eventId: headers[MOCK_WEBHOOK_HEADERS.eventId],
    });
    expect(reseller.verifyWebhook(body, headers, T0)).toEqual({ ok: false, reason: 'replay' });
    // a fresh event id header on the same signed body is still a replay (the id is not MAC-covered)
    expect(
      reseller.verifyWebhook(body, { ...headers, [MOCK_WEBHOOK_HEADERS.eventId]: 'other' }, T0),
    ).toEqual({ ok: false, reason: 'replay' });
    const fresh = reseller.signedWebhook([event(iccid, 20)], T0);
    const cases: [Record<string, string | undefined>, string][] = [
      [{ ...fresh.headers, [MOCK_WEBHOOK_HEADERS.signature]: undefined }, 'missing_headers'],
      [{ ...fresh.headers, [MOCK_WEBHOOK_HEADERS.signature]: '' }, 'missing_headers'],
      [{ ...fresh.headers, [MOCK_WEBHOOK_HEADERS.signature]: 'zz' }, 'bad_signature'],
      [{ ...fresh.headers, [MOCK_WEBHOOK_HEADERS.timestamp]: String(T0) }, 'skew'], // milliseconds
      [{ ...fresh.headers, [MOCK_WEBHOOK_HEADERS.timestamp]: 'soon' }, 'skew'],
      [{ ...fresh.headers, [MOCK_WEBHOOK_HEADERS.timestamp]: String(T0 / 1000 + 301) }, 'skew'],
    ];
    for (const [h, reason] of cases) {
      expect(() => reseller.verifyWebhook(fresh.body, h, T0)).not.toThrow();
      expect(reseller.verifyWebhook(fresh.body, h, T0)).toEqual({ ok: false, reason });
    }
    const parsed = (JSON.parse(fresh.body) as { events: Record<string, unknown>[] }).events[0]!;
    const swapped = JSON.stringify({
      events: [Object.fromEntries(Object.entries(parsed).reverse())],
    });
    expect(swapped).not.toBe(fresh.body);
    expect(reseller.verifyWebhook(swapped, fresh.headers, T0)).toEqual({
      ok: false,
      reason: 'bad_signature',
    });
    expect(reseller.verifyWebhook(fresh.body, fresh.headers, T0)).toMatchObject({ ok: true });
  });

  it('parseWebhook rejects usedMb > totalMb and unknown shapes', () => {
    const reseller = new MockReseller();
    const bad = JSON.stringify({ events: [{ ...event('8991000000000000001'), usedMb: 2000 }] });
    expect(() => reseller.parseWebhook(bad)).toThrow(
      expect.objectContaining({ code: 'invalid_response' }),
    );
    expect(() => reseller.parseWebhook('{"x":1}')).toThrow(
      expect.objectContaining({ code: 'invalid_response' }),
    );
  });

  it('rejects unknown plans, empty keys, unknown ICCIDs and bad MB', async () => {
    const reseller = new MockReseller();
    await expect(reseller.order('nope', { idempotencyKey: 'k' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(reseller.order('in-1gb-7d', { idempotencyKey: '' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    await expect(reseller.usage('8991')).rejects.toMatchObject({ code: 'not_found' });
    const { iccid } = await reseller.order('in-1gb-7d', { idempotencyKey: 'k' });
    await expect(reseller.topUp(iccid, 0, { idempotencyKey: 't' })).rejects.toMatchObject({
      code: 'invalid_request',
    });
    expect(() => reseller.advanceUsage(iccid, -1)).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
  });
});
