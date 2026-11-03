import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { createChainIdResolver } from './chain.js';
import { parseEnv } from './env.js';
import { createLogger } from './logger.js';

const env = parseEnv();
const logger = createLogger(env.LOG_LEVEL);
const app = createApp({ env, logger, getChainId: createChainIdResolver(env) });

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info({ port: info.port, mode: env.MODE, chain: env.CHAIN }, 'api listening');
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'shutting down');
  server.close((error) => {
    if (error) {
      logger.error({ err: error }, 'server did not close cleanly');
      process.exit(1);
    }
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
