/** GET /healthz, GET /plans, POST /challenge, POST /world/rp-context, GET /metrics.json. */
import { challenge as issueChallenge } from '@ethglobal/octroi';
import {
  ENTITLEMENT_CACHE_S,
  GIFT_CLAIM_WINDOW_S,
  STEP_MB,
  type Hex,
} from '@ethglobal/protocol/ids';
import {
  challengeRequestSchema,
  rpContextRequestSchema,
  type ChallengeRequest,
  type PlansResponse,
} from '@ethglobal/protocol/schemas';
import { usd6ToWire } from '@ethglobal/protocol/units';

import { inputOf, type AppEnv } from '../context.js';
import { campaignState } from '../middleware/octroi.js';
import { validateJson } from '../middleware/validate.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

export const GIFT_SIZES_MB = [100, 300, 500, 1000, 3000];

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

  let plans: { at: number; body: PlansResponse } | undefined;
  app.get('/plans', async (c) => {
    if (!plans || deps.now() - plans.at >= ENTITLEMENT_CACHE_S * 1000)
      plans = { at: deps.now(), body: await buildPlans(deps) };
    return c.json(plans.body);
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

async function buildPlans(deps: Deps): Promise<PlansResponse> {
  const id = deps.env.CAMPAIGN_ID ?? (await deps.stores.campaigns.list())[0]?.payload.id;
  let campaign: PlansResponse['campaign'] = null;
  if (id !== undefined) {
    const { campaign: c, counters } = await campaignState(deps, id as Hex);
    if (c && counters) {
      const price = c.pricePerClaimUsd6 > 0n ? c.pricePerClaimUsd6 : 1n;
      const left = Number((counters.budgetUsd6 - counters.spentUsd6) / price);
      campaign = {
        id: c.id,
        name: c.name,
        sponsor: c.sponsor,
        bundleMb: c.bundleMb,
        remainingClaims: Math.max(0, Math.min(left, c.maxClaims)),
        maxClaims: c.maxClaims,
        paused: counters.paused,
        expiresAt: c.expiresAt,
        network: c.network,
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
    },
    gift: { sizesMb: GIFT_SIZES_MB, claimWindowS: GIFT_CLAIM_WINDOW_S },
    simulated: { usage: deps.env.MODE === 'local', personhood: deps.env.MODE === 'local' },
  };
}
