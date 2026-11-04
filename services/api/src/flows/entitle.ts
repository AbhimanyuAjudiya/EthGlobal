/**
 * decideAndFulfil(): the ONE function behind /claim and /esim/provision (ARCHITECTURE §8 rule 11; /gift/claim and
 * /card/redeem reach fulfil() through claimGiftOrCard). It turns c.var.decision into a response: 402, a mapped deny,
 * or chain claim (free lane) → fulfil → 201/202.
 */
import type { Decision } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import { usd6ToWire } from '@ethglobal/protocol/units';

import { ChainRevert, ChainUnavailable } from '../chain.js';
import { denyError, fail } from '../errors.js';
import { fulfil, type Fulfilled } from './fulfil.js';
import { paymentRequiredResponse, withPaymentResponse } from '../middleware/x402.js';

import type { Ctx } from '../context.js';
import type { Deps } from '../deps.js';

type ServeFree = Extract<Decision, { kind: 'serve-free' }>;

/** How long a verified-but-unserved claim waits for its session's retry (T-24): long enough to reach the next hour bucket. */
export const INTENT_TTL_MS = 65 * 60_000;
const RETRYABLE_REVERTS = new Set(['HourlyCap', 'CampaignPaused']);

/** The decision every route must have, with 402/deny already handled. */
export function settledDecision(
  c: Ctx,
): Exclude<Decision, { kind: 'payment-required' | 'deny' }> | Response {
  const decision = c.get('decision');
  if (!decision) throw fail('internal_error');
  if (decision.kind === 'payment-required') return paymentRequiredResponse(c, decision.body);
  if (decision.kind === 'deny') throw denyError(decision.reason, decision.detail);
  return decision;
}

/**
 * The free lane's chain step (brief §4.1): DataDrop.claimed is re-read (authoritative even when the ledger entity has
 * vanished, N1; a failed read is a 503, never a claim), then DataDrop.claim from the attestor queue. The admission
 * slot is released right after the receipt.
 */
export async function claimOnChain(
  deps: Deps,
  campaignId: Hex,
  claimKey: Hex,
  release?: () => void,
): Promise<Hex> {
  try {
    if (await deps.dataDrop.claimed(campaignId, claimKey))
      throw fail('replay', { detail: 'claimed on-chain' });
    const { tx } = await deps.metrics.timed('chain_claim_ms', () =>
      deps.dataDrop.claim(campaignId, claimKey),
    );
    deps.logger.info({ event: 'claim.tx', campaignId, tx }, 'claimed on-chain');
    return tx;
  } finally {
    release?.();
  }
}

async function serveFree(
  c: Ctx,
  decision: ServeFree,
  nonce: Hex,
  sessionPubKey: Hex,
): Promise<Fulfilled> {
  const deps = c.get('deps');
  const campaign = c.get('campaign');
  if (!campaign) throw fail('internal_error');
  // One fulfilment per human at a time: a concurrent twin waits, then finds the entitlement (T-18).
  return deps.mutex.run(decision.entitlement.key, async () => {
    if (await deps.stores.entitlements.getByKey(decision.entitlement.key)) throw fail('replay');
    let tx: Hex;
    try {
      tx = await claimOnChain(deps, campaign.id as Hex, decision.claimKey, c.get('releaseSlot'));
    } catch (error) {
      // verified but not served: keep the decision for this session's retry (T-24); terminal reverts are not kept
      if (
        error instanceof ChainUnavailable ||
        (error instanceof ChainRevert && RETRYABLE_REVERTS.has(error.errorName))
      ) {
        deps.intents.set(sessionPubKey.toLowerCase(), {
          decision,
          campaignId: campaign.id,
          exp: deps.now() + INTENT_TTL_MS,
        });
      }
      throw error;
    }
    deps.intents.delete(sessionPubKey.toLowerCase());
    deps.metrics.inc('claims_total', { tier: decision.tier });
    void deps.anomaly.record(campaign.id as Hex, campaign.claimsPerHour);
    return fulfil(deps, decision.entitlement, {
      nonce,
      sessionPubKey,
      claimTx: tx,
      receipt: {
        kind: 'claim',
        campaignId: campaign.id,
        mb: decision.mb,
        usd6: usd6ToWire(campaign.pricePerClaimUsd6),
        network: campaign.network,
        tx,
        // the published per-campaign pseudonym, 64 hex without 0x (receipt.payer ≤ 64); never shown on /me (T-44)
        payer: decision.campaignClaimKey.slice(2),
      },
      hcs: {
        t: 'claim',
        campaign: campaign.id,
        claimKey: decision.claimKey,
        tier: decision.tier,
        mb: decision.mb,
        tx,
      },
    });
  });
}

/** /claim and /esim/provision. */
export async function decideAndFulfil(
  c: Ctx,
  opts: { nonce: Hex; sessionPubKey: Hex },
): Promise<Response> {
  const decision = settledDecision(c);
  if (decision instanceof Response) return decision;
  const deps = c.get('deps');
  let result: Fulfilled;
  if (decision.kind === 'serve-free') {
    result = await serveFree(c, decision, opts.nonce, opts.sessionPubKey);
  } else {
    const { entitlement, settlement, requirements } = decision;
    deps.metrics.inc('settlements_total', { network: settlement.network });
    withPaymentResponse(c, settlement);
    result = await fulfil(deps, entitlement, {
      nonce: opts.nonce,
      sessionPubKey: opts.sessionPubKey,
      settlement,
      receipt: {
        kind: 'provision',
        mb: entitlement.mbTotal,
        usd6: requirements.amount,
        network: settlement.network,
        tx: settlement.transaction,
        payer: settlement.payer,
      },
      hcs: {
        t: 'settle',
        kind: 'provision',
        network: settlement.network,
        tx: settlement.transaction,
        payer: settlement.payer,
        usd6: requirements.amount,
        mb: entitlement.mbTotal,
      },
    });
  }
  return c.json(result.body, result.status);
}
