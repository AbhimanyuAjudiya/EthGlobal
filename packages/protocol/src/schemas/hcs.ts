/** HCS receipt messages (INTERFACES §1.7, §9). One topic per deployment; agent messages carry `uaid`. */
import { z } from 'zod';

import { RechargeError } from '../errors.js';
import { parseJsonOrThrow, parseOrThrow, utf8Length } from '../internal.js';
import { caipNetworkSchema, digitsSchema, hex32Schema, mbSchema, tierSchema } from './common.js';

const hcsBase = {
  v: z.literal(1),
  at: z.iso.datetime(),
  svc: z.enum(['api', 'agent']),
  /** sha256(entitlementKey). */
  ent: hex32Schema,
};
export const hcsMessageSchema = z.discriminatedUnion('t', [
  z.object({
    ...hcsBase,
    t: z.literal('claim'),
    campaign: hex32Schema,
    claimKey: hex32Schema,
    tier: tierSchema,
    mb: mbSchema,
    tx: z.string(),
  }),
  z.object({
    ...hcsBase,
    t: z.literal('settle'),
    kind: z.enum(['provision', 'topup', 'gift']),
    network: caipNetworkSchema,
    tx: z.string(),
    payer: z.string(),
    usd6: digitsSchema,
    mb: mbSchema,
  }),
  z.object({
    ...hcsBase,
    t: z.literal('gift'),
    giftId: hex32Schema,
    namehash: hex32Schema.optional(),
    mb: mbSchema,
    tx: z.string(),
  }),
  z.object({ ...hcsBase, t: z.literal('gift-claim'), giftId: hex32Schema }),
  z.object({
    ...hcsBase,
    t: z.literal('gift-reclaim'),
    giftId: hex32Schema,
    network: caipNetworkSchema,
    tx: z.string(),
    usd6: digitsSchema,
    feeUsd6: digitsSchema,
  }),
  z.object({
    ...hcsBase,
    t: z.literal('card-redeem'),
    giftId: hex32Schema,
    claimKey: hex32Schema,
    tx: z.string(),
  }),
  z.object({
    ...hcsBase,
    t: z.literal('agent-topup'),
    uaid: z.string().max(200),
    network: caipNetworkSchema,
    tx: z.string(),
    usd6: digitsSchema,
    mb: mbSchema,
    reason: z.enum(['threshold', 'expiry']),
  }),
  /** The agent's World ID Agent Pass checkpoint (docs/WORLD_AGENT_PASS.md): one line per state change, no URL. */
  z.object({
    ...hcsBase,
    t: z.literal('agent-pass'),
    uaid: z.string().max(200),
    state: z.enum(['pending', 'approved', 'denied', 'expired']),
    code: z.string().max(32).optional(),
  }),
]);
export type HcsMessage = z.infer<typeof hcsMessageSchema>;

/** One chunk; encodeHcsMessage() throws above it (T-44). */
export const HCS_MAX_BYTES = 1024;

/** Validates and serialises one HCS message; throws RechargeError('invalid_request') if invalid or > 1024 bytes. */
export function encodeHcsMessage(message: HcsMessage): string {
  const text = JSON.stringify(parseOrThrow(hcsMessageSchema, message, 'HCS message'));
  const bytes = utf8Length(text);
  if (bytes > HCS_MAX_BYTES) {
    throw new RechargeError(
      'invalid_request',
      `HCS message is ${bytes} bytes (max ${HCS_MAX_BYTES})`,
      {
        reason: 'too_large',
      },
    );
  }
  return text;
}

/** Parses one HCS message read back from the mirror node; throws RechargeError('invalid_request'). */
export function decodeHcsMessage(text: string): HcsMessage {
  if (utf8Length(text) > HCS_MAX_BYTES) {
    throw new RechargeError('invalid_request', 'HCS message too large', { reason: 'too_large' });
  }
  return parseJsonOrThrow(hcsMessageSchema, text, 'HCS message');
}
