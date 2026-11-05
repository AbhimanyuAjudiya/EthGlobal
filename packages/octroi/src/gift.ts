/** The gift-reclaim rule (INTERFACES §5, A-17, D-7; T-71). Pure: decided from what the caller read. */
import { GIFT_CLAIM_WINDOW_S, GIFT_RECLAIM_WINDOW_S, type Hex } from '@ethglobal/protocol/ids';
import type { Gift, Receipt } from '@ethglobal/protocol/schemas';
import { usd6FromWire } from '@ethglobal/protocol/units';

export type GiftReclaimVerdict =
  | { kind: 'refund'; to: string; network: string; usd6: bigint; feeUsd6: bigint }
  | {
      kind: 'deny';
      reason:
        | 'too-early'
        | 'claimed'
        | 'already-reclaimed'
        | 'not-payer'
        | 'unknown-gift'
        | 'window-closed'
        | 'ledger-unavailable'
        /** fee ≥ amount paid: a zero-value refund would only burn treasury gas (A-39, RT-O-09). */
        | 'nothing-to-refund';
    };

type ReclaimDeny = Extract<GiftReclaimVerdict, { kind: 'deny' }>;
const deny = (reason: ReclaimDeny['reason']): ReclaimDeny => ({ kind: 'deny', reason });

/**
 * 'refund' only when: ledger ok ∧ a 'gift' receipt with network and usd6 ∧ its payer == payer ∧ no
 * 'gift-claim' (and the escrow, if still readable, is not claimed) ∧ no 'gift-reclaim' ∧ escrow gone ∧
 * now ≥ claimBy ∧ now < claimBy + GIFT_RECLAIM_WINDOW_S. claimBy = receipt.at + GIFT_CLAIM_WINDOW_S
 * (the receipt does not carry it). Amount = usd6 − max(fee, 0); a fee ≥ usd6 is 'nothing-to-refund' (no 0n
 * transfer, no gift-reclaim receipt; A-39, RT-O-09).
 */
export function decideGiftReclaim(input: {
  giftId: Hex;
  payer: string;
  now: number;
  escrow: Gift | null;
  receipts: Receipt[];
  ledgerOk: boolean;
  feeUsd6: bigint;
}): GiftReclaimVerdict {
  const { payer, now, escrow, receipts } = input;
  if (!input.ledgerOk) return deny('ledger-unavailable');
  const paid = receipts.find((r) => r.kind === 'gift');
  if (paid?.network === undefined || paid.usd6 === undefined) return deny('unknown-gift');
  if (paid.payer?.toLowerCase() !== payer.toLowerCase()) return deny('not-payer');
  if (escrow?.state === 'claimed' || receipts.some((r) => r.kind === 'gift-claim')) {
    return deny('claimed');
  }
  if (receipts.some((r) => r.kind === 'gift-reclaim')) return deny('already-reclaimed');
  if (escrow !== null) return deny('too-early');
  const claimBy = paid.at + GIFT_CLAIM_WINDOW_S * 1000;
  if (now < claimBy) return deny('too-early'); // the ledger dropped the escrow early (T-35)
  if (now >= claimBy + GIFT_RECLAIM_WINDOW_S * 1000) return deny('window-closed');
  const usd6 = usd6FromWire(paid.usd6);
  const feeUsd6 = input.feeUsd6 < 0n ? 0n : input.feeUsd6;
  if (feeUsd6 >= usd6) return deny('nothing-to-refund');
  return { kind: 'refund', to: payer, network: paid.network, usd6: usd6 - feeUsd6, feeUsd6 };
}
