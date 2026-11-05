import { createMiddleware } from 'hono/factory';

import { sha256Hex } from '@ethglobal/crypto';
import { IDEMPOTENCY_KEY_HEADER } from '@ethglobal/protocol/events';
import { PAYMENT_VALIDITY_S } from '@ethglobal/protocol/ids';
import { PAYMENT_RESPONSE_HEADER, PAYMENT_SIGNATURE_HEADER } from '@ethglobal/protocol/x402';

import { bounded } from '../cache.js';
import { fail } from '../errors.js';

import type { AppEnv } from '../context.js';

const DAY_MS = 86_400_000;
const KEY = /^[\x21-\x7E]{1,128}$/;
/** A cached body holding a once-only secret (a sealed LPA, a PIN) lives no longer than a payment (T-74). */
const ONCE_ONLY = /"(sealedLpa|pin)":/;

interface Stored {
  status: number;
  body: string;
  paymentResponse: string | undefined;
  expiresAt: number;
}

/**
 * `Idempotency-Key` on POST (T-74, N9). The cache scope is sha256(route ‖ key ‖ sha256(rawBody) ‖
 * sha256(PAYMENT-SIGNATURE) ‖ clientIp) — never the header alone — so another client with the same key is processed
 * independently. Only 2xx responses are stored. Same client + key + different body ⇒ 409; an in-flight duplicate ⇒
 * 409. The in-flight lock is per CLIENT (route ‖ key ‖ clientIp), not per scope, so two concurrent requests with one
 * key and two bodies are never both processed (RT-A-13). Money paths are also idempotent by their natural keys
 * (payment nonce, nullifier, giftId).
 */
export function idempotency(now: () => number) {
  const done = new Map<string, Stored>();
  /** client → bodyHash of the request holding that client's key right now. */
  const inFlight = new Map<string, string>();
  const bodies = new Map<string, { bodyHash: string; expiresAt: number }>();
  return createMiddleware<AppEnv>(async (c, next) => {
    const key = c.req.header(IDEMPOTENCY_KEY_HEADER);
    if (c.req.method !== 'POST' || key === undefined) return next();
    if (!KEY.test(key)) throw fail('invalid_request', { header: IDEMPOTENCY_KEY_HEADER });
    const raw = await c.req.text();
    const bodyHash = sha256Hex(raw);
    const client = `${c.req.path}\n${key}\n${c.get('clientIp')}`;
    const scope = sha256Hex(
      `${client}\n${bodyHash}\n${sha256Hex(c.req.header(PAYMENT_SIGNATURE_HEADER) ?? '')}`,
    );
    const t = now();
    const previous = bodies.get(client);
    if (previous && previous.expiresAt > t && previous.bodyHash !== bodyHash)
      throw fail('replay', { detail: 'idempotency_key_reused' });
    const hit = done.get(scope);
    if (hit && hit.expiresAt > t) {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        'idempotent-replay': 'true',
      };
      if (hit.paymentResponse !== undefined) headers[PAYMENT_RESPONSE_HEADER] = hit.paymentResponse;
      return c.body(hit.body, hit.status as 200, headers);
    }
    const holder = inFlight.get(client);
    if (holder !== undefined)
      throw fail('replay', {
        detail: holder === bodyHash ? 'in_flight' : 'idempotency_key_reused',
      });
    inFlight.set(client, bodyHash);
    try {
      await next();
      const status = c.res.status;
      if (status >= 200 && status < 300) {
        const body = await c.res.clone().text();
        const ttl = ONCE_ONLY.test(body) ? PAYMENT_VALIDITY_S * 1000 : DAY_MS;
        bounded(done, scope, {
          status,
          body,
          paymentResponse: c.res.headers.get(PAYMENT_RESPONSE_HEADER) ?? undefined,
          expiresAt: t + ttl,
        });
        bounded(bodies, client, { bodyHash, expiresAt: t + DAY_MS });
      }
    } finally {
      inFlight.delete(client);
    }
  });
}
