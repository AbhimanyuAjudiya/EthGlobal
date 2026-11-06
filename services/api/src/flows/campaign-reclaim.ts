/** Opt-in event reimbursements. Vendor credit and the sponsor's USDC refund are separate accounting events. */
import type { EsimProfile } from '@ethglobal/adapters';
import { openFromServer, sealToServer, sha256Hex, utf8, type SealedBox } from '@ethglobal/crypto';
import { entitlementIndex, type Campaign, type Entitlement } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import type { MeResponse } from '@ethglobal/protocol/schemas';

import { fail } from '../errors.js';
import { reserveRefund } from './reclaim.js';
import { errName, flushReceiptOutbox } from './record.js';
import { journalRefund } from './refund-recovery.js';

import type { Deps } from '../deps.js';

export interface CampaignReclaimJob {
  v: 1;
  entitlement: Entitlement;
  campaignId: Hex;
  claimKey: Hex;
  claimTx?: Hex;
  network: string;
  contract: string;
  sponsor: string;
  refundUsd6: string;
  noticeVersion: 1;
  reclaimAfter: number;
  phase:
    | 'awaiting-claim'
    | 'awaiting-profile'
    | 'scheduled'
    | 'vendor-cancel-pending'
    | 'refund-pending'
    | 'complete'
    | 'ineligible'
    | 'manual';
  /** Explicit persisted state, never inferred from a missing field on an older journal entry. */
  orderState: 'not-started' | 'attempted';
  createdAt: number;
  nextAttemptAt: number;
  attempts: number;
  iccidSealed?: SealedBox;
  providerRef?: string;
  cancellationConfirmedAt?: number;
  resolution?: 'cancelled' | 'unallocated';
  resolvedAt?: number;
  cancelAttemptedAt?: number;
  refundTx?: string;
  reason?: string;
}

export const campaignRefundKey = (key: string): string =>
  `rcpt:ledger:campaign-reclaim:${sha256Hex(key)}`;

/** Checkpoint a verified, newly consented event claim before broadcast; no refund until its transaction is proven. */
export function enrollCampaignReclaim(
  deps: Deps,
  campaign: Campaign,
  entitlement: Entitlement,
  claimKey: Hex,
  claimTx?: Hex,
): void {
  const event = campaign.event;
  if (!event?.reclaimUnused || event.noticeVersion !== 1) return;
  const existing = deps.campaignReclaims.get(entitlement.key);
  if (existing) {
    if (
      existing.claimKey !== claimKey ||
      (existing.claimTx !== undefined && claimTx !== undefined && existing.claimTx !== claimTx) ||
      existing.campaignId !== campaign.id
    )
      throw fail('replay');
    if (claimTx && !existing.claimTx)
      deps.campaignReclaims.set(entitlement.key, {
        ...existing,
        claimTx,
        phase: existing.phase === 'awaiting-claim' ? 'awaiting-profile' : existing.phase,
      });
    return;
  }
  deps.campaignReclaims.set(entitlement.key, {
    v: 1,
    entitlement,
    campaignId: campaign.id as Hex,
    claimKey,
    ...(claimTx ? { claimTx } : {}),
    network: campaign.network,
    contract: campaign.contract,
    sponsor: campaign.sponsor,
    refundUsd6: campaign.pricePerClaimUsd6.toString(),
    noticeVersion: 1,
    reclaimAfter: event.reclaimAfter,
    phase: claimTx ? 'awaiting-profile' : 'awaiting-claim',
    orderState: 'not-started',
    createdAt: deps.now(),
    nextAttemptAt: event.reclaimAfter,
    attempts: 0,
  });
}

/** Must precede every call that can allocate, including adapter fallback and an idempotent order retry. */
export function campaignOrderStarting(deps: Deps, key: string): void {
  assertCampaignDelivery(deps, key);
  const job = deps.campaignReclaims.get(key);
  // Installed profiles may keep their existing service/ciphertext, but no phase permits a new order after
  // the disclosed allocation deadline, even if a stale pending-delivery snapshot is retried.
  if (job && deps.now() >= job.reclaimAfter)
    throw fail('expired', { detail: 'the event provisioning deadline has passed' });
  if (job && job.orderState !== 'attempted')
    deps.campaignReclaims.set(key, { ...job, orderState: 'attempted' });
}

