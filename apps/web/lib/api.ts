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
  deliveryResponseSchema,
  cardPreviewSchema,
  catalogResponseSchema,
  challengeSchema,
  entitledResponseSchema,
  errorBodySchema,
  giftReclaimResponseSchema,
  meResponseSchema,
  planCancelResponseSchema,
  plansResponseSchema,
  receiptsResponseSchema,
  rpContextSchema,
  sponsorViewSchema,
  sponsorTicketsResponseSchema,
  type AgentPolicyPut,
  type ChallengeWire,
  type PlanCancelRequest,
  type SponsorTicketsRequest,
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

const ERROR_STATUSES = [400, 401, 402, 403, 404, 409, 410, 423, 429, 500, 502, 503];

/**
 * The entitling routes (/claim, /card/redeem, /gift/claim and the paid settlements) answer only after the API's own
 * step budgets have run: DataDrop read + simulate + send ≤ 60 s (viem http 10 s × retry 1, 20 s send) plus the receipt
 * wait (seconds on Hedera/Base, capped at 180 s), the reseller order (≤ 30 s of status polls, 10 s per call) and the
 * ledger and HCS writes. A live Orb claim answered 202 after 64.5 s and the former 30 s client timeout rendered it as
 * "check your connection" (RT-W-13). 180 s covers the sum of the nominal budgets with margin; past it the sheet says
 * the claim may have gone through (the API never serves the same human twice).
 */
export const ENTITLE_TIMEOUT_MS = 180_000;

const isErrorCode = (value: unknown): value is ErrorCode =>
  typeof value === 'string' && value in ERROR_CODES;

