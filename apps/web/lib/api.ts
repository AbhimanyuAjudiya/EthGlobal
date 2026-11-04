/**
 * Typed client over `httpJson` and the protocol schemas (INTERFACES §7). Every call sends an X-Request-Id;
 * every non-2xx becomes an `ApiError` carrying the protocol `ErrorCode`, so screens map codes to copy
 * (i18n `error.*`) and never print "Something went wrong".
 */
import { ERROR_CODES, type ErrorCode } from '@ethglobal/protocol/errors';
import { REQUEST_ID_HEADER, SPONSOR_AUTH_SCHEME } from '@ethglobal/protocol/events';
import { httpJson, HttpError } from '@ethglobal/protocol/http';
import type { ChallengePath, Hex } from '@ethglobal/protocol/ids';
import {
  agentPolicyViewSchema,
  cardPreviewSchema,
  challengeSchema,
  entitledResponseSchema,
  errorBodySchema,
  giftReclaimResponseSchema,
  meResponseSchema,
  plansResponseSchema,
  receiptsResponseSchema,
  rpContextSchema,
  sponsorViewSchema,
  type AgentPolicyPut,
  type ChallengeWire,
  type PersonhoodProof,
} from '@ethglobal/protocol/schemas';

import { config } from './env';

import type { z } from 'zod';

export class ApiError extends Error {
  override readonly name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'network',
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
    readonly retryAfterS?: number,
  ) {
    super(message);
  }
}

const ERROR_STATUSES = [400, 401, 402, 404, 409, 410, 423, 429, 500, 502, 503];

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && value in ERROR_CODES;

export const requestId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `rq-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

/** Turns an error body (or a transport failure) into an ApiError. */
export function toApiError(status: number, body: unknown, headers?: Headers): ApiError {
  const parsed = errorBodySchema.safeParse(body);
  const retry = Number(headers?.get('retry-after') ?? '');
  const retryAfterS = Number.isFinite(retry) && retry > 0 ? retry : undefined;
  if (parsed.success) {
    const code = isErrorCode(parsed.data.error) ? parsed.data.error : 'internal_error';
    return new ApiError(
      status,
      code,
      parsed.data.message,
      parsed.data.details,
      parsed.data.requestId,
      retryAfterS,
    );
  }
  return new ApiError(status, status === 0 ? 'network' : 'internal_error', `HTTP ${status}`);
}

interface CallOptions<T> {
  method?: 'GET' | 'POST' | 'PUT';
  body?: unknown;
  headers?: Record<string, string>;
  schema?: z.ZodType<T>;
  /** Statuses returned to the caller instead of thrown (e.g. 402 for a quote). */
  accept?: number[];
}

export async function call<T>(
  path: string,
  opts: CallOptions<T> = {},
): Promise<{ status: number; headers: Headers; data: T }> {
  const accept = opts.accept ?? [];
  try {
    const res = await httpJson<unknown>(`${config.apiUrl}${path}`, {
      method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
      headers: { [REQUEST_ID_HEADER]: requestId(), ...opts.headers },
      ...(opts.body === undefined ? {} : { body: opts.body }),
      allowStatus: [...ERROR_STATUSES, 202, 201, 204],
      timeoutMs: 30_000,
    });
    if (res.status >= 400 && !accept.includes(res.status))
      throw toApiError(res.status, res.data, res.headers);
    const data =
      opts.schema && res.status < 300 ? opts.schema.parse(res.data) : (res.data as T);
    return { status: res.status, headers: res.headers, data };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (error instanceof HttpError) throw toApiError(error.status, error.body);
    throw new ApiError(0, 'network', error instanceof Error ? error.message : 'network');
  }
}

const enc = encodeURIComponent;

export const api = {
  health: () => call('/healthz'),
  plans: async () => (await call('/plans', { schema: plansResponseSchema })).data,
  challenge: async (path: ChallengePath, sessionPubKey: Hex): Promise<ChallengeWire> =>
    (
      await call('/challenge', {
        body: { audience: 'recharge', path, sessionPubKey },
        schema: challengeSchema,
      })
    ).data,
  rpContext: async (path: ChallengePath) =>
    (await call('/world/rp-context', { body: { audience: 'recharge', path }, schema: rpContextSchema }))
      .data,
  /** MODE=local only: the API's simulated IDKit result (never built in the browser). */
  simulatedProof: async (
    signal: Hex,
    level: 'orb' | 'document' | 'device',
    seed: string,
  ): Promise<PersonhoodProof> =>
    (await call<PersonhoodProof>('/__local/world-proof', { body: { signal, level, seed } })).data,
  claim: (body: {
    proof: unknown;
    campaignId: Hex;
    challenge: ChallengeWire;
    sessionPubKey: Hex;
  }) => call('/claim', { body, schema: entitledResponseSchema }),
  me: async (key: string, refresh = false) =>
    (await call(`/me/${enc(key)}${refresh ? '?refresh=1' : ''}`, { schema: meResponseSchema }))
      .data,
  receipts: async (key: string) =>
    (await call(`/me/${enc(key)}/receipts`, { schema: receiptsResponseSchema })).data.receipts,
  card: async (serial: string) =>
    (await call(`/card/${enc(serial)}`, { schema: cardPreviewSchema })).data,
  redeemCard: (body: { pin: string; challenge: ChallengeWire; sessionPubKey: Hex }) =>
    call('/card/redeem', { body, schema: entitledResponseSchema }),
  /** The quote: 402 = the name resolves and the price is known; 404 name_unresolved before any 402 (T-43). */
  giftQuote: (name: string, mb: number) =>
    call('/gift', { body: { name, mb }, accept: [402] }),
  giftClaim: (body: Record<string, unknown>) =>
    call('/gift/claim', { body, schema: entitledResponseSchema }),
  giftReclaim: (body: Record<string, unknown>) =>
    call('/gift/reclaim', { body, schema: giftReclaimResponseSchema }),
  agentPolicy: async (key: string) =>
    (await call(`/agent/policy/${enc(key)}`, { schema: agentPolicyViewSchema })).data,
  putAgentPolicy: async (body: AgentPolicyPut) =>
    (await call('/agent/policy', { method: 'PUT', body, schema: agentPolicyViewSchema })).data,
  registerSponsor: async (body: unknown) =>
    (await call<{ id: string; auditKey: string }>('/sponsor', { body })).data,
  sponsor: async (id: string, login: { sponsor: string; issuedAt: number; signature: Hex }) =>
    (
      await call(`/sponsor/${enc(id)}`, {
        headers: { authorization: `${SPONSOR_AUTH_SCHEME} ${btoa(JSON.stringify(login))}` },
        schema: sponsorViewSchema,
      })
    ).data,
};
