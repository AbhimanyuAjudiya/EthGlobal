/**
 * The public self-run facilitator (A-30, T-75): GET /facilitator/supported · POST /facilitator/verify|settle. Only
 * our own terms are relayed — network ∈ X402_NETWORKS ∩ EVM, asset = our USDC, payTo = PAYOUT_ADDRESS, amount ≥ the
 * price of one step (the smallest thing we sell) — so nobody can make the relayer spend gas on someone else's
 * transfer or on dust. Rate-limited 30/min/IP (rate-limit.ts) and 10/min per payer (`authorization.from`); the
 * relayer sends one transaction at a time (deps.ts `serialRelayer`, RT-A-12).
 */
import { z } from 'zod';

import {
  isEvmExact,
  paymentPayloadSchema,
  paymentRequirementsSchema,
  type PaymentPayload,
  type PaymentRequirements,
} from '@ethglobal/protocol/schemas';

import { WindowLimiter } from '../admission.js';
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

/** Settlement attempts per payer address per minute (T-75 "per from"). */
export const FACILITATOR_PER_PAYER_PER_MIN = 10;

export function registerFacilitator(app: Hono<AppEnv>, deps: Deps): void {
  const facilitator = deps.facilitator;
  if (!facilitator) return;
  const ours = deps.accepts.filter((a) => facilitatorNetworks(deps).includes(a.network));
  const perPayer = new WindowLimiter(FACILITATOR_PER_PAYER_PER_MIN, 60_000, deps.now);

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
    // RT-A-12: a 1-unit authorization to our payTo is not a sale; it only occupies the relayer
    if (BigInt(r.amount) < deps.env.PRICE_USD6_PER_STEP) {
      throw fail('invalid_request', [
        { path: 'paymentRequirements.amount', message: 'below the smallest amount we sell' },
      ]);
    }
    const payload = req.paymentPayload.payload;
    const payer = isEvmExact(payload) ? payload.authorization.from.toLowerCase() : 'non-evm';
    const verdict = perPayer.hit(payer);
    if (!verdict.ok) throw fail('rate_limited', { retryAfterS: verdict.retryAfterS });
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
