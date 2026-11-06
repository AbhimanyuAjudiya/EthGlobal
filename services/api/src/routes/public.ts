/** Public health, destination catalog, campaign plans, challenges and metrics. */
import {
  challenge as issueChallenge,
  MAX_CAMPAIGN_MS,
  remainingCampaignClaims,
} from '@ethglobal/octroi';
import {
  ENTITLEMENT_CACHE_S,
  GIFT_CLAIM_WINDOW_S,
  PLAN_MB,
  STEP_MB,
  type Hex,
} from '@ethglobal/protocol/ids';
import {
  challengeRequestSchema,
  catalogResponseSchema,
  plansQuerySchema,
  rpContextRequestSchema,
  type ChallengeRequest,
  type CatalogResponse,
  type PlansResponse,
} from '@ethglobal/protocol/schemas';
import { usd6ToWire } from '@ethglobal/protocol/units';

import { inputOf, type AppEnv } from '../context.js';
import { fail } from '../errors.js';
import { catalogPlans } from '../flows/plan.js';
import { campaignState } from '../middleware/octroi.js';
import { validateJson } from '../middleware/validate.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

/** Every paid lane (new plans, top-ups, gifts) sells one size: PLAN_MB, the smallest eSIM the reseller sells. */
export const GIFT_SIZES_MB = [PLAN_MB];

export function registerPublic(app: Hono<AppEnv>, deps: Deps): void {
  app.get('/healthz', async (c) => {
    try {
      const chainId = await deps.getChainId();
      return c.json({
        ok: true,
        mode: deps.env.MODE,
        chainId,
        attestor: deps.dataDrop.attestor,
        degraded: deps.health.degraded,
      });
    } catch (error) {
      deps.logger.error(
        { err: error instanceof Error ? error.name : 'error' },
        'healthz: chain unreachable',
      );
      return c.json({ ok: false, mode: deps.env.MODE, error: 'chain_unreachable' }, 503);
    }
  });

  // Cache only public catalog facts. Campaign admission always rechecks the selected SKU before commitment.
  const catalog = new Map<string, { at: number; body: CatalogResponse }>();
  const catalogPending = new Map<string, Promise<CatalogResponse>>();
  app.get('/catalog', async (c) => {
    const countries = c.req.queries('country');
    const country = countries?.[0];
    if (countries?.length !== 1 || !country || !/^[A-Z]{2}$/.test(country))
      throw fail('invalid_request', [
        { path: 'country', message: 'one uppercase ISO2 country required' },
      ]);
    const hit = catalog.get(country);
    if (hit && deps.now() - hit.at < ENTITLEMENT_CACHE_S * 1000) return c.json(hit.body);
    let pending = catalogPending.get(country);
    if (!pending) {
      pending = catalogPlans(deps, country)
        .then((available) => {
          const body = catalogResponseSchema.parse({
            country,
            plans: available.map((plan) => ({
              id: plan.id,
              name: plan.name,
              mb: plan.dataMb,
              validityDays: plan.validityDays,
              wholesaleUsd6: usd6ToWire(plan.wholesaleUsd6),
              activation: plan.activation ?? { startsOn: 'unknown' },
              cancellation: plan.cancellation ?? 'unknown',
            })),
          });
          if (catalog.size >= PLANS_CACHE_MAX) catalog.clear();
          catalog.set(country, { at: deps.now(), body });
          return body;
        })
        .finally(() => catalogPending.delete(country));
      catalogPending.set(country, pending);
    }
    return c.json(await pending);
  });

  // one cache entry per campaign asked for (`?campaign=`: claim by ENS name, /c/<slug>), '' = the default campaign
  const plans = new Map<string, { at: number; body: PlansResponse }>();
  app.get('/plans', async (c) => {
    const query = plansQuerySchema.safeParse({ campaign: c.req.query('campaign') });
    if (!query.success) throw fail('invalid_request', [{ path: 'campaign', message: 'bytes32' }]);
    const id = query.data.campaign?.toLowerCase() ?? '';
    let hit = plans.get(id);
    if (!hit || deps.now() - hit.at >= ENTITLEMENT_CACHE_S * 1000) {
      hit = { at: deps.now(), body: await buildPlans(deps, id === '' ? undefined : (id as Hex)) };
      if (plans.size >= PLANS_CACHE_MAX) plans.clear();
      plans.set(id, hit);
    }
    return c.json(hit.body);
  });

  // No ledger write at issue time: the MAC makes the nonce unforgeable (D-3, T-45).
  app.post('/challenge', validateJson(challengeRequestSchema), (c) => {
    const { audience, path, sessionPubKey } = inputOf<ChallengeRequest>(c);
    return c.json(
      issueChallenge(audience, path, sessionPubKey.toLowerCase() as Hex, deps.now(), deps.secret),
    );
  });

  // Signs with WORLD_RP_SIGNING_KEY (never in a response, a log or an error); the clock is the server's (T-81).
  app.post('/world/rp-context', validateJson(rpContextRequestSchema), async (c) =>
    c.json(await deps.rpSigner.issue()),
  );

  app.get('/metrics.json', (c) =>
    c.json({ ...deps.metrics.snapshot(), degraded: deps.health.degraded }),
  );
}

/** Distinct `?campaign=` answers kept (the global rate limit bounds how fast new ones arrive). */
const PLANS_CACHE_MAX = 256;

async function buildPlans(deps: Deps, asked?: Hex): Promise<PlansResponse> {
  const id = asked ?? deps.env.CAMPAIGN_ID ?? (await deps.stores.campaigns.list())[0]?.payload.id;
  let campaign: PlansResponse['campaign'] = null;
  if (id !== undefined) {
    const { campaign: c, counters } = await campaignState(deps, id as Hex);
    if (c && counters) {
      campaign = {
        id: c.id,
        name: c.name,
        sponsor: c.sponsor,
        bundleMb: c.bundleMb,
        remainingClaims: remainingCampaignClaims(c, counters),
        maxClaims: c.maxClaims,
        paused: counters.paused,
        expiresAt: c.expiresAt,
        network: c.network,
        ...(c.event ? { event: c.event } : {}),
      };
    }
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
