/**
 * Buying one step over x402 (agent.md §4; T-56, T-57). The 402 loop itself is `fetchWithPayment` from
 * `@ethglobal/protocol/x402` (the one client loop); this module supplies the signer that enforces the agent's terms:
 *
 * - `choose()` accepts an entry only if `(network, asset, payTo[, feePayer])` is in AGENT_PAYTO_ALLOWLIST, its
 *   `amount` equals the price the agent computed from /plans (never copied from the 402), and that amount is
 *   ≤ AGENT_MAX_USD6_PER_STEP; payers are tried in preference order (Hedera first when configured), entries in any
 *   order — never "the first entry".
 * - Once a payload is signed it is durably retained. Only the response to that exact authorization can confirm
 *   completion; unrelated volume/receipt changes cannot. Retries and restarts resend the same payload, including
 *   after its validity window to recover a payment the API may already have settled.
 */
import { randomUUID } from 'node:crypto';

import { RechargeError } from '@ethglobal/protocol/errors';
import { REQUEST_ID_HEADER } from '@ethglobal/protocol/events';
import { HEDERA_MAX_TIMEOUT_S, PAYMENT_VALIDITY_S } from '@ethglobal/protocol/ids';
import {
  errorBodySchema,
  isEvmExact,
  topUpResponseSchema,
  type PaymentPayload,
  type PaymentRequirements,
  type PaymentResource,
  type SettleResult,
} from '@ethglobal/protocol/schemas';
import {
  decodePaymentResponse,
  encodePaymentPayload,
  fetchWithPayment,
  PAYMENT_RESPONSE_HEADER,
  PAYMENT_SIGNATURE_HEADER,
  type FetchWithPaymentResult,
  type PaymentSigner,
} from '@ethglobal/protocol/x402';

import { logEvent, safeError, type Log } from './log.js';
import { PayerRefusal, type Payer } from './payers/types.js';

import type { AllowedTerms } from './config.js';
import type { AgentReads } from './reads.js';

export const AGENT_UAID_HEADER = 'X-Agent-Uaid';
export const AGENT_EXPIRY_BOUGHT_HEADER = 'X-Agent-Expiry-Bought';
/** Stop resending this long before the authorization expires (agent.md §4). */
export const RESEND_MARGIN_MS = 10_000;

export type TermsField = 'network' | 'asset' | 'payTo' | 'fee-payer' | 'amount' | 'max-per-step';

export interface Rejection {
  index: number;
  network: string;
  /** A TermsField, or the payer's own refusal reason (e.g. 'domain-mismatch', 'no-payer'). */
  field: string;
}

export type SkipReason =
  | 'no-acceptable-terms'
  | 'over-max-per-step'
  | 'invalid-402'
  | 'insufficient-balance'
  | 'domain-mismatch'
  | 'payload-mismatch'
  | 'payment-rejected'
  | 'settlement-pending'
  | 'unexpected-status'
  | 'network-error'
  /** 403 pass_required: the policy has no armed World ID Agent Pass (docs/WORLD_AGENT_PASS.md). */
  | 'pass-required';

export type BuyOutcome =
  | { ok: true; tx: string; network: string; usd6: bigint; mb: number; recovered: boolean }
  | {
      ok: false;
      reason: SkipReason;
      /** true once a payload exists: keep it until the API confirms completion. */
      signed: boolean;
      validBefore?: number;
      detail?: Record<string, unknown>;
    };

export interface BuyRequest {
  key: string;
  mb: number;
  reason: 'threshold' | 'expiry';
  /** priceUsd6(mb, STEP_MB, /plans priceUsd6PerStep): the only amount the agent will sign. */
  expectedUsd6: bigint;
  expiresAt: number;
  mbTotalBefore: number;
  /** Persist the authorization BEFORE it leaves the process (crash safety, AG3.3). */
  onSigned?: (validBeforeMs: number, payload: PaymentPayload) => Promise<void>;
  /** Reconcile the exact authorization persisted before an earlier send; never sign a replacement. */
  resume?: { payload: PaymentPayload; validBeforeMs: number };
}

export interface BuyerDeps {
  apiUrl: string;
  fetch: typeof fetch;
  now: () => number;
  /** Preference order. */
  payers: Payer[];
  allowList: AllowedTerms[];
  maxUsd6PerStep: bigint;
  reads: Pick<AgentReads, 'entitlement' | 'latestTopupTx'>;
  uaid: string;
  log: Log;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
}

const sameEvm = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** Which allow-list field `req` violates, or undefined when the triple (and fee payer) is pinned. */
export function allowListField(
  req: PaymentRequirements,
  allow: AllowedTerms[],
): TermsField | undefined {
  const evm = req.network.startsWith('eip155:');
  const eq = (a: string, b: string) => (evm ? sameEvm(a, b) : a === b);
  const byNetwork = allow.filter((a) => a.network === req.network);
  if (byNetwork.length === 0) return 'network';
  const byAsset = byNetwork.filter((a) => eq(a.asset, req.asset));
  if (byAsset.length === 0) return 'asset';
  const byPayTo = byAsset.filter((a) => eq(a.payTo, req.payTo));
  if (byPayTo.length === 0) return 'payTo';
  if (req.network.startsWith('hedera:')) {
    const feePayer = req.extra?.feePayer;
    if (!byPayTo.some((a) => a.feePayer === feePayer)) return 'fee-payer';
  }
  return undefined;
}

