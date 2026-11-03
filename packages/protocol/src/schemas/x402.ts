/**
 * Wire types of the x402 v2 flow (INTERFACES §1.5), mirroring @x402/core 2.29.0 `PaymentRequiredV2Schema`,
 * `PaymentPayloadV2Schema`, `VerifyResponse` and `SettleResponse` (docs/vendor/API-FACTS.md §1.3–1.5, §1.7),
 * narrowed to what this product accepts: scheme `exact`, EIP-3009 on `eip155:*`, HTS transfers on `hedera:*`.
 */
import { z } from 'zod';

import { HEDERA_MAX_TIMEOUT_S } from '../ids.js';
import {
  caipNetworkSchema,
  digitsSchema,
  evmAddressSchema,
  hex32Schema,
  hexSchema,
} from './common.js';

const extensionsSchema = z.record(z.string(), z.unknown());

/** v2 also allows serviceName/tags/iconUrl; we never send them (unknown keys are stripped on parse). */
export const paymentResourceSchema = z.object({
  url: z.url(),
  description: z.string().max(200),
  mimeType: z.string().max(80),
});
export type PaymentResource = z.infer<typeof paymentResourceSchema>;

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEDERA_ACCOUNT = /^0\.0\.\d{1,12}$/;

/** `payTo` is an EVM address on eip155:* and a Hedera account id on hedera:* (A-6); other namespaces fail. */
export function payToMatchesNetwork(network: string, payTo: string): boolean {
  if (network.startsWith('eip155:')) return EVM_ADDRESS.test(payTo);
  if (network.startsWith('hedera:')) return HEDERA_ACCOUNT.test(payTo);
  return false;
}

const HEDERA_FEE_PAYER = HEDERA_ACCOUNT;

/**
 * The per-network rules of the exact scheme (A-6, A-20, A-21): payTo form; EVM needs the token's EIP-712
 * domain in extra.{name,version}; Hedera needs extra.feePayer and maxTimeoutSeconds ≤ 180.
 */
const checkRequirements = (
  r: {
    network: string;
    payTo: string;
    maxTimeoutSeconds: number;
    extra?: Record<string, unknown> | undefined;
  },
  ctx: z.RefinementCtx,
): void => {
  if (!payToMatchesNetwork(r.network, r.payTo)) {
    ctx.addIssue({ code: 'custom', path: ['payTo'], message: 'payTo does not match network' });
  }
  if (
    r.network.startsWith('eip155:') &&
    (typeof r.extra?.name !== 'string' || typeof r.extra.version !== 'string')
  ) {
    ctx.addIssue({
      code: 'custom',
      path: ['extra'],
      message: 'EVM exact needs extra.name and extra.version (EIP-712 domain)',
    });
  }
  if (r.network.startsWith('hedera:')) {
    const feePayer = r.extra?.feePayer;
    if (typeof feePayer !== 'string' || !HEDERA_FEE_PAYER.test(feePayer)) {
      ctx.addIssue({
        code: 'custom',
        path: ['extra', 'feePayer'],
        message: 'Hedera exact needs extra.feePayer (facilitator account)',
      });
    }
    if (r.maxTimeoutSeconds > HEDERA_MAX_TIMEOUT_S) {
      ctx.addIssue({
        code: 'custom',
        path: ['maxTimeoutSeconds'],
        message: 'Hedera tx valid <= 180 s',
      });
    }
  }
};

const requirementsShape = z.object({
  scheme: z.literal('exact'),
  network: caipNetworkSchema,
  /** EVM token address, or HTS token id on hedera:*. */
  asset: z.string().min(1).max(64),
  /** Base units (USDC 6-dec), never `maxAmountRequired` (that is v1). */
  amount: digitsSchema,
  /** EVM address on eip155:*, Hedera account id on hedera:*. */
  payTo: z.string().max(64),
  maxTimeoutSeconds: z.int().positive().max(3_600),
  /** EVM: `{ name, version }` (the token's EIP-712 domain); Hedera: `{ feePayer }`. */
  extra: z.record(z.string(), z.unknown()).optional(),
});

