import { hmacSha256, ReplayGuard, sha256Hex, verifyWebhookSignature, bytesToHex } from '@ethglobal/crypto';
import { WEBHOOK_WINDOW_S } from '@ethglobal/protocol/ids';
import {
  LPA_PATTERN,
  MOCK_WEBHOOK_HEADERS,
  mockWebhookEnvelopeSchema,
  webhookCanonical,
} from '@ethglobal/protocol/schemas';

import { AdapterError } from '../errors.js';

import type {
  EsimPlan,
  EsimProfile,
  EsimUsage,
  Reseller,
  UsageEvent,
  WebhookVerdict,
} from '../types.js';

export interface MockResellerOptions {
  now?: () => number;
  /** Simulated usage per minute of the injected clock (default 1 MB/min). */
  usageMbPerMinute?: number;
  plans?: EsimPlan[];
  /** HMAC key of the webhook simulator; default a fixed local test secret. */
  webhookSecret?: Uint8Array;
  /** The next order() throws AdapterError('reseller', 'unavailable') once (T-25, pending-profile). */
  failNextOrder?: boolean;
}

export const MOCK_PLANS: readonly EsimPlan[] = [
  {
    id: 'in-1gb-7d',
    provider: 'mock',
    name: 'India 1 GB · 7 days',
    country: 'IN',
    dataMb: 1000,
    validityDays: 7,
    wholesaleUsd6: 1_140_000n,
  },
  {
    id: 'in-300mb-7d',
    provider: 'mock',
    name: 'India 300 MB · 7 days',
    country: 'IN',
    dataMb: 300,
    validityDays: 7,
    wholesaleUsd6: 342_000n,
  },
];

export const DEFAULT_MOCK_WEBHOOK_SECRET: Uint8Array = hmacSha256(
  new TextEncoder().encode('recharge-local'),
  'mock-reseller-webhook',
);

interface Line {
  profile: EsimProfile;
  totalMb: number;
  orderedAt: number;
  advancedMb: number;
}

const header = (headers: Record<string, string | undefined>, name: string): string | undefined => {
  const hit = Object.entries(headers).find(([k]) => k.toLowerCase() === name);
  return hit?.[1];
};

/**
 * The local reseller (INTERFACES §3.2): deterministic ICCIDs and `LPA:1$local.test$…` codes, one profile per
 * idempotency key (T-40), simulated usage from the injected clock, and a webhook simulator whose deliveries
 * `verifyWebhook` checks exactly as T-34 requires (HMAC over `${timestamp}.${rawBody}`, ±300 s, replay cache).
 */
export class MockReseller implements Reseller {
  readonly name = 'mock' as const;
  readonly #now: () => number;
  readonly #mbPerMinute: number;
  readonly #plans: EsimPlan[];
  readonly #secret: Uint8Array;
  readonly #replay = new ReplayGuard(WEBHOOK_WINDOW_S);
  readonly #orders = new Map<string, EsimProfile>();
  readonly #lines = new Map<string, Line>();
  readonly #topUps = new Map<string, { orderId: string; totalMb: number }>();
  #failNext: boolean;
  #sequence = 0;

  constructor(options: MockResellerOptions = {}) {
    this.#now = options.now ?? Date.now;
    this.#mbPerMinute = options.usageMbPerMinute ?? 1;
    this.#plans = (options.plans ?? MOCK_PLANS).map((p) => ({ ...p }));
    this.#secret = options.webhookSecret ?? DEFAULT_MOCK_WEBHOOK_SECRET;
    this.#failNext = options.failNextOrder ?? false;
  }

  async plans(country: 'IN'): Promise<EsimPlan[]> {
    return this.#plans.filter((p) => p.country === country).map((p) => ({ ...p }));
  }

  async order(planId: string, opts: { idempotencyKey: string }): Promise<EsimProfile> {
    const key = opts.idempotencyKey;
    if (typeof key !== 'string' || key === '' || key.length > 200) {
      throw new AdapterError('reseller', 'invalid_request', 'idempotencyKey is required');
    }
    const existing = this.#orders.get(key);
    if (existing) return { ...existing };
    const plan = this.#plans.find((p) => p.id === planId);
    if (!plan) throw new AdapterError('reseller', 'invalid_request', `unknown plan ${planId}`);
    if (this.#failNext) {
      this.#failNext = false;
      throw new AdapterError('reseller', 'unavailable', 'mock reseller: simulated outage');
    }
    this.#sequence += 1;
    const digest = sha256Hex(`order:${key}`);
    const iccid = `8991${(BigInt(digest) % 10n ** 15n).toString().padStart(15, '0')}`;
    const lpa = `LPA:1$local.test$${digest.slice(2, 18).toUpperCase()}`;
    const profile: EsimProfile = {
      iccid,
      lpa,
      planId,
      provider: 'mock',
      orderId: `mock-order-${String(this.#sequence).padStart(6, '0')}`,
      status: 'ready',
    };
    if (!LPA_PATTERN.test(lpa)) throw new AdapterError('reseller', 'invalid_response', 'bad LPA');
    this.#orders.set(key, profile);
    this.#lines.set(iccid, { profile, totalMb: plan.dataMb, orderedAt: this.#now(), advancedMb: 0 });
    return { ...profile };
  }

