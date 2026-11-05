import { describe, expect, it, vi } from 'vitest';

import type { MeResponse } from '@ethglobal/protocol/schemas';

import { MeCache } from '../src/cache.js';
import { errorOf, harness, iccidOf, provisioned, topUp } from './support/harness.js';

describe('GET /me/:key', () => {
  it('reads the entity (R1); a second read within 60 s is cached; after 60 s it reads again', async () => {
    const h = await harness();
    const { path, body } = await provisioned(h);
    const query = vi.spyOn(h.adapters.ledger, 'query');
    const first = (await (await h.get(`/me/${path}`)).json()) as {
      cached: boolean;
      arkivKey: string;
      sponsorName: string;
    };
    expect(first).toMatchObject({
      cached: false,
      arkivKey: body.receipt.arkivKey,
      sponsorName: 'Mumbai Welcome',
    });
    const reads = query.mock.calls.length;
    expect(((await (await h.get(`/me/${path}`)).json()) as { cached: boolean }).cached).toBe(true);
    expect(query.mock.calls.length).toBe(reads);
    h.clock.advance(60_000);
    expect(((await (await h.get(`/me/${path}`)).json()) as { cached: boolean }).cached).toBe(false);
  });

  it('after expiry → the same 404 as unknown (RT-O-01: no liveness oracle; entity keys and random keys alike)', async () => {
    const h = await harness();
    const { path } = await provisioned(h);
    await h.get(`/me/${path}`);
    h.clock.advance(7 * 86_400_000 + 1);
    const gone = await h.get(`/me/${path}`);
    expect(gone.status).toBe(404);
    expect(await errorOf(gone)).toBe('not_found');
    const a = await h.get('/me/ent_000001');
    const b = await h.get(`/me/${encodeURIComponent(`ent:v1:0x${'ab'.repeat(32)}`)}`);
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(await a.json()).toEqual({
      ...((await b.json()) as object),
      requestId: a.headers.get('x-request-id'),
    });
    expect((await h.get('/me/short')).status).toBe(404);
  });

  it('?refresh=1 polls reseller.usage at most once per minute per ICCID', async () => {
    const h = await harness();
    const { path, key } = await provisioned(h);
    const usage = vi.spyOn(h.reseller, 'usage');
    h.reseller.advanceUsage(iccidOf(h, key), 25);
    for (let i = 0; i < 10; i++) await h.get(`/me/${path}?refresh=1`);
    expect(usage).toHaveBeenCalledTimes(1);
    expect(
      (await (await h.get(`/me/${path}?refresh=1`)).json()) as {
        mbUsed: number;
        usageSource: string;
      },
    ).toMatchObject({ mbUsed: 25, usageSource: 'poll' });
  });

  it('never includes sealedLpa, the ICCID or its sealed form', async () => {
    const h = await harness();
    const { path, key } = await provisioned(h);
    const text = await (await h.get(`/me/${path}`)).text();
    expect(text).not.toMatch(/sealedLpa|iccidEnc|sealedRef|LPA:/);
    expect(text).not.toContain(iccidOf(h, key));
  });

  it('receipts lists the claim and topup receipts without entitlementKeyHash (and no payer on the claim)', async () => {
    const h = await harness();
    const { path, key } = await provisioned(h);
    await topUp(h, key);
    const { receipts } = (await (await h.get(`/me/${path}/receipts`)).json()) as {
      receipts: Record<string, unknown>[];
    };
    expect(receipts.map((r) => r.kind)).toEqual(['claim', 'topup']);
    expect(receipts.every((r) => !('entitlementKeyHash' in r) && !('key' in r))).toBe(true);
    expect(receipts[0]).not.toHaveProperty('payer');
    expect(receipts[1]).toHaveProperty('payer');
  });

  it('degraded ledger: the cached copy is served with degraded: true; an uncached read is 503', async () => {
    const h = await harness();
    const { path } = await provisioned(h);
    await h.get(`/me/${path}`);
    h.clock.advance(61_000);
    vi.spyOn(h.adapters.ledger, 'query').mockRejectedValue(new Error('arkiv down'));
    expect(await (await h.get(`/me/${path}`)).json()).toMatchObject({
      cached: true,
      degraded: true,
    });
    expect((await h.get(`/me/${encodeURIComponent('paid:0xabc:0x01')}`)).status).toBe(503);
  });

  it('degraded ledger: a cached copy past its entitlement expiry, or one not marked stale-allowed, is never served [RT-O-01]', async () => {
    const h = await harness();
    const { path, key } = await provisioned(h);
    await h.get(`/me/${path}`);
    h.clock.advance(7 * 86_400_000 + 1);
    vi.spyOn(h.adapters.ledger, 'query').mockRejectedValue(new Error('arkiv down'));
    expect((await h.get(`/me/${path}`)).status).toBe(503);
    const other = new MeCache(h.clock.now);
    other.remember(key, { expiresAt: h.clock.now() + 1000 } as MeResponse);
    expect(other.stale(key)).toBeUndefined();
  });
});
