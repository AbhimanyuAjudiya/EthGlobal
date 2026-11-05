import type { Hex, Address } from '@ethglobal/protocol/ids';
import {
  verificationLevelSchema,
  type PaymentRequired,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentResource,
  type PersonhoodProof,
  type SettleResult,
  type UsageEvent,
  type VerificationLevel,
  type VerifyResult,
} from '@ethglobal/protocol/schemas';

export const adapterModes = ['local', 'live'] as const;
export type AdapterMode = (typeof adapterModes)[number];

// Wire types are owned by @ethglobal/protocol (INTERFACES §1.5, A-7); adapters only re-exports them.
export type { Hex, Address } from '@ethglobal/protocol/ids';
export type {
  PaymentResource,
  PaymentRequirements,
  PaymentRequired,
  PaymentAuthorization,
  PaymentPayload,
  VerifyResult,
  SettleResult,
  PersonhoodProof,
  VerificationLevel,
  UsageEvent,
} from '@ethglobal/protocol/schemas';

// ───────────────────────────── Ledger (modelled on Arkiv's entity API) ─────────────────────────────

export type AnnotationValue = string | number;
/** String and numeric annotations, queryable by equality. */
export type Annotations = Record<string, AnnotationValue>;

export interface LedgerEntity {
  key: string;
  payload: string;
  annotations: Annotations;
  /** ms since epoch */
  createdAt: number;
  /** ms since epoch, or null when the entity never expires */
  expiresAt: number | null;
  /**
   * Revision, maintained by the ledger (A-32): 1 on put, +1 on every update. Pass it back as
   * `update(…, { ifVersion })` for a compare-and-swap. Absent only on hand-built entities (read as 1).
   */
  version?: number;
}

/** The atomic primitives of the Ledger port (A-32, RT-O-03/05/06). */
export interface LedgerUpdatePatch {
  payload?: string;
  annotations?: Annotations;
  /**
   * Compare-and-swap: the update applies only if the live entity's `version` still equals this, else
   * AdapterError('ledger', 'conflict') and nothing changes.
   */
  ifVersion?: number;
}

export interface LedgerPutInput {
  payload: string;
  annotations?: Annotations;
  /**
   * Lifetime in seconds. Omit for no expiry. ArkivLedger maps it to the SDK's
   * `expiration: ExpirationTime.fromSeconds(ceil(s / 2) × 2)` (whole 2-s blocks, A-24).
   */
  expiresIn?: number;
  /**
   * Create-if-absent (A-32): when true, the put fails with AdapterError('ledger', 'conflict') if a live entity
   * of this writer already carries the same `type` and `key` annotations (both required, strings). Exactly one
   * of N concurrent ifAbsent puts of one (type, key) succeeds.
   */
  ifAbsent?: boolean;
}

export interface LedgerPutResult {
  key: string;
  expiresAt: number | null;
}

export interface LedgerQuery {
  /** Every listed annotation must match exactly (AND). */
  annotations?: Annotations;
  limit?: number;
}

export interface Ledger {
  put(input: LedgerPutInput): Promise<LedgerPutResult>;
  get(key: string): Promise<LedgerEntity | null>;
  query(query?: LedgerQuery): Promise<LedgerEntity[]>;
  /**
   * Replace payload and/or annotations; reset the lifetime when expiresIn is given; bump `version`. With
   * `patch.ifVersion`, a compare-and-swap (A-32). The returned key may differ (Arkiv); callers re-index by ANN.key.
   */
  update(key: string, patch: LedgerUpdatePatch, expiresIn?: number): Promise<LedgerPutResult>;
}

// ───────────────────────────── Personhood (modelled on World ID IDKit 4) ─────────────────────────────

/** The verification levels, from protocol's `verificationLevelSchema` (one definition). */
export const verificationLevels: readonly VerificationLevel[] = verificationLevelSchema.options;

export interface PersonhoodContext {
  /** Action id from the developer portal; the nullifier is unique per (user, action). */
  action: string;
  /** The challenge signal; when given, every response's signal_hash must equal hashToField(signal) (T-19). */
  signal?: string;
}

export interface PersonhoodResult {
  nullifierHash: Hex;
  level: VerificationLevel;
}

export interface Personhood {
  verify(proof: PersonhoodProof, context: PersonhoodContext): Promise<PersonhoodResult>;
}

