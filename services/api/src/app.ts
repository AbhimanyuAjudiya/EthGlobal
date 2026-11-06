/**
 * createApp(deps): the middleware chain in the fixed order of INTERFACES §7 — requestId → logger → securityHeaders
 * → cors → rateLimit → bodyLimit → idempotency → (per route) validate → x402 → octroi → handler — and the one error
 * mapper (errors.ts) behind every failure.
 */
import { Hono } from 'hono';
import { createMiddleware } from 'hono/factory';

import type { Hex } from '@ethglobal/protocol/ids';
import { hex32Schema } from '@ethglobal/protocol/schemas';

import { fail, respondError } from './errors.js';
import { accessLog, bodyLimit, cors, requestId, securityHeaders } from './middleware/basics.js';
import { idempotency } from './middleware/idempotency.js';
import { rateLimit } from './middleware/rate-limit.js';
import { LIVE_SERVER_URL, openApiDocument } from './openapi.js';
import { registerAgentPass } from './routes/agent-pass.js';
import { registerAgentPolicy } from './routes/agent-policy.js';
import { registerClaim } from './routes/claim.js';
import { registerFacilitator } from './routes/facilitator.js';
import { registerGift } from './routes/gift.js';
import { registerMe } from './routes/me.js';
import { registerPublic } from './routes/public.js';
import { registerSponsorAnalytics } from './routes/sponsor-analytics.js';
import { registerSponsorTickets } from './routes/sponsor-tickets.js';
import { registerSponsor } from './routes/sponsor.js';
import { registerTicketPreview } from './routes/ticket-preview.js';
import { registerWebhooks } from './routes/webhooks.js';
import { SIMULATED_LEVELS, simulatedWorldProof, type LocalClock } from './seed.js';

import type { AppEnv } from './context.js';
import type { Deps } from './deps.js';

/** POST routes the Idempotency-Key middleware covers (brief §3). */
export const IDEMPOTENT_ROUTES = [
  '/gift',
  '/gift/claim',
  '/gift/reclaim',
  '/card/redeem',
  '/sponsor',
  '/plan/cancel',
];
/** Writes that fail closed while the ledger is degraded (T-51); webhooks check inside their route. */
const LEDGER_WRITES = [
  '/claim',
  '/gift',
  '/gift/claim',
  '/gift/reclaim',
  '/card/redeem',
  '/sponsor',
  '/sponsor/:id/cards',
  '/sponsor/:id/tickets',
  '/sponsor/:id/tickets/revoke',
  '/agent/policy',
  '/plan/cancel',
];

/** GET /__local/ledger (MODE=local only) returns at most this many entities. */
export const LOCAL_LEDGER_DUMP_MAX = 100_000;

export interface AppOptions {
  /** MODE=local only: POST /__local/clock moves this clock (e2e time travel). */
  localClock?: LocalClock;
}