/** Capture identity before the activation blob/ledger writes; no raw ICCID or LPA leaves private state. */
export function captureCampaignProfile(deps: Deps, key: string, profile: EsimProfile): void {
  const job = deps.campaignReclaims.get(key);
  if (!job) return;
  if (job.iccidSealed) {
    const previous = openFromServer(deps.sealKey, job.iccidSealed, utf8(key));
    if (previous !== profile.iccid || (job.providerRef && job.providerRef !== profile.providerRef))
      throw fail('reseller_unavailable', { detail: 'event profile identity changed' });
    return;
  }
  deps.campaignReclaims.set(key, {
    ...job,
    phase: 'scheduled',
    entitlement: {
      ...job.entitlement,
      ...(profile.lifecycle === undefined ? {} : { lifecycle: profile.lifecycle }),
    },
    iccidSealed: sealToServer(deps.sealKey, profile.iccid, utf8(key)),
    ...(profile.providerRef === undefined ? {} : { providerRef: profile.providerRef }),
  });
}

export function campaignReclaimBlocks(deps: Deps, key: string): boolean {
  const job =
    deps.campaignReclaims.get(key) ??
    (key.startsWith('hk:')
      ? deps.campaignReclaims
          .entries()
          .find(([capability]) => entitlementIndex(capability) === key)?.[1]
      : undefined);
  return !!job && job.phase !== 'ineligible' && deps.now() >= job.reclaimAfter;
}

export function assertCampaignDelivery(deps: Deps, key: string): void {
  if (campaignReclaimBlocks(deps, key))
    throw fail('expired', {
      detail: 'event allocation is being reconciled after its disclosed deadline',
    });
}

export function campaignReclaimView(deps: Deps, key: string): MeResponse['campaignReclaim'] {
  const job = deps.campaignReclaims.get(key);
  if (!job) return undefined;
  const refund = deps.refundJobs.get(campaignRefundKey(key));
  return {
    state:
      job.phase === 'complete'
        ? 'refunded'
        : job.phase === 'ineligible'
          ? 'ineligible'
          : job.phase === 'manual' || refund?.phase === 'manual'
            ? 'manual'
            : deps.now() < job.reclaimAfter
              ? 'scheduled'
              : 'pending',
    reclaimAfter: job.reclaimAfter,
    ...(job.refundTx ? { refundTx: job.refundTx } : {}),
  };
}

/** A bounded, fairly ordered pass. Uncertain jobs are never expired, silently discarded or replaced. */
export async function recoverCampaignReclaims(deps: Deps): Promise<void> {
  if (deps.health.degraded) return;
  const due = deps.campaignReclaims
    .entries()
    .filter(
      ([, job]) =>
        job.phase !== 'complete' && job.phase !== 'ineligible' && job.nextAttemptAt <= deps.now(),
    )
    .sort((a, b) => a[1].nextAttemptAt - b[1].nextAttemptAt || a[1].createdAt - b[1].createdAt)
    .slice(0, 20);
  for (const [key] of due) {
    await deps.mutex.run(key, async () => {
      const job = deps.campaignReclaims.get(key);
      if (
        !job ||
        job.phase === 'complete' ||
        job.phase === 'ineligible' ||
        job.nextAttemptAt > deps.now()
      )
        return;
      deps.campaignReclaims.set(key, {
        ...job,
        attempts: job.attempts + 1,
        nextAttemptAt: deps.now() + 60_000,
      });
      try {
        await reclaimOne(deps, key);
      } catch (error) {
        deps.logger.warn(
          { event: 'campaign-reclaim', err: errName(error) },
          'event reimbursement awaits reconciliation',
        );
      }
    });
  }
}

