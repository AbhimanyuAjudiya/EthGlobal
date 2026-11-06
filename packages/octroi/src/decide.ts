/**
 * decide(): request → serve-free | serve-paid | payment-required | deny (INTERFACES §5; brief §4.4).
 * The order is the specification: everything that can fail cheaply fails before a verification is burned
 * (T-24). The only writes here are replay guards: the consumed-nonce entity, the free lane's claim locks
 * (reserve) and the paid lane's settlement marker (servedOnce); reseller, chain and HCS are the API's.
 */
import type { Ledger, PaymentRail, Personhood, PersonhoodResult } from '@ethglobal/adapters';
import { randomBytes, bytesToHex, utf8 } from '@ethglobal/crypto';
import {
  AUDIENCE,
  dayBucket,
  hourBucket,
  isEvmNetwork,
  isHederaNetwork,
  PLAN_MB,
  RECEIPT_TTL_S,
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

import {
  assertCampaignLifetime,
  CampaignTooLongError,
  campaignToPayload,
  CLAIM_RECORD_GRACE_MS,
  type Campaign,
  type CampaignCounters,
} from './campaign.js';
import { consumeChallenge, signalFor, type Challenge, type ConsumeResult } from './challenge.js';
import {
  auditKey,
  campaignClaimKey,
  claimLockKeys,
  freeEntitlementKey,
  holderHash,
  onchainClaimKey,
  paidEntitlementKey,
  quotaKey,
  settlementLockKey,
} from './keys.js';
import { sizeBundle } from './size.js';
import { ClaimStore } from './store/claim.js';
import { EntitlementStore } from './store/entitlement.js';
import { tierFromLevel, type Tier } from './tier.js';

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
  /** Decode only the native transaction's signed memo; missing support fails closed on LPA delivery. */
  nativeSessionBinding?: (payment: PaymentPayload) => Hex | undefined;
  /** Reseller plan for paid entitlements (additive to INTERFACES §5; default ''). */
  planId?: string;
  /**
   * The process's consumed-nonce cache (T-20), bounded by the caller. When omitted, decide() keeps one
   * self-pruning cache per ledger instance so concurrent calls still share it.
   */
  nonceCache?: Set<string>;
  /** Persist validated settled work before its replay marker; the API resumes only the same bound operation. */
  onPaidDecision?: (decision: Extract<Decision, { kind: 'serve-paid' }>) => Promise<void>;
  /** Journal an incomplete reservation before writes, so a restart can release only this attempt's locks. */
  onFreeReservation?: (
    decision: Extract<Decision, { kind: 'serve-free' }>,
    reservation: {
      token: Hex;
      keys: string[];
      locks: { key: string; scope: 'free-live' | 'free-campaign'; expiresAt: number }[];
    },
  ) => Promise<void>;
  /** Atomically promote the journaled reservation to resumable work after all locks were acquired. */
  onFreeDecision?: (decision: Extract<Decision, { kind: 'serve-free' }>) => Promise<void>;
}

export interface DecideRequest {
  resource: PaymentResource;
  /** Requested step multiple (paid) or ignored (free: sizeBundle decides). */
  mb: number;
  proof?: PersonhoodProof;
  challenge?: Challenge;
  sessionPubKey?: Hex;
  payment?: PaymentPayload;
  /** True on LPA routes: the signed EIP-3009 nonce or Hedera memo binds sessionNonce(sessionPubKey). */
  requireSessionKey?: boolean;
  campaign?: Campaign;
  counters?: CampaignCounters;
  /**
   * The caller's own replay knowledge, if any (an entitlement it already found). decide() does not need it: it
   * looks up the per-campaign entitlement, the per-campaign claim record and the human's live lock itself (T-18,
   * RT-O-08) — the caller cannot compute those keys (they need the nullifier).
   */
  existingEntitlement?: Entitlement | null;
}

type Deny = Extract<Decision, { kind: 'deny' }>;
type Settled = Extract<SettleResult, { success: true }>;

const DAY_MS = 86_400_000;
/** campaignSchema's validityDays bound: a live lock can only come from the last 30 claim days (A-33). */
const MAX_VALIDITY_DAYS = 30;

/** Every day bucket a live lock of a still-live bundle can sit in: the last 30 claim days and tomorrow's (A-44). */
const liveDays = (today: number): number[] =>
  Array.from({ length: MAX_VALIDITY_DAYS + 2 }, (_, i) => today - MAX_VALIDITY_DAYS + i);
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
    extra: {
      ...template.extra,
      mb,
      stepMb: deps.stepMb,
      sessionKeyRequired,
      ...(sessionKeyRequired && isHederaNetwork(template.network)
        ? { sessionBinding: 'hedera-memo-v1' }
        : {}),
    },
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
  if (c.pricePerClaimUsd6 > 0n && counters.spentUsd6 / c.pricePerClaimUsd6 >= BigInt(c.maxClaims))
    return deny('cap');
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

