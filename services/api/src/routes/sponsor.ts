/**
 * POST /sponsor (register) and GET /sponsor/:id (the dashboard = an Arkiv query + chain counters; T-72, A-9).
 *
 * Scopes (RT-A-04): `SponsorLogin` authorizes dashboard reads and one initial registration. An id that is
 * already registered is 409 `campaign_exists` whoever signs, so a captured dashboard bearer can neither rewrite a
 * campaign nor mint its audit key again. The audit key is shown once per channel — in the first registration's
 * 201, and on the first dashboard read — and "shown" is a ledger once-marker (`claim:` HMAC, A-42), not process
 * memory, so a restart does not show it again.
 *
 * POST /sponsor/:id/cards (A-43, RT-P-08) is the live way to mint campaign-funded scratch cards for a print run: it
 * needs the sponsor's WRITE credential, a fresh EIP-712 `SponsorCards{campaignId, sponsor, count, mb, nonce,
 * issuedAt}` (≤ 10 min old, nonce one-shot) by the on-chain sponsor of a registered, unpaused campaign; count ≤ 200
 * and ≤ the claims the remaining budget still pays for. The PINs appear once, in the 201 body; the ledger holds
 * serials and PIN HMACs, the log holds counts. Not idempotent by design (a cached replay would re-show PINs):
 * a retry needs a new nonce and mints a new batch.
 */
import { bytesToHex, hmacKey } from '@ethglobal/crypto';
import {
  assertCampaignLifetime,
  auditKey,
  campaignFromPayload,
  sizeBundle,
  type Campaign,
} from '@ethglobal/octroi';
import { keys, type Hex } from '@ethglobal/protocol/ids';
import {
  sponsorCardsRequestSchema,
  sponsorRegisterSchema,
  type SponsorCardsRequest,
  type SponsorCardsResponse,
  type SponsorRegister,
  type SponsorView,
} from '@ethglobal/protocol/schemas';
import {
  rechargeDomain,
  SPONSOR_CARDS_MAX,
  SPONSOR_CARDS_TTL_MS,
  SPONSOR_CARDS_TYPES,
} from '@ethglobal/protocol/typed-data';
import { formatUsd6, usd6ToWire } from '@ethglobal/protocol/units';

import { WindowLimiter } from '../admission.js';
import { inputOf, type AppEnv } from '../context.js';
import { fail } from '../errors.js';
import { claimWindowMs, mintCard, type MintedCard } from '../flows/gift.js';
import { assertConfiguredCapacity, assertPlanCapacity } from '../flows/plan.js';
import {
  SPONSOR_FUTURE_SKEW_MS,
  sponsorFromHeader,
  verifySponsorLogin,
} from '../middleware/sponsor-auth.js';
import { validateJson } from '../middleware/validate.js';
import { signedBy } from '../signatures.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';
import type { Address } from 'viem';

const DAY_MS = 86_400_000;
const ID = /^0x[0-9a-fA-F]{64}$/;

/** Card batches per campaign per minute (each is up to 200 ledger writes). */
export const SPONSOR_CARDS_PER_MIN = 5;
/** Ledger writes in flight per batch. */
const MINT_CONCURRENCY = 8;

/** True the first time `what` happens for this campaign, on any process sharing the ledger. */
const firstTime = (
  deps: Deps,
  what: 'registered' | 'audit-shown' | `cards-${string}`,
  id: Hex,
  until: number,
) =>
  deps.stores.claims.reserve(
    keys.claim(hmacKey(deps.secret, `sponsor-${what}`, id)),
    'once',
    until,
  );

