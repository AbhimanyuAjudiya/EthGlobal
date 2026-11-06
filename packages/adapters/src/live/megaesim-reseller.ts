/**
 * MegaEsimReseller — a FIXTURE-ONLY STUB (INTERFACES A-28). MegaeSIM publishes no API documentation (API-FACTS §5.2),
 * so every network method throws AdapterError('reseller', 'unavailable') and webhooks are never accepted.
 * liveConfigSchema refuses RESELLER=megaesim. Implement only if the vendor supplies docs on-site.
 */
import { AdapterError } from '../errors.js';

import type {
  EsimPlan,
  EsimProfile,
  EsimUsage,
  Reseller,
  UsageEvent,
  WebhookVerdict,
} from '../types.js';

export interface MegaEsimResellerOptions {
  /** Reserved for a vendor-supplied recording (fixtures/reseller/megaesim/*.json); unused until then. */
  fixtureFetch?: typeof fetch;
  baseUrl?: string;
  now: () => number;
}

const nope = (): never => {
  throw new AdapterError(
    'reseller',
    'unavailable',
    'MegaeSIM has no public API (A-28): fixture-only stub',
  );
};

export class MegaEsimReseller implements Reseller {
  readonly name = 'megaesim' as const;

  constructor(readonly options: MegaEsimResellerOptions) {}

  async plans(_country: string): Promise<EsimPlan[]> {
    return nope();
  }

  async order(_planId: string, _opts: { idempotencyKey: string }): Promise<EsimProfile> {
    return nope();
  }

  async topUp(
    _iccid: string,
    _mb: number,
    _opts: { idempotencyKey: string },
  ): Promise<{ orderId: string; totalMb: number }> {
    return nope();
  }

  async usage(_iccid: string): Promise<EsimUsage> {
    return nope();
  }

  async cancel(_iccid: string, _opts: { idempotencyKey: string }): Promise<void> {
    throw new AdapterError(
      'reseller',
      'not_implemented',
      'MegaeSIM cannot cancel or refund (A-28)',
    );
  }

  verifyWebhook(
    _rawBody: string,
    _headers: Record<string, string | undefined>,
    _now: number,
  ): WebhookVerdict {
    return { ok: false, reason: 'bad_signature' };
  }

  parseWebhook(_rawBody: string): UsageEvent[] {
    return nope();
  }
}
