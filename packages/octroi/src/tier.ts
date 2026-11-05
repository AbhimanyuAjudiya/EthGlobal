/** Credential tiers (INTERFACES §5, T-22). */
import type { Tier, VerificationLevel } from '@ethglobal/protocol/schemas';

export type { Tier } from '@ethglobal/protocol/schemas';

const LEVEL_TIER: Readonly<Record<VerificationLevel, Tier>> = Object.freeze({
  orb: 'orb',
  document: 'document',
  secure_document: 'document',
  device: 'device',
});

/**
 * Only from the verifier's response level (`PersonhoodResult.level`), never from the request body (T-22).
 * orb→orb, document|secure_document→document, device→device; anything else (a value outside the enum that
 * slipped past a live adapter) → none, which sizes to 0 MB.
 */
export function tierFromLevel(level: VerificationLevel): Tier {
  return Object.hasOwn(LEVEL_TIER, level) ? LEVEL_TIER[level] : 'none';
}
