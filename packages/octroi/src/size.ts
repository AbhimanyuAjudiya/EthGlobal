/** Bundle sizing (INTERFACES §5, A-1; T-23). Integer Usd6 math, 1 GB = 1000 MB, no floats. */
import { MAX_BUNDLE_MB } from '@ethglobal/protocol/ids';

import type { Campaign } from './campaign.js';
import type { Tier } from './tier.js';

const MB_PER_GB = 1000n;
/** 0.8 as a ratio of integers: a free bundle may cost at most 80 % of what a verified ID resells for. */
const EV_NUM = 8n;
const EV_DEN = 10n;

/**
 * min(c.bundleMb[tier], floor(0.8 × idResale / (wholesale / 1000 MB)), 300); device|none → 0;
 * wholesale ≤ 0 → the configured size under the cap (T-23).
 */
export function sizeBundle(
  c: Pick<Campaign, 'bundleMb' | 'idResaleUsd6' | 'wholesaleUsd6PerGb'>,
  tier: Tier,
): number {
  if (tier !== 'orb' && tier !== 'document') return 0;
  const configured = c.bundleMb[tier];
  if (!Number.isSafeInteger(configured) || configured <= 0) return 0;
  const capped = Math.min(configured, MAX_BUNDLE_MB);
  if (c.wholesaleUsd6PerGb <= 0n) return capped;
  if (c.idResaleUsd6 <= 0n) return 0;
  const evMb = (EV_NUM * c.idResaleUsd6 * MB_PER_GB) / (EV_DEN * c.wholesaleUsd6PerGb);
  return evMb < BigInt(capped) ? Number(evMb) : capped;
}
