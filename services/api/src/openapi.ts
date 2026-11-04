/**
 * GET /openapi.json: OpenAPI 3.1 generated from the SAME zod schemas the routes validate with
 * (`@ethglobal/protocol/schemas`; INTERFACES §8 rule 1 — one source of truth), via zod 4's own `z.toJSONSchema`
 * (JSON Schema 2020-12 = OpenAPI 3.1's dialect). `pnpm openapi` writes services/api/openapi.json; a test asserts
 * the committed file equals this document and that every operation here is a route of the app.
 */
import { z } from 'zod';

import {
  agentPolicyPutSchema,
  agentPolicyViewSchema,
  cardPreviewSchema,
  cardRedeemRequestSchema,
  challengeRequestSchema,
  challengeSchema,
  claimRequestSchema,
  entitledResponseSchema,
  errorBodySchema,
  giftClaimRequestSchema,
  giftReclaimRequestSchema,
  giftReclaimResponseSchema,
  giftRequestSchema,
  giftResponseSchema,
  healthSchema,
  meResponseSchema,
  paymentRequiredSchema,
  plansResponseSchema,
  provisionQuerySchema,
  receiptsResponseSchema,
  rpContextRequestSchema,
  rpContextSchema,
  settleResultSchema,
  sponsorRegisterSchema,
  sponsorViewSchema,
  supportedResponseSchema,
  topUpQuerySchema,
  topUpResponseSchema,
  verifyResultSchema,
} from '@ethglobal/protocol/schemas';

import { facilitatorRequestSchema } from './routes/facilitator.js';

type Method = 'get' | 'post' | 'put';
interface Operation {
  method: Method;
  path: string;
  summary: string;
  body?: z.ZodType;
  query?: z.ZodObject;
  params?: string[];
  headers?: string[];
  responses: Record<number, z.ZodType | null>;
}

const registered = z.object({ id: z.string(), auditKey: z.string() });

/** Every route of INTERFACES §7 (+ A-10, A-15, A-17, A-25). */
export const OPERATIONS: readonly Operation[] = [
  {
    method: 'get',
    path: '/healthz',
    summary: 'Liveness and chain id',
    responses: { 200: healthSchema, 503: healthSchema },
  },
  {
    method: 'get',
    path: '/plans',
    summary: 'Campaign, paid terms and gift sizes (cached 60 s)',
    responses: { 200: plansResponseSchema },
  },
  {
    method: 'post',
    path: '/challenge',
    summary: 'MAC-bound one-shot challenge (no ledger write)',
    body: challengeRequestSchema,
    responses: { 200: challengeSchema, 400: errorBodySchema, 429: errorBodySchema },
  },
  {
    method: 'post',
    path: '/world/rp-context',
    summary: 'Backend-signed IDKit 4 rp_context',
    body: rpContextRequestSchema,
    responses: { 200: rpContextSchema, 429: errorBodySchema },
  },
  {
    method: 'post',
    path: '/claim',
    summary: 'Free welcome bundle for a verified human',
    body: claimRequestSchema,
    responses: {
      201: entitledResponseSchema,
      202: entitledResponseSchema,
      401: errorBodySchema,
      402: paymentRequiredSchema,
      409: errorBodySchema,
      423: errorBodySchema,
      429: errorBodySchema,
      503: errorBodySchema,
    },
  },
  {
    method: 'get',
    path: '/esim/provision',
    summary: 'Paid eSIM bundle (x402); EIP-3009 nonce = keccak256(X-Session-Pubkey)',
    query: provisionQuerySchema,
    headers: ['PAYMENT-SIGNATURE', 'X-Session-Pubkey'],
    responses: { 201: entitledResponseSchema, 400: errorBodySchema, 402: paymentRequiredSchema },
  },
  {
    method: 'get',
    path: '/esim/topup',
    summary: 'Paid top-up of a live entitlement (x402)',
    query: topUpQuerySchema,
    headers: ['PAYMENT-SIGNATURE', 'X-Agent-Uaid'],
    responses: {
      200: topUpResponseSchema,
      402: paymentRequiredSchema,
      404: errorBodySchema,
      410: errorBodySchema,
      429: errorBodySchema,
    },
  },
  {
    method: 'post',
    path: '/gift',
    summary: 'Gift data to an ENS name (x402; the name resolves before any 402)',
    body: giftRequestSchema,
    headers: ['PAYMENT-SIGNATURE', 'Idempotency-Key'],
    responses: { 201: giftResponseSchema, 402: paymentRequiredSchema, 404: errorBodySchema },
  },
  {
    method: 'post',
    path: '/gift/claim',
    summary: 'Claim a gift by EIP-712 GiftClaim or PIN',
    body: giftClaimRequestSchema,
    headers: ['Idempotency-Key'],
    responses: {
      201: entitledResponseSchema,
      401: errorBodySchema,
      409: errorBodySchema,
      410: errorBodySchema,
    },
  },
  {
    method: 'post',
    path: '/gift/reclaim',
    summary: 'Reclaim a lapsed gift (EIP-712 GiftReclaim by the payer)',
    body: giftReclaimRequestSchema,
    headers: ['Idempotency-Key'],
    responses: {
      200: giftReclaimResponseSchema,
      401: errorBodySchema,
      404: errorBodySchema,
      409: errorBodySchema,
      410: errorBodySchema,
      503: errorBodySchema,
    },
  },
  {
    method: 'get',
    path: '/card/{serial}',
    summary: 'Scratch-card preview (read-only)',
    params: ['serial'],
    responses: { 200: cardPreviewSchema, 404: errorBodySchema },
  },
  {
    method: 'post',
    path: '/card/redeem',
    summary: 'Redeem a scratch card by PIN',
    body: cardRedeemRequestSchema,
    headers: ['Idempotency-Key'],
    responses: {
      201: entitledResponseSchema,
      401: errorBodySchema,
      410: errorBodySchema,
      429: errorBodySchema,
    },
  },
  {
    method: 'post',
    path: '/webhooks/reseller/{provider}',
    summary: 'Reseller usage webhook (raw body; mock HMAC or eSIM Access URL token)',
    params: ['provider'],
    responses: { 204: null, 400: errorBodySchema, 401: errorBodySchema, 409: errorBodySchema },
  },
  {
    method: 'get',
    path: '/me/{key}',
    summary: 'Entitlement (60-s cache; ?refresh=1 polls usage)',
    params: ['key'],
    responses: { 200: meResponseSchema, 404: errorBodySchema, 410: errorBodySchema },
  },
  {
    method: 'get',
    path: '/me/{key}/receipts',
    summary: 'Receipts of an entitlement',
    params: ['key'],
    responses: { 200: receiptsResponseSchema },
  },
  {
    method: 'post',
    path: '/sponsor',
    summary: 'Register a campaign once (EIP-712 SponsorLogin); a registered id is 409 campaign_exists',
    body: sponsorRegisterSchema,
    headers: ['Idempotency-Key'],
    responses: {
      201: registered,
      401: errorBodySchema,
      404: errorBodySchema,
      409: errorBodySchema,
    },
  },
  {
    method: 'get',
    path: '/sponsor/{id}',
    summary: 'Sponsor dashboard (Authorization: Recharge-Sponsor …)',
    params: ['id'],
    headers: ['Authorization'],
    responses: { 200: sponsorViewSchema, 401: errorBodySchema },
  },
  {
    method: 'put',
    path: '/agent/policy',
    summary: 'Set the agent top-up policy (EIP-712 AgentPolicy)',
    body: agentPolicyPutSchema,
    responses: { 200: agentPolicyViewSchema, 401: errorBodySchema, 409: errorBodySchema },
  },
  {
    method: 'get',
    path: '/agent/policy/{key}',
    summary: 'Read the agent policy',
    params: ['key'],
    responses: { 200: agentPolicyViewSchema, 404: errorBodySchema },
  },
  {
    method: 'get',
    path: '/facilitator/supported',
    summary: 'x402 facilitator kinds (self-run, EVM exact)',
    responses: { 200: supportedResponseSchema },
  },
  {
    method: 'post',
    path: '/facilitator/verify',
    summary: 'x402 facilitator verify (our terms, amount ≥ one step)',
    body: facilitatorRequestSchema,
    responses: { 200: verifyResultSchema, 400: errorBodySchema, 429: errorBodySchema },
  },
  {
    method: 'post',
    path: '/facilitator/settle',
    summary: 'x402 facilitator settle (our terms, amount ≥ one step; one relayer tx at a time)',
    body: facilitatorRequestSchema,
    responses: { 200: settleResultSchema, 400: errorBodySchema, 429: errorBodySchema },
  },
  { method: 'get', path: '/openapi.json', summary: 'This document', responses: { 200: null } },
];

