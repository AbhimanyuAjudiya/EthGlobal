/**
 * decide(): request → serve-free | serve-paid | payment-required | deny (INTERFACES §5; brief §4.4).
 * The order is the specification: everything that can fail cheaply fails before a verification is burned
 * (T-24). Nothing is persisted here except the consumed-nonce entity; reseller, chain and HCS are the API's.
 */
import type { Ledger, PaymentRail, Personhood, PersonhoodResult } from '@ethglobal/adapters';
import { utf8 } from '@ethglobal/crypto';
import {
  AUDIENCE,
  hourBucket,
  isEvmNetwork,
  isHederaNetwork,
  keys,
  type Hex,
} from '@ethglobal/protocol/ids';
import {
  isEvmExact,
  paymentPayloadSchema,
  settleResultSchema,
  type Entitlement,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type PaymentResource,
  type PersonhoodProof,
  type SettleResult,
  type AcceptTemplate,
} from '@ethglobal/protocol/schemas';
import { canonicalJson } from '@ethglobal/protocol/typed-data';
import { assertMbStep, priceUsd6, usd6ToWire } from '@ethglobal/protocol/units';
import { paymentRequired, sessionNonce } from '@ethglobal/protocol/x402';

import { consumeChallenge, signalFor, type Challenge, type ConsumeResult } from './challenge.js';
import { auditKey, campaignClaimKey, onchainClaimKey, quotaKey } from './keys.js';
import { sizeBundle } from './size.js';
import { EntitlementStore } from './store/entitlement.js';
import { tierFromLevel, type Tier } from './tier.js';

import type { Campaign, CampaignCounters } from './campaign.js';

export type { Entitlement } from '@ethglobal/protocol/schemas';

export type DenyReason =
  | 'replay'
  | 'paused'
  | 'cap'
  | 'budget'
  | 'invalid-proof'
  | 'invalid-payment'
  | 'expired'
  | 'no-campaign'
  | 'ledger-unavailable'
  | 'invalid-request';

export type Decision =
  | {
      kind: 'serve-free';
      entitlement: Entitlement;
      claimKey: Hex;
      campaignClaimKey: Hex;
      tier: Tier;
      mb: number;
    }
  | {
      kind: 'serve-paid';
      entitlement: Entitlement;
      settlement: Extract<SettleResult, { success: true }>;
      requirements: PaymentRequirements;
    }
  | { kind: 'payment-required'; body: PaymentRequired }
  | { kind: 'deny'; reason: DenyReason; detail?: string };

export interface OctroiDeps {
  ledger: Ledger;
  personhood: Personhood;
  payments: PaymentRail;
  secret: Uint8Array;
  now: () => number;
  /** WORLD_ACTION */
  action: string;
  priceUsd6PerStep: bigint;
  stepMb: number;
  maxMbPerPurchase: number;
  validityDays: number;
  /** local: [eip155:31337 MockUSDC]; demo: [eip155:84532 USDC, hedera:testnet USDC] */
  accepts: AcceptTemplate[];
  keccak256: (bytes: Uint8Array) => Hex;
  /** Reseller plan for paid entitlements (additive to INTERFACES §5; default ''). */
  planId?: string;
  /**
   * The process's consumed-nonce cache (T-20), bounded by the caller. When omitted, decide() keeps one
   * self-pruning cache per ledger instance so concurrent calls still share it.
   */
  nonceCache?: Set<string>;
}

export interface DecideRequest {
  resource: PaymentResource;
  /** Requested step multiple (paid) or ignored (free: sizeBundle decides). */
  mb: number;
  proof?: PersonhoodProof;
  challenge?: Challenge;
  sessionPubKey?: Hex;
  payment?: PaymentPayload;
  /** True on routes that deliver an LPA ⇒ the EIP-3009 nonce must equal sessionNonce(sessionPubKey). */
  requireSessionKey?: boolean;
  campaign?: Campaign;
  counters?: CampaignCounters;
  /** The caller's lookup of keys.entitlementFree(quotaKey); decide() also looks it up itself (T-18). */
  existingEntitlement?: Entitlement | null;
}

type Deny = Extract<Decision, { kind: 'deny' }>;
type Settled = Extract<SettleResult, { success: true }>;

const DAY_MS = 86_400_000;
export const DEVICE_TIER_DETAIL = 'device tier: paid lane at the human price';

const deny = (reason: DenyReason, detail?: string): Deny =>
  detail === undefined ? { kind: 'deny', reason } : { kind: 'deny', reason, detail };

