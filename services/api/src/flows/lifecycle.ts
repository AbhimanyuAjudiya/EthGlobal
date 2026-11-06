import { MAX_CAMPAIGN_MS } from '@ethglobal/octroi';
import type { Entitlement } from '@ethglobal/protocol/schemas';

/** Positive provider dates only; a storage lifetime is never presented as the start of mobile service. */
export function providerExpiry(
  lifecycle: Entitlement['lifecycle'],
  now: number,
): number | undefined {
  const end = lifecycle?.serviceExpiresAt ?? lifecycle?.installBy;
  if (end === undefined || !Number.isSafeInteger(end) || end <= 0) return undefined;
  return Math.min(Math.max(end, now + 1000), now + MAX_CAMPAIGN_MS);
}
