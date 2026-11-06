/**
 * EsimAccessReseller — the PRIMARY reseller (INTERFACES §3.3; A-27; API-FACTS §5.1, esimaccess-api@b9421b3).
 * Every call: POST {base}/<endpoint>, JSON body, RT-AccessCode / RT-Timestamp (ms) / RT-RequestID (uuid) /
 * RT-Signature = lower-hex HMAC-SHA256(key = signingKey ?? accessCode, timestamp + requestId + accessCode + rawBody),
 * signed over the exact string sent. Webhooks are unsigned: URL token + sender IP + body-hash replay cache, and their
 * numbers are hints only — the API re-reads usage() (T-34, T-82).
 */
import { z } from 'zod';

import {
  bytesToHex,
  hmacSha256,
  ReplayGuard,
  sha256,
  sha256Hex,
  timingSafeEqual,
  utf8,
} from '@ethglobal/crypto';
import { httpJson } from '@ethglobal/protocol/http';
import { WEBHOOK_WINDOW_S } from '@ethglobal/protocol/ids';
import { mbFromBytes } from '@ethglobal/protocol/units';

import { AdapterError, type AdapterErrorCode } from '../errors.js';
import {
  assertIccid,
  assertLpa,
  assertUsage,
  headerValue,
  ICCID_PATTERN,
  safePlanName,
  type ProfileStatus,
} from '../reseller-rules.js';
import { guard } from './errors.js';
import { checkedBaseUrl, joinUrl, withFetch } from './http.js';
import { Pacer } from './rate-limit.js';

import type {
  EsimPlan,
  EsimProfile,
  EsimUsage,
  Reseller,
  UsageEvent,
  WebhookVerdict,
} from '../types.js';

export const ESIMACCESS_BASE_URL = 'https://api.esimaccess.com/api/v1/open';
export const ESIMACCESS_WEBHOOK_IPS = [
  '3.1.131.226',
  '54.254.74.88',
  '18.136.190.97',
  '18.136.60.197',
  '18.136.19.137',
  '52.76.129.149', // observed 2026-11-06: the vendor's save-time test notification (not in the docs' list); founder-approved
];
/** Pseudo-headers the API route sets from `?token=` and the socket address (never trusted from the client, T-82). */
export const WEBHOOK_TOKEN_HEADER = 'x-recharge-url-token';
export const WEBHOOK_IP_HEADER = 'x-recharge-remote-ip';

const PAGER = { pageNum: 1, pageSize: 20 };

const envelope = z
  .object({
    success: z.boolean(),
    errorCode: z.union([z.string(), z.number()]).nullish(),
    errorMsg: z.string().nullish(),
    obj: z.unknown().optional(),
  })
  .loose();
const int = z.number().int().nonnegative();
const packageSchema = z
  .object({
    packageCode: z.string().min(1).max(64),
    name: z.string().max(10_000),
    price: int,
    volume: int,
    duration: int,
    durationUnit: z.string(),
    location: z.string().max(2000).optional(),
    supportTopUpType: z.number().int().optional(),
  })
  .loose();
const packageList = z.object({ packageList: z.array(packageSchema).max(2000) }).loose();
const orderObj = z
  .object({ orderNo: z.string().min(1).max(64), transactionId: z.string().max(64).optional() })
  .loose();
const esimSchema = z
  .object({
    esimTranNo: z.string().max(64),
    orderNo: z.string().max(64).optional(),
    transactionId: z.string().max(64).optional(),
    iccid: z.string().max(32),
    ac: z.string().max(512).optional(),
    smdpStatus: z.string().max(32).optional(),
    esimStatus: z.string().max(32).optional(),
    totalVolume: int.optional(),
    orderUsage: int.optional(),
  })
  .loose();
