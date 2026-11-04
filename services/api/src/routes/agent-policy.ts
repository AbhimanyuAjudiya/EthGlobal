/** PUT /agent/policy and GET /agent/policy/:key (D-10, T-73). */

import { keccak256, sha256Hex, utf8 } from '@ethglobal/crypto';
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
import { validateJson } from '../middleware/validate.js';
import { signedBy } from '../signatures.js';

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
    const entitlement = await deps.stores.entitlements.getByKey(put.entitlementKey);
    if (!entitlement) throw fail('not_found');
    const existing = await deps.stores.policies.get(put.entitlementKey);
    const owner = put.owner.toLowerCase();
    // paid: the payer owns the agent; free/gift/card: the first registered owner (T-73 b, see README)
    const rightful =
      entitlement.payload.payer?.toLowerCase() ?? existing?.payload.owner.toLowerCase();
    if (rightful !== undefined && rightful !== owner)
      throw fail('unauthorized', { detail: 'not the entitlement owner' });
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
    return c.json(await view(deps, wire));
  });

  app.get('/agent/policy/:key', async (c) => {
    const found = await deps.stores.policies.get(c.req.param('key'));
    if (!found) throw fail('not_found');
    return c.json(await view(deps, found.payload));
  });
}

async function view(deps: Deps, p: AgentPolicyWire): Promise<AgentPolicyView> {
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
  };
}