/** The per-buy signer: terms first (allow-list, exact amount, per-step max), then the payer's own checks. */
export class TermsGuard implements PaymentSigner {
  readonly rejections: Rejection[] = [];
  chosen: { payer: Payer; req: PaymentRequirements } | undefined;
  paid: PaymentPayload | undefined;
  validBeforeMs: number | undefined;
  signatures = 0;

  constructor(
    private readonly opts: {
      payers: Payer[];
      allowList: AllowedTerms[];
      expectedUsd6: bigint;
      maxUsd6PerStep: bigint;
      onSigned?: (validBeforeMs: number, payload: PaymentPayload) => Promise<void>;
    },
  ) {}

  termsField(req: PaymentRequirements): TermsField | undefined {
    const field = allowListField(req, this.opts.allowList);
    if (field !== undefined) return field;
    if (req.amount !== this.opts.expectedUsd6.toString()) return 'amount';
    if (BigInt(req.amount) > this.opts.maxUsd6PerStep) return 'max-per-step';
    return undefined;
  }

  choose(accepts: PaymentRequirements[]): PaymentRequirements | undefined {
    const ok: { req: PaymentRequirements; index: number }[] = [];
    accepts.forEach((req, index) => {
      const field = this.termsField(req);
      if (field === undefined) ok.push({ req, index });
      else this.rejections.push({ index, network: req.network, field });
    });
    for (const payer of this.opts.payers) {
      for (const { req, index } of ok) {
        const refused = payer.refusal(req);
        if (refused === undefined) {
          this.chosen = { payer, req };
          return req;
        }
        if (req.network === payer.network)
          this.rejections.push({ index, network: req.network, field: refused });
      }
    }
    for (const { req, index } of ok) {
      if (!this.opts.payers.some((p) => p.network === req.network)) {
        this.rejections.push({ index, network: req.network, field: 'no-payer' });
      }
    }
    return undefined;
  }

  async sign(
    req: PaymentRequirements,
    ctx: { resource: PaymentResource; nonce?: `0x${string}`; now: number },
  ): Promise<PaymentPayload> {
    if (this.signatures > 0) throw new Error('TermsGuard signs at most once (T-57)');
    if (this.chosen?.req !== req) throw new Error('sign() for an entry choose() did not pick');
    const signed = await this.chosen.payer.sign(req, ctx);
    // Resource metadata can contain the entitlement capability URL. Neither the EVM
    // signature nor the Hedera transaction signs it, so keep only the payment wire fields.
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: signed.accepted,
      payload: signed.payload,
    };
    this.signatures += 1;
    this.validBeforeMs = isEvmExact(payload.payload)
      ? Number(payload.payload.authorization.validBefore) * 1000
      : ctx.now + Math.min(req.maxTimeoutSeconds, HEDERA_MAX_TIMEOUT_S, PAYMENT_VALIDITY_S) * 1000;
    // the signed marker is durable (and the claim confirmed ours, RT-G-01) before `paid` is set: if onSigned throws,
    // nothing was paid and the payload never leaves the process
    await this.opts.onSigned?.(this.validBeforeMs, payload);
    this.paid = payload;
    return payload;
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The `error` code of an API error body, if the response is one. */
async function errorCodeOf(response: Response): Promise<string | undefined> {
  const body: unknown = await response.json().catch(() => undefined);
  const parsed = errorBodySchema.safeParse(body);
  return parsed.success ? parsed.data.error : undefined;
}

function settlementOf(response: Response): SettleResult | undefined {
  const header = response.headers.get(PAYMENT_RESPONSE_HEADER);
  if (header === null) return undefined;
  try {
    return decodePaymentResponse(header);
  } catch {
    return undefined;
  }
}

export class Buyer {
  constructor(private readonly deps: BuyerDeps) {}

  #skip(
    reason: SkipReason,
    signed: boolean,
    detail: Record<string, unknown>,
    validBefore?: number,
  ): BuyOutcome {
    logEvent(this.deps.log, 'warn', 'agent.skip', { reason, signed, ...detail });
    return {
      ok: false,
      reason,
      signed,
      ...(validBefore === undefined ? {} : { validBefore }),
      detail,
    };
  }

