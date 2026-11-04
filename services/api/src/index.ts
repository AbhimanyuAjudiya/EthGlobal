import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { buildDeps } from './deps.js';
import { parseEnv } from './env.js';
import { retryPendingOnBoot } from './flows/fulfil.js';
import { createLogger } from './logger.js';
import { LocalClock } from './seed.js';

const env = parseEnv();
const logger = createLogger(env.LOG_LEVEL);
// MODE=local: a clock the e2e script can move forward (POST /__local/clock); live: the wall clock, untouchable
const localClock = env.MODE === 'local' ? new LocalClock() : undefined;
const deps = await buildDeps(process.env, {
  logger,
  ...(localClock ? { now: localClock.now } : {}),
});
const app = createApp(deps, localClock ? { localClock } : {});
// RT-A-11: pending-profile deliveries that survived a restart are retried once now (then on /me, ≤ 1/min)
void retryPendingOnBoot(deps);

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(
    {
      port: info.port,
      mode: env.MODE,
      chain: deps.chainId,
      dataDrop: deps.dataDrop.address,
      attestor: deps.dataDrop.attestor,
      facilitator: deps.facilitator ? deps.facilitator.relayer : 'none',
      accepts: deps.accepts.map((a) => `${a.network}|${a.asset}|${a.payTo}`),
    },
    'api listening',
  );
});

function shutdown(signal: NodeJS.Signals): void {
  logger.info({ signal }, 'shutting down');
  server.close((error) => {
    if (error) {
      logger.error({ err: error.name }, 'server did not close cleanly');
      process.exit(1);
    }
    process.exit(0);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
