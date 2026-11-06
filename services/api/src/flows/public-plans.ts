/** Generic purchase terms are public; live campaign metadata requires an explicitly authorized ticket preview. */
import { MAX_CAMPAIGN_MS, remainingCampaignClaims } from '@ethglobal/octroi';
import { GIFT_CLAIM_WINDOW_S, PLAN_MB, STEP_MB, type Hex } from '@ethglobal/protocol/ids';
import type { PlansResponse } from '@ethglobal/protocol/schemas';
import { usd6ToWire } from '@ethglobal/protocol/units';

import { campaignState } from '../middleware/octroi.js';

import type { Deps } from '../deps.js';

export const GIFT_SIZES_MB = [PLAN_MB];

export async function buildPlans(
  deps: Deps,
  asked?: Hex,
  authorized = false,
): Promise<PlansResponse> {
  // Live: a ticketed (event) campaign is named only to an authorized pass holder; CAMPAIGN_ID may pin one public,
  // non-event campaign that the landing advertises to everyone (the sponsored free bundle).
  const id =
    deps.env.MODE === 'live'
      ? authorized
        ? asked
        : deps.env.CAMPAIGN_ID
      : (asked ?? deps.env.CAMPAIGN_ID ?? (await deps.stores.campaigns.list())[0]?.payload.id);
  let campaign: PlansResponse['campaign'] = null;
  if (id !== undefined) {
    const { campaign: value, counters } = await campaignState(deps, id as Hex);
    const disclosable = deps.env.MODE !== 'live' || authorized || !value?.event;
    if (value && counters && disclosable)
      campaign = {
        id: value.id,
        name: value.name,
        sponsor: value.sponsor,
        bundleMb: value.bundleMb,
        remainingClaims: remainingCampaignClaims(value, counters),
        maxClaims: value.maxClaims,
        paused: counters.paused,
        expiresAt: value.expiresAt,
        network: value.network,
        ...(value.event ? { event: value.event } : {}),
      };
  }
  return {
    mode: deps.env.MODE,
    campaign,
    paid: {
      stepMb: STEP_MB,
      priceUsd6PerStep: usd6ToWire(deps.env.PRICE_USD6_PER_STEP),
      validityDays: deps.env.VALIDITY_DAYS,
      accepts: deps.accepts,
      sizesMb: [PLAN_MB],
    },
    gift: { sizesMb: GIFT_SIZES_MB, claimWindowS: GIFT_CLAIM_WINDOW_S },
    sponsor: {
      minPricePerClaimUsd6: usd6ToWire(deps.env.COST_USD6_PER_CLAIM),
      maxCampaignDurationMs: MAX_CAMPAIGN_MS,
    },
    simulated: { usage: deps.env.MODE === 'local', personhood: deps.env.MODE === 'local' },
  };
}
