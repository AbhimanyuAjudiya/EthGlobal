import { fail } from '../errors.js';

import type { Deps } from '../deps.js';

/** A logical allocation must fit the physical package the operator will actually order. */
export async function assertConfiguredCapacity(deps: Deps, mb: number): Promise<void> {
  return assertPlanCapacity(deps, deps.env.RESELLER_PLAN_ID, mb);
}

export async function assertPlanCapacity(deps: Deps, planId: string, mb: number): Promise<void> {
  const plan = (await deps.adapters.reseller.plans('IN')).find((p) => p.id === planId);
  if (!plan) throw fail('reseller_unavailable', { detail: 'configured package is unavailable' });
  if (mb > plan.dataMb)
    throw fail('invalid_request', {
      detail: `configured package supports at most ${plan.dataMb} MB`,
    });
}
