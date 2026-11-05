/** The one PAYMENT-REQUIRED builder every rail uses (mock, self-run, remote), validated with protocol's schema. */
import { paymentRequirementsSchema } from '@ethglobal/protocol/schemas';

import { AdapterError } from './errors.js';

import type { PaymentRequired, PaymentRequirementInput, PaymentRequirements } from './types.js';

export const DEFAULT_PAYMENT_TIMEOUT_S = 300;
const INTEGER = /^\d+$/;

export function buildPaymentRequired(input: PaymentRequirementInput): PaymentRequired {
  if (!INTEGER.test(input.amount)) {
    throw new AdapterError(
      'payments',
      'invalid_amount',
      'amount must be an integer string in base units',
    );
  }
  const draft: PaymentRequirements = {
    scheme: 'exact',
    network: input.network,
    asset: input.asset,
    amount: input.amount,
    payTo: input.payTo,
    maxTimeoutSeconds: input.maxTimeoutSeconds ?? DEFAULT_PAYMENT_TIMEOUT_S,
    ...(input.extra ? { extra: input.extra } : {}),
  };
  const parsed = paymentRequirementsSchema.safeParse(draft);
  if (!parsed.success) {
    throw new AdapterError(
      'payments',
      'invalid_request',
      `invalid payment requirements: ${parsed.error.issues[0]?.message ?? 'schema'}`,
    );
  }
  return { x402Version: 2, resource: input.resource, accepts: [draft] };
}

/** accepted ≡ requirements on every field the payer committed to (case-insensitive for EVM hex). */
export function sameRequirements(a: PaymentRequirements, b: PaymentRequirements): boolean {
  const lower = (s: string) => s.toLowerCase();
  const extra = (r: PaymentRequirements) =>
    JSON.stringify(Object.entries(r.extra ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  return (
    a.scheme === b.scheme &&
    a.network === b.network &&
    lower(a.asset) === lower(b.asset) &&
    lower(a.payTo) === lower(b.payTo) &&
    a.amount === b.amount &&
    extra(a) === extra(b)
  );
}
