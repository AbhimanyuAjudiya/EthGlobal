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
  assertCountryCode,
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
  EsimCancellationEvidence,
  EsimLifecycle,
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
    dataType: z.number().int().optional(),
    currencyCode: z.string().max(8).optional(),
    location: z.string().max(2000).optional(),
    supportTopUpType: z.number().int().optional(),
    activeType: z.union([z.number().int(), z.string().max(8)]).nullish(),
    unusedValidTime: int.optional(),
  })
  .loose();
const packageList = z.object({ packageList: z.array(packageSchema).max(2000) }).loose();
const orderObj = z
  .object({ orderNo: z.string().min(1).max(64), transactionId: z.string().max(64).optional() })
  .loose();
const esimSchema = z
  .object({
    esimTranNo: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
    orderNo: z.string().max(64).optional(),
    transactionId: z.string().max(64).optional(),
    iccid: z.string().max(32),
    ac: z.string().max(512).optional(),
    smdpStatus: z.string().max(32).optional(),
    esimStatus: z.string().max(32).optional(),
    eid: z.string().max(64).nullish(),
    expiredTime: z.string().max(80).nullish(),
    activateTime: z.string().max(80).nullish(),
    activeType: z.union([z.number().int(), z.string().max(8)]).nullish(),
    totalDuration: int.optional(),
    durationUnit: z.string().max(16).optional(),
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

/** Official API: 1 = first installation; 2 = first network connection. */
const activationStart = (value: unknown): EsimLifecycle['startsOn'] =>
  value === 1 || value === '1'
    ? 'installation'
    : value === 2 || value === '2'
      ? 'first-network'
      : 'unknown';

function providerTime(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function lifecycle(e: Esim): EsimLifecycle {
  const activatedAt = providerTime(e.activateTime);
  const expiry = providerTime(e.expiredTime);
  const activated =
    activatedAt !== undefined || ['IN_USE', 'USED_UP', 'USED_EXPIRED'].includes(e.esimStatus ?? '');
  const unused = e.esimStatus === 'GOT_RESOURCE' && e.smdpStatus === 'RELEASED' && e.eid === '';
  return {
    startsOn: activationStart(e.activeType),
    ...(activatedAt === undefined ? {} : { activatedAt }),
    ...(activated && expiry !== undefined ? { serviceExpiresAt: expiry } : {}),
    ...(!activated && unused && expiry !== undefined ? { installBy: expiry } : {}),
    ...(e.durationUnit === 'DAY' && e.totalDuration !== undefined && e.totalDuration > 0
      ? { validityDays: e.totalDuration }
      : {}),
  };
}

/** smdpStatus / esimStatus → our profile status (API-FACTS §5.1 status model). */
export function esimStatus(e: {
  smdpStatus?: string | undefined;
  esimStatus?: string | undefined;
  eid?: string | null | undefined;
}): ProfileStatus {
  const s = new Set([e.smdpStatus, e.esimStatus]);
  // Official status matrix: USED_UP is depleted (reloadable), not expired.
  if (
    ['DELETED', 'UNUSED_EXPIRED', 'USED_EXPIRED', 'CANCEL', 'REVOKE', 'REVOKED'].some((v) =>
      s.has(v),
    )
  )
    return 'expired';
  if (s.has('IN_USE') || s.has('USED_UP')) return 'active';
  if (
    e.eid ||
    ['DOWNLOAD', 'DOWNLOADED', 'INSTALLATION', 'INSTALLED', 'ENABLED', 'DISABLED'].some((v) =>
      s.has(v),
    )
  )
    return 'installed';
  if (e.smdpStatus === 'RELEASED' && e.esimStatus === 'GOT_RESOURCE') return 'ready';
  // Missing/new/suspended vendor states must never be interpreted as proof of an unused profile.
  throw new AdapterError('reseller', 'invalid_response', 'unrecognized or unavailable eSIM status');
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

  async plans(country: string): Promise<EsimPlan[]> {
    assertCountryCode(country);
    const { packageList: list } = await this.#call(
      '/package/list',
      { locationCode: country, type: 'BASE', dataType: '1', slug: '', packageCode: '', iccid: '' },
      packageList,
    );
    return list
      .filter(
        (p) =>
          p.durationUnit === 'DAY' &&
          p.duration > 0 &&
          p.price > 0 &&
          mbFromBytes(p.volume) > 0 &&
          (p.dataType === undefined || p.dataType === 1) &&
          (p.currencyCode === undefined || p.currencyCode === 'USD') &&
          (p.location === undefined ||
            p.location
              .split(',')
              .map((code) => code.trim())
              .includes(country)),
      )
      .map((p) => ({
        id: p.packageCode,
        provider: 'esimaccess' as const,
        name: safePlanName(p.name),
        country,
        dataMb: mbFromBytes(p.volume), // bytes → MB (1 GB = 1000 MB, A-1)
        validityDays: p.duration,
        wholesaleUsd6: BigInt(p.price) * 100n, // USD × 10 000 → micro-USD
        activation: {
          startsOn: activationStart(p.activeType),
          ...(p.unusedValidTime !== undefined && p.unusedValidTime > 0
            ? { installWithinDays: p.unusedValidTime }
            : {}),
        },
        cancellation: 'never-installed' as const,
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
      if (!(error instanceof VendorError)) {
        // A transport failure can happen after the vendor accepted the order. Only a
        // definite vendor refusal is safe to replace with another inventory profile.
        if (error instanceof AdapterError) {
          throw new AdapterError(error.adapter, error.code, error.message, {
            ...error.details,
            orderMayExist: typeof error.details?.vendorCode !== 'string',
          });
        }
        throw error;
      }
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
      ).catch((error: unknown) => {
        if (error instanceof AdapterError)
          throw new AdapterError(error.adapter, error.code, error.message, {
            ...error.details,
            orderMayExist: true,
          });
        throw error;
      });
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
          orderMayExist: true,
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
      ...(e.esimTranNo ? { providerRef: e.esimTranNo } : {}),
      lifecycle: lifecycle(e),
    };
  }

  async #esim(iccid: string, providerRef?: string): Promise<Esim> {
    if (!ICCID_PATTERN.test(iccid))
      throw new AdapterError('reseller', 'invalid_request', 'malformed ICCID');
    const { esimList: list } = await this.#call(
      '/esim/query',
      {
        orderNo: '',
        iccid,
        ...(providerRef === undefined ? {} : { esimTranNo: providerRef }),
        pager: PAGER,
      },
      esimList,
    );
    if (list.length === 0) throw new AdapterError('reseller', 'not_found', 'unknown ICCID');
    const esim = list.find(
      (e) => e.iccid === iccid && (providerRef === undefined || e.esimTranNo === providerRef),
    );
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
    const before = await this.#esim(iccid);
    const { esimTranNo, totalVolume } = before;
    const transactionId = sha256Hex(`topup:${idempotencyKey}`).slice(2, 34);
    const profileMb = mbFromBytes(totalVolume ?? 0);
    // Existing vendor capacity can serve the absolute entitlement target; the API serializes targets per profile.
    if (totalMb !== undefined && totalMb <= profileMb)
      return { orderId: transactionId, totalMb: profileMb };
    if (!this.#topUpEligible(before))
      throw new AdapterError('reseller', 'invalid_request', 'this profile cannot be topped up');
    const need = totalMb === undefined ? mb : totalMb - profileMb;
    const list = await this.#fixedTopUps(iccid);
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
    const confirmedMb = mbFromBytes(after.totalVolume ?? 0);
    const requiredMb = totalMb ?? profileMb + mb;
    if (confirmedMb < requiredMb)
      throw unavailable('top-up capacity is not yet confirmed', {
        reason: 'pending_topup',
        requiredMb,
        confirmedMb,
      });
    return { orderId: transactionId, totalMb: confirmedMb };
  }

  #topUpEligible(e: Esim): boolean {
    if (!['GOT_RESOURCE', 'IN_USE', 'USED_UP'].includes(e.esimStatus ?? '')) return false;
    if (esimStatus(e) === 'expired') return false;
    if (e.expiredTime) {
      const expiry = Date.parse(e.expiredTime);
      if (!Number.isFinite(expiry))
        throw new AdapterError('reseller', 'invalid_response', 'malformed vendor expiration');
      if (expiry <= this.#opts.now()) return false;
    }
    return true;
  }

  async #fixedTopUps(iccid: string): Promise<z.infer<typeof packageSchema>[]> {
    const { packageList: list } = await this.#call(
      '/package/list',
      {
        locationCode: '',
        type: 'TOPUP',
        slug: '',
        packageCode: '',
        iccid,
      },
      packageList,
    );
    // The TOPUP catalogue reports fixed-volume top-ups as supportTopUpType 1 (the BASE catalogue says 2 for a
    // base package that accepts them; seen live 2026-11-07: every India top-up is 1). Type 3 is a day-pass
    // extension requiring periodNum; this product sells a fixed MB amount.
    return list.filter(
      (p) =>
        (p.supportTopUpType === 1 || p.supportTopUpType === 2) &&
        p.durationUnit === 'DAY' &&
        p.volume > 0,
    );
  }

  async canTopUp(iccid: string): Promise<boolean> {
    if (!this.#topUpEligible(await this.#esim(iccid))) return false;
    return (await this.#fixedTopUps(iccid)).length > 0;
  }

  /**
   * `/esim/cancel { esimTranNo }`: the vendor refunds only an unused profile (GOT_RESOURCE, never installed); one in
   * use is refused here without a call. The profile's own state is the idempotency: one already reading CANCEL
   * resolves without a second call.
   */
  async cancellationEvidence(
    iccid: string,
    opts: { providerRef?: string } = {},
  ): Promise<EsimCancellationEvidence> {
    const e = await this.#esim(iccid, opts.providerRef);
    if (opts.providerRef !== undefined && e.esimTranNo !== opts.providerRef)
      throw new AdapterError(
        'reseller',
        'invalid_response',
        'provider allocation identity changed',
      );
    const providerRef = /^[A-Za-z0-9_-]{1,64}$/.test(e.esimTranNo) ? e.esimTranNo : undefined;
    const rawStatus = /^[A-Z_]{1,32}$/.test(e.esimStatus ?? '') ? e.esimStatus : undefined;
    const smdpStatus = /^[A-Z_]{1,32}$/.test(e.smdpStatus ?? '') ? e.smdpStatus : undefined;
    const installed =
      Boolean(e.eid) ||
      providerTime(e.activateTime) !== undefined ||
      [
        'DOWNLOAD',
        'DOWNLOADED',
        'INSTALLATION',
        'INSTALLED',
        'ENABLED',
        'DISABLED',
        'DELETED',
      ].includes(e.smdpStatus ?? '');
    const expiry = providerTime(e.expiredTime);
    let status: EsimCancellationEvidence['status'] = 'unknown';
    if (providerRef && rawStatus === 'CANCEL') status = 'cancelled';
    else if (
      installed ||
      (e.orderUsage !== undefined && e.orderUsage > 0) ||
      [
        'IN_USE',
        'USED_UP',
        'UNUSED_EXPIRED',
        'USED_EXPIRED',
        'SUSPENDED',
        'REVOKE',
        'REVOKED',
      ].includes(e.esimStatus ?? '') ||
      (expiry !== undefined && expiry <= this.#opts.now())
    )
      status = 'ineligible';
    else if (
      providerRef &&
      rawStatus === 'GOT_RESOURCE' &&
      smdpStatus === 'RELEASED' &&
      e.orderUsage === 0 &&
      e.eid === '' &&
      (!e.activateTime || providerTime(e.activateTime) !== undefined) &&
      (!e.expiredTime || expiry !== undefined)
    )
      status = 'eligible';
    return {
      status,
      provider: this.name,
      ...(providerRef === undefined ? {} : { providerRef }),
      ...(rawStatus === undefined ? {} : { rawStatus }),
      ...(smdpStatus === undefined ? {} : { smdpStatus }),
      observedAt: this.#opts.now(),
    };
  }

  async cancel(
    iccid: string,
    opts: { idempotencyKey: string; providerRef?: string },
  ): Promise<void> {
    const evidence = await this.cancellationEvidence(iccid, opts);
    if (evidence.status === 'cancelled') return;
    if (evidence.status === 'unknown')
      throw unavailable('provider cancellation eligibility is unknown', {
        reason: 'pending_cancel',
      });
    if (evidence.status !== 'eligible' || evidence.providerRef === undefined)
      throw new AdapterError(
        'reseller',
        'invalid_request',
        'only an unused profile can be cancelled',
      );
    await this.#call('/esim/cancel', { esimTranNo: evidence.providerRef }, z.unknown());
    const confirmed = await this.cancellationEvidence(iccid, { providerRef: evidence.providerRef });
    if (confirmed.status !== 'cancelled')
      throw unavailable('provider cancellation is not yet confirmed', { reason: 'pending_cancel' });
  }

  async usage(iccid: string): Promise<EsimUsage> {
    const e = await this.#esim(iccid);
    const usedMb = mbFromBytes(e.orderUsage ?? 0);
    const totalMb = mbFromBytes(e.totalVolume ?? 0);
    assertUsage(usedMb, totalMb);
    return {
      iccid,
      usedMb,
      totalMb,
      asOf: this.#opts.now(),
      status: esimStatus(e),
      ...(e.esimTranNo ? { providerRef: e.esimTranNo } : {}),
      lifecycle: lifecycle(e),
    };
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
