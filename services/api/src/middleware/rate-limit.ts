import { createMiddleware } from 'hono/factory';

import { WindowLimiter } from '../admission.js';
import { fail } from '../errors.js';

import type { AppEnv } from '../context.js';

/** Per-route limits per IP per minute (brief §3; T-45, T-75, T-81). */
export const ROUTE_LIMITS: Readonly<Record<string, number>> = {
  '/challenge': 10,
  '/world/rp-context': 10,
  '/claim': 5,
  '/card/redeem': 10,
  '/gift/reclaim': 5,
  '/facilitator': 30,
};
/** Every IP, every route. */
export const GLOBAL_LIMIT_PER_MIN = 600;

/**
 * Sliding-window limiter keyed by `ip` and `ip:<route>`. It runs before any ledger, chain or adapter access and
 * decides synchronously, so concurrent requests cannot race past it (AP8.2).
 */
export function rateLimit(now: () => number) {
  const global = new WindowLimiter(GLOBAL_LIMIT_PER_MIN, 60_000, now);
  const perRoute = new Map(
    Object.entries(ROUTE_LIMITS).map(([route, limit]) => [
      route,
      new WindowLimiter(limit, 60_000, now),
    ]),
  );
  return createMiddleware<AppEnv>(async (c, next) => {
    if (c.req.method === 'OPTIONS') return next();
    const ip = c.get('clientIp');
    const route = Object.keys(ROUTE_LIMITS).find(
      (r) => c.req.path === r || c.req.path.startsWith(`${r}/`),
    );
    const checks = [
      global.hit(ip),
      ...(route === undefined ? [] : [perRoute.get(route)?.hit(`${ip}:${route}`)]),
    ];
    for (const verdict of checks) {
      if (verdict && !verdict.ok) throw fail('rate_limited', { retryAfterS: verdict.retryAfterS });
    }
    return next();
  });
}
