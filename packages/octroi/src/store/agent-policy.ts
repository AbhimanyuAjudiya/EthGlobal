/** AgentPolicyStore (INTERFACES §1.4; T-30, T-79). */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
import { AGENT_POLICY_TTL_S, ANN, keys } from '@ethglobal/protocol/ids';
import { agentPolicySchema, type AgentPolicyWire } from '@ethglobal/protocol/schemas';

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
