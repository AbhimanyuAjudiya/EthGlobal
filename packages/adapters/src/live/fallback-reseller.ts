/**
 * FallbackReseller: order() falls back to the second reseller when the primary is unavailable or rate limited;
 * plans() likewise. usage/topUp/cancel/webhooks always go to the primary — a top-up on a profile the primary never issued
 * must surface as an error, never silently "succeed" elsewhere (L8). The inventory holds pre-bought profiles of
 * the primary's own package codes, so a planId means the same plan on both.
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

const fallsBack = (error: unknown): boolean =>
  error instanceof AdapterError && (error.code === 'unavailable' || error.code === 'rate_limited');

export class FallbackReseller implements Reseller {
  constructor(
    readonly primary: Reseller,
    readonly fallback: Reseller,
    private readonly logger?: Pick<Console, 'warn'>,
  ) {}

  get name() {
    return this.primary.name;
  }

  async plans(country: 'IN'): Promise<EsimPlan[]> {
    try {
      return await this.primary.plans(country);
    } catch (error) {
      if (!fallsBack(error)) throw error;
      return this.fallback.plans(country);
    }
  }

  async order(planId: string, opts: { idempotencyKey: string }): Promise<EsimProfile> {
    try {
      return await this.primary.order(planId, opts);
    } catch (error) {
      if (!fallsBack(error)) throw error;
      this.logger?.warn(
        `reseller: ${this.primary.name} unavailable, ordering from ${this.fallback.name}`,
      );
      return this.fallback.order(planId, opts);
    }
  }

  topUp(
    iccid: string,
    mb: number,
    opts: { idempotencyKey: string },
  ): Promise<{ orderId: string; totalMb: number }> {
    return this.primary.topUp(iccid, mb, opts);
  }

  usage(iccid: string): Promise<EsimUsage> {
    return this.primary.usage(iccid);
  }

  /** The primary only, never the fallback: no refund from inventory (a profile the primary never issued is refused). */
  cancel(iccid: string, opts: { idempotencyKey: string }): Promise<void> {
    return this.primary.cancel(iccid, opts);
  }

  verifyWebhook(
    rawBody: string,
    headers: Record<string, string | undefined>,
    now: number,
  ): WebhookVerdict {
    return this.primary.verifyWebhook(rawBody, headers, now);
  }

  parseWebhook(rawBody: string): UsageEvent[] {
    return this.primary.parseWebhook(rawBody);
  }
}
