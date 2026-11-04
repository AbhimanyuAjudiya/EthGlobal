/** GET /me/:key (R1; the only cached read, T-51) and GET /me/:key/receipts. Never returns an LPA (T-31). */
import { openFromServer, sha256Hex, utf8, type SealedBox } from '@ethglobal/crypto';
import type { Entitlement } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import type { MeResponse, ReceiptPublic } from '@ethglobal/protocol/schemas';

import { type AppEnv } from '../context.js';
import { fail } from '../errors.js';
import { patchUsage } from './webhooks.js';
import { retryPending } from '../flows/fulfil.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

const KEY = /^[\x21-\x7E]{8,160}$/;

export function registerMe(app: Hono<AppEnv>, deps: Deps): void {
  app.get('/me/:key', async (c) => {
    const key = c.req.param('key');
    if (!KEY.test(key)) throw fail('not_found');
    const refresh = c.req.query('refresh') === '1';
    if (!refresh) {
      const cached = deps.cache.fresh(key);
      if (cached) return c.json({ ...cached, cached: true, degraded: deps.health.degraded });
    }
    let found;
    try {
      found = await deps.stores.entitlements.getByKey(key);
    } catch (error) {
      const stale = deps.cache.stale(key);
      if (stale) return c.json({ ...stale, cached: true, degraded: true });
      throw error;
    }
    if (!found) throw fail(deps.cache.expired(key) ? 'expired' : 'not_found');
    let e = found.payload;
    if (e.status === 'pending-profile') e = await retryPending(deps, e);
    if (refresh) e = await poll(deps, e);
    const me = toMe(deps, e, found.entityKey, await sponsorName(deps, e));
    deps.cache.remember(key, me);
    return c.json(me);
  });

  app.get('/me/:key/receipts', async (c) => {
    const key = c.req.param('key');
    if (!KEY.test(key)) throw fail('not_found');
    const receipts = await deps.stores.receipts.forEntitlement(sha256Hex(key));
    // never the key or its hash; a free claim's payer field is the sponsor-side pseudonym and stays off /me (AP4.3)
    const publicReceipts: ReceiptPublic[] = receipts.map(
      ({ key: _k, entitlementKeyHash: _h, ...r }) =>
        r.kind === 'claim' ? (({ payer: _p, ...rest }) => rest)(r) : r,
    );
    return c.json({ receipts: publicReceipts });
  });
}

/** ?refresh=1: reseller.usage at most once per minute per ICCID (shared with webhooks). */
async function poll(deps: Deps, e: Entitlement): Promise<Entitlement> {
  if (e.iccidEnc === undefined || e.iccidHash === undefined) return e;
  if (!deps.usagePolls.hit(e.iccidHash).ok) return e;
  const iccid = openFromServer(deps.sealKey, e.iccidEnc as SealedBox, utf8(e.key));
  try {
    const usage = await deps.adapters.reseller.usage(iccid);
    await patchUsage(deps, e.key, e.mbUsed, e.mbTotal, usage, 'poll');
    return (await deps.stores.entitlements.getByKey(e.key))?.payload ?? e;
  } catch {
    return e;
  }
}

async function sponsorName(deps: Deps, e: Entitlement): Promise<string | undefined> {
  if (e.campaignId === undefined) return undefined;
  return (await deps.stores.campaigns.get(e.campaignId as Hex))?.payload.name;
}

function toMe(
  deps: Deps,
  e: Entitlement,
  entityKey: string,
  sponsor: string | undefined,
): MeResponse {
  return {
    entitlementKey: e.key,
    kind: e.kind,
    status: e.status,
    tier: e.tier,
    ...(e.campaignId === undefined ? {} : { campaignId: e.campaignId }),
    ...(sponsor === undefined ? {} : { sponsorName: sponsor }),
    mbTotal: e.mbTotal,
    mbUsed: e.mbUsed,
    remainingMb: Math.max(0, e.mbTotal - e.mbUsed),
    usageAsOf: e.usageAsOf,
    usageSource: e.usageSource,
    expiresAt: e.expiresAt,
    arkivKey: entityKey,
    ledgerReadAt: deps.now(),
    cached: false,
    degraded: deps.health.degraded,
    ...(e.network === undefined ? {} : { network: e.network }),
  };
}
