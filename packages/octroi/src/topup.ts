/** The agent's top-up rule (INTERFACES §5, A-13, A-14; T-30). Pure; all money is bigint Usd6. */
import { RechargeError } from '@ethglobal/protocol/errors';
import {
  topUpPolicySchema,
  type Entitlement,
  type TopUpPolicyWire,
} from '@ethglobal/protocol/schemas';
import { usd6FromWire, usd6ToWire } from '@ethglobal/protocol/units';

export interface TopUpPolicy {
  maxUsd6PerDay: bigint;
  thresholdMb: number;
  stepMb: number;
  paused: boolean;
  topUpOnExpiry: boolean;
  expiryLeadS: number;
}

export type TopUpVerdict =
  | { buy: false; reason: 'ok' | 'paused' | 'cap' | 'expired' | 'already-bought-for-expiry' }
  | { buy: true; mb: number; reason: 'threshold' | 'expiry'; costUsd6: bigint };

/**
 * Evaluated top to bottom: paused → expired → already bought for this expiresAt → expiry lead → threshold
 * → ok; a candidate is refused when spentToday + stepPrice would exceed the daily cap (exactly reaching it
 * is allowed). `stepPriceUsd6` is the price of `p.stepMb`. A step price ≤ 0, a negative spend or a non-finite
 * `now` is malformed input and never buys (RT-O-07).
 */
export function shouldTopUp(
  e: Entitlement,
  p: TopUpPolicy,
  spentTodayUsd6: bigint,
  now: number,
  stepPriceUsd6: bigint,
  lastExpiryBought?: number,
): TopUpVerdict {
  // Untrusted numbers never buy (RT-O-07): a non-positive or unknown step price would slip the cap, a
  // non-finite clock would skip the expiry check, a negative spend would widen the cap.
  if (!(stepPriceUsd6 > 0n) || spentTodayUsd6 < 0n || !Number.isFinite(now)) {
    return { buy: false, reason: 'ok' };
  }
  if (p.paused) return { buy: false, reason: 'paused' };
  if (now >= e.expiresAt) return { buy: false, reason: 'expired' };
  const inExpiryLead = p.topUpOnExpiry && e.expiresAt - now <= p.expiryLeadS * 1000;
  if (inExpiryLead && lastExpiryBought === e.expiresAt) {
    return { buy: false, reason: 'already-bought-for-expiry' };
  }
  let reason: 'threshold' | 'expiry';
  if (inExpiryLead) reason = 'expiry';
  else if (e.mbTotal - e.mbUsed <= p.thresholdMb) reason = 'threshold';
  else return { buy: false, reason: 'ok' };
  if (spentTodayUsd6 + stepPriceUsd6 > p.maxUsd6PerDay) return { buy: false, reason: 'cap' };
  return { buy: true, mb: p.stepMb, reason, costUsd6: stepPriceUsd6 };
}

function parsePolicy(w: unknown): TopUpPolicyWire {
  const parsed = topUpPolicySchema.safeParse(w);
  if (!parsed.success) {
    throw new RechargeError('invalid_request', 'invalid top-up policy', parsed.error.issues);
  }
  return parsed.data;
}

export function policyFromWire(w: TopUpPolicyWire): TopUpPolicy {
  const valid = parsePolicy(w);
  return { ...valid, maxUsd6PerDay: usd6FromWire(valid.maxUsd6PerDay) };
}

export function policyToWire(p: TopUpPolicy): TopUpPolicyWire {
  return parsePolicy({ ...p, maxUsd6PerDay: usd6ToWire(p.maxUsd6PerDay) });
}
