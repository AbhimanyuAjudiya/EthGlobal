/** PUT /agent/policy and GET /agent/policy/:key (D-10, T-73). */

import { keccak256, sha256Hex, utf8 } from '@ethglobal/crypto';
import { mayRegisterPolicy } from '@ethglobal/octroi';
import { dayBucket, type Hex } from '@ethglobal/protocol/ids';
import {
  agentPolicyPutSchema,
  type AgentPolicyPut,
  type AgentPolicyView,
  type AgentPolicyWire,
} from '@ethglobal/protocol/schemas';
import { AGENT_POLICY_TYPES, canonicalJson, rechargeDomain } from '@ethglobal/protocol/typed-data';
import { usd6ToWire } from '@ethglobal/protocol/units';

import { inputOf, type AppEnv } from '../context.js';
import { fail } from '../errors.js';
import { campaignReclaimBlocks } from '../flows/campaign-reclaim.js';
import { aborted, cancelReceiptKey } from '../flows/cancel.js';
import { flushReceiptOutbox } from '../flows/record.js';
import { isEventPlan } from '../flows/tickets.js';
import { validateJson } from '../middleware/validate.js';
import { signedBy } from '../signatures.js';
import { policyVersion } from '../world-agent-pass.js';

import type { Deps } from '../deps.js';
import type { Hono } from 'hono';
import type { Address } from 'viem';

const FUTURE_SKEW_MS = 60_000;

export function registerAgentPolicy(app: Hono<AppEnv>, deps: Deps): void {
  app.put('/agent/policy', validateJson(agentPolicyPutSchema), async (c) => {
    const put = inputOf<AgentPolicyPut>(c);
    if (put.issuedAt > deps.now() + FUTURE_SKEW_MS)
      throw fail('invalid_request', [{ path: 'issuedAt', message: 'in the future' }]);
    const policyHash = keccak256(utf8(canonicalJson(put.policy)));
    const ok = await signedBy({
      address: put.owner as Address,
      domain: rechargeDomain(deps.chainId),
      types: AGENT_POLICY_TYPES,
      primaryType: 'AgentPolicy',
      message: {
        entitlementKey: put.entitlementKey,
        owner: put.owner as Address,
        policyHash,
        issuedAt: BigInt(put.issuedAt),
      },
      signature: put.signature as Hex,
    });
    if (!ok) throw fail('unauthorized', { detail: 'bad AgentPolicy signature' });
    // Match top-up's key → policy lock order; cancellation holds the key through its durable receipt.
    return deps.mutex.run(put.entitlementKey, () =>
      deps.mutex.run(`policy:${put.entitlementKey}`, async () => {
        const existing = await deps.stores.policies.get(put.entitlementKey);
        const cancelKey = cancelReceiptKey(put.entitlementKey);
        const cancellation = await deps.stores.receipts.byKey(cancelKey);
        const closing =
          campaignReclaimBlocks(deps, put.entitlementKey) ||
          deps.refundJobs.has(cancelKey) ||
          (cancellation?.kind === 'plan-cancel' && !aborted(cancellation));
        const pausingExisting = put.policy.paused && existing !== null;
        if (closing && !pausingExisting) throw fail('expired');
        const entitlement = await deps.stores.entitlements.getByKey(put.entitlementKey);
        if (!entitlement && !pausingExisting) throw fail('not_found');
        if (entitlement && isEventPlan(deps, entitlement.payload) && !pausingExisting)
          throw fail('invalid_request', {
            detail: 'automatic top-ups are not available for event packages',
          });
        // paid: the payer; an existing policy: its owner; a first free/gift/card registration: the session that
        // obtained the entitlement (octroi mayRegisterPolicy, A-35, T-73 b)
        // Ending a plan must not prevent its policy owner from disabling an existing grant. This exception
        // writes only a paused policy; it neither creates an entitlement nor permits enabling a missing plan.
        const may = entitlement
          ? mayRegisterPolicy({
              entitlement: entitlement.payload,
              existing: existing?.payload ?? null,
              owner: put.owner,
              ...(put.sessionPubKey === undefined
                ? {}
                : { sessionPubKey: put.sessionPubKey as Hex }),
            })
          : existing?.payload.owner.toLowerCase() === put.owner.toLowerCase()
            ? 'ok'
            : 'not-owner';
        if (may === 'not-owner')
          throw fail('unauthorized', { detail: 'not the entitlement owner' });
        if (may === 'holder-proof-required')
          throw fail('unauthorized', { detail: 'sessionPubKey of the claiming session required' });
        // an older signed policy can never undo a newer one (T-73 a)
        if (existing && put.issuedAt <= existing.payload.updatedAt)
          throw fail('replay', { detail: 'stale policy' });
        const wire: AgentPolicyWire = {
          v: 1,
          entitlementKey: put.entitlementKey,
          owner: put.owner,
          policy: put.policy,
          updatedAt: put.issuedAt,
          ...(existing?.payload.lastExpiryBought === undefined
            ? {}
            : { lastExpiryBought: existing.payload.lastExpiryBought }),
        };
        await deps.stores.policies.put(wire);
        // a changed policy is a new operation: its Agent Pass must be approved again (docs/WORLD_AGENT_PASS.md)
        if (existing && canonicalJson(existing.payload.policy) !== canonicalJson(put.policy))
          deps.agentPass?.revoke(put.entitlementKey);
        return c.json(await view(deps, wire));
      }),
    );
  });

  app.get('/agent/policy/:key', async (c) => {
    const found = await deps.stores.policies.get(c.req.param('key'));
    if (!found) throw fail('not_found');
    return c.json(await view(deps, found.payload));
  });
}

async function view(deps: Deps, p: AgentPolicyWire): Promise<AgentPolicyView> {
  await flushReceiptOutbox(deps);
  const spent = await deps.stores.receipts.spentUsd6(
    sha256Hex(p.entitlementKey),
    'agent-topup',
    dayBucket(deps.now()),
  );
  return {
    policy: p.policy,
    owner: p.owner,
    spentTodayUsd6: usd6ToWire(spent),
    updatedAt: p.updatedAt,
    ...(deps.agentPass === undefined
      ? {}
      : { pass: deps.agentPass.view(p.entitlementKey, policyVersion(p)) }),
  };
}