export function registerSponsor(app: Hono<AppEnv>, deps: Deps): void {
  app.post(
    '/sponsor/validate',
    validateJson(sponsorRegisterSchema.pick({ campaign: true })),
    async (c) => {
      const { campaign } = inputOf<Pick<SponsorRegister, 'campaign'>>(c);
      await validateDraft(deps, campaign);
      return c.json({ valid: true });
    },
  );

  app.post('/sponsor', validateJson(sponsorRegisterSchema), async (c) => {
    const { campaign, auth } = inputOf<SponsorRegister>(c);
    const id = campaign.id.toLowerCase() as Hex;
    await verifySponsorLogin(deps, {
      campaignId: id,
      sponsor: campaign.sponsor,
      issuedAt: auth.issuedAt,
      signature: auth.signature,
    });
    // the per-campaign claim record must outlive the campaign (RT-O-08, A-44): CampaignTooLongError ⇒ 400
    assertCampaignLifetime(campaign.expiresAt, deps.now());
    const chain = await deps.dataDrop.campaign(id);
    if (/^0x0{40}$/i.test(chain.sponsor))
      throw fail('not_found', { detail: 'no such campaign on-chain' });
    // signer == campaign.sponsor == on-chain campaigns(id).sponsor (nobody registers a campaign they do not own)
    if (chain.sponsor.toLowerCase() !== campaign.sponsor.toLowerCase())
      throw fail('unauthorized', { detail: 'not the on-chain sponsor' });
    if (
      campaign.contract.toLowerCase() !== deps.dataDrop.address.toLowerCase() ||
      campaign.network !== `eip155:${deps.chainId}`
    ) {
      throw fail('invalid_request', [
        { path: 'campaign.contract', message: 'not this deployment' },
      ]);
    }
    return deps.mutex.run(`sponsor:${id}`, async () => {
      if (await deps.stores.campaigns.get(id))
        throw fail('campaign_exists', { detail: 'already registered' });
      await validateDraft(deps, campaign, false);
      // every claim provisions a whole eSIM: a NEW campaign paying less per claim (the on-chain price, authoritative)
      // is refused; registered campaigns are never re-checked
      if (chain.pricePerClaim < deps.env.COST_USD6_PER_CLAIM) {
        throw fail('invalid_request', [
          {
            path: 'campaign.pricePerClaimUsd6',
            message: `per-claim price is below the eSIM cost (${formatUsd6(deps.env.COST_USD6_PER_CLAIM)})`,
          },
        ]);
      }
      const value = campaignFromPayload({ ...campaign, id, v: 1, createdAt: deps.now() });
      await deps.stores.campaigns.put(value);
      // another process registered it first: ours is not the first registration, so no audit key
      if (!(await firstTime(deps, 'registered', id, campaign.expiresAt)))
        throw fail('campaign_exists', { detail: 'already registered' });
      deps.logger.info({ event: 'ledger.op', op: 'campaign.put' }, 'campaign registered');
      // its ENSv2 name is registered in the background (flows/ens.ts): never delays or fails this 201
      deps.ens?.enqueue(id);
      return c.json({ id, auditKey: bytesToHex(auditKey(deps.secret, id)) }, 201);
    });
  });

  app.get('/sponsor/:id', async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) throw fail('unauthorized');
    const campaignId = id.toLowerCase() as Hex;
    const sponsor = await sponsorFromHeader(deps, c.req.header('authorization'), campaignId);
    const found = await deps.stores.campaigns.get(campaignId);
    const chain = await deps.dataDrop.campaign(campaignId);
    if (
      found?.payload.sponsor.toLowerCase() !== sponsor.toLowerCase() ||
      chain.sponsor.toLowerCase() !== sponsor.toLowerCase()
    ) {
      throw fail('unauthorized', { detail: 'not this campaign’s sponsor' });
    }
    const bucket = await deps.dataDrop.currentHourBucket();
    const [claimsThisHour, receipts, expiring] = await Promise.all([
      deps.dataDrop.claimsInHour(campaignId, bucket),
      deps.stores.receipts.forCampaign(campaignId),
      deps.stores.entitlements.expiringWithin(DAY_MS),
    ]);
    const c0 = found.payload;
    const claims = receipts.filter((r) => r.kind === 'claim' && r.payer !== undefined);
    const firstRead = await firstTime(deps, 'audit-shown', campaignId, c0.expiresAt);
    const view: SponsorView = {
      campaign: campaignPayload(c0),
      chain: {
        budgetUsd6: usd6ToWire(chain.budget),
        spentUsd6: usd6ToWire(chain.spent),
        paused: chain.paused,
        claims:
          chain.pricePerClaim > 0n ? Number(chain.spent / chain.pricePerClaim) : claims.length,
        claimsThisHour,
        hourBucket: bucket,
      },
      // published per-campaign pseudonyms only (never a nullifier, quota key or entitlement key)
      claims: claims.map((r) => ({
        at: r.at,
        campaignClaimKey: `0x${r.payer ?? ''}`,
        tier: tierForMb(c0, r.mb ?? 0),
        mb: r.mb ?? 0,
        usd6: r.usd6 ?? usd6ToWire(chain.pricePerClaim),
        ...(r.tx === undefined ? {} : { tx: r.tx }),
        status: 'confirmed',
      })),
      expiring: expiring
        .filter((f) => f.payload.campaignId?.toLowerCase() === campaignId)
        .map((f) => ({
          arkivKey: f.entityKey,
          remainingMb: Math.max(0, f.payload.mbTotal - f.payload.mbUsed),
          expiresAt: f.payload.expiresAt,
          tier: f.payload.tier,
        })),
      ...(firstRead ? { auditKey: bytesToHex(auditKey(deps.secret, campaignId)) } : {}),
    };
    return c.json(view);
  });

  const cardBatches = new WindowLimiter(SPONSOR_CARDS_PER_MIN, 60_000, deps.now);
  app.post('/sponsor/:id/cards', validateJson(sponsorCardsRequestSchema), async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) throw fail('unauthorized');
    const campaignId = id.toLowerCase() as Hex;
    const { count, mb, auth } = inputOf<SponsorCardsRequest>(c);
    await verifySponsorCards(deps, campaignId, { count, mb, ...auth });
    await assertConfiguredCapacity(deps, mb);
    // after the signature: unsigned junk cannot spend the sponsor's batch quota
    const limited = cardBatches.hit(campaignId);
    if (!limited.ok) throw fail('rate_limited', { retryAfterS: limited.retryAfterS });
    // RT-P-08: the mark is taken before the counters are read (Admission: a batch that commits after it is still
    // subtracted), and the open cards are read beside the chain's budget — outstanding PINs are promised claims
    const mark = deps.admission.mark();
    const [found, chain, open] = await Promise.all([
      deps.stores.campaigns.get(campaignId),
      deps.dataDrop.campaign(campaignId),
      deps.stores.gifts.openCampaignCards(campaignId),
    ]);
    const sponsor = auth.sponsor.toLowerCase();
    if (
      found?.payload.sponsor.toLowerCase() !== sponsor ||
      chain.sponsor.toLowerCase() !== sponsor
    ) {
      throw fail('unauthorized', { detail: 'not this campaign’s sponsor' });
    }
    const now = deps.now();
    if (chain.paused) throw fail('campaign_paused');
    if (chain.expiresAt <= now || found.payload.expiresAt <= now) throw fail('campaign_expired');
    const paysFor =
      chain.pricePerClaim > 0n ? (chain.budget - chain.spent) / chain.pricePerClaim : 0n;
    const remaining =
      paysFor > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(paysFor);
    // Atomic across batches (RT-P-08): `count` slots taken synchronously with the Admission reservation claims use
    // (its own `cards:` key, so a 200-card batch in flight never counts against the claims' hourly cap) against
    // (budget − spent) / price − open cards − cards in flight − cards committed since the mark.
    const slot = `cards:${campaignId}`;
    const release = deps.admission.takeMany(slot, count, remaining, open.length, mark);
    if (!release) {
      const left = Math.max(0, remaining - open.length - deps.admission.inFlight(slot));
      throw fail('budget_exhausted', {
        detail: `the budget pays for ${left} more cards (${open.length} unredeemed cards outstanding)`,
      });
    }
    let minted = false;
    try {
      // one-shot nonce: the same signed batch twice is a replay, never a second set of PINs
      if (
        !(await firstTime(
          deps,
          `cards-${auth.nonce.toLowerCase()}`,
          campaignId,
          now + SPONSOR_CARDS_TTL_MS,
        ))
      )
        throw fail('replay', { detail: 'this SponsorCards nonce was used' });
      const claimBy = Math.min(now + claimWindowMs(), chain.expiresAt, found.payload.expiresAt);
      const cards: MintedCard[] = [];
      for (let i = 0; i < count; i += MINT_CONCURRENCY) {
        const n = Math.min(MINT_CONCURRENCY, count - i);
        cards.push(
          ...(await Promise.all(
            Array.from({ length: n }, () => mintCard(deps, campaignId, mb, claimBy)),
          )),
        );
      }
      // counts only: no PIN, no serial list in the log (T-50, T-64)
      deps.logger.info({ event: 'ledger.op', op: 'card.mint', count, mb }, 'sponsor cards minted');
      minted = true;
      const reply: SponsorCardsResponse = {
        campaignId,
        mb,
        claimBy,
        cards: cards.map(({ serial, pin }) => ({ serial, pin, mb })),
      };
      return c.json(reply, 201);
    } finally {
      // committed: the cards now exist on the ledger (the next batch's `open` read counts them)
      release(minted);
    }
  });
}

