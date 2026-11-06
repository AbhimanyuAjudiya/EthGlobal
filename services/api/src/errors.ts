/**
 * The one place that turns a failure into an HTTP response (ARCHITECTURE §9, brief §3 `errors`): Decision.deny,
 * RechargeError, AdapterError (via ADAPTER_CODE_MAP), DataDrop reverts, zod errors, Hono HTTP exceptions; anything
 * else is a 500 `internal_error` with the request id only. Messages are built here from the code, never echoed
 * from an adapter or a vendor (AP21).
 */
import { HTTPException } from 'hono/http-exception';
import { ZodError } from 'zod';

import { isAdapterError } from '@ethglobal/adapters';
import type { DenyReason } from '@ethglobal/octroi';
import {
  ADAPTER_CODE_MAP,
  ERROR_CODES,
  RechargeError,
  type ErrorCode,
} from '@ethglobal/protocol/errors';

import { ChainRevert, ChainUnavailable } from './chain.js';

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** INTERFACES §7 "Decision → HTTP". */
export const DENY_CODES: Readonly<Record<DenyReason, ErrorCode>> = {
  replay: 'replay',
  paused: 'campaign_paused',
  cap: 'hourly_cap',
  budget: 'budget_exhausted',
  'invalid-proof': 'invalid_proof',
  'invalid-payment': 'invalid_payment',
  expired: 'campaign_expired',
  'no-campaign': 'not_found',
  'ledger-unavailable': 'ledger_unavailable',
  'invalid-request': 'invalid_request',
};

/** DataDrop custom errors → codes (brief §3); anything else is a retryable chain failure. */
export const REVERT_CODES: Readonly<Record<string, ErrorCode>> = {
  AlreadyClaimed: 'already_claimed',
  HourlyCap: 'hourly_cap',
  CampaignPaused: 'campaign_paused',
  CampaignExpired: 'campaign_expired',
  BudgetExhausted: 'budget_exhausted',
  CampaignExists: 'campaign_exists',
};

const MESSAGES: Readonly<Record<ErrorCode, string>> = {
  invalid_request: 'The request is malformed.',
  invalid_proof: 'The proof or challenge was not accepted.',
  unauthorized: 'The signature or credential was not accepted.',
  pass_required: 'The agent needs an armed World ID Agent Pass for this policy.',
  ticket_required: 'An organizer-issued ticket pass is required for this campaign.',
  ticket_invalid: 'That ticket pass is not valid for this campaign.',
  ticket_used: 'That ticket pass is already reserved for another claim.',
  payment_required: 'Payment is required.',
  invalid_payment: 'The payment was not accepted.',
  settlement_failed: 'The payment could not be settled.',
  not_found: 'Not found.',
  name_unresolved: 'That name does not resolve to an address.',
  replay: 'This was already used.',
  already_claimed: 'Already claimed.',
  campaign_exists: 'That campaign already exists.',
  budget_exhausted: 'The sponsor budget is used up.',
  campaign_expired: 'The campaign has ended.',
  expired: 'This has expired.',
  campaign_paused: 'The campaign is paused.',
  hourly_cap: 'This hour’s free bundles are gone; try next hour or pay.',
  daily_cap: 'Daily limit reached.',
  rate_limited: 'Too many requests; slow down.',
  provisioning_pending: 'The profile is still being provisioned.',
  ledger_unavailable: 'The ledger is unavailable; try again shortly.',
  reseller_unavailable: 'The eSIM provider is unavailable; try again shortly.',
  facilitator_unavailable: 'The payment facilitator is unavailable; try again shortly.',
  chain_unavailable: 'The chain is unavailable; try again shortly.',
  idp_unavailable: 'World ID is unavailable; try again shortly.',
  internal_error: 'Internal error.',
};

/** Which code an adapter's `unavailable`/`timeout` becomes depends on the adapter (ARCHITECTURE §9). */
const UNAVAILABLE_BY_ADAPTER: Readonly<Record<string, ErrorCode>> = {
  ledger: 'ledger_unavailable',
  reseller: 'reseller_unavailable',
  payments: 'facilitator_unavailable',
  treasury: 'chain_unavailable',
  consensus: 'ledger_unavailable',
  blobs: 'ledger_unavailable',
};