  async buy(r: BuyRequest): Promise<BuyOutcome> {
    const { deps } = this;
    if (!r.resume && r.expectedUsd6 > deps.maxUsd6PerStep) {
      // /plans itself lies (price × 10): caught before any request is made
      return this.#skip('over-max-per-step', false, {
        field: 'max-per-step',
        expected: r.expectedUsd6.toString(),
      });
    }
    const url = `${deps.apiUrl}/esim/topup?key=${encodeURIComponent(r.key)}&mb=${r.mb}`;
    const headers: Record<string, string> = {
      accept: 'application/json',
      [AGENT_UAID_HEADER]: deps.uaid,
      [REQUEST_ID_HEADER]: randomUUID(),
      ...(r.reason === 'expiry' ? { [AGENT_EXPIRY_BOUGHT_HEADER]: String(r.expiresAt) } : {}),
    };
    const guard = new TermsGuard({
      payers: deps.payers,
      allowList: deps.allowList,
      expectedUsd6: r.expectedUsd6,
      maxUsd6PerStep: deps.maxUsd6PerStep,
      ...(r.onSigned ? { onSigned: r.onSigned } : {}),
    });

    let result: FetchWithPaymentResult | undefined;
    let failure: unknown;
    try {
      if (r.resume) {
        guard.paid = r.resume.payload;
        guard.validBeforeMs = r.resume.validBeforeMs;
        result = { response: await this.#resend(url, headers, r.resume.payload) };
      } else
        result = await fetchWithPayment({
          fetch: deps.fetch,
          url,
          init: { method: 'GET', headers },
          signer: guard,
          now: deps.now,
          ...(deps.timeoutMs === undefined ? {} : { timeoutMs: deps.timeoutMs }),
        });
    } catch (error) {
      failure = error;
    }

    if (guard.paid === undefined) {
      if (failure instanceof PayerRefusal)
        return this.#skip(failure.reason, false, { message: failure.message });
      if (failure instanceof RechargeError) {
        return this.#skip('invalid-402', false, { code: failure.code, details: failure.details });
      }
      if (failure !== undefined)
        return this.#skip('network-error', false, {
          message: safeError(failure),
        });
      if (result?.required !== undefined) {
        return this.#skip('no-acceptable-terms', false, {
          field: guard.rejections[0]?.field,
          rejections: guard.rejections,
        });
      }
      if (
        result?.response.status === 403 &&
        (await errorCodeOf(result.response)) === 'pass_required'
      ) {
        return this.#skip('pass-required', false, {});
      }
      return this.#skip('unexpected-status', false, { status: result?.response.status });
    }

    const paid = guard.paid;
    const validBefore = guard.validBeforeMs!;
    let response = result?.response;
    let attempts = 1;
    let recovered = r.resume !== undefined;
    const maxAttempts = deps.maxAttempts ?? 5;
    while (response === undefined || response.status >= 500) {
      // Volume/receipts may belong to a concurrent human purchase. Only a response to
      // this exact authorization establishes that OUR payment and fulfillment completed.
      if (attempts >= maxAttempts || deps.now() >= validBefore - RESEND_MARGIN_MS) {
        return this.#skip(
          'network-error',
          true,
          { attempts, status: response?.status },
          validBefore,
        );
      }
      await (deps.sleep ?? defaultSleep)(Math.min(1_000 * 2 ** (attempts - 1), 8_000));
      attempts += 1;
      recovered = true;
      response = await this.#resend(url, headers, paid).catch(() => undefined);
    }

    const settlement = settlementOf(response) ?? (await this.#bodySettlement(response));
    if (
      response.status === 200 &&
      settlement?.success === true &&
      settlement.network === paid.accepted.network
    ) {
      logEvent(deps.log, 'info', 'agent.buy', {
        tx: settlement.transaction,
        network: settlement.network,
      });
      return {
        ok: true,
        tx: settlement.transaction,
        network: settlement.network,
        usd6: BigInt(paid.accepted.amount),
        mb: r.mb,
        recovered,
      };
    }
    if (
      response.status === 202 ||
      (settlement?.success === false && settlement.errorReason === 'settlement_pending')
    ) {
      return this.#skip('settlement-pending', true, { tx: settlement?.transaction }, validBefore);
    }
    if (response.status === 402) {
      return this.#skip(
        'payment-rejected',
        true,
        { errorReason: settlement?.success === false ? settlement.errorReason : undefined },
        validBefore,
      );
    }
    return this.#skip('unexpected-status', true, { status: response.status }, validBefore);
  }

  /** The same signed payload, byte for byte (EVM: same nonce; Hedera: same transaction bytes). */
  #resend(url: string, headers: Record<string, string>, paid: PaymentPayload): Promise<Response> {
    return this.deps.fetch.call(globalThis, url, {
      method: 'GET',
      headers: { ...headers, [PAYMENT_SIGNATURE_HEADER]: encodePaymentPayload(paid) },
      signal: AbortSignal.timeout(this.deps.timeoutMs ?? 30_000),
    });
  }

  async #bodySettlement(response: Response): Promise<SettleResult | undefined> {
    if (response.status !== 200) return undefined;
    const body: unknown = await response.json().catch(() => undefined);
    const parsed = topUpResponseSchema.safeParse(body);
    return parsed.success ? parsed.data.settlement : undefined;
  }
}