/** Everything the free lane derives from the verified nullifier (one place, so a bad one is one deny). */
interface FreeKeys {
  key: string;
  cck: Hex;
  claimKey: Hex;
  locks: ReturnType<typeof claimLockKeys>;
}

function freeKeys(deps: OctroiDeps, campaignId: Hex, nullifierHash: Hex): FreeKeys | Deny {
  try {
    const cck = campaignClaimKey(auditKey(deps.secret, campaignId), nullifierHash);
    return {
      key: freeEntitlementKey(deps.secret, campaignId, nullifierHash),
      cck,
      claimKey: onchainClaimKey(campaignId, cck),
      locks: claimLockKeys(deps.secret, campaignId, quotaKey(deps.secret, nullifierHash)),
    };
  } catch {
    // the verifier answered a malformed nullifier: a deny, not a throw after the verification (RT-O-07)
    return deny('invalid-proof', 'verifier_nullifier');
  }
}

/**
 * One live free bundle per human, one claim per (human, campaign) — decided from the ledger, not the caller:
 * this campaign's entitlement, this campaign's claim record (RT-O-08: survives the entitlement), and the
 * human's live locks of every day bucket a live bundle can hold (A-33, A-44). All reads, in parallel.
 */
async function alreadyServed(
  deps: OctroiDeps,
  req: DecideRequest,
  k: FreeKeys,
  now: number,
): Promise<Deny | null> {
  if (req.existingEntitlement || req.counters?.claimed === true) return deny('replay');
  try {
    const claims = new ClaimStore(deps.ledger, deps.now);
    const held = await Promise.all([
      new EntitlementStore(deps.ledger, deps.now).getByKey(k.key).then((found) => found !== null),
      claims.held(k.locks.campaign),
      ...liveDays(dayBucket(now)).map((day) => claims.held(k.locks.live(day))),
    ]);
    return held.some(Boolean) ? deny('replay') : null;
  } catch {
    return deny('ledger-unavailable', 'entitlement');
  }
}

/**
 * Take the human's live locks for today AND tomorrow (create-if-absent: of two concurrent claims on two campaigns
 * exactly one gets the bucket they share — today's when both run on one UTC day, the later one's today when they
 * straddle midnight, RT-O-03 / A-44) and this campaign's claim record. Written before serve-free, so a second claim — concurrent, in
 * another process, or after this bundle expired — is a replay inside decide(), before any sponsor pays.
 */
async function reserve(
  deps: OctroiDeps,
  k: FreeKeys,
  campaign: Campaign,
  entitlementExpiresAt: number,
  now: number,
  decision: Extract<Decision, { kind: 'serve-free' }>,
): Promise<Deny | null> {
  const claims = new ClaimStore(deps.ledger, deps.now);
  // the record outlives the campaign (A-44); freeInputInvalid refused a campaign the ledger cannot outlive
  const recordUntil = campaign.expiresAt + CLAIM_RECORD_GRACE_MS;
  const reservation = bytesToHex(randomBytes(32));
  const acquired: string[] = [];
  let committed = false;
  try {
    const today = dayBucket(now);
    await deps.onFreeReservation?.(decision, {
      token: reservation,
      keys: [k.locks.live(today), k.locks.live(today + 1), k.locks.campaign],
      locks: [
        { key: k.locks.live(today), scope: 'free-live', expiresAt: entitlementExpiresAt },
        { key: k.locks.live(today + 1), scope: 'free-live', expiresAt: entitlementExpiresAt },
        { key: k.locks.campaign, scope: 'free-campaign', expiresAt: recordUntil },
      ],
    });
    for (const day of [today, today + 1]) {
      const key = k.locks.live(day);
      if (!(await claims.reserve(key, 'free-live', entitlementExpiresAt, reservation)))
        return deny('replay', 'claim_lock');
      acquired.push(key);
    }
    const record = await claims.reserve(
      k.locks.campaign,
      'free-campaign',
      recordUntil,
      reservation,
    );
    if (!record) return deny('replay', 'claim_lock');
    acquired.push(k.locks.campaign);
    await deps.onFreeDecision?.(decision);
    committed = true;
    return null;
  } catch {
    return deny('ledger-unavailable', 'claim_lock');
  } finally {
    if (!committed)
      await Promise.allSettled(acquired.map((key) => claims.release(key, reservation)));
  }
}

