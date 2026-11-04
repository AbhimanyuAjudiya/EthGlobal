/**
 * Red-team verification of RT-O-01 (capability ≠ ledger index, A-34) through the real API: a ledger reader knows
 * only `entitlementIndex(key)` = `hk:` + sha256(key) (annotation AND payload). That value must open nothing anywhere —
 * not /me/:key (fresh cache, stale cache while the ledger is down, the 410-vs-404 oracle), not /me/:key/receipts.
 */
import { describe, expect, it } from 'vitest';

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

  // RT-FINDING RT-O-01: MeCache is keyed by entitlementIndex(key), and entitlementIndex is idempotent on `hk:` values, so the
  // victim's own /me read primes a cache entry that /me/<hk:index> serves for 60 s without ever calling getByKey.
  it('/me/<hk:index> after the owner read /me/<key> ⇒ 404, never the owner’s entitlement_RTFINDING', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 'verify-o01-cache');
    const own = await h.get(`/me/${encodeURIComponent(key)}`);
    expect(own.status).toBe(200);
    const stolen = await h.get(`/me/${encodeURIComponent(indexOf(key))}`);
    // observed: 200 with the owner's MeResponse, including `entitlementKey` — the capability itself
    expect(JSON.stringify(await stolen.json())).not.toContain(key);
    expect(stolen.status).toBe(404);
  });

  it('/me/<hk:index>/receipts ⇒ no receipts', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 'verify-o01-receipts');
    const res = await h.get(`/me/${encodeURIComponent(indexOf(key))}/receipts`);
    expect(((await res.json()) as { receipts: unknown[] }).receipts).toHaveLength(0);
  });
});
