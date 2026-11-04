/**
 * POST /gift/reclaim (brief §4.3, D-7, A-17, T-71): the payer of a lapsed gift gets the USDC back (minus the fee)
 * from the separate treasury wallet. Absence must be PROVEN: the escrow read and the receipt read both have to
 * succeed (a ledger error is a 503, never a refund). A pending `gift-reclaim` receipt with a per-gift logical key is
 * written BEFORE treasury.refund — it is the cross-process lock and the "already reclaimed" evidence; a refund that
 * throws leaves it pending (operator reconciles) and a retry never refunds twice.
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
import { usd6ToWire } from '@ethglobal/protocol/units';

import { fail } from '../errors.js';
import { signedBy } from '../signatures.js';
import { consume } from './challenge.js';
import { escrowOf } from './gift.js';
import { addReceipt, errName, submitHcs } from './record.js';

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

    const day = dayBucket(deps.now());
    if (deps.treasuryDay.day !== day) deps.treasuryDay = { day, spentUsd6: 0n };
    if (deps.treasuryDay.spentUsd6 + verdict.usd6 > deps.env.TREASURY_MAX_USD6_PER_DAY) {
      deps.logger.warn(
        { event: 'settle', op: 'reclaim', reason: 'treasury_cap' },
        'treasury daily cap reached',
      );
      throw fail('chain_unavailable', { reason: 'treasury_cap' });
    }
    const usd6 = usd6ToWire(verdict.usd6);
    const draft = {
      kind: 'gift-reclaim' as const,
      usd6,
      network: verdict.network,
      payer: verdict.to,
    };
    try {
      await addReceipt(deps, ent, { ...draft, key: `rcpt:ledger:gift-reclaim:${giftId}` });
    } catch (error) {
      if (error instanceof RechargeError && error.code === 'replay')
        throw fail('replay', { reason: 'already-reclaimed' });
      throw error;
    }
    deps.treasuryDay.spentUsd6 += verdict.usd6;
    let tx: string;
    try {
      ({ tx } = await deps.adapters.treasury.refund({
        network: verdict.network,
        to: verdict.to,
        usd6: verdict.usd6,
        memo: giftId,
      }));
    } catch (error) {
      deps.logger.error(
        { event: 'settle', op: 'reclaim', err: errName(error) },
        'treasury refund failed; pending receipt kept',
      );
      throw fail('chain_unavailable', { reason: 'treasury_unavailable' });
    }
    const hcs = await submitHcs(deps, ent, {
      t: 'gift-reclaim',
      giftId,
      network: verdict.network,
      tx,
      usd6,
      feeUsd6: usd6ToWire(verdict.feeUsd6),
    });
    // the settled twin of the pending receipt (ReceiptStore has no patch): same kind, keyed by the refund tx
    const receiptKey = await addReceipt(deps, ent, { ...draft, tx }, hcs).catch(
      (error: unknown) => {
        deps.logger.error(
          { event: 'ledger.op', op: 'receipt.add', kind: 'gift-reclaim', err: errName(error) },
          'reclaim receipt write failed',
        );
        return undefined;
      },
    );
    deps.logger.info(
      { event: 'settle', op: 'reclaim', network: verdict.network },
      'gift reclaimed',
    );
    return {
      giftId,
      refundedUsd6: usd6,
      feeUsd6: usd6ToWire(verdict.feeUsd6),
      network: verdict.network,
      tx,
      receipt: { arkivKey: receiptKey ?? ent, ...(hcs ? { hcs } : {}) },
    };
  });
}