const isSafeCount = (n: unknown): boolean => Number.isSafeInteger(n) && (n as number) >= 0;
const isUsd6 = (n: unknown): boolean => typeof n === 'bigint' && n >= 0n;

/** Campaign and counters are validated like stored data (RT-O-07): no NaN, no 0-day validity, no fractions. */
function freeInputInvalid(c: Campaign, counters: CampaignCounters, now: number): Deny | null {
  try {
    campaignToPayload(c);
    assertCampaignLifetime(c.expiresAt, now);
  } catch (error) {
    return deny(
      'invalid-request',
      error instanceof CampaignTooLongError ? error.message : 'campaign',
    );
  }
  const ok =
    typeof counters.paused === 'boolean' &&
    isUsd6(counters.budgetUsd6) &&
    isUsd6(counters.spentUsd6) &&
    isSafeCount(counters.claimsThisHour) &&
    isSafeCount(counters.hourBucket);
  return ok ? null : deny('invalid-request', 'counters');
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
  const now = deps.now();
  const invalid = freeInputInvalid(campaign, counters, now);
  if (invalid) return invalid;
  if (ch.path !== '/claim' || ch.audience !== AUDIENCE)
    return deny('invalid-proof', 'challenge_route');
  const blocked = campaignBlock(campaign, counters, now);
  if (blocked) return blocked;
  const consumed = await consume(deps, ch, sessionPubKey, now);
  if (consumed) return consumed;
  const person = await verifyPerson(deps, proof, ch);
  if ('kind' in person) return person;

  const tier = tierFromLevel(person.level); // from the verifier's response only (T-22)
  const mb = sizeBundle(campaign, tier);
  // the human price of what the paid lane sells: one PLAN_MB plan, never a lone pricing step
  if (mb === 0) return paymentRequiredFor(req, deps, PLAN_MB, DEVICE_TIER_DETAIL);

  const k = freeKeys(deps, campaign.id as Hex, person.nullifierHash);
  if ('kind' in k) return k;
  const replay = await alreadyServed(deps, req, k, now);
  if (replay) return replay;
  if (!(await actionAllows(campaign, k.claimKey))) return deny('invalid-proof', 'action');
  const expiresAt = now + campaign.validityDays * DAY_MS;
  const entitlement: Entitlement = {
    v: 1,
    key: k.key,
    kind: 'free',
    status: 'pending-profile',
    tier,
    campaignId: campaign.id,
    // the operator's vendor package wins: a campaign's planId comes from the sponsor's form and the vendor rejects
    // unknown package codes (live: RESELLER_PLAN_ID=JC060 vs the form's `in-1gb-7d`)
    planId: deps.planId !== undefined && deps.planId !== '' ? deps.planId : campaign.planId,
    mbTotal: mb,
    mbUsed: 0,
    usageAsOf: now,
    usageSource: 'none',
    holderHash: holderHash(k.key, sessionPubKey),
    createdAt: now,
    expiresAt,
  };
  const decision: Extract<Decision, { kind: 'serve-free' }> = {
    kind: 'serve-free',
    entitlement,
    claimKey: k.claimKey,
    campaignClaimKey: k.cck,
    tier,
    mb,
  };
  const reserved = await reserve(deps, k, campaign, expiresAt, now, decision);
  return reserved ?? decision;
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
  deps: Pick<OctroiDeps, 'keccak256' | 'nativeSessionBinding'>,
): Deny | null {
  let expected: Hex;
  try {
    expected = sessionNonce(sessionPubKey, deps.keccak256);
  } catch {
    return deny('invalid-request', 'session_key');
  }
  let actual: string | undefined;
  if (isEvmExact(payment.payload)) actual = payment.payload.authorization.nonce.toLowerCase();
  else {
    if (!isHederaNetwork(payment.accepted.network) || !deps.nativeSessionBinding)
      return deny('invalid-payment', 'session_binding_unsupported');
    try {
      actual = deps.nativeSessionBinding(payment);
    } catch {
      return deny('invalid-payment', 'session_binding');
    }
  }
  return actual === expected ? null : deny('invalid-payment', 'session_binding');
}

/**
 * verify → settle → parse. A verify that reports `nonce_already_used` is NOT final (T-15): the authorization may
 * have been front-run by anyone who saw it, which still paid us; settle() of a recovering facilitator then
 * returns the executed transaction. `recovered` records that, for the dedupe below.
 */
