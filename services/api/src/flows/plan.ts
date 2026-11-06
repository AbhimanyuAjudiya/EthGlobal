import type { EsimPlan } from '@ethglobal/adapters';
import { MAX_BUNDLE_MB, STEP_MB } from '@ethglobal/protocol/ids';
import type { CampaignPayload } from '@ethglobal/protocol/schemas';

import { fail } from '../errors.js';

import type { Deps } from '../deps.js';

/** A logical allocation must fit the physical package the operator will actually order. */
export async function assertConfiguredCapacity(deps: Deps, mb: number): Promise<void> {
  await assertPlanCapacity(deps, deps.env.RESELLER_PLAN_ID, mb);
}

/** Current destination-specific catalog; only packages representable by the app's service contract. */
export async function catalogPlans(deps: Deps, country: string): Promise<EsimPlan[]> {
  if (!/^[A-Z]{2}$/.test(country))
    throw fail('invalid_request', [
      { path: 'country', message: 'uppercase ISO2 country required' },
    ]);
  return (await deps.adapters.reseller.plans(country)).filter(
    (plan) =>
      plan.country === country &&
      plan.id.length > 0 &&
      plan.id.length <= 64 &&
      Number.isSafeInteger(plan.dataMb) &&
      plan.dataMb > 0 &&
      plan.dataMb <= 1_000_000 &&
      Number.isSafeInteger(plan.validityDays) &&
      plan.validityDays >= 1 &&
      plan.validityDays <= 30 &&
      plan.wholesaleUsd6 > 0n,
  );
}

export async function assertPlanCapacity(
  deps: Deps,
  planId: string,
  mb: number,
  country = 'IN',
): Promise<EsimPlan> {
  const plan = (await catalogPlans(deps, country)).find((p) => p.id === planId);
  if (!plan) throw fail('reseller_unavailable', { detail: 'configured package is unavailable' });
  if (!Number.isSafeInteger(mb) || mb < 0 || mb > plan.dataMb)
    throw fail('invalid_request', {
      detail: `configured package supports at most ${plan.dataMb} MB`,
    });
  return plan;
}

type CampaignPlan = Pick<CampaignPayload, 'planId' | 'bundleMb' | 'validityDays' | 'event'> & {
  pricePerClaimUsd6: string | bigint;
};
const DAY_MS = 86_400_000;

/** Check before a new financial commitment. Recovery retains its originally purchased SKU and terms. */
export async function assertCampaignPlan(deps: Deps, campaign: CampaignPlan): Promise<EsimPlan> {
  const mb = Math.max(campaign.bundleMb.orb, campaign.bundleMb.document, campaign.bundleMb.device);
  const event = campaign.event;
  const plan = await assertPlanCapacity(
    deps,
    event ? campaign.planId : deps.env.RESELLER_PLAN_ID,
    mb,
    event?.destinationCountry ?? 'IN',
  );
  if (!event) return plan;
  function reject(message: string, path = 'campaign.planId'): never {
    throw fail('invalid_request', [{ path, message }]);
  }
  // Vendors report 1 GB as either decimal bytes or 1 GiB (1073 decimal MB after flooring).
  const logicalMb = Math.floor(plan.dataMb / STEP_MB) * STEP_MB;
  if (
    plan.dataMb > 1074 ||
    logicalMb <= 0 ||
    logicalMb > MAX_BUNDLE_MB ||
    campaign.bundleMb.orb !== logicalMb ||
    campaign.bundleMb.document !== logicalMb
  )
    reject('each verified attendee must receive the selected package in full, up to 1 GB');
  if (campaign.validityDays !== plan.validityDays)
    reject('validity must match the selected provider package');
  if (BigInt(campaign.pricePerClaimUsd6) < plan.wholesaleUsd6)
    reject(
      'per-claim price must cover the selected provider package',
      'campaign.pricePerClaimUsd6',
    );
  if (
    event.reclaimUnused &&
    (plan.provider !== 'esimaccess' ||
      plan.cancellation !== 'never-installed' ||
      !deps.adapters.reseller.cancellationEvidence)
  )
    reject('this package cannot promise verified cancellation of never-installed profiles');
  if (plan.validityDays * DAY_MS < event.endsAt - event.startsAt)
    reject('the package service period is shorter than the event');
  const activation = plan.activation;
  if (!activation || activation.startsOn === 'unknown')
    reject('the provider must confirm when this package starts its service period');
  // An installation-start package must still cover the event if installed immediately after claim.
  const now = deps.now();
  if (
    event.reclaimUnused &&
    (activation.installWithinDays === undefined ||
      now + activation.installWithinDays * DAY_MS < event.reclaimAfter + DAY_MS)
  )
    reject('the unused activation window must cover the recovery deadline plus one processing day');
  if (activation.startsOn === 'installation' && now + plan.validityDays * DAY_MS < event.endsAt)
    reject(
      'this installation-start package would expire before the event; select a first-network package',
    );
  if (
    activation.startsOn === 'first-network' &&
    (activation.installWithinDays === undefined ||
      now + activation.installWithinDays * DAY_MS < event.endsAt)
  )
    reject(
      'the provider activation window must cover the event; claim closer to travel or select another package',
    );
  return plan;
}
