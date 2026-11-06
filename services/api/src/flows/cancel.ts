/**
 * POST /plan/cancel: the payer of an unused paid plan cancels it and gets the payment back, minus the gift-reclaim
 * fee, through the reclaim refund machinery (reserveRefund / payRefund). Order: CancelPlan signature by the payer on a
 * payer-bound challenge → the entitlement's mutex → eligibility (the ledger half in `decidePlanCancel`, then the
 * vendor must read the profile unused) → the pending `plan-cancel` receipt (cap, cross-process lock, "already
 * cancelled" evidence) → reseller.cancel (refused ⇒ the receipt is aborted with usd6 '0', 409, nothing refunded) →
 * treasury.refund (throws ⇒ 202 refund pending, never paid twice) → the entitlement expires now; /me then answers
 * the cancelled plan from its receipt.
 */
import { isAddress, type Address } from 'viem';

import { isAdapterError } from '@ethglobal/adapters';
import { openFromServer, sha256Hex, utf8, type SealedBox } from '@ethglobal/crypto';
import type { Challenge, Entitlement } from '@ethglobal/octroi';
import type { ErrorCode } from '@ethglobal/protocol/errors';
import type { Hex } from '@ethglobal/protocol/ids';
import type { PlanCancelRequest, PlanCancelResponse, Receipt } from '@ethglobal/protocol/schemas';
import {
  CANCEL_PLAN_TYPES,
  PLAN_CANCEL_TTL_MS,
  rechargeDomain,
} from '@ethglobal/protocol/typed-data';
import { usd6FromWire, usd6ToWire } from '@ethglobal/protocol/units';

import { fail } from '../errors.js';
import { signedBy } from '../signatures.js';
import { consume } from './challenge.js';
import { payRefund, reclaimSessionKey, reserveRefund } from './reclaim.js';
import { errName, flushReceiptOutbox } from './record.js';
import { refundRecovery } from './refund-recovery.js';

import type { Deps } from '../deps.js';

const FUTURE_SKEW_MS = 60_000;

export type PlanCancelDeny =
  | 'not-paid'
  | 'already-cancelled'
  | 'topped-up'
  | 'installed'
  | 'pending-profile'
  | 'not-payer'
  | 'no-payment'
  | 'nothing-to-refund';

export const CANCEL_DENY_CODES: Readonly<Record<PlanCancelDeny, ErrorCode>> = {
  // free, sponsored, gift and card plans: no wallet paid for them, nothing to give back
  'not-paid': 'replay',
  'already-cancelled': 'replay',
  'topped-up': 'replay',
  installed: 'replay',
  'pending-profile': 'replay',
  'not-payer': 'unauthorized',
  'no-payment': 'not_found',
  // fee ≥ amount paid: no zero-value transfer (as reclaim, A-39) — 410
  'nothing-to-refund': 'expired',
};

export type PlanCancelVerdict =
  | { kind: 'refund'; to: Address; network: string; usd6: bigint; feeUsd6: bigint }
  | { kind: 'deny'; reason: PlanCancelDeny };

/**
 * The ledger half of the eligibility, pure (the vendor's "unused" is read at cancel time); /me shows its refund.
 * Refund = the provision receipt's usd6 on its network minus max(fee, 0), to the payer the ENTITLEMENT recorded —
 * an EVM address, since only an address can sign CancelPlan; never an address from the request.
 */
export function decidePlanCancel(
  e: Entitlement,
  receipts: readonly Receipt[],
  feeUsd6: bigint,
): PlanCancelVerdict {
  const deny = (reason: PlanCancelDeny) => ({ kind: 'deny', reason }) as const;
  if (e.kind !== 'paid') return deny('not-paid');
  if (receipts.some((r) => r.kind === 'plan-cancel')) return deny('already-cancelled');
  if (receipts.some((r) => r.kind === 'topup' || r.kind === 'agent-topup'))
    return deny('topped-up');
  if (e.status === 'installed' || e.status === 'active') return deny('installed');
  if (e.iccidEnc === undefined) return deny('pending-profile');
  if (e.payer === undefined || !isAddress(e.payer, { strict: false })) return deny('not-payer');
  const paid = receipts.find((r) => r.kind === 'provision');
  if (paid?.usd6 === undefined || paid.network === undefined) return deny('no-payment');
  const usd6 = usd6FromWire(paid.usd6);
  const fee = feeUsd6 < 0n ? 0n : feeUsd6;
  if (fee >= usd6) return deny('nothing-to-refund');
  return { kind: 'refund', to: e.payer, network: paid.network, usd6: usd6 - fee, feeUsd6: fee };
}

/** The plan's one cancel receipt (logical key per entitlement; sha256 of the key, never the capability). */
export const cancelReceiptKey = (key: string): string =>
  `rcpt:ledger:plan-cancel:${sha256Hex(key)}`;

/** A plan-cancel receipt the vendor refused (usd6 '0', terminal): the plan was never cancelled. */
export const aborted = (r: Receipt): boolean => r.kind === 'plan-cancel' && r.usd6 === '0';

