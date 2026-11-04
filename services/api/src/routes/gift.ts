/** POST /gift, POST /gift/claim, POST /gift/reclaim, GET /card/:serial, POST /card/redeem. */
import { createMiddleware } from 'hono/factory';

import type { Challenge } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import {
  cardRedeemRequestSchema,
  giftClaimRequestSchema,
  giftReclaimRequestSchema,
  giftRequestSchema,
  isEvmExact,
  type CardPreview,
  type CardRedeemRequest,
  type GiftClaimRequest,
  type GiftReclaimRequest,
  type GiftRequest,
} from '@ethglobal/protocol/schemas';

import { inputOf, type AppEnv } from '../context.js';
import { fail } from '../errors.js';
import { settledDecision } from '../flows/entitle.js';
import {
  claimEscrow,
  claimWindowMs,
  consume,
  createGift,
  escrowByPin,
  escrowOf,
  resolveName,
  seedCard,
  verifyGiftClaimSigner,
} from '../flows/gift.js';
import { reclaim } from '../flows/reclaim.js';
import { octroi } from '../middleware/octroi.js';
import { validateJson } from '../middleware/validate.js';
import { withPaymentResponse, x402 } from '../middleware/x402.js';
import { seedCardCampaign, seedClaimWindowS } from '../seed.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

type Resolved = GiftRequest & { resolved: Awaited<ReturnType<typeof resolveName>> };

export function registerGift(app: Hono<AppEnv>, deps: Deps): void {
  app.post(
    '/gift',
    validateJson(giftRequestSchema),
    x402,
    createMiddleware<AppEnv>(async (c, next) => {
      const body = inputOf<GiftRequest>(c);
      const card = seedCardCampaign(c);
      if (card !== undefined)
        return c.json(
          await seedCard(
            deps,
            card as Hex,
            body.mb,
            (seedClaimWindowS(c) ?? claimWindowMs() / 1000) * 1000,
          ),
          201,
        );
      // the name resolves BEFORE any 402: nobody pays for a gift to nobody (T-43)
      c.set('input', { ...body, resolved: await resolveName(deps, body.name) } satisfies Resolved);
      return next();
    }),
    octroi((c) => ({
      lane: 'paid',
      mb: inputOf<Resolved>(c).mb,
      requireSessionKey: false,
      description: 'Recharge gift',
    })),
    async (c) => {
      const decision = settledDecision(c);
      if (decision instanceof Response) return decision;
      if (decision.kind !== 'serve-paid') throw fail('internal_error');
      const body = inputOf<Resolved>(c);
      const payment = c.get('payment');
      if (!payment || !isEvmExact(payment.payload))
        throw fail('invalid_payment', { detail: 'gifts are paid on EVM' });
      const window = seedClaimWindowS(c);
      const gift = await createGift(
        deps,
        {
          ...body.resolved,
          mb: body.mb,
          ...(body.message === undefined ? {} : { message: body.message }),
          claimWindowMs: window === undefined ? claimWindowMs() : window * 1000,
        },
        {
          settlement: decision.settlement,
          usd6: decision.requirements.amount,
          nonce: payment.payload.authorization.nonce as Hex,
        },
      );
      withPaymentResponse(c, gift.settlement);
      return c.json(gift, 201);
    },
  );

  app.post('/gift/claim', validateJson(giftClaimRequestSchema), async (c) => {
    const body = inputOf<GiftClaimRequest>(c);
    const sessionPubKey = body.sessionPubKey.toLowerCase() as Hex;
    await consume(deps, body.challenge as Challenge, '/gift/claim', sessionPubKey);
    const nonce = body.challenge.nonce as Hex;
    if ('pin' in body) {
      const escrow = await escrowByPin(deps, body.pin);
      const result = await claimEscrow(deps, escrow, {
        nonce,
        sessionPubKey,
        redeem: false,
        pin: body.pin,
      });
      return c.json(result.body, result.status);
    }
    const escrow = await escrowOf(deps, body.giftId as Hex);
    if (!escrow) throw fail('expired', { detail: 'gift not claimable' });
    if (escrow.payload.state === 'claimed') throw fail('already_claimed');
    await verifyGiftClaimSigner(deps, escrow.payload, {
      giftId: body.giftId as Hex,
      recipient: body.recipient,
      signature: body.signature,
      nonce,
    });
    const result = await claimEscrow(deps, escrow, { nonce, sessionPubKey, redeem: false });
    return c.json(result.body, result.status);
  });

  app.post('/gift/reclaim', validateJson(giftReclaimRequestSchema), async (c) =>
    c.json(await reclaim(deps, inputOf<GiftReclaimRequest>(c))),
  );

  // GET is read-only (T-47): link-preview bots and ?pin= never change state.
  app.get('/card/:serial', async (c) => {
    const serial = c.req.param('serial');
    const found = /^[0-9a-f]{8}$/.test(serial) ? await deps.stores.gifts.bySerial(serial) : null;
    if (!found) throw fail('not_found');
    const g = found.payload;
    const sponsor =
      g.campaignId === undefined
        ? undefined
        : (await deps.stores.campaigns.get(g.campaignId as Hex))?.payload.name;
    const preview: CardPreview = {
      serial: g.serial,
      mb: g.mb,
      ...(sponsor === undefined ? {} : { sponsorName: sponsor }),
      state: g.claimBy <= deps.now() ? 'expired' : g.state,
      claimBy: g.claimBy,
    };
    return c.json(preview);
  });

  app.post('/card/redeem', validateJson(cardRedeemRequestSchema), async (c) => {
    const body = inputOf<CardRedeemRequest>(c);
    const sessionPubKey = body.sessionPubKey.toLowerCase() as Hex;
    await consume(deps, body.challenge as Challenge, '/card/redeem', sessionPubKey);
    const escrow = await escrowByPin(deps, body.pin);
    if (escrow.payload.state === 'claimed') throw fail('expired', { detail: 'already redeemed' });
    const result = await claimEscrow(deps, escrow, {
      nonce: body.challenge.nonce as Hex,
      sessionPubKey,
      redeem: true,
      pin: body.pin,
    });
    return c.json(result.body, result.status);
  });
}
