/**
 * Red-team verification of RT-O-01 (capability ≠ ledger index, A-34) through the real API: a ledger reader knows
 * only `entitlementIndex(key)` = `hk:` + sha256(key) (annotation AND payload). That value must open nothing anywhere —
 * not /me/:key (fresh cache, stale cache while the ledger is down, the 410-vs-404 oracle), not /me/:key/receipts.
 */
import { describe, expect, it, vi } from 'vitest';

import { sha256Hex, utf8 } from '@ethglobal/crypto';
import { entitlementIndex } from '@ethglobal/octroi';

import { harness, provisioned } from '../support/harness.js';

const indexOf = (key: string): string => `hk:${sha256Hex(utf8(key))}`;

describe('verify RT-O-01: a ledger-read hk: index is never a capability (API)', () => {
  it('the index the ledger stores is the one an observer reads (control)', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 'verify-o01-control');
    expect(entitlementIndex(key)).toBe(indexOf(key));
    expect((await h.get(`/me/${encodeURIComponent(key)}`)).status).toBe(200);
    expect((await h.get(`/me/${encodeURIComponent(indexOf(key))}?refresh=1`)).status).toBe(404);
  });

  // RT-O-01 (verification variant, fixed): MeCache was keyed by entitlementIndex(key), so the victim's own /me read primed an
  // entry /me/<hk:index> served. The cache is now keyed by a keyed HMAC of the capability and /me refuses `hk:` first.
  it('/me/<hk:index> after the owner read /me/<key> ⇒ 404, never the owner’s entitlement [RT-O-01]', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 'verify-o01-cache');
    const own = await h.get(`/me/${encodeURIComponent(key)}`);
    expect(own.status).toBe(200);
    const stolen = await h.get(`/me/${encodeURIComponent(indexOf(key))}`);
    expect(JSON.stringify(await stolen.json())).not.toContain(key);
    expect(stolen.status).toBe(404);
  });

  it('/me/<hk:index> while the ledger is down, and after expiry ⇒ the same 404 as an unknown key [RT-O-01]', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 'verify-o01-stale');
    expect((await h.get(`/me/${encodeURIComponent(key)}`)).status).toBe(200);
    const unknown = await h.get(`/me/${encodeURIComponent(`hk:${'0'.repeat(64)}`)}`);
    const spy = vi.spyOn(h.adapters.ledger, 'query').mockRejectedValue(new Error('arkiv down'));
    const degraded = await h.get(`/me/${encodeURIComponent(indexOf(key))}`);
    spy.mockRestore();
    h.clock.advance(8 * 86_400_000);
    const expired = await h.get(`/me/${encodeURIComponent(indexOf(key))}`);
    const expiredCap = await h.get(`/me/${encodeURIComponent(key)}`);
    expect([unknown.status, degraded.status, expired.status, expiredCap.status]).toEqual([
      404, 404, 404, 404,
    ]);
    const bodies = await Promise.all(
      [unknown, degraded, expired, expiredCap].map(async (r) => ({
        ...((await r.json()) as object),
        requestId: undefined,
      })),
    );
    for (const b of bodies) expect(b).toEqual(bodies[0]);
  });

  it('/me/<hk:index>/receipts ⇒ no receipts', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 'verify-o01-receipts');
    const res = await h.get(`/me/${encodeURIComponent(indexOf(key))}/receipts`);
    expect(((await res.json()) as { receipts: unknown[] }).receipts).toHaveLength(0);
  });
});