export async function cancelPlan(
  deps: Deps,
  req: PlanCancelRequest,
): Promise<{ status: 200 | 202; body: PlanCancelResponse }> {
  const now = deps.now();
  if (req.issuedAt > now + FUTURE_SKEW_MS)
    throw fail('invalid_request', [{ path: 'issuedAt', message: 'in the future' }]);
  if (now - req.issuedAt > PLAN_CANCEL_TTL_MS) throw fail('expired', { detail: 'issuedAt' });
  await consume(deps, req.challenge as Challenge, '/plan/cancel', reclaimSessionKey(req.payer));
  const ok = await signedBy({
    address: req.payer as Address,
    domain: rechargeDomain(deps.chainId),
    types: CANCEL_PLAN_TYPES,
    primaryType: 'CancelPlan',
    message: {
      entitlementKey: req.entitlementKey,
      payer: req.payer as Address,
      nonce: req.challenge.nonce as Hex,
      issuedAt: BigInt(req.issuedAt),
    },
    signature: req.signature as Hex,
  });
  if (!ok) throw fail('unauthorized', { detail: 'bad CancelPlan signature' });
  return deps.mutex.run(req.entitlementKey, () =>
    cancelLocked(deps, req.entitlementKey, req.payer),
  );
}

async function cancelLocked(
  deps: Deps,
  key: string,
  signer: string,
): Promise<{ status: 200 | 202; body: PlanCancelResponse }> {
  await flushReceiptOutbox(deps);
  const found = await deps.stores.entitlements.getByKey(key);
  if (!found) throw fail('not_found'); // unknown and expired alike (RT-O-01)
  const e = found.payload;
  if (deps.paidOperations.entries().some(([, operation]) => operation.targetKey === key))
    throw fail('replay', { reason: 'topped-up' });
  const receipts = await deps.stores.receipts.forEntitlement(sha256Hex(key));
  const verdict = decidePlanCancel(e, receipts, deps.env.GIFT_RECLAIM_FEE_USD6);
  if (verdict.kind === 'deny')
    throw fail(CANCEL_DENY_CODES[verdict.reason], { reason: verdict.reason });
  if (verdict.to.toLowerCase() !== signer.toLowerCase())
    throw fail('unauthorized', { reason: 'not-payer' });
  const iccid = openFromServer(deps.sealKey, e.iccidEnc as SealedBox, utf8(key));
  // the vendor is the authority on "unused": installed or in use ⇒ 409 and nothing is written
  const usage = await deps.adapters.reseller.usage(iccid);
  if (usage.status !== 'ready' || usage.usedMb > 0) throw fail('replay', { reason: 'installed' });

  const usd6 = usd6ToWire(verdict.usd6);
  const pending = { key: cancelReceiptKey(key), kind: 'plan-cancel' } as const;
  const cancelledAt = deps.now(); // = the receipt's `at`, which /me reports once the entity is gone
  await reserveRefund(
    deps,
    key,
    { ...pending, usd6, network: verdict.network, payer: verdict.to, mb: e.mbTotal },
    'already-cancelled',
  );
  deps.cache.invalidate(key); // /me stops offering the refund, whatever the vendor answers
  try {
    await deps.metrics.timed(
      'reseller_ms',
      () => deps.adapters.reseller.cancel(iccid, { idempotencyKey: pending.key }),
      { op: 'cancel' },
    );
  } catch (error) {
    // unavailable / rate limited: the vendor's answer is unknown — the receipt stays pending, so no top-up and no
    // second attempt reaches the plan, and nothing is refunded until the operator has reconciled it
    if (!isAdapterError(error) || error.code === 'unavailable' || error.code === 'rate_limited') {
      deps.logger.error(
        { event: 'settle', op: 'plan-cancel', err: errName(error) },
        'vendor cancel unconfirmed; pending receipt kept',
      );
      throw error;
    }
    // refused: terminal and nothing refunded; usd6 '0' marks it aborted and frees its share of the day's cap
    await deps.stores.receipts.patch(pending.key, { usd6: '0' }).catch((patchError: unknown) => {
      deps.logger.error(
        { event: 'ledger.op', op: 'receipt.patch', kind: 'plan-cancel', err: errName(patchError) },
        'aborted cancel receipt write failed',
      );
    });
    throw fail('replay', { reason: 'vendor-refused' });
  }

  const paid = await payRefund(
    deps,
    key,
    pending,
    { network: verdict.network, to: verdict.to, usd6: verdict.usd6, memo: sha256Hex(key) },
    (tx) => ({
      t: 'plan-cancel',
      network: verdict.network,
      tx,
      usd6,
      feeUsd6: usd6ToWire(verdict.feeUsd6),
    }),
  );
  // the profile is gone at the vendor, refunded or not: the plan ends now (its Arkiv entity's lifetime is ≥ 1 s)
  const expiresAt = deps.now() + 1_000;
  await deps.stores.entitlements.patch(key, {}, { expiresAt }).catch((error: unknown) => {
    deps.logger.error(
      { event: 'ledger.op', op: 'entitlement.patch', err: errName(error) },
      'cancelled plan expiry write failed',
    );
  });
  deps.cache.invalidate(key);
  deps.cache.seen(key, expiresAt);
  deps.logger.info(
    { event: 'settle', op: 'plan-cancel', network: verdict.network, refunded: paid !== undefined },
    'plan cancelled',
  );
  return {
    status: paid ? 200 : 202,
    body: {
      cancelledAt,
      refund: {
        network: verdict.network,
        usd6,
        ...(paid ? { tx: paid.tx } : { recovery: refundRecovery(deps, pending.key) }),
      },
      receipt: {
        arkivKey: paid?.receiptKey ?? pending.key,
        ...(paid?.hcs ? { hcs: paid.hcs } : {}),
      },
    },
  };
}
