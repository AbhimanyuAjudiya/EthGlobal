/**
 * fulfil(): the one path from a decided entitlement to a delivered eSIM (brief §4.2): durable intent first
 * (`pending-profile`), order with the entitlement key as idempotency key, seal the LPA to the buyer's session key,
 * store only the blob reference, receipt + HCS, and retain authenticated ciphertext recovery (T-25, T-31, T-40).
 */
import { isAdapterError, type EsimProfile } from '@ethglobal/adapters';
import {
  hexToBytes,
  hmacKey,
  lpaAad,
  openFromServer,
  sealLpa,
  sealToServer,
  sha256Hex,
  utf8,
  type SealedBox as CryptoBox,
} from '@ethglobal/crypto';
import type { Entitlement, Found } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import {
  LPA_PATTERN,
  type EntitledResponse,
  type SealedBox,
  type SettleResult,
} from '@ethglobal/protocol/schemas';

import { fail } from '../errors.js';
import { planEvent } from './campaign-history.js';
import {
  assertCampaignDelivery,
  campaignOrderStarting,
  campaignReclaimView,
  captureCampaignProfile,
} from './campaign-reclaim.js';
import { providerExpiry } from './lifecycle.js';
import { errName, record, submitHcs, type ReceiptDraft, type Recorded } from './record.js';

import type { Deps } from '../deps.js';

const DAY_MS = 86_400_000;

/** A private retry credential, independent of the public X25519 key used to address ciphertext. */
export const deliveryRecoveryHash = (
  deps: Pick<Deps, 'secret'>,
  token?: string,
): Hex | undefined =>
  token && /^[A-Za-z0-9_-]{32,128}$/.test(token)
    ? hmacKey(deps.secret, 'redemption-recovery', token)
    : undefined;

export interface FulfilContext {
  /** Payment nonce (paid lanes) or challenge nonce (free/gift/card): the LPA's AAD (T-32). */
  nonce: Hex;
  sessionPubKey: Hex;
  recoveryKeyHash?: Hex;
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
  captureCampaignProfile(deps, key, profile);
  assertCampaignDelivery(deps, key);
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
      ...(profile.lifecycle === undefined ? {} : { lifecycle: profile.lifecycle }),
    },
    expiresAt: providerExpiry(profile.lifecycle, deps.now()),
  };
}

