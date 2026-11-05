/** The one error-code table (INTERFACES §1.9). `services/api/src/errors.ts` is the only mapper to HTTP. */
export const ERROR_CODES = {
  invalid_request: 400,
  invalid_proof: 401,
  unauthorized: 401,
  /** The agent policy has no armed World ID Agent Pass (docs/WORLD_AGENT_PASS.md); refused before any 402. */
  pass_required: 403,
  payment_required: 402,
  invalid_payment: 402,
  settlement_failed: 402,
  not_found: 404,
  name_unresolved: 404,
  replay: 409,
  already_claimed: 409,
  campaign_exists: 409,
  budget_exhausted: 409,
  campaign_expired: 410,
  expired: 410,
  campaign_paused: 423,
  hourly_cap: 429,
  daily_cap: 429,
  rate_limited: 429,
  provisioning_pending: 202,
  ledger_unavailable: 503,
  reseller_unavailable: 503,
  facilitator_unavailable: 503,
  chain_unavailable: 503,
  /** World IdP (auth.world.org) did not answer or refused the client: the pass attempt did not start. */
  idp_unavailable: 503,
  internal_error: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

export const isErrorCode = (value: string): value is ErrorCode => Object.hasOwn(ERROR_CODES, value);

/** Thrown by protocol, octroi (malformed input only) and services; `code` is stable and safe to branch on. */
export class RechargeError extends Error {
  override readonly name = 'RechargeError';

  constructor(
    readonly code: ErrorCode,
    message: string = code,
    readonly details?: unknown,
    readonly retryable = false,
  ) {
    super(message);
  }

  get status(): number {
    return ERROR_CODES[this.code];
  }
}

const identity = Object.fromEntries(Object.keys(ERROR_CODES).map((code) => [code, code])) as Record<
  ErrorCode,
  ErrorCode
>;

/**
 * Adapter codes (`AdapterError.code`, ARCHITECTURE §9) → ErrorCode. One table; services/api/src/errors.ts
 * applies it. Every protocol code maps to itself so an adapter may also throw a protocol code directly.
 */
export const ADAPTER_CODE_MAP: Readonly<Record<string, ErrorCode>> = Object.freeze({
  ...identity,
  already_verified: 'replay',
  invalid_proof: 'invalid_proof',
  invalid_action: 'internal_error',
  invalid_response: 'reseller_unavailable',
  nonce_already_used: 'invalid_payment',
  requirements_mismatch: 'invalid_payment',
  insufficient_amount: 'invalid_payment',
  recipient_mismatch: 'invalid_payment',
  invalid_signature: 'invalid_payment',
  unsupported_scheme: 'invalid_payment',
  not_yet_valid: 'invalid_payment',
  expired: 'invalid_payment',
  invalid_amount: 'invalid_request',
  unavailable: 'ledger_unavailable',
  timeout: 'ledger_unavailable',
  rate_limited: 'rate_limited',
  invalid_expiry: 'internal_error',
  invalid_name: 'invalid_request',
  too_large: 'invalid_request',
  unsupported_network: 'invalid_request',
  fixture_miss: 'internal_error',
  not_implemented: 'internal_error',
  /** Ledger create-if-absent / compare-and-swap lost (A-32): the other writer won. */
  conflict: 'replay',
});
