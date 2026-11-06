/**
 * POST /gift/reclaim (brief §4.3, D-7, A-17, T-71): the payer of a lapsed gift gets the USDC back (minus the fee)
 * from the separate treasury wallet. Absence must be PROVEN: the escrow read and the receipt read both have to
 * succeed (a ledger error is a 503, never a refund). A pending `gift-reclaim` receipt with a per-gift logical key is
 * written BEFORE treasury.refund — it is the cross-process lock and the "already reclaimed" evidence; a refund that
 * throws leaves it pending (operator reconciles) and a retry never refunds twice. On success the same receipt is
 * patched with the refund tx and HCS reference (`ReceiptStore.patch`, A-38). TREASURY_MAX_USD6_PER_DAY is summed
 * from today's refund receipts on the ledger (`spentUsd6ForDay`, every refund kind), so a restart or a crash loop
 * does not reset it (RT-A-11); the check and the pending write run under one in-process lock, so two refunds cannot
 * both pass the last dollar of the cap. `reserveRefund` / `payRefund` are that machinery, shared with /plan/cancel.
 */
import { pad, type Address } from 'viem';

import { sha256Hex } from '@ethglobal/crypto';
import { decideGiftReclaim, type Challenge, type GiftReclaimVerdict } from '@ethglobal/octroi';
import { RechargeError, type ErrorCode } from '@ethglobal/protocol/errors';
import { dayBucket, keys, type Hex } from '@ethglobal/protocol/ids';
import type {
  Gift,
  GiftReclaimRequest,
  GiftReclaimResponse,
  Receipt,
} from '@ethglobal/protocol/schemas';
import { GIFT_RECLAIM_TYPES, rechargeDomain } from '@ethglobal/protocol/typed-data';
import { usd6FromWire, usd6ToWire } from '@ethglobal/protocol/units';

import { fail } from '../errors.js';
import { signedBy } from '../signatures.js';
import { consume } from './challenge.js';
import { escrowOf } from './gift.js';
import { addReceipt, errName, submitHcs, type ReceiptDraft, type Recorded } from './record.js';

import type { Deps } from '../deps.js';

type Deny = Extract<GiftReclaimVerdict, { kind: 'deny' }>['reason'];
export const RECLAIM_DENY_CODES: Readonly<Record<Deny, ErrorCode>> = {
  'too-early': 'replay',
  claimed: 'already_claimed',
  'already-reclaimed': 'replay',
  'not-payer': 'unauthorized',
  'unknown-gift': 'not_found',
  'window-closed': 'expired',
  'ledger-unavailable': 'ledger_unavailable',
  // fee ≥ amount paid: no zero-value transfer, no gift-reclaim receipt (octroi A-39, RT-O-09) — 410, nothing left
  'nothing-to-refund': 'expired',
};

/** The /gift/reclaim challenge binds the payer: its "session key" is the payer address left-padded to 32 bytes. */
export const reclaimSessionKey = (payer: string): Hex =>
  pad(payer.toLowerCase() as Hex, { size: 32 });

export async function reclaim(deps: Deps, req: GiftReclaimRequest): Promise<GiftReclaimResponse> {
  const giftId = req.giftId.toLowerCase() as Hex;
  await consume(deps, req.challenge as Challenge, '/gift/reclaim', reclaimSessionKey(req.payer));
  const ok = await signedBy({
    address: req.payer as Address,
    domain: rechargeDomain(deps.chainId),
    types: GIFT_RECLAIM_TYPES,
    primaryType: 'GiftReclaim',
    message: {
      giftId: req.giftId as Hex,
      payer: req.payer as Address,
      nonce: req.challenge.nonce as Hex,
    },
    signature: req.signature as Hex,
  });
  if (!ok) throw fail('unauthorized', { detail: 'bad GiftReclaim signature' });

  return deps.mutex.run(`reclaim:${giftId}`, async () => {
    const ent = keys.gift(giftId);
    let escrow: Gift | null = null;
    let receipts: Receipt[] = [];
    let ledgerOk = true;
    try {
      escrow = (await escrowOf(deps, giftId))?.payload ?? null;
      receipts = await deps.stores.receipts.forEntitlement(sha256Hex(ent));
    } catch {
      ledgerOk = false;
    }
    const verdict = decideGiftReclaim({
      giftId,
      payer: req.payer,
      now: deps.now(),
      escrow,
      receipts,
      ledgerOk,
      feeUsd6: deps.env.GIFT_RECLAIM_FEE_USD6,
    });
    if (verdict.kind === 'deny')
      throw fail(RECLAIM_DENY_CODES[verdict.reason], { reason: verdict.reason });

    const usd6 = usd6ToWire(verdict.usd6);
    const pending = { key: `rcpt:ledger:gift-reclaim:${giftId}`, kind: 'gift-reclaim' } as const;
    await reserveRefund(
      deps,
      ent,
      { ...pending, usd6, network: verdict.network, payer: verdict.to },
      'already-reclaimed',
    );
    const paid = await payRefund(
      deps,
      ent,
      pending,
      { network: verdict.network, to: verdict.to, usd6: verdict.usd6, memo: giftId },
      (tx) => ({
        t: 'gift-reclaim',
        giftId,
        network: verdict.network,
        tx,
        usd6,
        feeUsd6: usd6ToWire(verdict.feeUsd6),
      }),
    );
    if (!paid) throw fail('chain_unavailable', { reason: 'treasury_unavailable' });
    deps.logger.info(
      { event: 'settle', op: 'reclaim', network: verdict.network },
      'gift reclaimed',
    );
    return {
      giftId,
      refundedUsd6: usd6,
      feeUsd6: usd6ToWire(verdict.feeUsd6),
      network: verdict.network,
      tx: paid.tx,
      receipt: { arkivKey: paid.receiptKey ?? ent, ...(paid.hcs ? { hcs: paid.hcs } : {}) },
    };
  });
}

