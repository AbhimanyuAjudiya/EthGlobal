/** POST /claim (free lane) and GET /esim/provision · GET /esim/topup (paid lane). Thin: no business rule here. */
import { createMiddleware } from 'hono/factory';
import { keccak256, toBytes } from 'viem';

import { openFromServer, sha256Hex, utf8, type SealedBox } from '@ethglobal/crypto';
import { entitlementIndex, type Challenge } from '@ethglobal/octroi';
import { dayBucket, type Hex } from '@ethglobal/protocol/ids';
import {
  claimRequestSchema,
  isEvmExact,
  provisionQuerySchema,
  topUpQuerySchema,
  type ClaimRequest,
  type ProvisionQuery,
  type TopUpQuery,
} from '@ethglobal/protocol/schemas';
import { SESSION_PUBKEY_HEADER } from '@ethglobal/protocol/x402';

import { inputOf, type AppEnv, type Ctx } from '../context.js';
import { fail } from '../errors.js';
import { assertCampaignDelivery } from '../flows/campaign-reclaim.js';
import { aborted } from '../flows/cancel.js';
import { decideAndFulfil, settledDecision } from '../flows/entitle.js';
import { deliveryRecoveryHash, fulfilTopUp } from '../flows/fulfil.js';
import { paidRecovery, paymentFingerprint } from '../flows/payments.js';
import { assertConfiguredCapacity } from '../flows/plan.js';
import { flushReceiptOutbox, record } from '../flows/record.js';
import { isEventPlan } from '../flows/tickets.js';
import { octroi } from '../middleware/octroi.js';
import { assertPlanMb, validateJson, validateQuery } from '../middleware/validate.js';
import { paymentNonce, withPaymentResponse, x402 } from '../middleware/x402.js';
import { seedValidityS } from '../seed.js';
import { policyVersion } from '../world-agent-pass.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

export function registerClaim(app: Hono<AppEnv>, deps: Deps): void {
  app.post(
    '/claim',
    validateJson(claimRequestSchema),
    x402,
    octroi((c) => {
      const body = inputOf<ClaimRequest>(c);
      const recoveryKeyHash = deliveryRecoveryHash(deps, c.req.header('idempotency-key'));
      return {
        lane: 'free',
        campaignId: body.campaignId as Hex,
        proof: body.proof,
        challenge: body.challenge as Challenge,
        sessionPubKey: body.sessionPubKey.toLowerCase() as Hex,
        ...(body.ticketPass === undefined ? {} : { ticketPass: body.ticketPass }),
        ...(body.eventNoticeVersion === undefined
          ? {}
          : { eventNoticeVersion: body.eventNoticeVersion }),
        ...(recoveryKeyHash === undefined ? {} : { recoveryKeyHash }),
      };
    }),
    async (c) => {
      const body = inputOf<ClaimRequest>(c);
      const validity = seedValidityS(c);
      const decision = c.get('decision');
      if (validity !== undefined && decision?.kind === 'serve-free')
        decision.entitlement.expiresAt = deps.now() + validity * 1000;
      return decideAndFulfil(c, {
        nonce: body.challenge.nonce as Hex,
        sessionPubKey: body.sessionPubKey.toLowerCase() as Hex,
      });
    },
  );

  // LPA-delivering purchase: the signed EVM nonce or native Hedera memo binds keccak256(X-Session-Pubkey).
  app.get(
    '/esim/provision',
    validateQuery(provisionQuerySchema),
    x402,
    paidRecovery,
    createMiddleware<AppEnv>(async (c, next) => {
      const { mb, planId } = inputOf<ProvisionQuery>(c);
      if (c.get('paidOperation')) return next();
      assertPlanMb(mb);
      await assertConfiguredCapacity(deps, mb);
      if (!c.get('sessionPubKey')) throw fail('invalid_request', { header: SESSION_PUBKEY_HEADER });
      if (planId !== undefined && planId !== deps.env.RESELLER_PLAN_ID) {
        throw fail('invalid_request', [{ path: 'planId', message: 'unknown plan' }]);
      }
      return next();
    }),
    octroi((c) => ({
      lane: 'paid',
      mb: inputOf<ProvisionQuery>(c).mb,
      requireSessionKey: true,
      description: 'Recharge eSIM data bundle',
    })),
    async (c) => {
      const decision = c.get('decision');
      const { planId } = inputOf<ProvisionQuery>(c);
      if (planId !== undefined && decision?.kind === 'serve-paid')
        decision.entitlement.planId = planId;
      const payment = c.get('payment');
      const nonce =
        payment && isEvmExact(payment.payload)
          ? (payment.payload.authorization.nonce as Hex)
          : keccak256(toBytes(c.get('sessionPubKey')!));
      return decideAndFulfil(c, { nonce, sessionPubKey: c.get('sessionPubKey')! });
    },
  );

  app.get(
    '/esim/topup',
    validateQuery(topUpQuerySchema),
    x402,
    paidRecovery,
    createMiddleware<AppEnv>((c, next) => deps.mutex.run(inputOf<TopUpQuery>(c).key, next)),
    createMiddleware<AppEnv>((c, next) =>
      deps.mutex.run(`policy:${inputOf<TopUpQuery>(c).key}`, next),
    ),
    topUpGuard,
    octroi((c) => ({
      lane: 'paid',
      mb: inputOf<TopUpQuery>(c).mb,
      requireSessionKey: false,
      description: 'Recharge top-up',
      // the payment is for THIS entitlement (RT-A-08): `extra.resource = /esim/topup?key=<index>`. The ledger index,
      // not the capability: the offer travels to the payer's wallet and the facilitator (RT-O-01)
      bind: { key: entitlementIndex(inputOf<TopUpQuery>(c).key) },
    })),
    topUp,
  );
}