async function reclaimOne(deps: Deps, key: string): Promise<void> {
  let job = deps.campaignReclaims.get(key)!;
  const save = (patch: Partial<CampaignReclaimJob>) => {
    job = { ...job, ...patch };
    deps.campaignReclaims.set(key, job);
    deps.cache.invalidate(key);
  };
  if (deps.now() < job.reclaimAfter) return;
  if (!job.claimTx) {
    if (!(await deps.dataDrop.claimed(job.campaignId, job.claimKey))) {
      // An absent read can lag a previously submitted transaction. Retain the private liability until there
      // is positive claim evidence or an operator reconciles the original transaction's definitive failure.
      save({
        phase: 'manual',
        reason: 'campaign-claim-unconfirmed',
        nextAttemptAt: deps.now() + 15 * 60_000,
      });
      return;
    }
    const claimTx = await deps.dataDrop.claimTransaction?.(job.campaignId, job.claimKey);
    if (!claimTx) {
      save({ phase: 'manual', reason: 'claim-transaction-unresolved' });
      return;
    }
    save({ claimTx, phase: 'awaiting-profile' });
  }
  if (!job.resolution && job.orderState === 'not-started') {
    // Explicit pre-order journal state proves this confirmed allocation never reached the vendor.
    await ensureReservation(deps, key, job);
    save({
      phase: 'refund-pending',
      resolution: 'unallocated',
      resolvedAt: deps.now(),
      reason: 'unallocated',
    });
  }
  // A pending profile cannot be ordered after the deadline just to obtain something to cancel.
  if (!job.resolution && !job.iccidSealed) {
    save({
      phase: 'manual',
      reason: 'provider-allocation-unresolved',
      nextAttemptAt: deps.now() + 15 * 60_000,
    });
    return;
  }
  await flushReceiptOutbox(deps);
  if (!job.resolution) {
    const current = await deps.stores.entitlements.getByKey(key);
    const receipts = await deps.stores.receipts.forEntitlement(sha256Hex(key));
    const paid =
      receipts.some((r) => r.kind === 'topup' || r.kind === 'agent-topup') ||
      deps.paidOperations.entries().some(([, operation]) => operation.targetKey === key) ||
      deps.topUpIntents.entries().some(([, intent]) => intent.key === key) ||
      (current?.payload.appliedTopUps?.length ?? 0) > 0;
    if (
      paid ||
      (current &&
        (current.payload.mbUsed > 0 ||
          current.payload.status === 'installed' ||
          current.payload.status === 'active'))
    ) {
      if (job.phase === 'vendor-cancel-pending' || job.phase === 'manual') {
        save({ phase: 'manual', reason: 'state-changed-during-cancellation' });
      } else save({ phase: 'ineligible', reason: paid ? 'paid-topup' : 'installed-or-used' });
      return;
    }
    const reseller = deps.adapters.reseller;
    if (!reseller.cancellationEvidence) {
      save({ phase: 'manual', reason: 'provider-cancellation-evidence-unavailable' });
      return;
    }
    const iccid = openFromServer(deps.sealKey, job.iccidSealed!, utf8(key));
    const options = job.providerRef ? { providerRef: job.providerRef } : {};
    let evidence = await reseller.cancellationEvidence(iccid, options);
    if (evidence.status === 'ineligible') {
      save(
        job.cancelAttemptedAt === undefined
          ? { phase: 'ineligible', reason: 'vendor-refused' }
          : { phase: 'manual', reason: 'vendor-state-changed-after-cancel-attempt' },
      );
      return;
    }
    if (evidence.status === 'unknown') {
      save({ phase: 'manual', reason: 'vendor-status-unknown' });
      return;
    }
    const receiptKey = campaignRefundKey(key);
    await ensureReservation(deps, key, job);
    if (evidence.status !== 'cancelled') {
      if (job.cancelAttemptedAt !== undefined) {
        save({ phase: 'manual', reason: 'prior-cancellation-outcome-unresolved' });
        return;
      }
      // Persist before side effects. A timeout keeps the plan held and is reconciled by exact provider identity.
      save({
        phase: 'vendor-cancel-pending',
        cancelAttemptedAt: deps.now(),
        ...(evidence.providerRef ? { providerRef: evidence.providerRef } : {}),
      });
      await reseller.cancel(iccid, {
        idempotencyKey: receiptKey,
        ...(job.providerRef ? { providerRef: job.providerRef } : {}),
      });
      evidence = await reseller.cancellationEvidence(
        iccid,
        job.providerRef ? { providerRef: job.providerRef } : {},
      );
      if (evidence.status !== 'cancelled') return;
    }
    save({
      phase: 'refund-pending',
      resolution: 'cancelled',
      resolvedAt: deps.now(),
      cancellationConfirmedAt: deps.now(),
    });
    deps.agentPass?.revoke(key);
    if (current) await deps.stores.entitlements.patch(key, {}, { expiresAt: deps.now() + 1000 });
  }
  // Original claim price only; recipient comes from the verified campaign, never request input.
  if (!deps.refundJobs.has(campaignRefundKey(key))) await ensureReservation(deps, key, job);
  const refund = await journalRefund(deps, {
    entitlementKey: key,
    receiptKey: campaignRefundKey(key),
    kind: 'campaign-reclaim',
    input: {
      network: job.network,
      to: job.sponsor,
      usd6: job.refundUsd6,
      memo: `event refund ${job.campaignId}`,
    },
    hcsBody: {
      t: 'campaign-reclaim',
      campaignId: job.campaignId,
      claimKey: job.claimKey,
      network: job.network,
      to: job.sponsor,
      usd6: job.refundUsd6,
      tx: '',
      ...(job.resolution ? { reason: job.resolution } : {}),
    },
  });
  if (refund) save({ phase: 'complete', refundTx: refund.tx });
}