export async function fulfil(
  deps: Deps,
  entitlement: Entitlement,
  ctx: FulfilContext,
): Promise<Fulfilled> {
  await assertDeliveryUsable(deps, entitlement);
  const { key } = entitlement;
  const target = deps.pendingDelivery.get(key);
  if (target && (target.sessionPubKey !== ctx.sessionPubKey || target.nonce !== ctx.nonce))
    throw fail('unauthorized', { detail: 'another delivery session owns this entitlement' });
  // The complete recovery intent precedes every external write, including creation of the entitlement itself.
  deps.pendingDelivery.set(
    key,
    {
      sessionPubKey: ctx.sessionPubKey,
      nonce: ctx.nonce,
      ...(ctx.recoveryKeyHash === undefined ? {} : { recoveryKeyHash: ctx.recoveryKeyHash }),
      entitlement,
      context: ctx,
    },
    entitlement.expiresAt,
  );
  const existing = await deps.stores.entitlements.getByKey(key);
  const created = existing
    ? { key: existing.entityKey }
    : await deps.stores.entitlements.create({ ...entitlement, status: 'pending-profile' });
  if (existing?.payload.sealedRef) {
    const sealed = await activationBox(deps, existing.payload);
    const recorded = ctx.receipt
      ? await record(deps, key, ctx.receipt, ctx.hcs)
      : { hcs: undefined };
    return {
      status: 201,
      body: entitledBody(existing.payload, existing.entityKey, {
        sealed,
        claimTx: ctx.claimTx,
        settlement: ctx.settlement,
        hcs: recorded.hcs,
        campaignReclaim: campaignReclaimView(deps, key),
        event: planEvent(deps, existing.payload),
      }),
    };
  }
  deps.cache.seen(key, entitlement.expiresAt);
  let sealed: SealedBox | undefined;
  let delivered = entitlement;
  try {
    campaignOrderStarting(deps, key);
    const profile = await deps.metrics.timed(
      'reseller_ms',
      () => deps.adapters.reseller.order(entitlement.planId, { idempotencyKey: key }),
      { op: 'order' },
    );
    const done = await seal(deps, key, profile, ctx.sessionPubKey, ctx.nonce);
    const updated = await deps.stores.entitlements.patch(
      key,
      done.patch,
      done.expiresAt === undefined ? {} : { expiresAt: done.expiresAt },
    );
    delivered = updated.payload;
    deps.pendingDelivery.set(
      key,
      { ...deps.pendingDelivery.get(key)!, entitlement: delivered },
      delivered.expiresAt,
    );
    sealed = done.sealed;
  } catch (error) {
    // The human never proves (or pays) twice: the entitlement stays pending and /me (or the next boot) retries the
    // same order (T-25); the delivery target is durable state, so a restart does not strand it (RT-A-11).
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
  const body = entitledBody(delivered, created.key, {
    sealed,
    claimTx: ctx.claimTx,
    settlement: ctx.settlement,
    hcs: recorded.hcs,
    campaignReclaim: campaignReclaimView(deps, key),
    event: planEvent(deps, delivered),
  });
  return { status: sealed ? 201 : 202, body };
}

/** A retained recovery intent cannot revive a terminal plan after its ledger entity disappears. */
export async function assertDeliveryUsable(deps: Deps, entitlement: Entitlement): Promise<void> {
  assertCampaignDelivery(deps, entitlement.key);
  if (entitlement.expiresAt <= deps.now()) throw fail('expired');
  if (entitlement.kind !== 'paid') return;
  const key = `rcpt:ledger:plan-cancel:${sha256Hex(entitlement.key)}`;
  const cancel = await deps.stores.receipts.byKey(key);
  if (deps.refundJobs.has(key) || (cancel !== null && cancel.usd6 !== '0'))
    throw fail('expired', { detail: 'plan cancellation has started' });
}

/** Retrieve ciphertext only; the secret session key never exists on the server. */
export async function activationBox(deps: Deps, entitlement: Entitlement): Promise<SealedBox> {
  if (!entitlement.sealedRef) throw fail('provisioning_pending');
  const bytes = await deps.adapters.blobs.get(entitlement.sealedRef);
  if (!bytes) throw fail('ledger_unavailable', { detail: 'activation blob unavailable' });
  const { sealedBoxSchema } = await import('@ethglobal/protocol/schemas');
  return sealedBoxSchema.parse(JSON.parse(new TextDecoder().decode(bytes)));
}

/** The entitledResponse body; `sealedLpa` only when sealed in this very request (T-31). */
function entitledBody(
  e: Entitlement,
  arkivKey: string,
  x: {
    sealed: SealedBox | undefined;
    claimTx: string | undefined;
    settlement: SettleResult | undefined;
    hcs: Recorded['hcs'];
    status?: 'ready' | 'pending-profile';
    campaignReclaim?: EntitledResponse['campaignReclaim'];
    event?: EntitledResponse['event'];
  },
): EntitledResponse {
  return {
    entitlementKey: e.key,
    kind: e.kind,
    status: x.status ?? (x.sealed ? 'ready' : 'pending-profile'),
    tier: e.tier,
    mbTotal: e.mbTotal,
    expiresAt: e.expiresAt,
    validityDays: e.lifecycle?.validityDays ?? Math.round((e.expiresAt - e.createdAt) / DAY_MS),
    ...(e.lifecycle === undefined ? {} : { lifecycle: e.lifecycle }),
    ...(x.campaignReclaim === undefined ? {} : { campaignReclaim: x.campaignReclaim }),
    ...(x.event === undefined ? {} : { event: x.event }),
    ...(x.sealed ? { sealedLpa: x.sealed } : {}),
    ...(x.claimTx === undefined ? {} : { claimTx: x.claimTx }),
    ...(x.settlement === undefined ? {} : { settlement: x.settlement }),
    receipt: { arkivKey, ...(x.hcs ? { hcs: x.hcs } : {}) },
  };
}

/** Lost redemption responses recover only plan metadata; the delivery endpoint returns the original AAD nonce. */
export function deliveryMetadata(
  found: Found<Entitlement>,
  context?: FulfilContext,
  deps?: Deps,
): Fulfilled {
  const pending = found.payload.status === 'pending-profile';
  return {
    status: pending ? 202 : 201,
    body: entitledBody(found.payload, found.entityKey, {
      sealed: undefined,
      claimTx: context?.claimTx,
      settlement: context?.settlement,
      hcs: undefined,
      status: pending ? 'pending-profile' : 'ready',
      ...(deps
        ? {
            campaignReclaim: campaignReclaimView(deps, found.payload.key),
            event: planEvent(deps, found.payload),
          }
        : {}),
    }),
  };
}

/**
 * The 202 an already-served, still pending-profile free claim answered, rebuilt from the ledger for a re-bind
 * (RT-A-17): the same plan key, status and claim receipt; never an LPA.
 */
export async function pendingResponse(deps: Deps, found: Found<Entitlement>): Promise<Fulfilled> {
  const e = found.payload;
  const receipts = await deps.stores.receipts.forEntitlement(sha256Hex(e.key));
  const claim = receipts.find((r) => r.kind === 'claim');
  return {
    status: 202,
    body: entitledBody(e, found.entityKey, {
      sealed: undefined,
      claimTx: claim?.tx,
      settlement: undefined,
      hcs: claim?.hcs,
      campaignReclaim: campaignReclaimView(deps, e.key),
      event: planEvent(deps, e),
    }),
  };
}

/**
 * /me (or boot) retry of a pending-profile order (≤ 1/min per key) with the same idempotency key. The new LPA is
 * sealed to the session key of the original request and stored as a blob reference only; it is NOT returned by /me
 * (T-31) — see README "Decisions" (AP6.3).
 */
export function retryPending(deps: Deps, entitlement: Entitlement): Promise<Entitlement> {
  // under the entitlement's mutex: a re-bind (RT-A-17) cannot move the target while this order is in flight
  return deps.mutex.run(entitlement.key, () => retryPendingLocked(deps, entitlement));
}

export async function retryPendingLocked(
  deps: Deps,
  entitlement: Entitlement,
): Promise<Entitlement> {
  const delivery = deps.pendingDelivery.get(entitlement.key);
  if (!delivery || !deps.orderRetries.hit(entitlement.key).ok) return entitlement;
  try {
    const current = await deps.stores.entitlements.getByKey(entitlement.key);
    if (current?.payload.status !== 'pending-profile') return current?.payload ?? entitlement;
    await assertDeliveryUsable(deps, current.payload);
    campaignOrderStarting(deps, entitlement.key);
    const profile = await deps.adapters.reseller.order(entitlement.planId, {
      idempotencyKey: entitlement.key,
    });
    const done = await seal(deps, entitlement.key, profile, delivery.sessionPubKey, delivery.nonce);
    const found = await deps.stores.entitlements.patch(
      entitlement.key,
      done.patch,
      done.expiresAt === undefined ? {} : { expiresAt: done.expiresAt },
    );
    deps.pendingDelivery.set(
      entitlement.key,
      { ...delivery, entitlement: found.payload },
      found.payload.expiresAt,
    );
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
 * ready entitlement retains its holder binding for encrypted delivery recovery. Never throws.
 */
export async function retryPendingOnBoot(deps: Deps): Promise<{ retried: number; ready: number }> {
  let retried = 0;
  let ready = 0;
  for (const [key, delivery] of deps.pendingDelivery.entries()) {
    try {
      const found = await deps.stores.entitlements.getByKey(key);
      if (!found && delivery.entitlement && delivery.context) {
        retried++;
        const result = await deps.mutex.run(key, () =>
          fulfil(deps, delivery.entitlement!, delivery.context!),
        );
        if (result.status === 201) ready++;
        continue;
      }
      if (found?.payload.status !== 'pending-profile') {
        // Older state files may contain only a target for an already expired/missing plan.
        if (!found) deps.pendingDelivery.delete(key);
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
  operationId: Hex = nonce,
): Promise<Entitlement> {
  assertCampaignDelivery(deps, existing.key);
  if (existing.iccidEnc === undefined)
    throw fail('invalid_request', { detail: 'profile not provisioned yet' });
  const iccid = openFromServer(deps.sealKey, existing.iccidEnc as CryptoBox, utf8(existing.key));
  let intent = deps.topUpIntents.get(operationId);
  if (!intent) {
    intent = {
      key: existing.key,
      mb,
      targetMb: existing.mbTotal + mb,
      expiresAt: Math.max(existing.expiresAt, deps.now() + deps.env.VALIDITY_DAYS * DAY_MS),
    };
    deps.topUpIntents.set(operationId, intent, intent.expiresAt);
  }
  if (intent.key !== existing.key || intent.mb !== mb) throw fail('replay');
  const targetMb = intent.targetMb;
  if (!intent.vendorDone) {
    await deps.metrics.timed(
      'reseller_ms',
      () =>
        deps.adapters.reseller.topUp(iccid, mb, {
          idempotencyKey: nonce,
          totalMb: targetMb,
        }),
      { op: 'topUp' },
    );
    intent = { ...intent, vendorDone: true };
    deps.topUpIntents.set(operationId, intent, intent.expiresAt);
  }
  const expiresAt = Math.max(existing.expiresAt, intent.expiresAt);
  const found = await deps.stores.entitlements.patch(
    existing.key,
    (current) =>
      current.appliedTopUps?.includes(operationId)
        ? {}
        : {
            mbTotal: current.mbTotal + mb,
            appliedTopUps: [...(current.appliedTopUps ?? []), operationId],
          },
    { expiresAt },
  );
  deps.cache.invalidate(existing.key);
  deps.cache.seen(existing.key, expiresAt);
  return found.payload;
}