/**
 * Before any 402 or settlement: the size must be PLAN_MB (400 before any ledger read), the entitlement must be live
 * (an expired one is 410 and is never charged, AP7.13) and under its per-ICCID daily top-up cap (429 daily_cap before
 * settle, AP7.14). Cheap ledger reads only. The cap is a synchronous reservation over today's receipt count
 * (RT-A-02): N concurrent payments take at most the slots left, a slot is released when the request ends and counted
 * as a commit when the top-up was served (its receipt now exists), so the receipts stay the cross-process floor and
 * in-flight requests are the in-process ceiling.
 */
const topUpGuard = createMiddleware<AppEnv>(async (c, next) => {
  const deps = c.get('deps');
  await flushReceiptOutbox(deps);
  const { key, mb } = inputOf<TopUpQuery>(c);
  assertPlanMb(mb);
  assertCampaignDelivery(deps, key);
  // Settlement already succeeded under the original guards. Finish that operation even if its pass,
  // policy, daily window or plan lifetime changed while the reseller was unavailable.
  if (c.get('paidOperation')) return next();
  const found = await deps.stores.entitlements.getByKey(key);
  if (!found) throw fail(deps.cache.expired(key) ? 'expired' : 'not_found');
  if (isEventPlan(deps, found.payload))
    throw fail('invalid_request', { detail: 'top-ups are not available for event packages' });
  c.set('paidTarget', found.payload);
  const today = dayBucket(deps.now());
  const keyHash = sha256Hex(key);
  const mark = deps.admission.mark();
  const receipts = await deps.stores.receipts.forEntitlement(keyHash);
  // a cancelled plan, or one whose cancel is still pending, is never charged for a top-up (POST /plan/cancel)
  if (receipts.some((r) => r.kind === 'plan-cancel' && !aborted(r))) throw fail('expired');
  const count =
    receipts.filter(
      (r) => (r.kind === 'topup' || r.kind === 'agent-topup') && dayBucket(r.at) === today,
    ).length +
    deps.paidOperations.entries().filter(([, operation]) => {
      if (
        operation.targetKey !== key ||
        dayBucket(operation.decision.entitlement.createdAt) !== today
      )
        return false;
      const payment = operation.decision.settlement;
      return !receipts.some(
        (receipt) => receipt.network === payment.network && receipt.tx === payment.transaction,
      );
    }).length;
  const fingerprint = await paymentFingerprint(c);
  const recovering = fingerprint !== undefined && deps.paidOperations.has(fingerprint);
  const release = recovering
    ? () => undefined
    : deps.admission.take(
        `topup:${keyHash}:${today}`,
        deps.env.TOPUPS_PER_ICCID_PER_DAY,
        count,
        mark,
      );
  if (!release) throw fail('daily_cap');
  try {
    if (found.payload.iccidEnc === undefined)
      throw fail('invalid_request', { detail: 'profile not provisioned yet' });
    const iccid = openFromServer(deps.sealKey, found.payload.iccidEnc as SealedBox, utf8(key));
    if ((await deps.adapters.reseller.canTopUp?.(iccid)) === false)
      throw fail('invalid_request', { detail: 'this profile does not support top-ups' });
    // World ID Agent Pass (docs/WORLD_AGENT_PASS.md): an agent buying under a policy needs an armed pass. Decided
    // here, before octroi() can answer 402, so nothing is quoted, signed or settled without the human checkpoint.
    // Human top-ups (no X-Agent-Uaid, payer not an AGENT_PAYER) are untouched.
    const pass = deps.agentPass;
    const policy =
      pass !== undefined && isAgentRequest(c) ? await deps.stores.policies.get(key) : undefined;
    if (pass !== undefined && policy) {
      const version = policyVersion(policy.payload);
      if (!pass.armed(key, version))
        throw fail('pass_required', { detail: pass.view(key, version).state });
    }
    await next();
    release(c.res.status === 200);
  } finally {
    release();
  }
});

