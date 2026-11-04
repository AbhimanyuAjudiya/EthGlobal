/**
 * fulfil(): the one path from a decided entitlement to a delivered eSIM (brief §4.2): durable intent first
 * (`pending-profile`), order with the entitlement key as idempotency key, seal the LPA to the buyer's session key,
 * store only the blob reference, receipt + HCS, and return the sealed box exactly once (T-25, T-31, T-40).
 */
import { isAdapterError, type EsimProfile } from '@ethglobal/adapters';
import {
  hexToBytes,
  lpaAad,
  openFromServer,
  sealLpa,
  sealToServer,
  sha256Hex,
  utf8,
  type SealedBox as CryptoBox,
} from '@ethglobal/crypto';
import type { Entitlement } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import {
  LPA_PATTERN,
  type EntitledResponse,
  type SealedBox,
  type SettleResult,
} from '@ethglobal/protocol/schemas';

import { fail } from '../errors.js';
import { errName, record, submitHcs, type ReceiptDraft } from './record.js';

import type { Deps } from '../deps.js';

const DAY_MS = 86_400_000;

export interface FulfilContext {
  /** Payment nonce (paid lanes) or challenge nonce (free/gift/card): the LPA's AAD (T-32). */
  nonce: Hex;
  sessionPubKey: Hex;
  /** Omitted when the caller already wrote the receipt (gift claims write theirs before delivery). */
  receipt?: ReceiptDraft;
  hcs: Parameters<typeof record>[3];
  claimTx?: string;
  settlement?: SettleResult;
}

export interface Fulfilled {
  status: 201 | 202;
  body: EntitledResponse;
}

/** Seals the profile's LPA and the ICCID; the clear LPA never leaves this function (T-31). */
async function seal(deps: Deps, key: string, profile: EsimProfile, sessionPubKey: Hex, nonce: Hex) {
  if (!LPA_PATTERN.test(profile.lpa))
    throw fail('reseller_unavailable', { detail: 'activation code malformed' });
  const sealed: SealedBox = sealLpa(profile.lpa, hexToBytes(sessionPubKey), lpaAad(nonce, key));
  const { ref } = await deps.adapters.blobs.put(utf8(JSON.stringify(sealed)), 'application/json');
  return {
    sealed,
    patch: {
      status: 'ready' as const,
      iccidHash: sha256Hex(profile.iccid),
      iccidEnc: sealToServer(deps.sealKey, profile.iccid, utf8(key)),
      sealedRef: ref,
    },
  };
}

export async function fulfil(
  deps: Deps,
  entitlement: Entitlement,
  ctx: FulfilContext,
): Promise<Fulfilled> {
  const { key } = entitlement;
  const created = await deps.stores.entitlements.create({
    ...entitlement,
    status: 'pending-profile',
  });
  deps.cache.seen(key, entitlement.expiresAt);
  let sealed: SealedBox | undefined;
  try {
    const profile = await deps.metrics.timed(
      'reseller_ms',
      () => deps.adapters.reseller.order(entitlement.planId, { idempotencyKey: key }),
      { op: 'order' },
    );
    const done = await seal(deps, key, profile, ctx.sessionPubKey, ctx.nonce);
    await deps.stores.entitlements.patch(key, done.patch);
    sealed = done.sealed;
  } catch (error) {
    // The human never proves (or pays) twice: the entitlement stays pending and /me (or the next boot) retries the
    // same order (T-25); the delivery target is durable state, so a restart does not strand it (RT-A-11).
    deps.pendingDelivery.set(
      key,
      { sessionPubKey: ctx.sessionPubKey, nonce: ctx.nonce },
      entitlement.expiresAt,
    );
    if (!isAdapterError(error) || error.adapter !== 'reseller') throw error;
    deps.logger.warn(
      { event: 'provision', status: 'pending-profile', err: errName(error) },
      'order failed; pending-profile',
    );
  }
  const recorded = ctx.receipt
    ? await record(deps, key, ctx.receipt, ctx.hcs)
    : { hcs: await submitHcs(deps, key, ctx.hcs) };
  deps.logger.info(
    { event: 'provision', kind: entitlement.kind, status: sealed ? 'ready' : 'pending-profile' },
    'provisioned',
  );
  const body: EntitledResponse = {
    entitlementKey: key,
    kind: entitlement.kind,
    status: sealed ? 'ready' : 'pending-profile',
    tier: entitlement.tier,
    mbTotal: entitlement.mbTotal,
    expiresAt: entitlement.expiresAt,
    validityDays: Math.round((entitlement.expiresAt - entitlement.createdAt) / DAY_MS),
    ...(sealed ? { sealedLpa: sealed } : {}),
    ...(ctx.claimTx === undefined ? {} : { claimTx: ctx.claimTx }),
    ...(ctx.settlement === undefined ? {} : { settlement: ctx.settlement }),
    receipt: { arkivKey: created.key, ...(recorded.hcs ? { hcs: recorded.hcs } : {}) },
  };
  return { status: sealed ? 201 : 202, body };
}

