/**
 * What the agent reads before it decides (R2). Live: straight from the ledger through the octroi stores over an
 * ArkivLedger pinned to AGENT_LEDGER_WRITER (T-79: entities from any other `$creator` are invisible). Local: the
 * in-memory ledger lives inside the API process, so the same three reads go through the API's public routes
 * (`/me/:key`, `/agent/policy/:key`, `/me/:key/receipts`).
 */
import type { Ledger } from '@ethglobal/adapters';
import { sha256Hex } from '@ethglobal/crypto';
import { AgentPolicyStore, EntitlementStore, ReceiptStore } from '@ethglobal/octroi';
import { HttpError, httpJson } from '@ethglobal/protocol/http';
import { dayBucket, KEY_PREFIXES } from '@ethglobal/protocol/ids';
import {
  agentPolicyViewSchema,
  entitlementSchema,
  meResponseSchema,
  plansResponseSchema,
  receiptsResponseSchema,
  type Entitlement,
  type TopUpPolicyWire,
} from '@ethglobal/protocol/schemas';
import { usd6FromWire } from '@ethglobal/protocol/units';

import type { z } from 'zod';

export interface PolicyRead {
  owner: string;
  policy: TopUpPolicyWire;
  lastExpiryBought?: number;
}

export interface AgentReads {
  entitlement(key: string): Promise<Entitlement | null>;
  policy(key: string): Promise<PolicyRead | null>;
  /** Σ usd6 of this entitlement's `agent-topup` receipts in the UTC day of `now` (T-30). */
  spentTodayUsd6(key: string, now: number): Promise<bigint>;
  /** Entitlement keys whose policy names `owner` (bounded). */
  watchKeys(owner: string, limit: number): Promise<string[]>;
  /** The newest agent-topup tx at or after `sinceMs` (T-57: a settled purchase whose 200 was lost). */
  latestTopupTx(key: string, sinceMs: number): Promise<string | undefined>;
}

/** The newest `agent-topup` tx at or after `sinceMs`. */
const newestTopupTx = (
  receipts: readonly { kind: string; at: number; tx?: string | undefined }[],
  sinceMs: number,
): string | undefined =>
  receipts
    .filter((r) => r.kind === 'agent-topup' && r.at >= sinceMs && r.tx !== undefined)
    .sort((a, b) => b.at - a.at)[0]?.tx;

export class LedgerReads implements AgentReads {
  readonly #entitlements: EntitlementStore;
  readonly #policies: AgentPolicyStore;
  readonly #receipts: ReceiptStore;

  constructor(ledger: Ledger, now: () => number) {
    this.#entitlements = new EntitlementStore(ledger, now);
    this.#policies = new AgentPolicyStore(ledger, now);
    this.#receipts = new ReceiptStore(ledger, now);
  }