/** Public preflight runs before wallet approval/funding; registration repeats it against the actual chain. */
async function validateDraft(
  deps: Deps,
  campaign: SponsorRegister['campaign'],
  checkPrice = true,
): Promise<void> {
  assertCampaignLifetime(campaign.expiresAt, deps.now());
  if (
    campaign.contract.toLowerCase() !== deps.dataDrop.address.toLowerCase() ||
    campaign.network !== `eip155:${deps.chainId}`
  )
    throw fail('invalid_request', [{ path: 'campaign.contract', message: 'not this deployment' }]);
  if (checkPrice && BigInt(campaign.pricePerClaimUsd6) < deps.env.COST_USD6_PER_CLAIM)
    throw fail('invalid_request', [
      {
        path: 'campaign.pricePerClaimUsd6',
        message: `per-claim price is below the eSIM cost (${formatUsd6(deps.env.COST_USD6_PER_CLAIM)})`,
      },
    ]);
  const value = campaignFromPayload({ ...campaign, v: 1, createdAt: deps.now() });
  await assertPlanCapacity(
    deps,
    campaign.planId,
    Math.max(...(['orb', 'document', 'device'] as const).map((tier) => sizeBundle(value, tier))),
  );
}

function campaignPayload(c: Campaign): SponsorView['campaign'] {
  const { actionCheck: _a, pricePerClaimUsd6, wholesaleUsd6PerGb, idResaleUsd6, ...rest } = c;
  return {
    ...rest,
    v: 1,
    pricePerClaimUsd6: usd6ToWire(pricePerClaimUsd6),
    wholesaleUsd6PerGb: usd6ToWire(wholesaleUsd6PerGb),
    idResaleUsd6: usd6ToWire(idResaleUsd6),
  };
}

