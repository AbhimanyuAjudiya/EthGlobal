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
  '/plan/cancel': 5,
  '/facilitator': 30,
};
/** Every IP, every route. */
export const GLOBAL_LIMIT_PER_MIN = 600;

/**
 * The bucket an address counts against (RT-A-10): IPv4 as is, an IPv4-mapped IPv6 address as its IPv4, any other
 * IPv6 address as its /64 — one host or one home network gets 2^64 addresses, one bucket. A string that is not an
 * IPv6 address is returned unchanged.
 */
export function ipBucket(ip: string): string {
  const address =
    ip
      .trim()
      .toLowerCase()
      .replace(/^\[|\]$/g, '')
      .split('%')[0] ?? '';
  const mapped = /^(?:0{0,4}:){0,4}:?(?:0{0,4}:)?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (mapped?.[1] !== undefined) return mapped[1];
  if (!address.includes(':')) return address;
  const groups = expandIpv6(address);
  return groups === undefined ? address : `${groups.slice(0, 4).join(':')}::/64`;
}

/** The eight 16-bit groups of an IPv6 address (`::` expanded, embedded IPv4 converted), or undefined. */
function expandIpv6(address: string): string[] | undefined {
  let text = address;
  const v4 = /(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return undefined;
  const head = halves[0] === '' ? [] : (halves[0]?.split(':') ?? []);
  const tail = halves.length === 2 && halves[1] !== '' ? (halves[1]?.split(':') ?? []) : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return undefined;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill('0'), ...tail];
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return undefined;
  return groups.map((g) => g.replace(/^0+(?=.)/, ''));
}

/**
 * Sliding-window limiter keyed by `ipBucket(ip)` and `ipBucket(ip):<route>`. It runs before any ledger, chain or adapter access and
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
    const ip = ipBucket(c.get('clientIp'));
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