// ───────────────────────────── PaymentRail (modelled on x402 v2) ─────────────────────────────

export interface PaymentRequirementInput {
  amount: string;
  asset: string;
  /** EVM address on eip155:*, Hedera account id on hedera:* (A-6). */
  payTo: string;
  network: string;
  resource: PaymentResource;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export interface PaymentRail {
  createPaymentRequirement(input: PaymentRequirementInput): PaymentRequired;
  /** Must return invalidReason 'unsupported_scheme' for a payload shape it does not implement. */
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResult>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResult>;
}

// ───────────────────────────── Inference (modelled on 0G Compute) ─────────────────────────────

export interface InferenceOptions {
  model?: string;
  maxTokens?: number;
}

export interface InferenceResult {
  text: string;
  requestId: string;
  /** Provider signature over the response (0G: ZG-Res-Signature). */
  signature: Hex;
  model: string;
}

export interface Inference {
  complete(prompt: string, options?: InferenceOptions): Promise<InferenceResult>;
}

// ───────────────────────────── NameResolver (modelled on ENS) ─────────────────────────────

export interface NameResolver {
  resolve(name: string): Promise<Address | null>;
  getText(name: string, key: string): Promise<string | null>;
}

// ───────────────────────────── Reseller (eSIM Access; MegaeSIM fixture-only) ─────────────────────────────

export type ResellerName = 'mock' | 'esimaccess' | 'megaesim' | 'inventory';
export interface EsimPlan {
  id: string;
  provider: ResellerName;
  name: string;
  country: 'IN';
  dataMb: number;
  validityDays: number;
  wholesaleUsd6: bigint;
}
export interface EsimProfile {
  iccid: string;
  lpa: string;
  planId: string;
  provider: ResellerName;
  orderId: string;
  status: 'ready' | 'installed' | 'active' | 'expired';
}
export interface EsimUsage {
  iccid: string;
  usedMb: number;
  totalMb: number;
  asOf: number;
  status?: EsimProfile['status'];
}
export type WebhookVerdict =
  | { ok: true; eventId: string }
  | { ok: false; reason: 'missing_headers' | 'bad_signature' | 'skew' | 'replay' };
export interface Reseller {
  readonly name: ResellerName;
  plans(country: 'IN'): Promise<EsimPlan[]>;
  /** One profile per order. A second call with the same idempotencyKey returns the same profile, never a second one (T-40). */
  order(planId: string, opts: { idempotencyKey: string }): Promise<EsimProfile>;
  topUp(
    iccid: string,
    mb: number,
    opts: { idempotencyKey: string },
  ): Promise<{ orderId: string; totalMb: number }>;
  usage(iccid: string): Promise<EsimUsage>;
  /** Pure: checks headers + HMAC + skew + its own replay cache. Never throws. */
  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
    now: number,
  ): WebhookVerdict;
  /** zod-validated; throws AdapterError('reseller','invalid_response'). */
  parseWebhook(rawBody: string): UsageEvent[];
}

// ───────────────────────────── ConsensusLog (HCS), BlobStore (Swarm), Treasury ─────────────────────────────

export interface ConsensusLog {
  submit(
    topic: string,
    message: string,
  ): Promise<{ sequence: number; consensusAt: number; txId: string }>;
  read(
    topic: string,
    fromSequence?: number,
  ): Promise<{ sequence: number; message: string; consensusAt: number }[]>;
}
export interface BlobStore {
  put(bytes: Uint8Array, contentType: string): Promise<{ ref: string }>;
  get(ref: string): Promise<Uint8Array | null>;
}
/** Outbound USDC from the separate refund wallet — gift reclaims only. Bounded by TREASURY_MAX_USD6_PER_DAY in the API (A-31). */
export interface Treasury {
  refund(input: {
    network: string;
    to: string;
    usd6: bigint;
    memo: string;
  }): Promise<{ tx: string }>;
  balanceUsd6(network: string): Promise<bigint>;
}

// ───────────────────────────── Bundle ─────────────────────────────

export interface Adapters {
  mode: AdapterMode;
  ledger: Ledger;
  personhood: Personhood;
  payments: PaymentRail;
  inference: Inference;
  names: NameResolver;
  reseller: Reseller;
  consensus: ConsensusLog;
  blobs: BlobStore;
  treasury: Treasury;
}

export type AdapterName = Exclude<keyof Adapters, 'mode'>;
