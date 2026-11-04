/**
 * The public self-run facilitator (A-30, T-75): GET /facilitator/supported · POST /facilitator/verify|settle. Only
 * our own terms are relayed — network ∈ X402_NETWORKS ∩ EVM, asset = our USDC, payTo = PAYOUT_ADDRESS — so nobody
 * can make the relayer spend gas on someone else's transfer. Rate-limited 30/min/IP (rate-limit.ts).
 */
import { z } from 'zod';

import {
  paymentPayloadSchema,
  paymentRequirementsSchema,
  type PaymentPayload,
  type PaymentRequirements,
} from '@ethglobal/protocol/schemas';

import { inputOf, type AppEnv } from '../context.js';
import { facilitatorNetworks, type Deps } from '../deps.js';
import { fail } from '../errors.js';
import { validateJson } from '../middleware/validate.js';

import type { Hono } from 'hono';

export const facilitatorRequestSchema = z.object({
  x402Version: z.literal(2),
  paymentPayload: paymentPayloadSchema,
  paymentRequirements: paymentRequirementsSchema,
});
type FacilitatorRequest = z.infer<typeof facilitatorRequestSchema>;

export function registerFacilitator(app: Hono<AppEnv>, deps: Deps): void {
  const facilitator = deps.facilitator;
  if (!facilitator) return;
  const ours = deps.accepts.filter((a) => facilitatorNetworks(deps).includes(a.network));

  app.get('/facilitator/supported', (c) =>
    c.json({
      kinds: ours.map((a) => ({
        x402Version: 2,
        scheme: 'exact',
        network: a.network,
        extra: { name: a.extra?.name, version: a.extra?.version },
      })),
      extensions: [],
      signers: { 'eip155:*': [facilitator.relayer] },
    }),
  );

  const guarded = (
    req: FacilitatorRequest,
  ): { payload: PaymentPayload; requirements: PaymentRequirements } => {
    const r = req.paymentRequirements;
    const template = ours.find((a) => a.network === r.network);
    if (
      template?.asset.toLowerCase() !== r.asset.toLowerCase() ||
      template.payTo.toLowerCase() !== r.payTo.toLowerCase()
    ) {
      throw fail('invalid_request', [
        { path: 'paymentRequirements', message: 'not terms this facilitator relays' },
      ]);
    }
    return { payload: req.paymentPayload, requirements: r };
  };

  for (const op of ['verify', 'settle'] as const) {
    app.post(`/facilitator/${op}`, validateJson(facilitatorRequestSchema), async (c) => {
      const { payload, requirements } = guarded(inputOf<FacilitatorRequest>(c));
      const run = (): Promise<unknown> => facilitator.rail[op](payload, requirements);
      return c.json(await deps.metrics.timed('facilitator_ms', run, { op }));
    });
  }
}
