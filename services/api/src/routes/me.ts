/**
 * GET /me/:key (R1; the only cached read, T-51), GET /me/:key/receipts and POST /plan/cancel. Never returns an LPA
 * (T-31).
 */
import { openFromServer, sha256Hex, utf8, type SealedBox } from '@ethglobal/crypto';
import { INDEX_PREFIX, type Entitlement } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import {
  planCancelRequestSchema,
  deliveryRequestSchema,
  type DeliveryRequest,
  type MeResponse,
  type PlanCancelRequest,
  type ReceiptPublic,
} from '@ethglobal/protocol/schemas';
import { usd6ToWire } from '@ethglobal/protocol/units';

import { inputOf, type AppEnv } from '../context.js';
import { fail } from '../errors.js';
import { patchUsage } from './webhooks.js';
import { aborted, cancelPlan, cancelReceiptKey, decidePlanCancel } from '../flows/cancel.js';
import { activationBox, assertDeliveryUsable, fulfil, retryPending } from '../flows/fulfil.js';
import { flushReceiptOutbox } from '../flows/record.js';
import { recoverRefunds, refundRecovery } from '../flows/refund-recovery.js';
import { validateJson } from '../middleware/validate.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

const KEY = /^[\x21-\x7E]{8,160}$/;
/** A capability, never a ledger index (`hk:…` is world-readable off Arkiv, RT-O-01): checked before any cache. */
const isCapability = (key: string): boolean => KEY.test(key) && !key.startsWith(INDEX_PREFIX);
/** Statuses whose cached copy may be served while the ledger is down (T-51); a pending profile changes underfoot. */
const STALE_OK = new Set<Entitlement['status']>(['ready', 'installed', 'active']);

export function registerMe(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/me/:key/delivery', validateJson(deliveryRequestSchema), async (c) => {
    const key = c.req.param('key');
    if (!isCapability(key)) throw fail('not_found');
    const { sessionPubKey } = inputOf<DeliveryRequest>(c);
    const delivery = deps.pendingDelivery.get(key);
    if (delivery?.sessionPubKey.toLowerCase() !== sessionPubKey.toLowerCase())
      throw fail('unauthorized');
    let found = await deps.stores.entitlements.getByKey(key);
    const original = found?.payload ?? delivery.entitlement;
    if (original) await assertDeliveryUsable(deps, original);
    if (!found && delivery.entitlement && delivery.context) {
      if (deps.health.degraded) throw fail('ledger_unavailable');
      await deps.mutex.run(key, () => fulfil(deps, delivery.entitlement!, delivery.context!));
      found = await deps.stores.entitlements.getByKey(key);
    }
    if (!found) throw fail('not_found');
    let entitlement = found.payload;
    if (entitlement.status === 'pending-profile') {
      if (deps.health.degraded) throw fail('ledger_unavailable');
      entitlement = await retryPending(deps, entitlement);
    }
    const target = deps.pendingDelivery.get(key);
    if (target?.sessionPubKey.toLowerCase() !== sessionPubKey.toLowerCase())
      throw fail('unauthorized');
    if (entitlement.status === 'pending-profile') return c.json({ status: 'pending-profile' }, 202);
    return c.json({
      status: 'ready',
      nonce: target.nonce,
      sealedLpa: await activationBox(deps, entitlement),
    });
  });

  app.get('/me/:key', async (c) => {
    const key = c.req.param('key');
    if (!isCapability(key)) throw fail('not_found');
    await recoverRefunds(deps, key);
    // The vendor is already cancelled when a refund job exists, even if the entitlement expiry patch failed.
    if (deps.refundJobs.has(cancelReceiptKey(key))) return c.json(await cancelledMe(deps, key));
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
    // expired and unknown are the same 404 (RT-O-01): /me is no liveness oracle for a key — except to the holder of
    // a cancelled plan's capability: its one plan-cancel receipt says how it ended
    if (!found) return c.json(await cancelledMe(deps, key));
    let e = found.payload;
    if (e.status === 'pending-profile') e = await retryPending(deps, e);
    if (refresh) e = await poll(deps, e);
    const me = toMe(
      deps,
      e,
      found.entityKey,
      await sponsorName(deps, e),
      await refundable(deps, e),
    );
    deps.cache.remember(key, me, { staleAllowed: STALE_OK.has(e.status) });
    return c.json(me);
  });

  app.get('/me/:key/receipts', async (c) => {
    const key = c.req.param('key');
    if (!isCapability(key)) throw fail('not_found');
    await flushReceiptOutbox(deps);
    const receipts = await deps.stores.receipts.forEntitlement(sha256Hex(key));
    // never the key or its hash; a free claim's payer field is the sponsor-side pseudonym and stays off /me (AP4.3)
    const publicReceipts: ReceiptPublic[] = receipts.map(
      ({ key: _k, entitlementKeyHash: _h, ...r }) =>
        r.kind === 'claim' ? (({ payer: _p, ...rest }) => rest)(r) : r,
    );
    return c.json({ receipts: publicReceipts });
  });

  app.post('/plan/cancel', validateJson(planCancelRequestSchema), async (c) => {
    const { status, body } = await cancelPlan(deps, inputOf<PlanCancelRequest>(c));
    return c.json(body, status);
  });
}

/** Paid and ready: what POST /plan/cancel would refund now and to whom (the ledger half of its eligibility). */
async function refundable(deps: Deps, e: Entitlement): Promise<MeResponse['refundable']> {
  if (e.kind !== 'paid' || e.status !== 'ready') return undefined;
  if (deps.paidOperations.entries().some(([, operation]) => operation.targetKey === e.key))
    return undefined;
  const receipts = await deps.stores.receipts.forEntitlement(sha256Hex(e.key)).catch(() => null);
  if (!receipts) return undefined; // the offer waits for the next read; the cancel itself re-checks everything
  const v = decidePlanCancel(e, receipts, deps.env.GIFT_RECLAIM_FEE_USD6);
  return v.kind === 'refund'
    ? { usd6: usd6ToWire(v.usd6), network: v.network, to: v.to }
    : undefined;
}

/**
 * A cancelled plan once its entity has expired: the plan-cancel receipt is the record — the paid, unused plan of
 * `mb`, ended (expiresAt) at its cancel, with its refund (no tx = pending). Anything else is the 404. One exact
 * lookup by the receipt's logical key, empty alike for an expired and an unknown key: reading the key's other
 * receipts would time-separate them (RT-O-01).
 */
async function cancelledMe(deps: Deps, key: string): Promise<MeResponse> {
  const r = await deps.stores.receipts.byKey(cancelReceiptKey(key));
  if (r?.network === undefined || r.usd6 === undefined || aborted(r)) throw fail('not_found');
  const cancelledAt = deps.refundJobs.get(cancelReceiptKey(key))?.createdAt ?? r.at;
  return {
    entitlementKey: key,
    kind: 'paid',
    status: 'ready',
    tier: 'none',
    mbTotal: r.mb ?? 0,
    mbUsed: 0,
    remainingMb: 0,
    usageAsOf: cancelledAt,
    usageSource: 'none',
    expiresAt: cancelledAt,
    arkivKey: r.key,
    ledgerReadAt: deps.now(),
    cached: false,
    degraded: deps.health.degraded,
    network: r.network,
    cancelledAt,
    refund: {
      network: r.network,
      usd6: r.usd6,
      ...(r.tx === undefined
        ? { recovery: refundRecovery(deps, cancelReceiptKey(key)) }
        : { tx: r.tx }),
    },
  };
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
  refund: MeResponse['refundable'],
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
    ...(refund === undefined ? {} : { refundable: refund }),
  };
}
