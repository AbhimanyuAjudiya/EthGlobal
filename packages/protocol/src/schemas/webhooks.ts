/** Reseller usage webhooks (INTERFACES §1.7). Real providers' envelopes are mapped to UsageEvent by adapters. */
import { z } from 'zod';

import { mbSchema, msSchema } from './common.js';

export const usageEventSchema = z.object({
  provider: z.enum(['mock', 'esimaccess', 'megaesim', 'inventory']),
  eventId: z.string().max(128),
  iccid: z.string().regex(/^\d{18,22}$/),
  usedMb: mbSchema,
  totalMb: mbSchema,
  asOf: msSchema,
  status: z.enum(['ready', 'installed', 'active', 'expired']).optional(),
});
export type UsageEvent = z.infer<typeof usageEventSchema>;

/** The mock reseller's own webhook envelope; real providers have their own (adapters map them to UsageEvent). */
export const mockWebhookEnvelopeSchema = z.object({ events: z.array(usageEventSchema) });
export type MockWebhookEnvelope = z.infer<typeof mockWebhookEnvelopeSchema>;

/**
 * Mock reseller signature headers (T-34): signature = hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`),
 * timestamp = unix seconds. Lower-case, as Node and fetch normalise header names.
 */
export const MOCK_WEBHOOK_HEADERS = {
  signature: 'x-recharge-signature',
  timestamp: 'x-recharge-timestamp',
  eventId: 'x-recharge-event-id',
} as const;

/** The default webhook MAC canonical string (`@ethglobal/crypto` verifyWebhookSignature). */
export const webhookCanonical = (timestamp: number, rawBody: string): string =>
  `${timestamp}.${rawBody}`;
