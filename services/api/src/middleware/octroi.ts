import { createMiddleware } from 'hono/factory';

import { isAdapterError, nullifierHex, signalHash } from '@ethglobal/adapters';
import { hmacKey } from '@ethglobal/crypto';
import {
  decide,
  signalFor,
  type Campaign,
  type CampaignCounters,
  type DecideRequest,
  type Challenge,
  type OctroiDeps,
} from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import type { PaymentResource, PersonhoodProof } from '@ethglobal/protocol/schemas';

import { fail } from '../errors.js';
import { consume } from '../flows/challenge.js';

import type { Release } from '../admission.js';
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
  | {
      lane: 'paid';
      mb: number;
      requireSessionKey: boolean;
      description: string;
      /**
       * What the payment is FOR, beyond the route (RT-A-08): query parameters the offer binds into
       * `extra.resource` (`path?name=value…`), e.g. the top-up's target entitlement. The payer echoes it and
       * decide() compares the echo, so an unmodified header replayed for another target is a mismatch.
       */
      bind?: Record<string, string>;
    };

/**
 * octroi(): assembles the DecideRequest (campaign from the ledger + DataDrop counters for the free lane, payment and
 * session key for the paid lane), takes the per-campaign admission slot BEFORE decide() can burn a verification
 * (T-24, T-46) — sized to BOTH the hour's remaining claims and the remaining sponsor budget (RT-A-03) — runs
 * decide(), and stores the Decision on c.var.decision. The slot is released when the request ends (the free-lane
 * flow releases it earlier, right after the chain receipt, as a commit). Paid lanes compare the payment against
 * accepts bound to this route (`extra.resource`, RT-A-08).
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
    let release: Release | undefined;
    let engine: OctroiDeps = deps.octroi;
    if (lane.lane === 'free') {
      const mark = deps.admission.mark();
      const { campaign, counters } = await campaignState(deps, lane.campaignId);
      c.set('campaign', campaign);
      if (campaign && counters) release = admit(deps, campaign, counters, mark);
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
      engine = {
        ...deps.octroi,
        accepts: routeAccepts(deps, boundResource(c.req.path, lane.bind)),
      };
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
        resumed ?? (await deps.metrics.timed('decide_ms', () => decide(request, engine)));
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
 * The admission slot (RT-A-03): slots = min(claimsPerHour − claimsThisHour, ⌊(budget − spent) / price⌋) − inFlight
 * − commits since `mark`. Nobody is verified for a claim the hour OR the budget cannot pay; the refusal names the
 * constraint that bound (409 budget_exhausted, else 429 hourly_cap).
 */
function admit(deps: Deps, campaign: Campaign, counters: CampaignCounters, mark: number): Release {
  const hourLeft = campaign.claimsPerHour - counters.claimsThisHour;
  const price = campaign.pricePerClaimUsd6;
  const budgetLeft =
    price > 0n
      ? Number((counters.budgetUsd6 - counters.spentUsd6) / price)
      : Number.MAX_SAFE_INTEGER;
  const release = deps.admission.take(campaign.id, Math.min(hourLeft, budgetLeft), 0, mark);
  if (release) return release;
  if (budgetLeft <= hourLeft) throw fail('budget_exhausted');
  throw fail('hourly_cap', { retryAfterS: secondsToNextHour(deps.now()) });
}

/** This route's accepts (RT-A-08): `extra.resource` = the bound resource, echoed by the payer and compared by decide(). */
export const routeAccepts = (
  deps: Pick<Deps, 'accepts'>,
  resource: string,
): OctroiDeps['accepts'] => deps.accepts.map((t) => ({ ...t, extra: { ...t.extra, resource } }));

/** `path` plus the bound parameters as a canonical query (sorted names, URI-encoded values); no params ⇒ the path. */
export function boundResource(path: string, bind: Record<string, string> = {}): string {
  const query = Object.keys(bind)
    .sort()
    .map((name) => `${encodeURIComponent(name)}=${encodeURIComponent(bind[name]!)}`)
    .join('&');
  return query === '' ? path : `${path}?${query}`;
}

const firstResponse = (proof: PersonhoodProof) =>
  (proof as { responses?: { nullifier?: unknown; signal_hash?: unknown }[] }).responses?.[0];

/** HMAC of the proof's (first) nullifier: an intent is resumable only by a proof of the SAME human (RT-A-05). */
export function proofTag(deps: Pick<Deps, 'secret'>, proof: PersonhoodProof): Hex | undefined {
  const raw = firstResponse(proof)?.nullifier;
  const nullifier = typeof raw === 'string' ? nullifierHex(raw) : undefined;
  return nullifier === undefined ? undefined : hmacKey(deps.secret, 'intent', nullifier);
}

/**
 * T-24 recovery: a human whose proof was verified but whose chain step failed retries with a FRESH challenge from
 * the SAME session key; the stored serve-free decision completes without spending a second verification (World
 * proofs are one-time). RT-A-05: the session PUBLIC key alone is not enough — the retry's proof must name the same
 * nullifier and the verifier must accept it as that human (fresh, or `already_verified`: the one-time proof was
 * spent on the first attempt), bound to the new challenge's signal or — a resent first proof — the first one's.
 * Another session key, another campaign, or another human's proof never resumes and never touches the intent; it
 * falls through to the normal lane, which judges it on its own. The new challenge is consumed first (one-shot, T-20).
 */
async function resumeIntent(deps: Deps, lane: Extract<LaneInput, { lane: 'free' }>) {
  const spk = lane.sessionPubKey.toLowerCase();
  const intent = deps.intents.get(spk);
  // Another campaign is not this intent's resume: fall through WITHOUT touching it (RT-A-05 variant — a junk request
  // naming another campaign used to delete the victim's intent before any proof was checked). It ends by its TTL,
  // or when this human is served (entitle.ts deletes only the served human's own intent).
  if (intent?.campaignId.toLowerCase() !== lane.campaignId.toLowerCase()) return undefined;
  const tag = proofTag(deps, lane.proof);
  if (tag === undefined || tag !== intent.nullifierTag) return undefined;
  await consume(deps, lane.challenge, '/claim', lane.sessionPubKey);
  // a fresh proof binds the new challenge; a resent first proof binds the first attempt's signal
  const fresh = signalFor(lane.challenge.nonce, lane.challenge.audience);
  const raw = firstResponse(lane.proof)?.signal_hash;
  const sent = typeof raw === 'string' ? raw.toLowerCase() : '';
  const signal = sent === signalHash(intent.signal).toLowerCase() ? intent.signal : fresh;
  try {
    const result = await deps.adapters.personhood.verify(lane.proof, {
      action: deps.env.WORLD_ACTION,
      signal,
    });
    if (hmacKey(deps.secret, 'intent', result.nullifierHash) !== intent.nullifierTag)
      throw fail('invalid_proof');
  } catch (error) {
    if (!(isAdapterError(error) && error.code === 'already_verified'))
      throw fail('invalid_proof', { detail: 'intent_proof' });
  }
  return intent.decision;
}

const secondsToNextHour = (now: number): number =>
  Math.max(1, Math.ceil((3_600_000 - (now % 3_600_000)) / 1000));
