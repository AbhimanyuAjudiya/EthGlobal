/**
 * POST /sponsor/:id/cards (A-43, RT-P-08): the live path for Thursday's print run. Campaign-funded scratch cards,
 * minted only with the sponsor's write credential (a fresh `SponsorCards` signature over this exact batch), ≤ 200,
 * ≤ what the remaining budget pays for, PINs once in the 201 body and nowhere else.
 */
import { describe, expect, it } from 'vitest';

import { isValidPin } from '@ethglobal/protocol/pin';
import { sponsorCardsResponseSchema } from '@ethglobal/protocol/schemas';

import { scopedCampaignId, sponsorCardsRequest, sponsorLogin } from './support/client.js';
import {
  DAY,
  errorOf,
  harness,
  redeemPin,
  SPONSOR,
  SPONSOR_KEY,
  STRANGER_KEY,
  type Harness,
} from './support/harness.js';
import { SPONSOR_CARDS_PER_MIN } from '../src/routes/sponsor.js';

type Body = Awaited<ReturnType<typeof sponsorCardsRequest>>;

const mint = async (h: Harness, o: { count?: number; mb?: number; key?: `0x${string}` } = {}) => {
  const body = await sponsorCardsRequest(o.key ?? SPONSOR_KEY, h.deps.chainId, h.campaignId, {
    count: o.count ?? 3,
    mb: o.mb ?? 300,
    issuedAt: h.clock.now(),
  });
  return { body, res: await post(h, body) };
};
const post = (h: Harness, body: unknown, id: string = h.campaignId) =>
  h.json(`/sponsor/${id}/cards`, body);