export const requestId = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : // nosemgrep: recharge-math-random-for-secrets — a log correlation id fallback (no randomUUID), never a secret or nonce
      `rq-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

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
  /** Default 30 s (a cheap call); the entitling routes pass ENTITLE_TIMEOUT_MS. */
  timeoutMs?: number;
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
      timeoutMs: opts.timeoutMs ?? 30_000,
    });
    if (res.status >= 400 && !accept.includes(res.status))
      throw toApiError(res.status, res.data, res.headers);
    const data = opts.schema && res.status < 300 ? opts.schema.parse(res.data) : (res.data as T);
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
  catalog: async (country: string) =>
    (await call(`/catalog?country=${enc(country)}`, { schema: catalogResponseSchema })).data,
  /** `campaignId`: that registered campaign instead of the default one (claim by ENS name, /c/<slug>). */
  plans: async (campaignId?: string) =>
    (
      await call(campaignId ? `/plans?campaign=${campaignId}` : '/plans', {
        schema: plansResponseSchema,
      })
    ).data,
  challenge: async (path: ChallengePath, sessionPubKey: Hex): Promise<ChallengeWire> =>
    (
      await call('/challenge', {
        body: { audience: 'recharge', path, sessionPubKey },
        schema: challengeSchema,
      })
    ).data,
  rpContext: async (path: ChallengePath) =>
    (
      await call('/world/rp-context', {
        body: { audience: 'recharge', path },
        schema: rpContextSchema,
      })
    ).data,
  /** A valid pass discloses the campaign's facts as `plans` (shaped like /plans, which in live carries none). */
  previewTicket: async (
    body: { campaignId: Hex; ticketPass: Hex; sessionPubKey: Hex; eventNoticeVersion?: 1 },
    recoveryToken: string,
  ) => {
    const { data } = await call<{ valid: true; campaignId: Hex; plans: unknown }>(
      '/ticket/preview',
      { body, headers: { 'Idempotency-Key': recoveryToken } },
    );
    return { ...data, plans: plansResponseSchema.parse(data.plans) };
  },
  claim: (
    body: {
      proof: unknown;
      campaignId: Hex;
      challenge: ChallengeWire;
      sessionPubKey: Hex;
      ticketPass?: Hex;
      eventNoticeVersion?: 1;
    },
    recoveryToken?: string,
  ) =>
    call('/claim', {
      body,
      ...(recoveryToken ? { headers: { 'Idempotency-Key': recoveryToken } } : {}),
      schema: entitledResponseSchema,
      timeoutMs: ENTITLE_TIMEOUT_MS,
    }),
  me: async (key: string, refresh = false) =>
    (await call(`/me/${enc(key)}${refresh ? '?refresh=1' : ''}`, { schema: meResponseSchema }))
      .data,
  delivery: async (key: string, sessionPubKey: Hex) =>
    (
      await call(`/me/${enc(key)}/delivery`, {
        body: { sessionPubKey },
        schema: deliveryResponseSchema,
      })
    ).data,
  receipts: async (key: string) =>
    (await call(`/me/${enc(key)}/receipts`, { schema: receiptsResponseSchema })).data.receipts,
  card: async (serial: string) =>
    (await call(`/card/${enc(serial)}`, { schema: cardPreviewSchema })).data,
  redeemCard: (
    body: { pin: string; challenge: ChallengeWire; sessionPubKey: Hex },
    recoveryToken?: string,
  ) =>
    call('/card/redeem', {
      body,
      ...(recoveryToken ? { headers: { 'Idempotency-Key': recoveryToken } } : {}),
      schema: entitledResponseSchema,
      timeoutMs: ENTITLE_TIMEOUT_MS,
    }),
  /** The quote: 402 = the name resolves and the price is known; 404 name_unresolved before any 402 (T-43). */
  giftQuote: (name: string, mb: number) => call('/gift', { body: { name, mb }, accept: [402] }),
  giftClaim: (body: Record<string, unknown>, recoveryToken?: string) =>
    call('/gift/claim', {
      body,
      ...(recoveryToken ? { headers: { 'Idempotency-Key': recoveryToken } } : {}),
      schema: entitledResponseSchema,
      timeoutMs: ENTITLE_TIMEOUT_MS,
    }),
  giftReclaim: (body: Record<string, unknown>) =>
    call('/gift/reclaim', { body, schema: giftReclaimResponseSchema }),
  /** 200 refunded, 202 cancelled with the refund pending (`refund.tx` absent). */
  planCancel: async (body: PlanCancelRequest) =>
    (await call('/plan/cancel', { body, schema: planCancelResponseSchema })).data,
  agentPolicy: async (key: string) =>
    (await call(`/agent/policy/${enc(key)}`, { schema: agentPolicyViewSchema })).data,
  putAgentPolicy: async (body: AgentPolicyPut) =>
    (await call('/agent/policy', { method: 'PUT', body, schema: agentPolicyViewSchema })).data,
  validateSponsor: async (campaign: unknown): Promise<void> => {
    const response = await call<{ valid?: boolean }>('/sponsor/validate', {
      method: 'POST',
      body: { campaign },
    });
    if (response.data?.valid !== true)
      throw new ApiError(502, 'internal_error', 'Sponsor validation did not complete.');
  },
  registerSponsor: async (body: unknown) =>
    (await call<{ id: string; auditKey: string }>('/sponsor', { body })).data,
  issueSponsorTickets: async (id: string, body: SponsorTicketsRequest) =>
    (await call(`/sponsor/${enc(id)}/tickets`, { body, schema: sponsorTicketsResponseSchema }))
      .data,
  sponsorTickets: async (
    id: string,
    login: { sponsor: string; issuedAt: number; signature: Hex },
  ) =>
    (
      await call<{
        campaignId: string;
        tickets: { reference: string; issuedAt: number; status: 'issued' | 'reserved' }[];
      }>(`/sponsor/${enc(id)}/tickets`, {
        headers: { authorization: `${SPONSOR_AUTH_SCHEME} ${btoa(JSON.stringify(login))}` },
      })
    ).data,
  sponsor: async (id: string, login: { sponsor: string; issuedAt: number; signature: Hex }) =>
    (
      await call(`/sponsor/${enc(id)}`, {
        headers: { authorization: `${SPONSOR_AUTH_SCHEME} ${btoa(JSON.stringify(login))}` },
        schema: sponsorViewSchema,
      })
    ).data,
};