async function topUp(c: Ctx): Promise<Response> {
  const deps = c.get('deps');
  const decision = settledDecision(c);
  if (decision instanceof Response) return decision;
  if (decision.kind !== 'serve-paid') throw fail('internal_error');
  const { key, mb } = inputOf<TopUpQuery>(c);
  const { settlement, requirements } = decision;
  withPaymentResponse(c, settlement);
  let existing = await deps.stores.entitlements.getByKey(key);
  if (!existing) {
    const original = c.get('paidOperation')?.targetEntitlement;
    if (original?.key === key) {
      await deps.stores.entitlements.create({
        ...original,
        expiresAt: deps.now() + deps.env.VALIDITY_DAYS * 86_400_000,
      });
      existing = await deps.stores.entitlements.getByKey(key);
    }
  }
  if (!existing) throw fail('expired');
  const updated = await fulfilTopUp(
    deps,
    existing.payload,
    mb,
    paymentNonce(c, settlement),
    sha256Hex(`${settlement.network}:${settlement.transaction}`),
  );
  deps.metrics.inc('settlements_total', { network: settlement.network });
  const uaid = agentUaid(c, settlement.payer);
  const recorded = await record(
    deps,
    key,
    {
      kind: uaid === undefined ? 'topup' : 'agent-topup',
      mb,
      usd6: requirements.amount,
      network: settlement.network,
      tx: settlement.transaction,
      payer: settlement.payer,
      ...(uaid === undefined ? {} : { uaid }),
    },
    {
      t: 'settle',
      kind: 'topup',
      network: settlement.network,
      tx: settlement.transaction,
      payer: settlement.payer,
      usd6: requirements.amount,
      mb,
    },
    decision.entitlement.createdAt,
  );
  deps.logger.info({ event: 'topup', mb, network: settlement.network }, 'topped up');
  return c.json({
    entitlementKey: key,
    mbTotal: updated.mbTotal,
    mbUsed: updated.mbUsed,
    expiresAt: updated.expiresAt,
    settlement,
    receipt: { arkivKey: existing.entityKey, ...(recorded.hcs ? { hcs: recorded.hcs } : {}) },
  });
}

/** The request says it is the agent's: the X-Agent-Uaid header, or an EVM payment from an AGENT_PAYERS wallet. */
function isAgentRequest(c: Ctx): boolean {
  if (c.req.header('x-agent-uaid') !== undefined) return true;
  const payment = c.get('payment');
  if (payment === undefined || !isEvmExact(payment.payload)) return false;
  const from = payment.payload.authorization.from.toLowerCase();
  return c.get('deps').env.AGENT_PAYERS.some((p) => p.toLowerCase() === from);
}

/** X-Agent-Uaid is recorded only for payers on the AGENT_PAYERS allow-list; anyone else's is ignored (T-77). */
function agentUaid(c: Ctx, payer: string): string | undefined {
  const uaid = c.req.header('x-agent-uaid');
  if (uaid === undefined || !/^uaid:[\x21-\x7E]{1,195}$/.test(uaid)) return undefined;
  const allowed = c
    .get('deps')
    .env.AGENT_PAYERS.some((p) => p.toLowerCase() === payer.toLowerCase());
  return allowed ? uaid : undefined;
}