export interface ErrorResponse {
  status: number;
  code: ErrorCode;
  details?: unknown;
  retryAfterS?: number;
}

/** A Decision.deny as a throwable error (routes throw; only this module answers). */
export function denyError(reason: DenyReason, detail?: string): RechargeError {
  // An expired challenge is a 410: the human must fetch a new one (AP2.3); the proof itself was not judged.
  if (reason === 'invalid-proof' && detail === 'challenge_expired')
    return new RechargeError('expired', 'expired', { detail });
  const code = DENY_CODES[reason];
  return new RechargeError(
    code,
    code,
    detail === undefined ? undefined : { detail },
    ERROR_CODES[code] >= 500,
  );
}

export const fail = (code: ErrorCode, details?: unknown): RechargeError =>
  new RechargeError(code, code, details, ERROR_CODES[code] >= 500);

function classify(error: unknown): ErrorResponse {
  if (error instanceof RechargeError) {
    return {
      status: error.status,
      code: error.code,
      ...(error.details === undefined ? {} : { details: error.details }),
    };
  }
  if (isAdapterError(error)) {
    const unavailable = error.code === 'unavailable' || (error.code as string) === 'timeout';
    const code = unavailable
      ? (UNAVAILABLE_BY_ADAPTER[error.adapter] ?? 'internal_error')
      : (ADAPTER_CODE_MAP[error.code] ?? 'internal_error');
    return { status: ERROR_CODES[code], code };
  }
  if (error instanceof ChainRevert) {
    const code = REVERT_CODES[error.errorName] ?? 'chain_unavailable';
    return { status: ERROR_CODES[code], code, details: { revert: error.errorName } };
  }
  if (error instanceof ChainUnavailable) return { status: 503, code: 'chain_unavailable' };
  if (error instanceof ZodError) {
    return {
      status: 400,
      code: 'invalid_request',
      details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }
  if (error instanceof HTTPException) {
    // 413 (body limit) keeps its status; the code table has no 413 so the body says invalid_request.
    return {
      status: error.status,
      code: error.status === 429 ? 'rate_limited' : 'invalid_request',
    };
  }
  return { status: 500, code: 'internal_error' };
}

export function toErrorResponse(error: unknown): ErrorResponse & { message: string } {
  const classified = classify(error);
  const retryAfterS =
    classified.code === 'rate_limited' ||
    classified.code === 'hourly_cap' ||
    classified.code === 'daily_cap'
      ? (retryAfterOf(error) ?? 60)
      : classified.status >= 500 && classified.code !== 'internal_error'
        ? 5
        : undefined;
  return {
    ...classified,
    message: MESSAGES[classified.code],
    ...(retryAfterS === undefined ? {} : { retryAfterS }),
  };
}

function retryAfterOf(error: unknown): number | undefined {
  if (
    error instanceof RechargeError &&
    typeof error.details === 'object' &&
    error.details !== null
  ) {
    const value = (error.details as { retryAfterS?: unknown }).retryAfterS;
    if (typeof value === 'number') return value;
  }
  return undefined;
}

/** The JSON body of every non-2xx response (errorBodySchema). */
export function errorBody(error: unknown, requestId: string | undefined) {
  const r = toErrorResponse(error);
  const body = {
    error: r.code,
    message: r.message,
    ...(r.details === undefined ? {} : { details: r.details }),
    ...(requestId === undefined ? {} : { requestId }),
  };
  return { status: r.status, body, retryAfterS: r.retryAfterS };
}

/** Writes the error response (the only `c.json` of an error body in the service). */
export function respondError(c: Context, error: unknown, requestId: string | undefined): Response {
  const { status, body, retryAfterS } = errorBody(error, requestId);
  if (retryAfterS !== undefined) c.header('Retry-After', String(retryAfterS));
  return c.json(body, status as ContentfulStatusCode);
}