export const paymentRequirementsSchema = requirementsShape.superRefine(checkRequirements);
export type PaymentRequirements = z.infer<typeof paymentRequirementsSchema>;

/** accepts[] entry before the per-request amount is known. */
export const acceptTemplateSchema = requirementsShape
  .omit({ amount: true })
  .superRefine(checkRequirements);
export type AcceptTemplate = Omit<PaymentRequirements, 'amount'>;

export const paymentRequiredSchema = z.object({
  x402Version: z.literal(2),
  resource: paymentResourceSchema,
  accepts: z.array(paymentRequirementsSchema).min(1).max(8),
  error: z.string().max(200).optional(),
  extensions: extensionsSchema.optional(),
});
export type PaymentRequired = z.infer<typeof paymentRequiredSchema>;

/** EIP-3009 authorization; `validAfter`/`validBefore` are unix SECONDS as digit strings (as @x402/evm sends). */
export const paymentAuthorizationSchema = z.object({
  from: evmAddressSchema,
  to: evmAddressSchema,
  value: digitsSchema,
  validAfter: digitsSchema,
  validBefore: digitsSchema,
  nonce: hex32Schema,
});
export type PaymentAuthorization = z.infer<typeof paymentAuthorizationSchema>;

export const evmExactPayloadSchema = z.object({
  signature: hexSchema,
  authorization: paymentAuthorizationSchema,
});
export type EvmExactPayload = z.infer<typeof evmExactPayloadSchema>;

/**
 * Hedera exact scheme (@x402/hedera 2.29.0 `ExactHederaPayload`): a base64 serialized, partially signed
 * `TransferTransaction` whose transaction id account is `extra.feePayer`.
 */
export const hederaExactPayloadSchema = z.object({ transaction: z.base64().max(8_192) });
export type HederaExactPayload = z.infer<typeof hederaExactPayloadSchema>;

export const paymentPayloadSchema = z
  .object({
    x402Version: z.literal(2),
    resource: paymentResourceSchema.optional(),
    accepted: paymentRequirementsSchema,
    payload: z.union([evmExactPayloadSchema, hederaExactPayloadSchema]),
    extensions: extensionsSchema.optional(),
  })
  .superRefine((p, ctx) => {
    const evm = 'authorization' in p.payload;
    if (evm !== p.accepted.network.startsWith('eip155:')) {
      ctx.addIssue({
        code: 'custom',
        path: ['payload'],
        message: 'payload kind does not match network',
      });
    }
  });
export type PaymentPayload = z.infer<typeof paymentPayloadSchema>;

export const isEvmExact = (p: PaymentPayload['payload']): p is EvmExactPayload =>
  'authorization' in p;

export const verifyResultSchema = z.discriminatedUnion('isValid', [
  z.object({ isValid: z.literal(true), payer: z.string().max(64) }),
  z.object({
    isValid: z.literal(false),
    invalidReason: z.string().max(80),
    payer: z.string().max(64).optional(),
  }),
]);
export type VerifyResult = z.infer<typeof verifyResultSchema>;

/**
 * `SettleResponse`. Failures carry `transaction: ""`; 'settlement_pending' carries the tx and is non-terminal.
 * Hedera facilitators put the tx id (`0.0.x@seconds.nanos`) in `transaction`; a body with only `transactionId`
 * is normalised into `transaction` by the adapter before parsing (A-20).
 */
export const settleResultSchema = z.discriminatedUnion('success', [
  z.object({
    success: z.literal(true),
    transaction: z.string().min(10).max(128),
    network: caipNetworkSchema,
    payer: z.string().max(64),
  }),
  z.object({
    success: z.literal(false),
    errorReason: z.string().max(80),
    network: caipNetworkSchema,
    transaction: z.string().max(128).optional(),
    payer: z.string().max(64).optional(),
  }),
]);
export type SettleResult = z.infer<typeof settleResultSchema>;
/** Body of the PAYMENT-RESPONSE header. */
export const paymentResponseSchema = settleResultSchema;