/** An adapter/protocol error's stable `code`, duck-typed so no adapter runtime is imported. */
const codeOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
    ? (error as { code: string }).code
    : 'error';

/** accepts[] for `mb`: each template + `amount` = steps × price, `extra` += { mb, stepMb, sessionKeyRequired }. */
export function buildAccepts(
  deps: Pick<OctroiDeps, 'accepts' | 'priceUsd6PerStep' | 'stepMb'>,
  mb: number,
  opts: { sessionKeyRequired?: boolean } = {},
): PaymentRequirements[] {
  assertMbStep(mb, deps.stepMb, Number.MAX_SAFE_INTEGER);
  const amount = usd6ToWire(priceUsd6(mb, deps.stepMb, deps.priceUsd6PerStep));
  const sessionKeyRequired = opts.sessionKeyRequired === true;
  return deps.accepts.map((template) => ({
    ...template,
    amount,
    extra: { ...template.extra, mb, stepMb: deps.stepMb, sessionKeyRequired },
  }));
}

function paymentRequiredFor(
  req: DecideRequest,
  deps: OctroiDeps,
  mb: number,
  error: string,
): Decision {
  const accepts = buildAccepts(deps, mb, { sessionKeyRequired: req.requireSessionKey === true });
  return {
    kind: 'payment-required',
    body: paymentRequired({ resource: req.resource, accepts, error }),
  };
}

// ───────────────────────────── consumed-nonce cache (T-20) ─────────────────────────────

interface DefaultCache {
  nonces: Set<string>;
  exp: Map<string, number>;
}
const defaultCaches = new WeakMap<Ledger, DefaultCache>();

function cacheFor(ledger: Ledger, now: number): DefaultCache {
  let cache = defaultCaches.get(ledger);
  if (!cache) {
    cache = { nonces: new Set(), exp: new Map() };
    defaultCaches.set(ledger, cache);
  }
  // An expired challenge is refused by its MAC'd exp before the cache is read, so pruning it is safe.
  for (const [nonce, exp] of cache.exp) {
    if (exp < now) {
      cache.exp.delete(nonce);
      cache.nonces.delete(nonce);
    }
  }
  return cache;
}

function consumeDenial(result: ConsumeResult): Deny | null {
  switch (result) {
    case 'ok':
      return null;
    case 'replayed':
      return deny('replay', 'challenge');
    case 'unavailable':
      return deny('ledger-unavailable', 'nonce');
    case 'expired':
    case 'invalid':
      return deny('invalid-proof', `challenge_${result}`);
  }
}

async function consume(
  deps: OctroiDeps,
  ch: Challenge,
  sessionPubKey: Hex,
  now: number,
): Promise<Deny | null> {
  const run = (cache: Set<string>) =>
    consumeChallenge(deps.ledger, cache, ch, sessionPubKey, now, deps.secret);
  if (deps.nonceCache) return consumeDenial(await run(deps.nonceCache));
  const shared = cacheFor(deps.ledger, now);
  const result = await run(shared.nonces);
  const id = ch.nonce.toLowerCase();
  if (shared.nonces.has(id)) shared.exp.set(id, ch.exp);
  return consumeDenial(result);
}

// ───────────────────────────── free lane ─────────────────────────────

/** Campaign liveness, hour cap and budget from the chain-side counters, before anything is burned (T-24). */
function campaignBlock(c: Campaign, counters: CampaignCounters, now: number): Deny | null {
  if (counters.paused) return deny('paused');
  if (now >= c.expiresAt) return deny('expired');
  // A count from an earlier hour bucket no longer applies (DataDrop resets per bucket).
  const stale = counters.hourBucket < hourBucket(now);
  const claimsThisHour = stale ? 0 : counters.claimsThisHour;
  if (claimsThisHour >= c.claimsPerHour) return deny('cap');
  if (counters.spentUsd6 + c.pricePerClaimUsd6 > counters.budgetUsd6) return deny('budget');
  return null;
}

async function verifyPerson(
  deps: OctroiDeps,
  proof: PersonhoodProof,
  ch: Challenge,
): Promise<PersonhoodResult | Deny> {
  try {
    // The signal is recomputed from the consumed nonce, never taken from the client's echo (T-19).
    return await deps.personhood.verify(proof, {
      action: deps.action,
      signal: signalFor(ch.nonce, ch.audience),
    });
  } catch (error) {
    const code = codeOf(error);
    return code === 'already_verified' ? deny('replay', code) : deny('invalid-proof', code);
  }
}

