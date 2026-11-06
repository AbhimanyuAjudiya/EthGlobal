import type { MeResponse } from '@ethglobal/protocol/schemas';

/** Minimal durable facts available before a first /me snapshot, including while travelling offline. */
export type ActivationPolicy = Pick<
  MeResponse,
  'expiresAt' | 'lifecycle' | 'campaignReclaim' | 'cancelledAt'
>;

/** A cached activation code never overrides cancellation, provider expiry, or disclosed event recovery. */
export function activationBlocked(policy: ActivationPolicy, now: number): boolean {
  const providerExpiry = policy.lifecycle?.serviceExpiresAt ?? policy.lifecycle?.installBy;
  if (
    policy.cancelledAt !== undefined ||
    policy.expiresAt <= now ||
    (providerExpiry !== undefined && providerExpiry <= now)
  )
    return true;
  const reclaim = policy.campaignReclaim;
  return (
    reclaim !== undefined &&
    reclaim.state !== 'ineligible' &&
    (reclaim.state !== 'scheduled' || reclaim.reclaimAfter <= now)
  );
}
