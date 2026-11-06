/** Refunds are journaled before broadcast. Recovery submits only the original signed transaction. */
import { isAdapterError, type PreparedRefund } from '@ethglobal/adapters';
import { dayBucket, RECEIPT_TTL_S } from '@ethglobal/protocol/ids';
import type { Receipt } from '@ethglobal/protocol/schemas';

import { fail } from '../errors.js';
import { errName, submitHcs, type Recorded } from './record.js';

import type { Deps } from '../deps.js';

export interface RefundJob {
  entitlementKey: string;
  receiptKey: string;
  kind: 'gift-reclaim' | 'plan-cancel';
  input: { network: string; to: string; usd6: string; memo: string };
  hcsBody: Extract<Parameters<typeof submitHcs>[2], { t: 'gift-reclaim' | 'plan-cancel' }>;
  phase: 'queued' | 'prepared' | 'confirmed' | 'complete' | 'manual';
  prepared?: PreparedRefund;
  tx?: string;
  hcs?: NonNullable<Recorded['hcs']>;
  createdAt: number;
  nextAttemptAt?: number;
  receipt?: Receipt;
}

export interface Refunded {
  tx: string;
  hcs: Recorded['hcs'];
  receiptKey: string | undefined;
}

const RETRY_MS = 15_000;
const MIRROR_GRACE_MS = 10 * 60_000;

export function refundRecovery(deps: Deps, key: string): 'automatic' | 'manual' {
  const job = deps.refundJobs.get(key);
  return !job ||
    job.phase === 'manual' ||
    deps.refundJobs
      .entries()
      .some(([, prior]) => prior.input.network === job.input.network && prior.phase === 'manual')
    ? 'manual'
    : 'automatic';
}

/** Called only after the durable refund receipt has reserved funds and the vendor cancellation succeeded. */
export async function journalRefund(
  deps: Deps,
  job: Omit<RefundJob, 'phase' | 'createdAt'>,
): Promise<Refunded | undefined> {
  if (!deps.refundJobs.has(job.receiptKey)) {
    const receipt = await deps.stores.receipts.byKey(job.receiptKey);
    if (!receipt) throw fail('ledger_unavailable', { detail: 'refund reservation missing' });
    deps.refundJobs.set(job.receiptKey, {
      ...job,
      receipt,
      phase: 'queued',
      createdAt: receipt.at,
    });
  }
  await recoverRefunds(deps, job.entitlementKey, true);
  const latest = deps.refundJobs.get(job.receiptKey);
  return latest?.tx && (latest.phase === 'confirmed' || latest.phase === 'complete')
    ? {
        tx: latest.tx,
        hcs: latest.hcs,
        receiptKey: latest.phase === 'complete' ? latest.receiptKey : undefined,
      }
    : undefined;
}

/** Known pending jobs never expire. Unknown legacy outcomes are left for explicit operator reconciliation. */
export async function recoverRefunds(
  deps: Deps,
  entitlementKey?: string,
  force = false,
): Promise<void> {
  const networks = new Set(
    deps.refundJobs
      .entries()
      .filter(([, job]) => entitlementKey === undefined || job.entitlementKey === entitlementKey)
      .map(([, job]) => job.input.network),
  );
  for (const network of networks)
    await deps.mutex.run(`refund-network:${network}`, async () => {
      const jobs = deps.refundJobs
        .entries()
        .filter(([, job]) => job.input.network === network)
        .sort((a, b) => a[1].createdAt - b[1].createdAt);
      for (const [key] of jobs) {
        const job = deps.refundJobs.get(key);
        if (!job || job.phase === 'complete') continue;
        // A pending signed nonce must resolve before another refund is prepared on this network.
        if (job.phase === 'manual' && !job.prepared) break;
        if (!force && (job.nextAttemptAt ?? 0) > deps.now()) break;
        try {
          if (!(await recoverOne(deps, job))) break;
        } catch (error) {
          deps.logger.error(
            { event: 'settle', op: job.kind, err: errName(error) },
            'refund recovery pending',
          );
          break;
        }
      }
    });
}

