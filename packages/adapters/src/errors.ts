import type { AdapterName } from './types.js';

/**
 * Every code an adapter throws. Each one is a key of protocol's ADAPTER_CODE_MAP (a test enforces it), so the
 * API maps it to an HTTP status without a default branch (wave1-adapters L15).
 */
export const ADAPTER_ERROR_CODES = [
  // closed list of the live adapters (adapters-live brief §3)
  'invalid_proof',
  'already_verified',
  'invalid_response',
  'unavailable',
  'rate_limited',
  'unauthorized',
  'nonce_already_used',
  'requirements_mismatch',
  'insufficient_amount',
  'expired',
  'not_yet_valid',
  'unsupported_scheme',
  'fixture_miss',
  // port semantics shared by mocks and live adapters
  'invalid_request',
  'invalid_expiry',
  'invalid_action',
  'invalid_amount',
  'invalid_name',
  'not_found',
  'too_large',
  'unsupported_network',
  'not_implemented',
  // A-32: a create-if-absent found the key taken, or a compare-and-swap lost
  'conflict',
] as const;
export type AdapterErrorCode = (typeof ADAPTER_ERROR_CODES)[number];

/** Thrown by adapters; `code` is stable and safe to branch on. Messages and details never carry secrets. */
export class AdapterError extends Error {
  override readonly name = 'AdapterError';

  constructor(
    readonly adapter: AdapterName,
    readonly code: AdapterErrorCode,
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
  }
}

export const isAdapterError = (error: unknown): error is AdapterError =>
  error instanceof AdapterError;