  async entitlement(key: string): Promise<Entitlement | null> {
    return (await this.#entitlements.getByKey(key))?.payload ?? null;
  }

  async policy(key: string): Promise<PolicyRead | null> {
    const found = await this.#policies.get(key);
    if (!found) return null;
    const { owner, policy, lastExpiryBought } = found.payload;
    return { owner, policy, ...(lastExpiryBought === undefined ? {} : { lastExpiryBought }) };
  }

  spentTodayUsd6(key: string, now: number): Promise<bigint> {
    return this.#receipts.spentUsd6(sha256Hex(key), 'agent-topup', dayBucket(now));
  }

  async watchKeys(owner: string, limit: number): Promise<string[]> {
    const all = await this.#policies.all();
    return all
      .filter((p) => p.payload.owner.toLowerCase() === owner.toLowerCase())
      .map((p) => p.payload.entitlementKey)
      .slice(0, limit);
  }

  async latestTopupTx(key: string, sinceMs: number): Promise<string | undefined> {
    return newestTopupTx(await this.#receipts.forEntitlement(sha256Hex(key)), sinceMs);
  }
}

/** GET a JSON route; 404/410 ⇒ null. Other failures throw (the tick reports them). */
async function getOrNull<T>(
  url: string,
  schema: z.ZodType<T>,
  fetchFn: typeof fetch,
): Promise<T | null> {
  try {
    const { data } = await httpJson(url, { fetch: fetchFn, schema });
    return data;
  } catch (error) {
    if (error instanceof HttpError && (error.status === 404 || error.status === 410)) return null;
    throw error;
  }
}

/** A paid entitlement key is `paid:<payer>:<nonce>` (keys.entitlementPaid): the payer it was issued to. */
export function paidKeyPayer(key: string): string | undefined {
  if (!key.startsWith(KEY_PREFIXES.entitlementPaid)) return undefined;
  const payer = key.slice(KEY_PREFIXES.entitlementPaid.length).split(':')[0];
  return payer === '' ? undefined : payer;
}

export class ApiReads implements AgentReads {
  constructor(
    private readonly apiUrl: string,
    private readonly fetchFn: typeof fetch,
  ) {}

  #url(path: string, key: string): string {
    return `${this.apiUrl}${path.replace(':key', encodeURIComponent(key))}`;
  }

  async entitlement(key: string): Promise<Entitlement | null> {
    const me = await getOrNull(this.#url('/me/:key', key), meResponseSchema, this.fetchFn);
    if (!me) return null;
    // /me is a view of the entitlement entity; only mbTotal/mbUsed/expiresAt feed the decision. /me has no payer:
    // the key we asked for names it (paid keys only), which tick checks the policy owner against (RT-G-04).
    const payer = paidKeyPayer(key);
    return entitlementSchema.parse({
      v: 1,
      key: me.entitlementKey,
      kind: me.kind,
      status: me.status,
      tier: me.tier,
      ...(me.campaignId === undefined ? {} : { campaignId: me.campaignId }),
      planId: '',
      mbTotal: me.mbTotal,
      mbUsed: me.mbUsed,
      usageAsOf: me.usageAsOf,
      usageSource: me.usageSource,
      ...(me.network === undefined ? {} : { network: me.network }),
      ...(payer === undefined ? {} : { payer }),
      createdAt: 0,
      expiresAt: me.expiresAt,
    });
  }

  async #view(key: string) {
    return getOrNull(this.#url('/agent/policy/:key', key), agentPolicyViewSchema, this.fetchFn);
  }

  async policy(key: string): Promise<PolicyRead | null> {
    const view = await this.#view(key);
    return view && { owner: view.owner, policy: view.policy };
  }

  async spentTodayUsd6(key: string): Promise<bigint> {
    const view = await this.#view(key);
    return view ? usd6FromWire(view.spentTodayUsd6) : 0n;
  }

  /** The API has no "policies by owner" route: local mode watches AGENT_WATCH_KEYS only. */
  async watchKeys(): Promise<string[]> {
    return [];
  }

  async latestTopupTx(key: string, sinceMs: number): Promise<string | undefined> {
    const body = await getOrNull(
      this.#url('/me/:key/receipts', key),
      receiptsResponseSchema,
      this.fetchFn,
    );
    return newestTopupTx(body?.receipts ?? [], sinceMs);
  }
}

export type Plans = z.infer<typeof plansResponseSchema>;

/** GET /plans, cached 60 s (the API caches it for as long). */
export class PlansCache {
  #cached: { at: number; plans: Plans } | undefined;

  constructor(
    private readonly opts: {
      apiUrl: string;
      fetch: typeof fetch;
      now: () => number;
      ttlMs?: number;
    },
  ) {}

  async get(): Promise<Plans> {
    const now = this.opts.now();
    if (this.#cached && now - this.#cached.at < (this.opts.ttlMs ?? 60_000))
      return this.#cached.plans;
    const { data } = await httpJson(`${this.opts.apiUrl}/plans`, {
      fetch: this.opts.fetch,
      schema: plansResponseSchema,
    });
    this.#cached = { at: now, plans: data };
    return data;
  }
}