/** Every receipt kind the treasury pays out: one TREASURY_MAX_USD6_PER_DAY across them all (A-31). */
const REFUND_KINDS = ['gift-reclaim', 'plan-cancel'] as const;
interface Pending {
  key: string;
  kind: (typeof REFUND_KINDS)[number];
}

/**
 * The pending refund receipt, written BEFORE any side effect under the one treasury lock: today's refunds of every
 * kind (summed from the ledger) plus this one must stay within the cap (else 503 treasury_cap), then the receipt is
 * created under its logical key — the cross-process lock and the "already done" evidence (a taken key ⇒ 409
 * `already`).
 */
export async function reserveRefund(
  deps: Deps,
  ent: string,
  pending: Pending & ReceiptDraft & { usd6: string },
  already: string,
): Promise<void> {
  await deps.mutex.run('treasury-day', async () => {
    const day = dayBucket(deps.now());
    let spent = 0n;
    for (const kind of REFUND_KINDS) spent += await deps.stores.receipts.spentUsd6ForDay(kind, day);
    if (spent + usd6FromWire(pending.usd6) > deps.env.TREASURY_MAX_USD6_PER_DAY) {
      deps.logger.warn(
        { event: 'settle', op: pending.kind, reason: 'treasury_cap' },
        'treasury daily cap reached',
      );
      throw fail('chain_unavailable', { reason: 'treasury_cap' });
    }
    try {
      await addReceipt(deps, ent, pending);
    } catch (error) {
      if (error instanceof RechargeError && error.code === 'replay')
        throw fail('replay', { reason: already });
      throw error;
    }
  });
}

/**
 * treasury.refund, its HCS twin, then the pending receipt becomes the settled one (A-38: same key, now carrying the
 * refund tx and HCS reference). A refund that throws is logged and leaves the receipt pending — the operator
 * reconciles, and a retry finds the key taken, so nothing is ever paid twice — and answers `undefined`.
 */
export async function payRefund(
  deps: Deps,
  ent: string,
  pending: Pending,
  refund: { network: string; to: string; usd6: bigint; memo: string },
  hcsBody: (tx: string) => Parameters<typeof submitHcs>[2],
): Promise<{ tx: string; hcs: Recorded['hcs']; receiptKey: string | undefined } | undefined> {
  let tx: string;
  try {
    ({ tx } = await deps.adapters.treasury.refund(refund));
  } catch (error) {
    deps.logger.error(
      { event: 'settle', op: pending.kind, err: errName(error) },
      'treasury refund failed; pending receipt kept',
    );
    return undefined;
  }
  const hcs = await submitHcs(deps, ent, hcsBody(tx));
  const receiptKey = await deps.stores.receipts
    .patch(pending.key, { tx, ...(hcs ? { hcs } : {}) })
    .then((r) => r.key)
    .catch((error: unknown) => {
      deps.logger.error(
        { event: 'ledger.op', op: 'receipt.patch', kind: pending.kind, err: errName(error) },
        'refund receipt write failed',
      );
      return undefined;
    });
  return { tx, hcs, receiptKey };
}
