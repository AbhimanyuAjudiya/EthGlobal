/** Validate the private pass before asking an attendee to open World App. This never reserves a ticket. */
import { z } from 'zod';

import type { Hex } from '@ethglobal/protocol/ids';
import { hex32Schema } from '@ethglobal/protocol/schemas';

import { inputOf, type AppEnv } from '../context.js';
import { fail } from '../errors.js';
import { deliveryRecoveryHash } from '../flows/fulfil.js';
import { buildPlans } from '../flows/public-plans.js';
import { ticketAdmission } from '../flows/tickets.js';
import { campaignState } from '../middleware/octroi.js';
import { validateJson } from '../middleware/validate.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

export const previewSchema = z
  .object({
    campaignId: hex32Schema,
    ticketPass: hex32Schema,
    sessionPubKey: hex32Schema,
    eventNoticeVersion: z.literal(1).optional(),
  })
  .strict();

export function registerTicketPreview(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/ticket/preview', validateJson(previewSchema), async (c) => {
    const body = inputOf<z.infer<typeof previewSchema>>(c);
    const { campaign, counters } = await campaignState(deps, body.campaignId.toLowerCase() as Hex);
    if (!campaign || !counters) throw fail('not_found');
    if (campaign.expiresAt <= deps.now()) throw fail('campaign_expired');
    if (counters.paused) throw fail('campaign_paused');
    const recoveryKeyHash = deliveryRecoveryHash(deps, c.req.header('idempotency-key'));
    ticketAdmission(
      deps,
      campaign,
      {
        ticketPass: body.ticketPass,
        ...(body.eventNoticeVersion === undefined
          ? {}
          : { eventNoticeVersion: body.eventNoticeVersion }),
        sessionPubKey: body.sessionPubKey.toLowerCase() as Hex,
        ...(recoveryKeyHash === undefined ? {} : { recoveryKeyHash }),
      },
      { requireNotice: false },
    );
    const plans = await buildPlans(deps, campaign.id as Hex, true);
    if (!plans.campaign) throw fail('not_found');
    c.header('Cache-Control', 'no-store');
    return c.json({ valid: true, campaignId: campaign.id, plans });
  });
}
