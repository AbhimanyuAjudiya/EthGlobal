import { serve } from '@hono/node-server';

import { createApp } from './app.js';
import { buildDeps } from './deps.js';
import { parseEnv } from './env.js';
import { recoverCampaignReclaims } from './flows/campaign-reclaim.js';
import { retryPendingOnBoot } from './flows/fulfil.js';
import { flushReceiptOutbox } from './flows/record.js';
import { recoverRefunds } from './flows/refund-recovery.js';
import { createLogger } from './logger.js';
import { recoverFreeReservations } from './middleware/octroi.js';
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
await recoverFreeReservations(deps);
void recoverCampaignReclaims(deps).catch(() =>
  logger.warn({ event: 'campaign-reclaim' }, 'event reconciliation waits for recovery'),
);
// RT-A-11: pending-profile deliveries that survived a restart are retried once now (then on /me, ≤ 1/min)
void retryPendingOnBoot(deps);
void flushReceiptOutbox(deps).catch(() =>
  logger.warn({ event: 'receipt-outbox' }, 'receipt replay waits for ledger recovery'),
);
void recoverRefunds(deps).catch(() =>
  logger.warn({ event: 'refund-recovery' }, 'refund replay waits for recovery'),
);
const refundTimer = setInterval(() => {
  void recoverCampaignReclaims(deps).catch(() =>
    logger.warn({ event: 'campaign-reclaim' }, 'event reconciliation waits for recovery'),
  );
  void flushReceiptOutbox(deps).catch(() =>
    logger.warn({ event: 'receipt-outbox' }, 'receipt replay waits for ledger recovery'),
  );
  void recoverRefunds(deps).catch(() =>
    logger.warn({ event: 'refund-recovery' }, 'refund replay waits for recovery'),
  );
}, 30_000);
refundTimer.unref();
// ENSv2 campaign names left `pending` by the last process continue (flows/ens.ts)
void deps.ens?.resumeOnBoot();

// RT-P-01: an explicit listen address — loopback unless HOST says otherwise (live only; env.ts refuses it locally)
const server = serve({ fetch: app.fetch, port: env.PORT, hostname: env.HOST }, (info) => {
  logger.info(
    {
      host: info.address,
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
  clearInterval(refundTimer);
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
