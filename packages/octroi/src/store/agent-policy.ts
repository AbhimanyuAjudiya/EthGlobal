/**
 * AgentPolicyStore (INTERFACES §1.4; T-30, T-79). Legacy rows remain readable and migrate on an authorized write.
 * Stop old writers before upgrading: hashing future storage cannot revoke capabilities already published in chain history.
 */
import type { Ledger, LedgerPutResult } from '@ethglobal/adapters';
import { hexToBytes, timingSafeEqual } from '@ethglobal/crypto';
import { RechargeError } from '@ethglobal/protocol/errors';
import { AGENT_POLICY_TTL_S, ANN, keys, type Hex } from '@ethglobal/protocol/ids';
import {
  agentPolicySchema,
  type AgentPolicyWire,
  type Entitlement,
} from '@ethglobal/protocol/schemas';
import { canonicalJson } from '@ethglobal/protocol/typed-data';

import { entitlementIndex, holderHash, INDEX_PREFIX } from '../keys.js';
import { CAS_ATTEMPTS, isConflict, lower, Repo, type Codec, type Found } from './common.js';

const agentPolicyCodec: Codec<AgentPolicyWire> = {
  type: 'agentpolicy',
  schema: agentPolicySchema,
  key: (p) => keys.agentPolicy(entitlementIndex(p.entitlementKey)),
  annotations: (p) => ({ [ANN.owner]: lower(p.owner) }),
  expiresIn: () => AGENT_POLICY_TTL_S,
};

/** Compatibility reads validate the original key/owner annotations just as strictly as new rows. */
const legacyPolicyCodec: Codec<AgentPolicyWire> = {
  ...agentPolicyCodec,
  key: (p) => keys.agentPolicy(p.entitlementKey),
};

function currentPolicy(
  a: Found<AgentPolicyWire> | null,
  b: Found<AgentPolicyWire> | null,
): Found<AgentPolicyWire> | null {
  if (!a) return b;
  if (!b) return a;
  if (a.payload.owner.toLowerCase() !== b.payload.owner.toLowerCase())
    throw new RechargeError('unauthorized', 'conflicting policy owners');
  if (
    a.payload.updatedAt === b.payload.updatedAt &&
    canonicalJson(a.payload.policy) !== canonicalJson(b.payload.policy)
  )
    throw new RechargeError('replay', 'conflicting policies at the same timestamp');
  const latest = a.payload.updatedAt >= b.payload.updatedAt ? a : b;
  const expiry = Math.max(a.payload.lastExpiryBought ?? 0, b.payload.lastExpiryBought ?? 0);
  const hasExpiry =
    a.payload.lastExpiryBought !== undefined || b.payload.lastExpiryBought !== undefined;
  return {
    ...latest,
    payload: { ...latest.payload, ...(hasExpiry ? { lastExpiryBought: expiry } : {}) },
  };
}

export class AgentPolicyStore {
  readonly #repo: Repo<AgentPolicyWire>;
  readonly #legacy: Repo<AgentPolicyWire>;

  constructor(ledger: Ledger, now: () => number) {
    this.#repo = new Repo(ledger, now, agentPolicyCodec);
    this.#legacy = new Repo(ledger, now, legacyPolicyCodec);
  }

  async #rows(entitlementKey: string) {
    return Promise.all([
      this.#repo.byKey(keys.agentPolicy(entitlementIndex(entitlementKey))),
      this.#legacy.byKey(keys.agentPolicy(entitlementKey)),
    ]);
  }

  async get(entitlementKey: string): Promise<Found<AgentPolicyWire> | null> {
    if (entitlementKey.startsWith(INDEX_PREFIX)) return null;
    const found = currentPolicy(...(await this.#rows(entitlementKey)));
    return found ? { ...found, payload: { ...found.payload, entitlementKey } } : null;
  }

  /** Recheck ownership and policy ordering after EVERY CAS conflict; never publish a bearer key. */
  async put(p: AgentPolicyWire): Promise<LedgerPutResult> {
    if (p.entitlementKey.startsWith(INDEX_PREFIX))
      throw new RechargeError(
        'invalid_request',
        'policy writes require the private entitlement key',
      );
    const next = this.#repo.validate({ ...p, entitlementKey: entitlementIndex(p.entitlementKey) });
    for (let attempt = 1; ; attempt++) {
      const [hashed, legacy] = await this.#rows(p.entitlementKey);
      if (
        (!hashed && (await this.#repo.exists(keys.agentPolicy(next.entitlementKey)))) ||
        (!legacy && (await this.#legacy.exists(keys.agentPolicy(p.entitlementKey))))
      ) {
        // A concurrent migration can move a row between the two reads. Re-read before
        // treating it as corruption; never overwrite an undecodable row in either namespace.
        if (attempt < CAS_ATTEMPTS) continue;
        throw new RechargeError('replay', 'an unreadable policy already exists');
      }
      const found = currentPolicy(hashed, legacy);
      if (found) {
        const old = found.payload;
        if (old.owner.toLowerCase() !== next.owner.toLowerCase())
          throw new RechargeError('unauthorized', 'policy owner cannot change');
        if (
          next.updatedAt < old.updatedAt ||
          (next.updatedAt === old.updatedAt &&
            canonicalJson(next.policy) !== canonicalJson(old.policy))
        )
          throw new RechargeError('replay', 'stale policy');
        // Internal expiry-purchase bookkeeping may keep the same signed policy timestamp.
        if (old.lastExpiryBought !== undefined)
          next.lastExpiryBought = Math.max(old.lastExpiryBought, next.lastExpiryBought ?? 0);
      }
      try {
        if (!found) return await this.#repo.create(next);
        // Re-key a legacy row in place under CAS, preserving its entity identity. If a hashed
        // row already exists, update it only after checking the legacy owner's state above.
        const saved = await this.#repo.replace(hashed ?? legacy!, next, AGENT_POLICY_TTL_S);
        return { key: saved.entityKey, expiresAt: saved.expiresAt };
      } catch (error) {
        if (
          attempt >= CAS_ATTEMPTS ||
          !(isConflict(error) || (error instanceof RechargeError && error.code === 'replay'))
        )
          throw error;
      }
    }
  }

  /** Public discovery returns indexes, never capabilities. Agents must receive plan keys privately. */
  async all(): Promise<Found<AgentPolicyWire>[]> {
    const [hashed, legacy] = await Promise.all([this.#repo.findAll(), this.#legacy.findAll()]);
    const rows = new Map<string, Found<AgentPolicyWire>>();
    for (const row of [
      ...hashed,
      ...legacy.filter((r) => !r.payload.entitlementKey.startsWith(INDEX_PREFIX)),
    ]) {
      const index = entitlementIndex(row.payload.entitlementKey);
      const found = currentPolicy(rows.get(index) ?? null, row)!;
      rows.set(index, { ...found, payload: { ...found.payload, entitlementKey: index } });
    }
    return [...rows.values()];
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
 *   alone (a leaked /me link) no longer wins the first-owner race. Legacy unbound entitlements cannot register
 *   their first owner until an authenticated holder binding has been established.
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
  if (entitlement.holderHash === undefined) return 'holder-proof-required';
  if (sessionPubKey === undefined) return 'holder-proof-required';
  let presented: Hex;
  try {
    presented = holderHash(entitlement.key, sessionPubKey);
  } catch {
    return 'holder-proof-required';
  }
  return sameHash(presented, entitlement.holderHash as Hex) ? 'ok' : 'holder-proof-required';
}