async function settle(
  deps: OctroiDeps,
  payment: PaymentPayload,
  offered: PaymentRequirements,
): Promise<{ s: Settled; recovered: boolean } | Deny> {
  let recovered = false;
  let verifiedPayer: string | undefined;
  try {
    const verified = await deps.payments.verify(payment, offered);
    verifiedPayer = verified.payer;
    if (!verified.isValid) {
      if (verified.invalidReason !== 'nonce_already_used')
        return deny('invalid-payment', verified.invalidReason);
      recovered = true;
    }
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
  if (
    isHederaNetwork(offered.network) &&
    (!/^0\.0\.[1-9]\d{0,11}$/.test(s.payer) || verifiedPayer !== s.payer)
  )
    return deny('invalid-payment', 'settlement_payer');
  return { s, recovered };
}

/**
 * One serve per on-chain payment (RT-O-05): the settlement marker is written create-if-absent before serve-paid.
 * A second request for the same transaction — concurrent (both settled, the recovering facilitator answered the
 * same tx), sequential, or in another process — is refused: `nonce_already_used` when verify had said so,
 * `replay` otherwise. A ledger failure fails closed; a retry is served once through the facilitator's recovery.
 */
async function servedOnce(
  deps: OctroiDeps,
  settled: { s: Settled; recovered: boolean },
  now: number,
): Promise<Deny | null> {
  const key = settlementLockKey(deps.secret, settled.s.network, settled.s.transaction);
  let first: boolean;
  try {
    first = await new ClaimStore(deps.ledger, deps.now).reserve(
      key,
      'settlement',
      now + RECEIPT_TTL_S * 1000,
    );
  } catch {
    return deny('ledger-unavailable', 'settlement');
  }
  if (first) return null;
  return settled.recovered
    ? deny('invalid-payment', 'nonce_already_used')
    : deny('replay', 'settlement');
}

async function paidLane(
  req: DecideRequest,
  deps: OctroiDeps,
  raw: PaymentPayload,
): Promise<Decision> {
  const offers = buildAccepts(deps, req.mb, { sessionKeyRequired: req.requireSessionKey === true });
  // The echo is compared RAW (an added key fails); everything after uses only the validated payload (RT-O-02).
  const offered = offers.find((offer) => sameRequirements(raw.accepted, offer));
  if (!offered) return deny('invalid-payment', 'requirements_mismatch');
  const parsed = paymentPayloadSchema.safeParse(raw);
  if (!parsed.success) return deny('invalid-payment', 'malformed_payload');
  const payment = parsed.data;
  if (req.requireSessionKey === true) {
    if (!req.sessionPubKey) return deny('invalid-request', 'session_key_required');
    const unbound = sessionBound(payment, req.sessionPubKey, deps);
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
  const { s } = settled;
  const nonce = isEvmExact(payment.payload)
    ? payment.payload.authorization.nonce
    : deps.keccak256(utf8(s.transaction));
  const entitlement: Entitlement = {
    v: 1,
    key: paidEntitlementKey(deps.secret, offered.network, s.payer, nonce),
    kind: 'paid',
    status: 'pending-profile',
    tier: 'none',
    planId: deps.planId ?? '',
    mbTotal: req.mb,
    mbUsed: 0,
    usageAsOf: now,
    usageSource: 'none',
    payer: s.payer,
    network: offered.network,
    createdAt: now,
    expiresAt: now + deps.validityDays * DAY_MS,
  };
  const decision: Extract<Decision, { kind: 'serve-paid' }> = {
    kind: 'serve-paid',
    entitlement,
    settlement: s,
    requirements: offered,
  };
  if (deps.onPaidDecision) {
    try {
      await deps.onPaidDecision(decision);
    } catch {
      return deny('ledger-unavailable', 'paid-recovery');
    }
  }
  const twice = await servedOnce(deps, settled, now);
  return twice ?? decision;
}

// ───────────────────────────── entry point ─────────────────────────────

const isObject = (v: unknown): boolean => typeof v === 'object' && v !== null;

function requestInvalid(req: DecideRequest, deps: OctroiDeps): Deny | null {
  // decide() is a public entry: hostile shapes are a deny, never a TypeError (RT-O-07, ARCHITECTURE §9 rule 2)
  if (!isObject(req)) return deny('invalid-request', 'request');
  if (req.payment !== undefined && !isObject(req.payment))
    return deny('invalid-request', 'payment');
  if (req.proof !== undefined && !isObject(req.proof)) return deny('invalid-request', 'proof');
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