async function alreadyServed(
  deps: OctroiDeps,
  req: DecideRequest,
  entitlementKey: string,
): Promise<Deny | null> {
  if (req.existingEntitlement || req.counters?.claimed === true) return deny('replay');
  try {
    const found = await new EntitlementStore(deps.ledger, deps.now).getByKey(entitlementKey);
    return found ? deny('replay') : null;
  } catch {
    return deny('ledger-unavailable', 'entitlement');
  }
}

async function actionAllows(c: Campaign, claimKey: Hex): Promise<boolean> {
  if (!c.actionCheck) return true;
  try {
    return (await c.actionCheck(claimKey)) === true;
  } catch {
    return false;
  }
}

async function freeLane(
  req: DecideRequest,
  deps: OctroiDeps,
  proof: PersonhoodProof,
): Promise<Decision> {
  const { campaign, challenge: ch, sessionPubKey, counters } = req;
  if (!campaign) return deny('no-campaign');
  if (!ch || !sessionPubKey || !counters) return deny('invalid-request', 'challenge_required');
  // The free lane is /claim only; gift and card lanes consume their own path (T-21).
  if (ch.path !== '/claim' || ch.audience !== AUDIENCE)
    return deny('invalid-proof', 'challenge_route');
  const now = deps.now();
  const blocked = campaignBlock(campaign, counters, now);
  if (blocked) return blocked;
  const consumed = await consume(deps, ch, sessionPubKey, now);
  if (consumed) return consumed;
  const person = await verifyPerson(deps, proof, ch);
  if ('kind' in person) return person;

  const tier = tierFromLevel(person.level); // from the verifier's response only (T-22)
  const mb = sizeBundle(campaign, tier);
  if (mb === 0) return paymentRequiredFor(req, deps, deps.stepMb, DEVICE_TIER_DETAIL);

  const key = keys.entitlementFree(quotaKey(deps.secret, person.nullifierHash));
  const cck = campaignClaimKey(auditKey(deps.secret, campaign.id as Hex), person.nullifierHash);
  const claimKey = onchainClaimKey(campaign.id as Hex, cck);
  const replay = await alreadyServed(deps, req, key);
  if (replay) return replay;
  if (!(await actionAllows(campaign, claimKey))) return deny('invalid-proof', 'action');

  const entitlement: Entitlement = {
    v: 1,
    key,
    kind: 'free',
    status: 'pending-profile',
    tier,
    campaignId: campaign.id,
    planId: campaign.planId,
    mbTotal: mb,
    mbUsed: 0,
    usageAsOf: now,
    usageSource: 'none',
    createdAt: now,
    expiresAt: now + campaign.validityDays * DAY_MS,
  };
  return { kind: 'serve-free', entitlement, claimKey, campaignClaimKey: cck, tier, mb };
}

// ───────────────────────────── paid lane ─────────────────────────────

/** Addresses compare lower-cased (asset always; payTo on EVM); everything else exactly (T-28). */
function normalised(r: unknown): unknown {
  if (typeof r !== 'object' || r === null) return r;
  const o = r as Record<string, unknown>;
  const lowerIf = (v: unknown, yes: boolean) =>
    yes && typeof v === 'string' ? v.toLowerCase() : v;
  const evm = typeof o.network === 'string' && isEvmNetwork(o.network);
  return { ...o, asset: lowerIf(o.asset, true), payTo: lowerIf(o.payTo, evm) };
}

/** Deep equality by canonical JSON, on the RAW echo (an added key, e.g. a v1 amount field, fails). */
function sameRequirements(accepted: unknown, offered: PaymentRequirements): boolean {
  try {
    return canonicalJson(normalised(accepted)) === canonicalJson(normalised(offered));
  } catch {
    return false;
  }
}

const TX_PATTERNS: readonly [(network: string) => boolean, RegExp][] = [
  [isEvmNetwork, /^0x[0-9a-fA-F]{64}$/],
  [isHederaNetwork, /^0\.0\.\d{1,12}@\d{1,12}\.\d{1,9}$/],
];
const transactionFits = (network: string, tx: string): boolean =>
  TX_PATTERNS.some(([applies, pattern]) => applies(network) && pattern.test(tx));

function sessionBound(
  payment: PaymentPayload,
  sessionPubKey: Hex,
  keccak: OctroiDeps['keccak256'],
): Deny | null {
  let expected: Hex;
  try {
    expected = sessionNonce(sessionPubKey, keccak);
  } catch {
    return deny('invalid-request', 'session_key');
  }
  // Hedera: the binding would be the transaction memo, which octroi cannot decode without the SDK
  // [verify Wed]; until then an LPA route refuses a Hedera payment (fail closed).
  if (!isEvmExact(payment.payload)) return deny('invalid-payment', 'session_binding_unsupported');
  return payment.payload.authorization.nonce.toLowerCase() === expected
    ? null
    : deny('invalid-payment', 'session_binding');
}

