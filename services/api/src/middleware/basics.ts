/** requestId → logger → securityHeaders → cors → bodyLimit (brief §2–§3). */
import { randomUUID } from 'node:crypto';

import { bodyLimit as honoBodyLimit } from 'hono/body-limit';
import { cors as honoCors } from 'hono/cors';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';

import { REQUEST_ID_HEADER } from '@ethglobal/protocol/events';
import {
  PAYMENT_REQUIRED_HEADER,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  SESSION_PUBKEY_HEADER,
} from '@ethglobal/protocol/x402';

import type { AppEnv, Ctx } from '../context.js';
import type { Deps } from '../deps.js';

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const requestId = (deps: Deps) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const offered = c.req.header(REQUEST_ID_HEADER);
    const id = offered !== undefined && REQUEST_ID.test(offered) ? offered : randomUUID();
    c.set('deps', deps);
    c.set('requestId', id);
    c.set('log', deps.logger.child({ requestId: id }));
    c.set('clientIp', clientIp(c, deps.env.TRUST_PROXY));
    c.header(REQUEST_ID_HEADER, id);
    await next();
    c.res.headers.set(REQUEST_ID_HEADER, id);
  });

/** One `event: 'request'` line per request: method, path (never the query string, T-50/T-82), status, ms. */
export const accessLog = createMiddleware<AppEnv>(async (c, next) => {
  const started = performance.now();
  await next();
  const ms = Math.round(performance.now() - started);
  c.get('deps').metrics.observe('http_ms', ms, { status: String(c.res.status) });
  c.get('log').info(
    {
      event: 'request',
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: ms,
    },
    'request',
  );
});

export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next();
  const h = c.res.headers;
  h.set('Cache-Control', 'no-store');
  h.set('X-Content-Type-Options', 'nosniff');
  h.set('Referrer-Policy', 'no-referrer');
  h.set('X-Frame-Options', 'DENY');
});

/** Exact-origin allow-list, no credentials (T-54). */
export const cors = (origins: readonly string[]) =>
  honoCors({
    origin: (origin) => (origins.includes(origin) ? origin : null),
    allowMethods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowHeaders: [
      PAYMENT_SIGNATURE_HEADER,
      SESSION_PUBKEY_HEADER,
      'Idempotency-Key',
      'Authorization',
      'Content-Type',
      REQUEST_ID_HEADER,
      'X-Agent-Uaid',
    ],
    exposeHeaders: [PAYMENT_REQUIRED_HEADER, PAYMENT_RESPONSE_HEADER, REQUEST_ID_HEADER],
    credentials: false,
    maxAge: 600,
  });

export const JSON_LIMIT = 64 * 1024;
export const WEBHOOK_LIMIT = 256 * 1024;

/** 64 KiB JSON; webhooks 256 KiB raw (413 through the error mapper). */
export const bodyLimit = createMiddleware<AppEnv>(async (c, next) => {
  const maxSize = c.req.path.startsWith('/webhooks/') ? WEBHOOK_LIMIT : JSON_LIMIT;
  return honoBodyLimit({
    maxSize,
    onError: () => {
      throw new HTTPException(413, { message: 'body too large' });
    },
  })(c, next);
});

/**
 * The socket address; X-Forwarded-For only when TRUST_PROXY=1, and then its RIGHT-most hop — the address our own
 * proxy saw — never the client-supplied left-most value (AP8.3).
 */
export function clientIp(c: Ctx, trustProxy: boolean): string {
  if (trustProxy) {
    const hops = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((h) => h.trim())
      .filter((h) => h !== '');
    const last = hops.at(-1);
    if (last !== undefined) return last;
  }
  return c.env?.incoming?.socket?.remoteAddress ?? '0.0.0.0';
}