/**
 * /me (or boot) retry of a pending-profile order (≤ 1/min per key) with the same idempotency key. The new LPA is
 * sealed to the session key of the original request and stored as a blob reference only; it is NOT returned by /me
 * (T-31) — see README "Decisions" (AP6.3).
 */
export async function retryPending(deps: Deps, entitlement: Entitlement): Promise<Entitlement> {
  const delivery = deps.pendingDelivery.get(entitlement.key);
  if (!delivery || !deps.orderRetries.hit(entitlement.key).ok) return entitlement;
  try {
    const profile = await deps.adapters.reseller.order(entitlement.planId, {
      idempotencyKey: entitlement.key,
    });
    const done = await seal(deps, entitlement.key, profile, delivery.sessionPubKey, delivery.nonce);
    const found = await deps.stores.entitlements.patch(entitlement.key, done.patch);
    deps.pendingDelivery.delete(entitlement.key);
    deps.logger.info(
      { event: 'provision', status: 'ready', retried: true },
      'pending profile provisioned',
    );
    return found.payload;
  } catch (error) {
    deps.logger.warn(
      { event: 'provision', status: 'pending-profile', err: errName(error) },
      'order retry failed',
    );
    return entitlement;
  }
}

/**
 * Boot (RT-A-11): every pending-profile delivery the durable state still holds is retried once; a delivery whose
 * entitlement is gone or no longer pending is dropped. Never throws (a failed retry stays pending for /me).
 */
export async function retryPendingOnBoot(deps: Deps): Promise<{ retried: number; ready: number }> {
  let retried = 0;
  let ready = 0;
  for (const [key] of deps.pendingDelivery.entries()) {
    try {
      const found = await deps.stores.entitlements.getByKey(key);
      if (found?.payload.status !== 'pending-profile') {
        deps.pendingDelivery.delete(key);
        continue;
      }
      retried++;
      if ((await retryPending(deps, found.payload)).status === 'ready') ready++;
    } catch (error) {
      deps.logger.warn({ event: 'provision', err: errName(error) }, 'boot retry skipped');
    }
  }
  if (retried > 0) deps.logger.info({ event: 'provision', retried, ready }, 'boot retries done');
  return { retried, ready };
}

/**
 * Top-up of an existing, live entitlement (brief §4.2 fulfilTopUp): reseller, then the ledger. The patch is the
 * function form (octroi A-38): `mbTotal` is recomputed from each fresh row under compare-and-swap, so two concurrent
 * paid top-ups both land (RT-A-01, T-27).
 */
export async function fulfilTopUp(
  deps: Deps,
  existing: Entitlement,
  mb: number,
  nonce: Hex,
): Promise<Entitlement> {
  if (existing.iccidEnc === undefined)
    throw fail('invalid_request', { detail: 'profile not provisioned yet' });
  const iccid = openFromServer(deps.sealKey, existing.iccidEnc as CryptoBox, utf8(existing.key));
  await deps.metrics.timed(
    'reseller_ms',
    () => deps.adapters.reseller.topUp(iccid, mb, { idempotencyKey: nonce }),
    { op: 'topUp' },
  );
  const expiresAt = Math.max(existing.expiresAt, deps.now() + deps.env.VALIDITY_DAYS * DAY_MS);
  const found = await deps.stores.entitlements.patch(
    existing.key,
    (current) => ({ mbTotal: current.mbTotal + mb, expiresAt }),
    { expiresAt },
  );
  deps.cache.invalidate(existing.key);
  deps.cache.seen(existing.key, expiresAt);
  return found.payload;
}
