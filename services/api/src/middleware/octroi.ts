import { createMiddleware } from 'hono/factory';

import {
  decide,
  type Campaign,
  type CampaignCounters,
  type DecideRequest,
  type Challenge,
} from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import type { PaymentResource, PersonhoodProof } from '@ethglobal/protocol/schemas';

import { fail } from '../errors.js';
import { consume } from '../flows/challenge.js';

import type { AppEnv, Ctx } from '../context.js';
import type { Deps } from '../deps.js';

/** What a route hands octroi(): the free lane (proof) or the paid lane (payment from x402()). */
export type LaneInput =
  | {
      lane: 'free';
      campaignId: Hex;
      proof: PersonhoodProof;
      challenge: Challenge;
      sessionPubKey: Hex;
    }
  | { lane: 'paid'; mb: number; requireSessionKey: boolean; description: string };

/**
 * octroi(): assembles the DecideRequest (campaign from the ledger + DataDrop counters for the free lane, payment and
 * session key for the paid lane), takes the per-campaign admission slot BEFORE decide() can burn a verification
 * (T-24, T-46), runs decide(), and stores the Decision on c.var.decision. The slot is released when the request ends
 * (the free-lane flow releases it earlier, right after the chain receipt).
 */
export const octroi = (input: (c: Ctx) => LaneInput | Promise<LaneInput>) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const deps = c.get('deps');
    if (deps.health.degraded) throw fail('ledger_unavailable', { detail: 'degraded' });
    const lane = await input(c);
    const resource: PaymentResource = {
      url: c.req.url,
      description: lane.lane === 'paid' ? lane.description : 'Recharge welcome bundle',
      mimeType: 'application/json',
    };
    let request: DecideRequest;
    let release: (() => void) | undefined;
    if (lane.lane === 'free') {
      const { campaign, counters } = await campaignState(deps, lane.campaignId);
      c.set('campaign', campaign);
      if (campaign && counters) {
        release = deps.admission.take(campaign.id, campaign.claimsPerHour, counters.claimsThisHour);
        if (!release) throw fail('hourly_cap', { retryAfterS: secondsToNextHour(deps.now()) });
      }
      request = {
        resource,
        mb: 0,
        proof: lane.proof,
        challenge: lane.challenge,
        sessionPubKey: lane.sessionPubKey,
        ...(campaign ? { campaign } : {}),
        ...(counters ? { counters } : {}),
      };
    } else {
      const payment = c.get('payment');
      const spk = c.get('sessionPubKey');
      request = {
        resource,
        mb: lane.mb,
        requireSessionKey: lane.requireSessionKey,
        ...(payment ? { payment } : {}),
        ...(spk ? { sessionPubKey: spk } : {}),
      };
    }
    c.set('releaseSlot', release);
    try {
      const resumed = lane.lane === 'free' ? await resumeIntent(deps, lane) : undefined;
      const decision =
        resumed ?? (await deps.metrics.timed('decide_ms', () => decide(request, deps.octroi)));
      deps.metrics.inc('decision_total', {
        kind: decision.kind,
        ...(decision.kind === 'deny' ? { reason: decision.reason } : {}),
      });
      c.get('log').info(
        {
          event: 'decision',
          kind: decision.kind,
          ...(decision.kind === 'deny' ? { reason: decision.reason, detail: decision.detail } : {}),
        },
        'decision',
      );
      c.set('decision', decision);
      await next();
    } finally {
      release?.();
    }
  });

/**
 * The campaign as the engine needs it. The ledger holds the descriptive fields; price, hourly cap and expiry are
 * taken from DataDrop (authoritative). The (id, sponsor) pair must agree between ledger and chain, else the campaign
 * does not exist for us (RT-C-02). Ledger or chain failure ⇒ 503 before anything is burned.
 */
export async function campaignState(
  deps: Deps,
  id: Hex,
): Promise<{ campaign: Campaign | undefined; counters: CampaignCounters | undefined }> {
  const found = await deps.stores.campaigns.get(id);
  if (!found) return { campaign: undefined, counters: undefined };
  const [chain, bucket] = await Promise.all([
    deps.dataDrop.campaign(id),
    deps.dataDrop.currentHourBucket(),
  ]);
  if (chain.sponsor.toLowerCase() !== found.payload.sponsor.toLowerCase())
    return { campaign: undefined, counters: undefined };
  const claimsThisHour = await deps.dataDrop.claimsInHour(id, bucket);
  const campaign: Campaign = {
    ...found.payload,
    pricePerClaimUsd6: chain.pricePerClaim,
    claimsPerHour: chain.claimsPerHour,
    expiresAt: Math.min(found.payload.expiresAt, chain.expiresAt),
  };
  const counters: CampaignCounters = {
    paused: chain.paused,
    budgetUsd6: chain.budget,
    spentUsd6: chain.spent,
    claimsThisHour,
    hourBucket: bucket,
  };
  return { campaign, counters };
}

/**
 * T-24 recovery: a human whose proof was verified but whose chain step failed retries with a FRESH challenge from
 * the SAME session key; the stored serve-free decision completes without a second verification (World proofs are
 * one-time). Another session key never matches. The new challenge is still consumed (one-shot, T-20).
 */
async function resumeIntent(deps: Deps, lane: Extract<LaneInput, { lane: 'free' }>) {
  const intent = deps.intents.get(lane.sessionPubKey.toLowerCase());
  if (!intent) return undefined;
  if (
    intent.exp <= deps.now() ||
    intent.campaignId.toLowerCase() !== lane.campaignId.toLowerCase()
  ) {
    deps.intents.delete(lane.sessionPubKey.toLowerCase());
    return undefined;
  }
  await consume(deps, lane.challenge, '/claim', lane.sessionPubKey);
  return intent.decision;
}

const secondsToNextHour = (now: number): number =>
  Math.max(1, Math.ceil((3_600_000 - (now % 3_600_000)) / 1000));
