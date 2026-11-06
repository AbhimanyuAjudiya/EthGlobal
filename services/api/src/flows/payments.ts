/** Validated paid operations, sealed in STATE_FILE before the engine consumes a settlement. */
import { createMiddleware } from 'hono/factory';

import { sha256Hex } from '@ethglobal/crypto';
import type { Decision, Entitlement } from '@ethglobal/octroi';
import { RECEIPT_TTL_S } from '@ethglobal/protocol/ids';
import { isEvmExact } from '@ethglobal/protocol/schemas';
import { canonicalJson } from '@ethglobal/protocol/typed-data';
import { PAYMENT_RESPONSE_HEADER } from '@ethglobal/protocol/x402';

import { fail } from '../errors.js';

import type { AppEnv, Ctx } from '../context.js';
import type { Deps } from '../deps.js';

export type PaidDecision = Extract<Decision, { kind: 'serve-paid' }>;
export interface PaidOperation {
  decision: PaidDecision;
  expiresAt: number;
  targetKey?: string;
  targetEntitlement?: Entitlement;
  input?: unknown;
  completed?: { status: number; body: string; paymentResponse?: string };
}
export interface TopUpIntent {
  key: string;
  mb: number;
  targetMb: number;
  expiresAt: number;
  vendorDone?: boolean;
}

/** Ignore optional descriptive payment metadata; the accepted offer and signed authorization are binding. */
export async function paymentFingerprint(c: Ctx): Promise<string | undefined> {
  const payment = c.get('payment');
  if (!payment) return undefined;
  const url = new URL(c.req.url);
  url.searchParams.sort();
  return sha256Hex(
    canonicalJson({
      method: c.req.method,
      path: url.pathname,
      query: url.searchParams.toString(),
      body: c.req.method === 'GET' ? '' : await c.req.text(),
      sessionPubKey: c.get('sessionPubKey') ?? '',
      recoveryKey: c.req.header('idempotency-key') ?? '',
      payment: { accepted: payment.accepted, payload: payment.payload },
    }),
  );
}

export function rememberPaid(
  deps: Deps,
  fingerprint: string,
  decision: PaidDecision,
  details: Pick<PaidOperation, 'targetKey' | 'targetEntitlement' | 'input'> = {},
): void {
  const settlement = decision.settlement;
  for (const [other, operation] of deps.paidOperations.entries()) {
    const previous = operation.decision.settlement;
    if (
      previous.network === settlement.network &&
      previous.transaction === settlement.transaction
    ) {
      if (other !== fingerprint)
        throw fail('invalid_payment', { detail: 'payment belongs to another operation' });
      return;
    }
  }
  const expiresAt = deps.now() + RECEIPT_TTL_S * 1000;
  deps.paidOperations.set(fingerprint, { decision, expiresAt, ...details }, expiresAt);
}

export function paidReplay(c: Ctx, operation: PaidOperation): Response | undefined {
  const done = operation.completed;
  if (!done) return undefined;
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'idempotent-replay': 'true',
  };
  if (done.paymentResponse) headers[PAYMENT_RESPONSE_HEADER] = done.paymentResponse;
  return c.body(done.body, done.status as 200, headers);
}

export async function completePaid(c: Ctx, fingerprint: string): Promise<void> {
  if (c.res.status < 200 || c.res.status >= 300) return;
  const deps = c.get('deps');
  const operation = deps.paidOperations.get(fingerprint);
  if (!operation) return;
  const paymentResponse = c.res.headers.get(PAYMENT_RESPONSE_HEADER);
  deps.paidOperations.set(
    fingerprint,
    {
      ...operation,
      completed: {
        status: c.res.status,
        body: await c.res.clone().text(),
        ...(paymentResponse === null ? {} : { paymentResponse }),
      },
    },
    operation.expiresAt,
  );
}

/** Exact retries, including after authorization expiry, resume the already verified durable operation. */
export const paidRecovery = createMiddleware<AppEnv>(async (c, next) => {
  const fingerprint = await paymentFingerprint(c);
  const payment = c.get('payment');
  if (!fingerprint || !payment) return next();
  const identity = isEvmExact(payment.payload)
    ? `${payment.accepted.network}:${payment.payload.authorization.from.toLowerCase()}:${payment.payload.authorization.nonce.toLowerCase()}`
    : `${payment.accepted.network}:${sha256Hex(payment.payload.transaction)}`;
  return c.get('deps').mutex.run(`payment:${identity}`, async () => {
    const previous = c.get('deps').paidOperations.get(fingerprint);
    if (previous) {
      const response = paidReplay(c, previous);
      if (response) return response;
      c.set('paidOperation', previous);
      if (previous.input !== undefined) c.set('input', previous.input);
    }
    await next();
    await completePaid(c, fingerprint);
  });
});