async function recoverOne(deps: Deps, initial: RefundJob): Promise<boolean> {
  let job = initial;
  const save = (next: RefundJob) => {
    deps.refundJobs.set(next.receiptKey, next);
    job = next;
  };
  if (job.phase !== 'confirmed') {
    const treasury = deps.adapters.treasury;
    const durable =
      typeof treasury.prepareRefund === 'function' &&
      typeof treasury.submitRefund === 'function' &&
      typeof treasury.refundStatus === 'function';
    if (durable) {
      if (!job.prepared) {
        await reserveBroadcastDay(deps, job);
        const prepared = await treasury.prepareRefund!({
          ...job.input,
          usd6: BigInt(job.input.usd6),
        });
        if (prepared.network !== job.input.network)
          throw new Error('refund preparation returned another network');
        save({ ...job, prepared, tx: prepared.tx, phase: 'prepared' });
      }
      const prepared = job.prepared!;
      save({ ...job, nextAttemptAt: deps.now() + RETRY_MS });
      const status = await treasury.refundStatus!(prepared);
      if (status === 'failed') {
        save({ ...job, phase: 'manual' });
        return false;
      }
      if (status !== 'success') {
        // Native validity expiring does not prove nonpayment. Stop broadcasting, retain the liability,
        // and keep reading the original transaction in case the mirror later confirms it.
        if (
          job.phase === 'manual' ||
          (prepared.expiresAt !== undefined && deps.now() > prepared.expiresAt + MIRROR_GRACE_MS)
        ) {
          save({ ...job, phase: 'manual' });
          return false;
        }
        try {
          const sent = await treasury.submitRefund!(prepared);
          if (sent.tx !== prepared.tx) throw new Error('refund transaction identity changed');
        } catch (error) {
          deps.logger.warn(
            { event: 'settle', op: job.kind, err: errName(error) },
            'signed refund awaits confirmation',
          );
          return false;
        }
      }
      save({ ...job, phase: 'confirmed' });
    } else {
      await reserveBroadcastDay(deps, job);
      // A legacy adapter can submit once. Checkpoint the uncertain state BEFORE calling it.
      save({ ...job, phase: 'manual' });
      try {
        const { tx } = await treasury.refund({ ...job.input, usd6: BigInt(job.input.usd6) });
        save({ ...job, tx, phase: 'confirmed' });
      } catch (error) {
        const tx =
          isAdapterError(error) && typeof error.details?.tx === 'string'
            ? error.details.tx
            : undefined;
        if (tx) save({ ...job, tx });
        deps.logger.error(
          { event: 'settle', op: job.kind, err: errName(error) },
          'refund outcome needs reconciliation',
        );
        return false;
      }
    }
  }
  const tx = job.tx!;
  if (!(await deps.stores.receipts.byKey(job.receiptKey))) {
    if (!job.receipt)
      throw fail('ledger_unavailable', { detail: 'refund reservation unavailable' });
    await deps.stores.receipts.add(job.receipt);
  }
  if (!job.hcs) {
    const hcs = await submitHcs(deps, job.entitlementKey, { ...job.hcsBody, tx });
    if (hcs) save({ ...job, hcs });
  }
  await deps.stores.receipts.patch(job.receiptKey, { tx, ...(job.hcs ? { hcs: job.hcs } : {}) });
  deps.refundJobs.set(
    job.receiptKey,
    { ...job, phase: 'complete' },
    deps.now() + RECEIPT_TTL_S * 1000,
  );
  deps.cache.invalidate(job.entitlementKey);
  return true;
}

/** A queued refund crossing midnight must reserve room in the day it first submits. */
async function reserveBroadcastDay(deps: Deps, job: RefundJob): Promise<void> {
  await deps.mutex.run('treasury-day', async () => {
    const day = dayBucket(deps.now());
    const receipt = await deps.stores.receipts.byKey(job.receiptKey);
    if (receipt && dayBucket(receipt.at) === day) return;
    const spent =
      (await deps.stores.receipts.spentUsd6ForDay('gift-reclaim', day)) +
      (await deps.stores.receipts.spentUsd6ForDay('plan-cancel', day));
    if (spent + BigInt(job.input.usd6) > deps.env.TREASURY_MAX_USD6_PER_DAY)
      throw fail('chain_unavailable', { reason: 'treasury_cap' });
    if (receipt) await deps.stores.receipts.patch(job.receiptKey, { at: deps.now() });
    else if (job.receipt) await deps.stores.receipts.add({ ...job.receipt, at: deps.now() });
    else throw fail('ledger_unavailable', { detail: 'refund reservation unavailable' });
  });
}