describe('POST /sponsor/:id/cards', () => {
  it('the on-chain sponsor mints N redeemable cards; PINs appear once, only in the 201 body', async () => {
    const h = await harness();
    const { res } = await mint(h, { count: 20 });
    expect(res.status).toBe(201);
    expect(res.headers.get('cache-control')).toContain('no-store');
    const reply = sponsorCardsResponseSchema.parse(await res.json());
    expect(reply.campaignId).toBe(h.campaignId);
    expect(reply.cards).toHaveLength(20);
    expect(new Set(reply.cards.map((c) => c.pin)).size).toBe(20);
    expect(new Set(reply.cards.map((c) => c.serial)).size).toBe(20);
    for (const card of reply.cards) {
      expect(isValidPin(card.pin)).toBe(true);
      expect(card.mb).toBe(300);
    }
    // claimBy never outlives the campaign
    expect(reply.claimBy).toBeLessThanOrEqual(h.clock.now() + 30 * DAY);

    // nothing stores or logs a PIN: the ledger has serials and PIN HMACs, the log a count
    const ledger = JSON.stringify(await h.adapters.ledger.query({}));
    const log = h.lines.join('\n');
    for (const { pin } of reply.cards) {
      expect(ledger).not.toContain(pin);
      expect(log).not.toContain(pin);
    }
    expect(log).toContain('"op":"card.mint","count":20');

    // a printed card redeems (DataDrop.claim from the campaign), once
    const first = reply.cards[0]!;
    const redeemed = await redeemPin(h, first.pin);
    expect(redeemed.status).toBe(201);
    expect(((await redeemed.json()) as { kind: string }).kind).toBe('card');
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    const preview = (await (await h.get(`/card/${first.serial}`)).json()) as { state: string };
    expect(preview.state).toBe('claimed');
  });

  it('count 0, 201 or a non-100 MB size → 400; a malformed campaign id → 401', async () => {
    const h = await harness();
    for (const [count, mb] of [
      [0, 300],
      [201, 300],
      [5, 250],
      [5, 4000],
    ] as const) {
      const body = await sponsorCardsRequest(SPONSOR_KEY, h.deps.chainId, h.campaignId, {
        count,
        mb,
        issuedAt: h.clock.now(),
      });
      expect((await post(h, body)).status).toBe(400);
    }
    const { body } = await mint(h);
    expect((await post(h, body, '0x1234')).status).toBe(401);
  });

  it('200 in one batch is allowed (the print run)', async () => {
    const h = await harness();
    const { res } = await mint(h, { count: 200 });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { cards: unknown[] }).cards).toHaveLength(200);
  });

  it('a stranger, a tampered batch, a stale/future signature or the dashboard read bearer → 401', async () => {
    const h = await harness();
    expect(await errorOf((await mint(h, { key: STRANGER_KEY })).res)).toBe('unauthorized');

    const signed = await sponsorCardsRequest(SPONSOR_KEY, h.deps.chainId, h.campaignId, {
      count: 5,
      mb: 300,
      issuedAt: h.clock.now(),
    });
    expect((await post(h, { ...signed, count: 50 })).status).toBe(401); // signed 5, asks 50
    expect((await post(h, { ...signed, mb: 1000 })).status).toBe(401);

    for (const issuedAt of [h.clock.now() - 600_001, h.clock.now() + 61_000]) {
      const body = await sponsorCardsRequest(SPONSOR_KEY, h.deps.chainId, h.campaignId, {
        count: 5,
        mb: 300,
        issuedAt,
      });
      expect((await post(h, body)).status).toBe(401);
    }

    // the SponsorLogin signature a dashboard holds is a READ credential: it cannot mint (RT-A-04 scopes)
    const login = await sponsorLogin(SPONSOR_KEY, h.deps.chainId, h.campaignId, h.clock.now());
    const asRead: Body = {
      count: 5,
      mb: 300,
      auth: {
        sponsor: login.sponsor,
        nonce: `0x${'00'.repeat(32)}`,
        issuedAt: login.issuedAt,
        signature: login.signature,
      },
    };
    expect((await post(h, asRead)).status).toBe(401);

    // the right sponsor signing for ANOTHER campaign's id
    const other = scopedCampaignId(SPONSOR, 99n);
    const forOther = await sponsorCardsRequest(SPONSOR_KEY, h.deps.chainId, other, {
      count: 5,
      mb: 300,
      issuedAt: h.clock.now(),
    });
    expect((await post(h, forOther)).status).toBe(401);
    expect(await h.adapters.ledger.query({ annotations: { type: 'gift' } })).toHaveLength(0);
  });

  it('a replayed batch → 409 replay, never a second set of PINs', async () => {
    const h = await harness();
    const { body, res } = await mint(h, { count: 2 });
    expect(res.status).toBe(201);
    const again = await post(h, body);
    expect(again.status).toBe(409);
    expect(await errorOf(again)).toBe('replay');
  });

  it('a paused campaign → 423; more cards than the remaining budget pays for → 409 budget_exhausted', async () => {
    const paused = await harness({ campaign: { paused: true } });
    expect(await errorOf((await mint(paused)).res)).toBe('campaign_paused');

    // 3 USDC budget at 0.50/claim pays for 6 claims
    const poor = await harness({ campaign: { budget: 3_000_000n } });
    expect(await errorOf((await mint(poor, { count: 7 })).res)).toBe('budget_exhausted');
    expect((await mint(poor, { count: 6 })).res.status).toBe(201);
  });

  it('an unregistered (chain-only) or expired campaign mints nothing', async () => {
    const h = await harness();
    const id = scopedCampaignId(SPONSOR, 7n);
    h.dataDrop.create(id, {
      sponsor: SPONSOR,
      pricePerClaim: 500_000n,
      budget: 10_000_000n,
      spent: 0n,
      claimsPerHour: 10,
      expiresAt: h.clock.now() + DAY,
    });
    const body = await sponsorCardsRequest(SPONSOR_KEY, h.deps.chainId, id, {
      count: 1,
      mb: 300,
      issuedAt: h.clock.now(),
    });
    expect((await post(h, body, id)).status).toBe(401);

    const old = await harness({ campaign: { expiresInMs: DAY } });
    old.clock.advance(DAY + 1);
    // the campaign entity's lifetime ended with the campaign: the ledger no longer knows it (401), or 410
    expect([401, 410]).toContain((await mint(old)).res.status);
    expect(await old.adapters.ledger.query({ annotations: { type: 'gift' } })).toHaveLength(0);
  });

  it(`more than ${SPONSOR_CARDS_PER_MIN} signed batches a minute for one campaign → 429`, async () => {
    const h = await harness();
    for (let i = 0; i < SPONSOR_CARDS_PER_MIN; i += 1)
      expect((await mint(h, { count: 1 })).res.status).toBe(201);
    expect((await mint(h, { count: 1 })).res.status).toBe(429);
    h.clock.advance(60_001);
    expect((await mint(h, { count: 1 })).res.status).toBe(201);
  });
});
