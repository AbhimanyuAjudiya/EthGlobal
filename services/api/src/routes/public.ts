/** Public health, destination catalog, campaign plans, challenges and metrics. */
import { challenge as issueChallenge } from '@ethglobal/octroi';
import { ENTITLEMENT_CACHE_S, type Hex } from '@ethglobal/protocol/ids';
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
import { buildPlans } from '../flows/public-plans.js';
import { validateJson } from '../middleware/validate.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

/** Every paid lane (new plans, top-ups, gifts) sells one size: PLAN_MB, the smallest eSIM the reseller sells. */
export { GIFT_SIZES_MB } from '../flows/public-plans.js';

export function registerPublic(app: Hono<AppEnv>, deps: Deps): void {
  // The chain id is asked of the RPC relay at most every CHAIN_SEEN_TTL_MS; a relay blip within CHAIN_SEEN_GRACE_MS of
  // the last answer keeps the service "ok" (with the age shown) instead of stalling every probe on the RPC timeout.
  const CHAIN_SEEN_TTL_MS = 30_000;
  const CHAIN_SEEN_GRACE_MS = 120_000;
  let chainSeen: { at: number; chainId: number } | undefined;
  let chainRefreshing: Promise<void> | undefined;
  const refreshChain = (): Promise<void> => {
    chainRefreshing ??= deps
      .getChainId()
      .then((chainId) => {
        chainSeen = { at: deps.now(), chainId };
      })
      .finally(() => {
        chainRefreshing = undefined;
      });
    return chainRefreshing;
  };
  app.get('/healthz', async (c) => {
    const now = deps.now();
    try {
      if (!chainSeen || now - chainSeen.at >= CHAIN_SEEN_GRACE_MS) await refreshChain();
      else if (now - chainSeen.at >= CHAIN_SEEN_TTL_MS) void refreshChain().catch(() => undefined);
      const seen = chainSeen as { at: number; chainId: number };
      return c.json({
        ok: true,
        mode: deps.env.MODE,
        chainId: seen.chainId,
        attestor: deps.dataDrop.attestor,
        degraded: deps.health.degraded,
        // measured after a refresh that may have just landed, never negative
        chainAgeS: Math.max(0, Math.floor((deps.now() - seen.at) / 1000)),
      });
    } catch (error) {
      deps.logger.error(
        { err: error instanceof Error ? error.name : 'error' },
        'healthz: chain unreachable',
      );
      if (chainSeen && now - chainSeen.at < CHAIN_SEEN_GRACE_MS)
        return c.json({
          ok: true,
          mode: deps.env.MODE,
          chainId: chainSeen.chainId,
          attestor: deps.dataDrop.attestor,
          degraded: deps.health.degraded,
          chainAgeS: Math.floor((now - chainSeen.at) / 1000),
          chainStale: true,
        });
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

  // One cache entry per explicitly requested campaign. Live generic plans never discover a campaign for a visitor.
  const plans = new Map<string, { at: number; body: PlansResponse }>();
  const PLANS_STALE_MAX_MS = 10 * 60_000;
  const plansRefreshing = new Map<string, Promise<void>>();
  /** One refresh per key at a time; a failure keeps the previous answer and only throws when there is none. */
  const refreshPlans = (id: string): Promise<void> => {
    const pending = plansRefreshing.get(id);
    if (pending) return pending;
    const run = buildPlans(deps, id === '' ? undefined : (id as Hex))
      .then((body) => {
        if (plans.size >= PLANS_CACHE_MAX && !plans.has(id)) plans.clear();
        plans.set(id, { at: deps.now(), body });
      })
      .catch((error: unknown) => {
        const hit = plans.get(id);
        if (!hit || deps.now() - hit.at >= PLANS_STALE_MAX_MS) throw error;
        // a relay blip must not empty the landing: the last good answer (≤ 10 min old) stands in, logged
        deps.logger.warn(
          {
            err: error instanceof Error ? error.name : 'error',
            ageS: Math.floor((deps.now() - hit.at) / 1000),
          },
          'plans: chain unavailable, serving the last answer',
        );
      })
      .finally(() => {
        plansRefreshing.delete(id);
      });
    plansRefreshing.set(id, run);
    return run;
  };
  app.get('/plans', async (c) => {
    const query = plansQuerySchema.safeParse({ campaign: c.req.query('campaign') });
    if (!query.success) throw fail('invalid_request', [{ path: 'campaign', message: 'bytes32' }]);
    const id = query.data.campaign?.toLowerCase() ?? '';
    const hit = plans.get(id);
    const age = hit ? deps.now() - hit.at : Infinity;
    if (!hit || age >= PLANS_STALE_MAX_MS) await refreshPlans(id);
    else if (age >= ENTITLEMENT_CACHE_S * 1000) void refreshPlans(id).catch(() => undefined);
    return c.json(plans.get(id)!.body);
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
