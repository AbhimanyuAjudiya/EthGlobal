export const adapterModes = ['local', 'live'] as const;
export type AdapterMode = (typeof adapterModes)[number];

export type Address = `0x${string}`;
export type Hex = `0x${string}`;

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
}

export interface LedgerPutInput {
  payload: string;
  annotations?: Annotations;
  /** Lifetime in seconds (Arkiv: blocks-to-live). Omit for no expiry. */
  expiresIn?: number;
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
}

// ───────────────────────────── Personhood (modelled on World ID IDKit) ─────────────────────────────

export const verificationLevels = ['orb', 'device', 'document', 'secure_document'] as const;
export type VerificationLevel = (typeof verificationLevels)[number];

/** Shape of IDKit's success result, as posted by the widget. */
export interface PersonhoodProof {
  proof: Hex;
  merkle_root: Hex;
  nullifier_hash: Hex;
  verification_level: VerificationLevel;
}

export interface PersonhoodContext {
  /** Action id from the developer portal; the nullifier is unique per (user, action). */
  action: string;
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

export interface PaymentResource {
  url: string;
  description: string;
  mimeType: string;
}

export interface PaymentRequirements {
  scheme: 'exact';
  /** CAIP-2 network id, e.g. `eip155:31337`. */
  network: string;
  /** Token contract address (or native marker) the payment is denominated in. */
  asset: string;
  /** Amount in the asset's base units, as a decimal string. */
  amount: string;
  payTo: Address;
  maxTimeoutSeconds: number;
  extra?: Record<string, unknown>;
}

/** Body of a 402 response; also base64-encoded into the PAYMENT-REQUIRED header. */
export interface PaymentRequired {
  x402Version: 2;
  resource: PaymentResource;
  accepts: PaymentRequirements[];
  error?: string;
}

export interface PaymentAuthorization {
  from: Address;
  to: Address;
  value: string;
  /** unix seconds */
  validAfter: number;
  /** unix seconds */
  validBefore: number;
  nonce: Hex;
}

/** Decoded PAYMENT-SIGNATURE header sent by the client. */
export interface PaymentPayload {
  x402Version: 2;
  accepted: PaymentRequirements;
  payload: {
    signature: Hex;
    authorization: PaymentAuthorization;
  };
}

export interface PaymentRequirementInput {
  amount: string;
  asset: string;
  payTo: Address;
  network: string;
  resource: PaymentResource;
  maxTimeoutSeconds?: number;
  extra?: Record<string, unknown>;
}

export type VerifyResult =
  { isValid: true; payer: Address } | { isValid: false; invalidReason: string };

export type SettleResult =
  | { success: true; transaction: Hex; network: string; payer: Address }
  | { success: false; errorReason: string; network: string };

export interface PaymentRail {
  createPaymentRequirement(input: PaymentRequirementInput): PaymentRequired;
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

// ───────────────────────────── Bundle ─────────────────────────────

export interface Adapters {
  mode: AdapterMode;
  ledger: Ledger;
  personhood: Personhood;
  payments: PaymentRail;
  inference: Inference;
  names: NameResolver;
}

export type AdapterName = Exclude<keyof Adapters, 'mode'>;
