/** AgentPolicyStore (INTERFACES §1.4; T-30, T-79). */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
import { hexToBytes, timingSafeEqual } from '@ethglobal/crypto';
import { AGENT_POLICY_TTL_S, ANN, keys, type Hex } from '@ethglobal/protocol/ids';
import {
  agentPolicySchema,
  type AgentPolicyWire,
  type Entitlement,
} from '@ethglobal/protocol/schemas';

import { holderHash } from '../keys.js';
import { lower, Repo, type Codec, type Found } from './common.js';

const agentPolicyCodec: Codec<AgentPolicyWire> = {
  type: 'agentpolicy',
  schema: agentPolicySchema,
  key: (p) => keys.agentPolicy(p.entitlementKey),
  annotations: (p) => ({ [ANN.owner]: lower(p.owner) }),
  expiresIn: () => AGENT_POLICY_TTL_S,
};

export class AgentPolicyStore {
  readonly #repo: Repo<AgentPolicyWire>;

  constructor(ledger: Ledger, now: () => number) {
    this.#repo = new Repo(ledger, now, agentPolicyCodec);
  }

  get(entitlementKey: string): Promise<Found<AgentPolicyWire> | null> {
    return this.#repo.byKey(keys.agentPolicy(entitlementKey));
  }

  /** Create or replace; every write renews the lifetime. */
  put(p: AgentPolicyWire): Promise<LedgerPutResult> {
    return this.#repo.upsert(p);
  }

  all(): Promise<Found<AgentPolicyWire>[]> {
    return this.#repo.findAll();
  }
}

export type PolicyRegistration = 'ok' | 'not-owner' | 'holder-proof-required';

/** Both sides are hex32 (holderHash output and an entitlementSchema-validated field). */
const sameHash = (a: Hex, b: Hex): boolean => timingSafeEqual(hexToBytes(a), hexToBytes(b));

/**
 * Who may PUT the agent policy of `entitlement` (A-35, T-73 b), decided before the store write:
 * - a paid entitlement: only its payer;
 * - an existing policy: only its owner (an owner change is a re-registration by the same owner);
 * - the FIRST registration of a free / gift / card entitlement that carries a `holderHash`: only the session that
 *   obtained it — `sessionPubKey` with holderHash(key, sessionPubKey) === entitlement.holderHash. Knowing the key
 *   alone (a leaked /me link) no longer wins the first-owner race. Entitlements without a holderHash (written
 *   before A-35) keep the first-registration rule.
 * The owner's EIP-712 signature over the policy is the API's check and comes first.
 */
export function mayRegisterPolicy(input: {
  entitlement: Entitlement;
  existing: AgentPolicyWire | null;
  owner: string;
  sessionPubKey?: Hex;
}): PolicyRegistration {
  const { entitlement, existing, owner, sessionPubKey } = input;
  const rightful = entitlement.payer ?? existing?.owner;
  if (rightful !== undefined)
    return rightful.toLowerCase() === owner.toLowerCase() ? 'ok' : 'not-owner';
  if (entitlement.holderHash === undefined) return 'ok';
  if (sessionPubKey === undefined) return 'holder-proof-required';
  let presented: Hex;
  try {
    presented = holderHash(entitlement.key, sessionPubKey);
  } catch {
    return 'holder-proof-required';
  }
  return sameHash(presented, entitlement.holderHash as Hex) ? 'ok' : 'holder-proof-required';
}
