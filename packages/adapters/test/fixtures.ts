import { anvilAccounts } from '../src/mocks/name-resolver.js';

import type { PaymentPayload, PaymentRequirementInput, PaymentRequirements } from '../src/types.js';

export const T0 = Date.UTC(2026, 10, 3, 12, 0, 0);

/** A settable fake clock in ms. */
export function fakeClock(start = T0) {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
  };
}

export const requirementInput: PaymentRequirementInput = {
  amount: '1000000',
  asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  payTo: anvilAccounts[1],
  network: 'eip155:31337',
  resource: {
    url: 'http://localhost:8787/resource',
    description: 'test resource',
    mimeType: 'application/json',
  },
};

export function paymentPayload(
  requirements: PaymentRequirements,
  overrides: Partial<PaymentPayload['payload']['authorization']> = {},
): PaymentPayload {
  const nowSeconds = Math.floor(T0 / 1000);
  return {
    x402Version: 2,
    accepted: requirements,
    payload: {
      signature: '0xabcdef',
      authorization: {
        from: anvilAccounts[0],
        to: requirements.payTo,
        value: requirements.amount,
        validAfter: nowSeconds - 60,
        validBefore: nowSeconds + 60,
        nonce: '0x01',
        ...overrides,
      },
    },
  };
}