export function campaignReclaimSummary(deps: Deps, campaignId: string) {
  const jobs = deps.campaignReclaims
    .entries()
    .map(([, job]) => job)
    .filter((job) => job.campaignId.toLowerCase() === campaignId.toLowerCase());
  const sum = (rows: CampaignReclaimJob[]) =>
    rows.reduce((total, job) => total + BigInt(job.refundUsd6), 0n).toString();
  return {
    scheduled: jobs.filter(
      (job) =>
        job.phase === 'scheduled' ||
        job.phase === 'awaiting-profile' ||
        job.phase === 'awaiting-claim',
    ).length,
    pending: jobs.filter((job) =>
      ['vendor-cancel-pending', 'refund-pending', 'manual'].includes(job.phase),
    ).length,
    completed: jobs.filter((job) => job.phase === 'complete').length,
    ineligible: jobs.filter((job) => job.phase === 'ineligible').length,
    refundPendingUsd6: sum(
      jobs.filter((job) => job.resolution !== undefined && job.phase !== 'complete'),
    ),
    refundedUsd6: sum(jobs.filter((job) => job.phase === 'complete')),
  };
}

async function ensureReservation(deps: Deps, key: string, job: CampaignReclaimJob): Promise<void> {
  const receiptKey = campaignRefundKey(key);
  const existing = await deps.stores.receipts.byKey(receiptKey);
  if (existing) {
    if (
      existing.kind !== 'campaign-reclaim' ||
      existing.usd6 !== job.refundUsd6 ||
      existing.network !== job.network ||
      existing.payer?.toLowerCase() !== job.sponsor.toLowerCase()
    )
      throw fail('replay', { detail: 'campaign refund reservation mismatch' });
    return;
  }
  await reserveRefund(
    deps,
    key,
    {
      key: receiptKey,
      kind: 'campaign-reclaim',
      campaignId: job.campaignId,
      mb: job.entitlement.mbTotal,
      usd6: job.refundUsd6,
      network: job.network,
      payer: job.sponsor,
    },
    'campaign-refund-reserved',
  );
}
