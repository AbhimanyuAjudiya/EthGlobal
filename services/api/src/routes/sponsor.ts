/**
 * POST /sponsor (register) and GET /sponsor/:id (the dashboard = an Arkiv query + chain counters; T-72, A-9).
 *
 * Scopes (RT-A-04): the `SponsorLogin` bearer is a READ credential. Registration is a one-time write: an id that is
 * already registered is 409 `campaign_exists` whoever signs, so a captured dashboard bearer can neither rewrite a
 * campaign nor mint its audit key again. The audit key is shown once per channel — in the first registration's
 * 201, and on the first dashboard read — and "shown" is a ledger once-marker (`claim:` HMAC, A-42), not process
 * memory, so a restart does not show it again.
 */
import { bytesToHex, hmacKey } from '@ethglobal/crypto';
import { auditKey, campaignFromPayload, sizeBundle, type Campaign } from '@ethglobal/octroi';
import { keys, type Hex } from '@ethglobal/protocol/ids';
import {
  sponsorRegisterSchema,
  type SponsorRegister,
  type SponsorView,
} from '@ethglobal/protocol/schemas';
import { usd6ToWire } from '@ethglobal/protocol/units';

import { inputOf, type AppEnv } from '../context.js';
import { fail } from '../errors.js';
import { sponsorFromHeader, verifySponsorLogin } from '../middleware/sponsor-auth.js';
import { validateJson } from '../middleware/validate.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

const DAY_MS = 86_400_000;
const ID = /^0x[0-9a-fA-F]{64}$/;

/** True the first time `what` happens for this campaign, on any process sharing the ledger. */
const firstTime = (deps: Deps, what: 'registered' | 'audit-shown', id: Hex, until: number) =>
  deps.stores.claims.reserve(
    keys.claim(hmacKey(deps.secret, `sponsor-${what}`, id)),
    'once',
    until,
  );

export function registerSponsor(app: Hono<AppEnv>, deps: Deps): void {
  app.post('/sponsor', validateJson(sponsorRegisterSchema), async (c) => {
    const { campaign, auth } = inputOf<SponsorRegister>(c);
    const id = campaign.id.toLowerCase() as Hex;
    await verifySponsorLogin(deps, {
      campaignId: id,
      sponsor: campaign.sponsor,
      issuedAt: auth.issuedAt,
      signature: auth.signature,
    });
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
      await deps.stores.campaigns.put(
        campaignFromPayload({ ...campaign, id, v: 1, createdAt: deps.now() }),
      );
      // another process registered it first: ours is not the first registration, so no audit key
      if (!(await firstTime(deps, 'registered', id, campaign.expiresAt)))
        throw fail('campaign_exists', { detail: 'already registered' });
      deps.logger.info({ event: 'ledger.op', op: 'campaign.put' }, 'campaign registered');
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
