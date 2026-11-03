import { describe, expect, it } from 'vitest';

import { fakeClock, paymentPayload, requirementInput } from './fixtures.js';
import { MockPaymentRail } from '../src/mocks/payment-rail.js';
import {
  decodePaymentPayload,
  decodePaymentRequired,
  encodePaymentPayload,
  encodePaymentRequired,
} from '../src/x402-headers.js';

function setup() {
  const clock = fakeClock();
  const rail = new MockPaymentRail({ now: clock.now });
  const required = rail.createPaymentRequirement(requirementInput);
  const requirements = required.accepts[0]!;
  return { clock, rail, required, requirements };
}

describe('MockPaymentRail', () => {
  it('builds a PAYMENT-REQUIRED body from the input', () => {
    const { required } = setup();
    expect(required).toEqual({
      x402Version: 2,
      resource: requirementInput.resource,
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:31337',
          asset: requirementInput.asset,
          amount: '1000000',
          payTo: requirementInput.payTo,
          maxTimeoutSeconds: 300,
        },
      ],
    });
    expect(() =>
      new MockPaymentRail().createPaymentRequirement({ ...requirementInput, amount: '1.5' }),
    ).toThrow(/integer/);
  });

  it('verifies a matching, in-window payload', async () => {
    const { rail, requirements } = setup();
    await expect(rail.verify(paymentPayload(requirements), requirements)).resolves.toEqual({
      isValid: true,
      payer: paymentPayload(requirements).payload.authorization.from,
    });
  });

  it.each([
    ['insufficient_amount', { value: '999999' }],
    ['recipient_mismatch', { to: '0x0000000000000000000000000000000000000001' as const }],
    ['expired', { validBefore: Math.floor(Date.UTC(2026, 10, 3, 11) / 1000) }],
    ['not_yet_valid', { validAfter: Math.floor(Date.UTC(2026, 10, 3, 13) / 1000) }],
    ['invalid_amount', { value: 'ten' }],
  ])('reports %s', async (reason, overrides) => {
    const { rail, requirements } = setup();
    await expect(
      rail.verify(paymentPayload(requirements, overrides), requirements),
    ).resolves.toEqual({
      isValid: false,
      invalidReason: reason,
    });
  });

  it('reports requirements_mismatch when the client accepted something else', async () => {
    const { rail, requirements } = setup();
    const payload = paymentPayload({ ...requirements, amount: '1', network: 'eip155:1' });
    await expect(rail.verify(payload, requirements)).resolves.toMatchObject({
      invalidReason: 'requirements_mismatch',
    });
  });

  it('settles once per nonce with a deterministic transaction hash', async () => {
    const { rail, requirements } = setup();
    const payload = paymentPayload(requirements);
    const first = await rail.settle(payload, requirements);
    expect(first).toMatchObject({
      success: true,
      network: 'eip155:31337',
      payer: payload.payload.authorization.from,
    });
    expect(first.success && first.transaction).toMatch(/^0x[0-9a-f]{64}$/);

    const again = await rail.settle(payload, requirements);
    expect(again).toEqual({
      success: false,
      errorReason: 'nonce_already_used',
      network: 'eip155:31337',
    });

    const fresh = setup();
    const replay = await fresh.rail.settle(paymentPayload(fresh.requirements), fresh.requirements);
    expect(replay.success && replay.transaction).toBe(first.success && first.transaction);
  });

  it('round-trips the x402 headers', () => {
    const { required, requirements } = setup();
    const payload = paymentPayload(requirements);
    expect(decodePaymentRequired(encodePaymentRequired(required))).toEqual(required);
    expect(decodePaymentPayload(encodePaymentPayload(payload))).toEqual(payload);
  });
});
