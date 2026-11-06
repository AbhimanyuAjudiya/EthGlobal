import { createMiddleware } from 'hono/factory';

import { PLAN_MB } from '@ethglobal/protocol/ids';

import { fail } from '../errors.js';

import type { AppEnv } from '../context.js';
import type { z } from 'zod';

const issues = (error: z.ZodError) =>
  error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));

/** JSON body → zod (400 `invalid_request` with the issue paths); `Content-Type: application/json` is required. */
export const validateJson = (schema: z.ZodType) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const type = c.req.header('content-type') ?? '';
    if (!/^application\/json(;|$)/i.test(type.trim()))
      throw fail('invalid_request', { detail: 'content-type must be application/json' });
    let json: unknown;
    try {
      json = JSON.parse(await c.req.text());
    } catch {
      throw fail('invalid_request', { detail: 'body is not JSON' });
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw fail('invalid_request', issues(parsed.error));
    c.set('input', parsed.data);
    return next();
  });

/** Query → zod; a repeated parameter is refused so the price and the grant can never read different values (AP7.6). */
export const validateQuery = (schema: z.ZodType, integers: readonly string[] = ['mb']) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const params = new URL(c.req.url).searchParams;
    const names = [...params.keys()];
    if (new Set(names).size !== names.length)
      throw fail('invalid_request', { detail: 'repeated query parameter' });
    // z.coerce.number() would read '1e3' or '0x64' as numbers; amounts on the wire are plain decimal integers
    for (const name of integers) {
      const value = params.get(name);
      if (value !== null && !/^\d{1,7}$/.test(value))
        throw fail('invalid_request', [{ path: name, message: 'decimal integer' }]);
    }
    const parsed = schema.safeParse(Object.fromEntries(params));
    if (!parsed.success) throw fail('invalid_request', issues(parsed.error));
    c.set('input', parsed.data);
    return next();
  });

/**
 * New plans, top-ups (a legacy plan's too) and paid gifts are exactly PLAN_MB, the smallest eSIM the reseller sells.
 * Each route calls this before any ledger read, 402 quote or settlement.
 */
export function assertPlanMb(mb: number): void {
  if (mb !== PLAN_MB)
    throw fail('invalid_request', [{ path: 'mb', message: `mb must be ${PLAN_MB} (1 GB)` }]);
}
