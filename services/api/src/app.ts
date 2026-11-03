import { Hono } from 'hono';

import type { ChainIdResolver } from './chain.js';
import type { Env } from './env.js';
import type { Logger } from './logger.js';

export interface AppDependencies {
  env: Pick<Env, 'MODE'>;
  logger: Logger;
  getChainId: ChainIdResolver;
}

export function createApp({ env, logger, getChainId }: AppDependencies) {
  const app = new Hono();

  app.use('*', async (c, next) => {
    const started = performance.now();
    await next();
    logger.info(
      {
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        durationMs: Math.round(performance.now() - started),
      },
      'request',
    );
  });

  app.get('/healthz', async (c) => {
    try {
      const chainId = await getChainId();
      return c.json({ ok: true, mode: env.MODE, chainId });
    } catch (error) {
      logger.error({ err: error }, 'healthz: chain unreachable');
      return c.json({ ok: false, mode: env.MODE, error: 'chain_unreachable' }, 503);
    }
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));
  app.onError((error, c) => {
    logger.error({ err: error }, 'unhandled error');
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

export type App = ReturnType<typeof createApp>;