export function createApp(deps: Deps, options: AppOptions = {}) {
  const app = new Hono<AppEnv>();
  app.use('*', requestId(deps));
  app.use('*', accessLog);
  app.use('*', securityHeaders);
  app.use('*', cors(deps.env.CORS_ORIGINS));
  app.use('*', rateLimit(deps.now));
  app.use('*', bodyLimit);
  const idem = idempotency(deps.now);
  for (const route of IDEMPOTENT_ROUTES) app.use(route, idem);
  const degradedGuard = createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.method !== 'GET' && deps.health.degraded)
      throw fail('ledger_unavailable', { detail: 'degraded' });
    return next();
  });
  for (const route of LEDGER_WRITES) app.use(route, degradedGuard);

  registerPublic(app, deps);
  registerClaim(app, deps);
  registerGift(app, deps);
  registerWebhooks(app, deps);
  registerMe(app, deps);
  registerSponsor(app, deps);
  registerSponsorTickets(app, deps);
  registerTicketPreview(app, deps);
  registerSponsorAnalytics(app, deps);
  registerAgentPolicy(app, deps);
  registerAgentPass(app, deps);
  registerFacilitator(app, deps);
  const document = openApiDocument(deps.env.MODE === 'live' ? LIVE_SERVER_URL : undefined);
  app.get('/openapi.json', (c) => c.json(document));

  const clock = options.localClock;
  if (deps.env.MODE === 'local' && clock) {
    app.post('/__local/clock', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as { advanceMs?: unknown };
      const ms = body.advanceMs;
      if (typeof ms !== 'number' || !Number.isSafeInteger(ms) || ms < 0 || ms > 60 * 86_400_000)
        throw fail('invalid_request');
      clock.advance(ms);
      c.get('log').warn(
        { event: 'seed-hook', hook: 'clock', advanceMs: ms },
        'local clock advanced',
      );
      return c.json({ now: deps.now() });
    });
    // scripts/dump-ledger.ts: every entity of the local in-memory ledger, for the I-18 forbidden-pattern scan
    app.get('/__local/ledger', async (c) => {
      const entities = await deps.adapters.ledger.query({ limit: LOCAL_LEDGER_DUMP_MAX });
      return c.json({ count: entities.length, entities });
    });
    // The simulated World ID Agent Pass (docs/WORLD_AGENT_PASS.md; only with WORLD_AGENT_PASS_CLIENT_ID=simulated):
    // the "phone" page the QR / verification URL opens (approve or deny this user code), and the script the next
    // device attempt follows (e2e: approve | deny | expire before the agent runs).
    app.get('/__local/agent-pass/:code', (c) => {
      const sim = deps.agentPass?.sim;
      if (!sim) throw fail('not_found');
      const outcome = c.req.query('outcome') === 'deny' ? 'deny' : 'approve';
      const ok = sim.resolve(c.req.param('code'), outcome);
      c.get('log').warn(
        { event: 'seed-hook', hook: 'agent-pass', outcome, ok },
        'simulated Agent Pass',
      );
      return c.json({ simulated: true, outcome, resolved: ok });
    });
    app.post('/__local/agent-pass', async (c) => {
      const sim = deps.agentPass?.sim;
      if (!sim) throw fail('not_found');
      const body = (await c.req.json().catch(() => ({}))) as {
        outcome?: unknown;
        expiresInS?: unknown;
      };
      const outcome = (['pending', 'approve', 'deny', 'expire'] as const).find(
        (o) => o === body.outcome,
      );
      if (!outcome) throw fail('invalid_request');
      const expiresInS =
        typeof body.expiresInS === 'number' &&
        Number.isInteger(body.expiresInS) &&
        body.expiresInS > 0
          ? Math.min(body.expiresInS, 1200)
          : undefined;
      sim.script = { outcome, ...(expiresInS === undefined ? {} : { expiresInS }) };
      c.get('log').warn(
        { event: 'seed-hook', hook: 'agent-pass', outcome },
        'simulated Agent Pass scripted',
      );
      return c.json({ simulated: true, outcome });
    });
    // The PWA's "Simulated World ID" button: an IDKit-4-shaped result bound to the challenge signal, so the
    // browser never builds a proof itself (MODE=local only; the route does not exist in live).
    app.post('/__local/world-proof', async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
      const level = SIMULATED_LEVELS.find((l) => l === body.level);
      const signal = hex32Schema.safeParse(body.signal);
      const seed =
        typeof body.seed === 'string' && /^[\w-]{1,64}$/.test(body.seed) ? body.seed : '';
      if (!level || !signal.success || seed === '') throw fail('invalid_request');
      c.get('log').warn({ event: 'seed-hook', hook: 'world-proof', level }, 'simulated World ID');
      return c.json(
        simulatedWorldProof(level, signal.data as Hex, seed, {
          action: deps.env.WORLD_ACTION,
          environment: deps.env.WORLD_ENVIRONMENT,
          nowMs: deps.now(),
        }),
      );
    });
  }

  app.notFound((c) => respondError(c, fail('not_found'), c.get('requestId')));
  app.onError((error, c) => {
    const status = errorStatusForLog(error);
    const log = c.get('log') ?? deps.logger;
    // name and code only: messages of chain/vendor errors can carry URLs with access keys (T-50)
    if (status >= 500)
      log.error(
        { event: 'request', err: { name: error.name, code: (error as { code?: unknown }).code } },
        'request failed',
      );
    return respondError(c, error, c.get('requestId'));
  });
  return app;
}

function errorStatusForLog(error: Error): number {
  const status = (error as { status?: unknown }).status;
  return typeof status === 'number' ? status : 500;
}

export type App = ReturnType<typeof createApp>;