async function settle(
  deps: OctroiDeps,
  payment: PaymentPayload,
  offered: PaymentRequirements,
): Promise<Settled | Deny> {
  try {
    const verified = await deps.payments.verify(payment, offered);
    if (!verified.isValid) return deny('invalid-payment', verified.invalidReason);
  } catch (error) {
    return deny('invalid-payment', `verify_${codeOf(error)}`);
  }
  let raw: unknown;
  try {
    raw = await deps.payments.settle(payment, offered);
  } catch (error) {
    return deny('invalid-payment', `settle_${codeOf(error)}`);
  }
  const parsed = settleResultSchema.safeParse(raw);
  if (!parsed.success) return deny('invalid-payment', 'settlement_malformed');
  const s = parsed.data;
  // 'settlement_pending' is non-terminal (A-18): never serve on it (T-27).
  if (!s.success) return deny('invalid-payment', s.errorReason);
  if (s.network !== offered.network) return deny('invalid-payment', 'settlement_network');
  if (!transactionFits(s.network, s.transaction)) return deny('invalid-payment', 'settlement_tx');
  if (
    isEvmExact(payment.payload) &&
    s.payer.toLowerCase() !== payment.payload.authorization.from.toLowerCase()
  ) {
    return deny('invalid-payment', 'settlement_payer');
  }
  return s;
}

async function paidLane(
  req: DecideRequest,
  deps: OctroiDeps,
  payment: PaymentPayload,
): Promise<Decision> {
  const offers = buildAccepts(deps, req.mb, { sessionKeyRequired: req.requireSessionKey === true });
  const offered = offers.find((offer) => sameRequirements(payment.accepted, offer));
  if (!offered) return deny('invalid-payment', 'requirements_mismatch');
  if (!paymentPayloadSchema.safeParse(payment).success) {
    return deny('invalid-payment', 'malformed_payload');
  }
  if (req.requireSessionKey === true) {
    if (!req.sessionPubKey) return deny('invalid-request', 'session_key_required');
    const unbound = sessionBound(payment, req.sessionPubKey, deps.keccak256);
    if (unbound) return unbound;
  }
  if (isEvmExact(payment.payload)) {
    const { value, to } = payment.payload.authorization;
    if (value !== offered.amount) return deny('invalid-payment', 'amount_mismatch'); // exact (T-26)
    if (to.toLowerCase() !== offered.payTo.toLowerCase()) {
      return deny('invalid-payment', 'recipient_mismatch');
    }
  }
  const settled = await settle(deps, payment, offered);
  if ('kind' in settled) return settled;

  const now = deps.now();
  const nonce = isEvmExact(payment.payload)
    ? payment.payload.authorization.nonce
    : deps.keccak256(utf8(settled.transaction));
  const entitlement: Entitlement = {
    v: 1,
    key: keys.entitlementPaid(settled.payer, nonce as Hex),
    kind: 'paid',
    status: 'pending-profile',
    tier: 'none',
    planId: deps.planId ?? '',
    mbTotal: req.mb,
    mbUsed: 0,
    usageAsOf: now,
    usageSource: 'none',
    payer: settled.payer,
    network: offered.network,
    createdAt: now,
    expiresAt: now + deps.validityDays * DAY_MS,
  };
  return { kind: 'serve-paid', entitlement, settlement: settled, requirements: offered };
}

// ───────────────────────────── entry point ─────────────────────────────

function requestInvalid(req: DecideRequest, deps: OctroiDeps): Deny | null {
  if (req.proof !== undefined && req.payment !== undefined) {
    return deny('invalid-request', 'proof_and_payment');
  }
  if (!Number.isInteger(req.mb)) return deny('invalid-request', 'mb');
  if (req.proof !== undefined) return null; // free lane: sizeBundle decides the MB
  try {
    assertMbStep(req.mb, deps.stepMb, deps.maxMbPerPurchase);
  } catch {
    return deny('invalid-request', 'mb_step');
  }
  return null;
}

export async function decide(req: DecideRequest, deps: OctroiDeps): Promise<Decision> {
  const invalid = requestInvalid(req, deps);
  if (invalid) return invalid;
  if (req.proof !== undefined) return freeLane(req, deps, req.proof);
  if (req.payment !== undefined) return paidLane(req, deps, req.payment);
  return paymentRequiredFor(req, deps, req.mb, 'payment required');
}
