/** Private metadata history for authenticated sponsor reads after public campaign TTL. Never used for admission. */
import { campaignFromPayload, campaignToPayload, type Campaign } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';

import type { Deps } from '../deps.js';

export async function campaignHistory(deps: Deps, id: Hex): Promise<Campaign | null> {
  const live = await deps.stores.campaigns.get(id);
  if (live) return live.payload;
  const archived = deps.campaignHistory.get(id.toLowerCase());
  return archived ? campaignFromPayload(archived) : null;
}

/** Caller has checked the authoritative chain owner. No private capabilities or ticket references are included. */
export function archiveCampaign(deps: Deps, campaign: Campaign): void {
  const payload = campaignToPayload(campaign);
  const previous = deps.campaignHistory.get(campaign.id.toLowerCase());
  if (JSON.stringify(previous) !== JSON.stringify(payload))
    deps.campaignHistory.set(campaign.id.toLowerCase(), payload);
}