const esimList = z.object({ esimList: z.array(esimSchema).max(100) }).loose();
const webhookSchema = z
  .object({
    notifyType: z.string().max(32),
    content: z
      .object({
        iccid: z.string().max(32).optional(),
        esimStatus: z.string().optional(),
        smdpStatus: z.string().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

type Esim = z.infer<typeof esimSchema>;

/** smdpStatus / esimStatus → our profile status (API-FACTS §5.1 status model). */
export function esimStatus(e: {
  smdpStatus?: string | undefined;
  esimStatus?: string | undefined;
}): ProfileStatus {
  const s = new Set([e.smdpStatus, e.esimStatus]);
  if (s.has('USED_UP') || s.has('DELETED') || s.has('USED_EXPIRED')) return 'expired';
  if (s.has('IN_USE')) return 'active';
  if (s.has('ENABLED')) return 'installed';
  return 'ready';
}

const ERROR_CODES: Record<string, AdapterErrorCode> = {
  '101003': 'unauthorized', // signature mismatch
  '401001': 'unauthorized',
  '200007': 'unavailable', // insufficient balance: an ops alarm
  '200002': 'invalid_response', // status does not allow the action
  '400001': 'invalid_response', // our request is wrong
  '000105': 'invalid_response',
};

class VendorError extends Error {
  constructor(readonly vendorCode: string) {
    super(`eSIM Access error ${vendorCode}`);
  }
}

export interface EsimAccessResellerOptions {
  accessCode: string;
  /** Defaults to the access code (the official reference keys the HMAC with it, A-27). */
  signingKey?: string;
  webhookToken: string;
  webhookIps?: string[];
  fetch?: typeof fetch;
  baseUrl?: string;
  now: () => number;
  /** Injectable for tests (and to make the 3-s order poll instant there). */
  sleep?: (ms: number) => Promise<void>;
  uuid?: () => string;
  pollMs?: number;
  pollTimeoutMs?: number;
  logger?: Pick<Console, 'warn'>;
}

const unavailable = (message: string, details?: Record<string, unknown>) =>
  new AdapterError('reseller', 'unavailable', message, details);

export class EsimAccessReseller implements Reseller {
  readonly name = 'esimaccess' as const;
  readonly #opts: EsimAccessResellerOptions;
  readonly #base: URL;
  readonly #pacer: Pacer;
  readonly #replay = new ReplayGuard(WEBHOOK_WINDOW_S);
  readonly #ips: ReadonlySet<string>;
  readonly #tokenDigest: Uint8Array;
  readonly #orders = new Map<string, Promise<EsimProfile>>();
  readonly #topUps = new Map<string, Promise<{ orderId: string; totalMb: number }>>();
  readonly #sleep: (ms: number) => Promise<void>;

  constructor(opts: EsimAccessResellerOptions) {
    if (!opts.accessCode) throw new Error('ESIMACCESS_ACCESS_CODE is required');
    if (opts.webhookToken.length < 16)
      throw new Error('ESIMACCESS_WEBHOOK_TOKEN must be at least 16 characters');
    this.#opts = opts;
    this.#base = checkedBaseUrl(opts.baseUrl ?? ESIMACCESS_BASE_URL);
    this.#sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.#pacer = new Pacer(8, opts.now, this.#sleep);
    this.#ips = new Set(opts.webhookIps ?? ESIMACCESS_WEBHOOK_IPS);
    this.#tokenDigest = sha256(opts.webhookToken);
  }

  /** The RT-* headers for one call (exported for the fixture test that recomputes the signature). */
  signHeaders(rawBody: string, timestamp: string, requestId: string): Record<string, string> {
    const { accessCode } = this.#opts;
    const key = utf8(this.#opts.signingKey ?? accessCode);
    const signature = bytesToHex(
      hmacSha256(key, `${timestamp}${requestId}${accessCode}${rawBody}`),
    ).slice(2);
    return {
      'content-type': 'application/json',
      'RT-AccessCode': accessCode,
      'RT-Timestamp': timestamp,
      'RT-RequestID': requestId,
      'RT-Signature': signature,
    };
  }

  async #call<T>(
    endpoint: string,
    body: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    await this.#pacer.acquire();
    const rawBody = JSON.stringify(body); // serialised once: the string signed is the string sent
    const requestId = (this.#opts.uuid ?? (() => crypto.randomUUID()))();
    const headers = this.signHeaders(rawBody, String(this.#opts.now()), requestId);
    const { data } = await guard('reseller', () =>
      httpJson(joinUrl(this.#base, endpoint), {
        method: 'POST',
        rawBody,
        headers,
        ...withFetch(this.#opts.fetch),
        schema: envelope,
      }),
    );
    if (!data.success) {
      const code = String(data.errorCode ?? '');
      if (code === '310402') throw new VendorError(code);
      const mapped = ERROR_CODES[code] ?? 'unavailable';
      if (code === '200007')
        this.#opts.logger?.warn('esimaccess: insufficient balance (200007) — top up the console');
      if (mapped === 'invalid_response')
        this.#opts.logger?.warn(`esimaccess: ${endpoint} refused (${code}), request ${requestId}`);
      throw new AdapterError(
        'reseller',
        mapped,
        `eSIM Access ${endpoint} failed (${code || 'no code'})`,
        {
          vendorCode: code,
          requestId,
        },
      );
    }
    const parsed = schema.safeParse(data.obj);
    if (!parsed.success)
      throw new AdapterError(
        'reseller',
        'invalid_response',
        `eSIM Access ${endpoint}: unexpected shape`,
      );
    return parsed.data;
  }

  async plans(country: 'IN'): Promise<EsimPlan[]> {
    const { packageList: list } = await this.#call(
      '/package/list',
      { locationCode: country, type: '', slug: '', packageCode: '', iccid: '' },
      packageList,
    );
    return list
      .filter(
        (p) =>
          p.durationUnit === 'DAY' && p.duration > 0 && p.price > 0 && mbFromBytes(p.volume) > 0,
      )
      .map((p) => ({
        id: p.packageCode,
        provider: 'esimaccess' as const,
        name: safePlanName(p.name),
        country,
        dataMb: mbFromBytes(p.volume), // bytes → MB (1 GB = 1000 MB, A-1)
        validityDays: p.duration,
        wholesaleUsd6: BigInt(p.price) * 100n, // USD × 10 000 → micro-USD
      }));
  }

  order(planId: string, opts: { idempotencyKey: string }): Promise<EsimProfile> {
    const key = opts.idempotencyKey;
    if (!key)
      return Promise.reject(
        new AdapterError('reseller', 'invalid_request', 'idempotencyKey is required'),
      );
    const existing = this.#orders.get(key);
    if (existing) return existing;
    const pending = this.#order(planId, key);
    this.#orders.set(key, pending);
    // a failure is not cached: the caller retries with the same key, and 310402 re-queries (T-40)
    pending.catch(() => this.#orders.delete(key));
    return pending;
  }

  async #order(planId: string, idempotencyKey: string): Promise<EsimProfile> {
    const transactionId = sha256Hex(idempotencyKey).slice(2, 34);
    let lookup: Record<string, unknown>;
    try {
      const placed = await this.#call(
        '/esim/order',
        { transactionId, packageInfoList: [{ packageCode: planId, count: 1 }] },
        orderObj,
      );
      lookup = { orderNo: placed.orderNo, iccid: '' };
    } catch (error) {
      if (!(error instanceof VendorError)) throw error;
      // 310402: this transactionId was already ordered — find that order, never place a second one.
      // [verify Wed] /esim/query by transactionId is not in the reference; confirm the field on a real duplicate.
      lookup = { orderNo: '', iccid: '', transactionId };
    }
    const deadline = this.#opts.now() + (this.#opts.pollTimeoutMs ?? 30_000);
    for (;;) {
      const { esimList: list } = await this.#call(
        '/esim/query',
        { ...lookup, pager: PAGER },
        esimList,
      );
      const esim = list.find(
        (e) =>
          (lookup.orderNo ? e.orderNo === lookup.orderNo : e.transactionId === transactionId) &&
          e.iccid !== '',
      );
      if (esim?.ac) return this.#profile(esim, planId);
      if (this.#opts.now() >= deadline) {
        // The API keeps pending-profile and retries with the same key (the vendor dedupes by transactionId).
        throw unavailable('eSIM Access profile not ready after 30 s (pending-profile)', {
          reason: 'pending_profile',
        });
      }
      await this.#sleep(this.#opts.pollMs ?? 3_000);
    }
  }

  #profile(e: Esim, planId: string): EsimProfile {
    return {
      iccid: assertIccid(e.iccid),
      lpa: assertLpa(e.ac ?? ''),
      planId,
      provider: 'esimaccess',
      orderId: e.orderNo ?? e.esimTranNo,
      status: esimStatus(e),
    };
  }

  async #esim(iccid: string): Promise<Esim> {
    if (!ICCID_PATTERN.test(iccid))
      throw new AdapterError('reseller', 'invalid_request', 'malformed ICCID');
    const { esimList: list } = await this.#call(
      '/esim/query',
      { orderNo: '', iccid, pager: PAGER },
      esimList,
    );
    if (list.length === 0) throw new AdapterError('reseller', 'not_found', 'unknown ICCID');
    const esim = list.find((e) => e.iccid === iccid);
    if (!esim)
      throw new AdapterError('reseller', 'invalid_response', 'query answered for another ICCID');
    return esim;
  }

  topUp(
    iccid: string,
    mb: number,
    opts: { idempotencyKey: string; totalMb?: number },
  ): Promise<{ orderId: string; totalMb: number }> {
    const existing = this.#topUps.get(opts.idempotencyKey);
    if (existing) return existing;
    const pending = this.#topUp(iccid, mb, opts.idempotencyKey, opts.totalMb);
    this.#topUps.set(opts.idempotencyKey, pending);
    pending.catch(() => this.#topUps.delete(opts.idempotencyKey));
    return pending;
  }

  async #topUp(
    iccid: string,
    mb: number,
    idempotencyKey: string,
    totalMb?: number,
  ): Promise<{ orderId: string; totalMb: number }> {
    if (!Number.isSafeInteger(mb) || mb <= 0)
      throw new AdapterError('reseller', 'invalid_request', 'mb must be a positive integer');
    const { esimTranNo, totalVolume } = await this.#esim(iccid);
    const transactionId = sha256Hex(`topup:${idempotencyKey}`).slice(2, 34);
    const profileMb = mbFromBytes(totalVolume ?? 0);
    // ponytail: the profile's own volume serves 100 MB steps until the plan outgrows it (vendor top-ups start at 1 GB);
    // a plan with no known total buys at least `mb`. Upgrade: a per-ICCID volume ledger if steps ever race the vendor.
    if (totalMb !== undefined && totalMb <= profileMb) return { orderId: transactionId, totalMb: profileMb };
    const need = totalMb === undefined ? mb : totalMb - profileMb;
    // `type: "TOPUP"` with `iccid` lists the profile's compatible top-ups (live: supportTopUpType 1, 1 GB and up).
    const { packageList: list } = await this.#call(
      '/package/list',
      { locationCode: '', type: 'TOPUP', slug: '', packageCode: '', iccid },
      packageList,
    );
    const pkg = [...list]
      .sort((a, b) => a.volume - b.volume)
      .find((p) => mbFromBytes(p.volume) >= need);
    if (!pkg)
      throw new AdapterError(
        'reseller',
        'invalid_request',
        `no top-up package of at least ${need} MB for this profile`,
      );
    try {
      await this.#call(
        '/esim/topup',
        { esimTranNo, iccid: '', packageCode: pkg.packageCode, transactionId },
        z.unknown(),
      );
    } catch (error) {
      if (!(error instanceof VendorError)) throw error; // 310402: already applied under this transactionId
    }
    const after = await this.#esim(iccid);
    return { orderId: transactionId, totalMb: mbFromBytes(after.totalVolume ?? 0) };
  }

  async usage(iccid: string): Promise<EsimUsage> {
    const e = await this.#esim(iccid);
    const usedMb = mbFromBytes(e.orderUsage ?? 0);
    const totalMb = mbFromBytes(e.totalVolume ?? 0);
    assertUsage(usedMb, totalMb);
    return { iccid, usedMb, totalMb, asOf: this.#opts.now(), status: esimStatus(e) };
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
    now: number,
  ): WebhookVerdict {
    try {
      const token = headerValue(headers, WEBHOOK_TOKEN_HEADER);
      const ip = headerValue(headers, WEBHOOK_IP_HEADER);
      if (!token || !ip) return { ok: false, reason: 'missing_headers' };
      // constant time: compare digests of equal length, never the strings (no early return on a prefix)
      if (!timingSafeEqual(sha256(token), this.#tokenDigest))
        return { ok: false, reason: 'bad_signature' };
      if (!this.#ips.has(ip.replace(/^::ffff:/, ''))) return { ok: false, reason: 'bad_signature' };
      const rtTimestamp = headerValue(headers, 'rt-timestamp');
      if (rtTimestamp !== undefined) {
        // eSIM Access timestamps are MILLISECONDS; ours (`now`) too — convert explicitly, compare in seconds.
        const seconds = Number(rtTimestamp) / 1000;
        if (!/^\d{13}$/.test(rtTimestamp) || Math.abs(now / 1000 - seconds) > WEBHOOK_WINDOW_S) {
          return { ok: false, reason: 'skew' };
        }
      }
      const eventId = sha256Hex(rawBody);
      if (!this.#replay.accept(eventId, now)) return { ok: false, reason: 'replay' };
      return { ok: true, eventId };
    } catch {
      return { ok: false, reason: 'bad_signature' };
    }
  }

  /**
   * Usage HINTS: an event per ICCID-bearing DATA_USAGE / ESIM_STATUS / VALIDITY_USAGE body, with usedMb = totalMb = 0
   * — the body's numbers are never exposed (unsigned, T-82); the API re-reads usage(iccid). ORDER_STATUS and
   * CHECK_HEALTH yield []. [verify Wed] the exact webhook JSON (docs show no schema).
   */
  parseWebhook(rawBody: string): UsageEvent[] {
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      throw new AdapterError('reseller', 'invalid_response', 'webhook body is not JSON');
    }
    const parsed = webhookSchema.safeParse(json);
    if (!parsed.success)
      throw new AdapterError('reseller', 'invalid_response', 'unknown webhook shape');
    const { notifyType, content } = parsed.data;
    const iccid = content?.iccid;
    if (
      !['DATA_USAGE', 'ESIM_STATUS', 'VALIDITY_USAGE'].includes(notifyType) ||
      !iccid ||
      !ICCID_PATTERN.test(iccid)
    ) {
      return [];
    }
    const event: UsageEvent = {
      provider: 'esimaccess',
      eventId: sha256Hex(rawBody),
      iccid,
      usedMb: 0,
      totalMb: 0,
      asOf: this.#opts.now(),
      ...(notifyType === 'ESIM_STATUS' ? { status: esimStatus(content) } : {}),
    };
    return [event];
  }
}