/** Receipts carry no tier; it is recovered from the bundle size the campaign gives each tier. */
const tierForMb = (c: Campaign, mb: number): SponsorView['claims'][number]['tier'] =>
  mb === sizeBundle(c, 'orb') ? 'orb' : mb === sizeBundle(c, 'document') ? 'document' : 'none';

/** EIP-712 `SponsorCards` by `auth.sponsor`, issuedAt within 10 min (60 s future skew); 401 otherwise. */
async function verifySponsorCards(
  deps: Pick<Deps, 'chainId' | 'now'>,
  campaignId: Hex,
  a: {
    count: number;
    mb: number;
    sponsor: string;
    nonce: string;
    issuedAt: number;
    signature: string;
  },
): Promise<void> {
  const now = deps.now();
  if (a.issuedAt < now - SPONSOR_CARDS_TTL_MS || a.issuedAt > now + SPONSOR_FUTURE_SKEW_MS)
    throw fail('unauthorized', { detail: 'issuedAt outside the 10-min window' });
  if (a.count > SPONSOR_CARDS_MAX) throw fail('invalid_request');
  const ok = await signedBy({
    address: a.sponsor as Address,
    domain: rechargeDomain(deps.chainId),
    types: SPONSOR_CARDS_TYPES,
    primaryType: 'SponsorCards',
    message: {
      campaignId,
      sponsor: a.sponsor as Address,
      count: BigInt(a.count),
      mb: BigInt(a.mb),
      nonce: a.nonce as Hex,
      issuedAt: BigInt(a.issuedAt),
    },
    signature: a.signature as Hex,
  });
  if (!ok) throw fail('unauthorized', { detail: 'bad SponsorCards signature' });
}