  async topUp(
    iccid: string,
    mb: number,
    opts: { idempotencyKey: string },
  ): Promise<{ orderId: string; totalMb: number }> {
    const done = this.#topUps.get(opts.idempotencyKey);
    if (done) return { ...done };
    if (!Number.isSafeInteger(mb) || mb <= 0) {
      throw new AdapterError('reseller', 'invalid_request', 'mb must be a positive integer');
    }
    const line = this.#line(iccid);
    line.totalMb += mb;
    this.#sequence += 1;
    const result = { orderId: `mock-topup-${String(this.#sequence).padStart(6, '0')}`, totalMb: line.totalMb };
    this.#topUps.set(opts.idempotencyKey, result);
    return { ...result };
  }

  async usage(iccid: string): Promise<EsimUsage> {
    const line = this.#line(iccid);
    const now = this.#now();
    const simulated = Math.floor(((now - line.orderedAt) / 60_000) * this.#mbPerMinute);
    const usedMb = Math.min(line.totalMb, Math.max(0, simulated) + line.advancedMb);
    const status: EsimProfile['status'] =
      usedMb >= line.totalMb ? 'expired' : usedMb > 0 ? 'active' : 'ready';
    return { iccid, usedMb, totalMb: line.totalMb, asOf: now, status };
  }

  /** Adds `mb` of simulated usage to a line (the demo's "use some data" button). */
  advanceUsage(iccid: string, mb: number): void {
    if (!Number.isSafeInteger(mb) || mb < 0) {
      throw new AdapterError('reseller', 'invalid_request', 'mb must be a non-negative integer');
    }
    this.#line(iccid).advancedMb += mb;
  }

  /** A delivery as the mock provider would send it: envelope body + `x-recharge-*` headers (INTERFACES §1.7). */
  signedWebhook(events: UsageEvent[], now: number): { body: string; headers: Record<string, string> } {
    const body = JSON.stringify(mockWebhookEnvelopeSchema.parse({ events }));
    const timestamp = Math.floor(now / 1000);
    const signature = bytesToHex(hmacSha256(this.#secret, webhookCanonical(timestamp, body))).slice(2);
    return {
      body,
      headers: {
        [MOCK_WEBHOOK_HEADERS.signature]: signature,
        [MOCK_WEBHOOK_HEADERS.timestamp]: String(timestamp),
        [MOCK_WEBHOOK_HEADERS.eventId]: sha256Hex(body),
      },
    };
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
    now: number,
  ): WebhookVerdict {
    try {
      const signature = header(headers, MOCK_WEBHOOK_HEADERS.signature);
      const timestampText = header(headers, MOCK_WEBHOOK_HEADERS.timestamp);
      const eventId = header(headers, MOCK_WEBHOOK_HEADERS.eventId);
      if (!signature || !timestampText || !eventId) return { ok: false, reason: 'missing_headers' };
      if (!/^\d{1,13}$/.test(timestampText)) return { ok: false, reason: 'skew' };
      const timestamp = Number(timestampText);
      // Seconds only: a millisecond timestamp is ~1.7e12 and is outside any window (T-34).
      if (timestamp > 1e11 || Math.abs(now / 1000 - timestamp) > WEBHOOK_WINDOW_S) {
        return { ok: false, reason: 'skew' };
      }
      const canonical = webhookCanonical(timestamp, rawBody);
      if (!verifyWebhookSignature(this.#secret, canonical, signature, timestamp, now, WEBHOOK_WINDOW_S)) {
        return { ok: false, reason: 'bad_signature' };
      }
      // The header id is not covered by the MAC, so the body hash is the replay key too.
      const bodyId = sha256Hex(rawBody);
      if (!this.#replay.accept(`body:${bodyId}`, now)) return { ok: false, reason: 'replay' };
      if (!this.#replay.accept(`id:${eventId}`, now)) return { ok: false, reason: 'replay' };
      return { ok: true, eventId };
    } catch {
      return { ok: false, reason: 'bad_signature' };
    }
  }

  parseWebhook(rawBody: string): UsageEvent[] {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new AdapterError('reseller', 'invalid_response', 'webhook body is not JSON');
    }
    const parsed = mockWebhookEnvelopeSchema.safeParse(json);
    if (!parsed.success) throw new AdapterError('reseller', 'invalid_response', 'unknown webhook shape');
    if (parsed.data.events.some((e) => e.usedMb > e.totalMb)) {
      throw new AdapterError('reseller', 'invalid_response', 'usedMb exceeds totalMb');
    }
    return parsed.data.events;
  }

  orders(): readonly { idempotencyKey: string; profile: EsimProfile }[] {
    return [...this.#orders].map(([idempotencyKey, profile]) => ({ idempotencyKey, profile: { ...profile } }));
  }

  #line(iccid: string): Line {
    const line = this.#lines.get(iccid);
    if (!line) throw new AdapterError('reseller', 'not_found', 'unknown ICCID');
    return line;
  }
}