interface JsonSchema {
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
}
const json = (schema: z.ZodType, io: 'input' | 'output'): JsonSchema => {
  const { $schema: _s, ...rest } = z.toJSONSchema(schema, {
    target: 'draft-2020-12',
    io,
    unrepresentable: 'any',
  }) as JsonSchema;
  return rest;
};

export function openApiDocument(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const op of OPERATIONS) {
    const query = op.query ? json(op.query, 'input') : {};
    const parameters = [
      ...(op.params ?? []).map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      })),
      ...Object.entries(query.properties ?? {}).map(([name, schema]) => ({
        name,
        in: 'query',
        required: query.required?.includes(name) ?? false,
        schema,
      })),
      ...(op.headers ?? []).map((name) => ({
        name,
        in: 'header',
        required: false,
        schema: { type: 'string' },
      })),
    ];
    const responses = Object.fromEntries(
      Object.entries(op.responses).map(([status, schema]) => [
        status,
        schema === null
          ? { description: status }
          : {
              description: status,
              content: { 'application/json': { schema: json(schema, 'output') } },
            },
      ]),
    );
    paths[op.path] = {
      ...paths[op.path],
      [op.method]: {
        summary: op.summary,
        operationId: `${op.method}${op.path.replace(/[{}]/g, '').replace(/[^A-Za-z0-9]+(.)?/g, (_m, ch: string | undefined) => (ch ?? '').toUpperCase())}`,
        ...(parameters.length === 0 ? {} : { parameters }),
        ...(op.body
          ? {
              requestBody: {
                required: true,
                content: { 'application/json': { schema: json(op.body, 'input') } },
              },
            }
          : {}),
        responses,
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Recharge API',
      version: '0.0.0',
      description: 'services/api — INTERFACES §7. Generated from @ethglobal/protocol/schemas.',
    },
    servers: [{ url: 'http://127.0.0.1:8787' }],
    paths,
  };
}
