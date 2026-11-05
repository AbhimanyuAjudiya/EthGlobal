import { describe, expect, it } from 'vitest';

import { MockPaymentRail } from '../src/mocks/payment-rail.js';
import { fakeClock, paymentPayload, requirementInput, T0 } from '../src/testing/index.js';

import type { PaymentAuthorization, PaymentPayload } from '../src/types.js';

function setup() {
  const clock = fakeClock();
  const rail = new MockPaymentRail({ now: clock.now });
  const input = requirementInput();
  const required = rail.createPaymentRequirement(input);
  const requirements = required.accepts[0]!;
  return { clock, rail, input, required, requirements };
}

const seconds = (ms: number): string => String(Math.floor(ms / 1000));
const payer = (p: PaymentPayload): string =>
  'authorization' in p.payload ? p.payload.authorization.from : '';

describe('MockPaymentRail', () => {
  it('builds a PAYMENT-REQUIRED body from the input', () => {
    const { required, input } = setup();
    expect(required).toEqual({
      x402Version: 2,
      resource: input.resource,
      accepts: [
        {
          scheme: 'exact',
          network: 'eip155:31337',
          asset: input.asset,
          amount: '1000000',
          payTo: input.payTo,
          maxTimeoutSeconds: 300,
          extra: { name: 'USD Coin', version: '2' },
        },
      ],
    });
    expect(() =>
      new MockPaymentRail().createPaymentRequirement(requirementInput({ amount: '1.5' })),
    ).toThrow(/integer/);
  });

  it('verifies a matching, in-window payload', async () => {
    const { rail, requirements } = setup();
    const payload = paymentPayload(requirements);
    await expect(rail.verify(payload, requirements)).resolves.toEqual({
      isValid: true,
      payer: payer(payload),
    });
  });

  it.each<[string, Partial<PaymentAuthorization>]>([
    ['insufficient_amount', { value: '999999' }],
    ['recipient_mismatch', { to: '0x0000000000000000000000000000000000000001' }],
    ['expired', { validBefore: seconds(Date.UTC(2026, 10, 3, 11)) }],
    ['not_yet_valid', { validAfter: seconds(Date.UTC(2026, 10, 3, 13)) }],
    ['not_yet_valid', { validAfter: seconds(T0) }], // strict: validAfter == now is not yet valid
    ['invalid_amount', { value: 'ten' }],
    ['invalid_validity', { validBefore: 'soon' }],
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

  it('reports unsupported_scheme for a Hedera payload (verify and settle)', async () => {
    const { rail, requirements } = setup();
    const hedera: PaymentPayload = {
      x402Version: 2,
      accepted: requirements,
      payload: { transaction: 'AAAA' },
    };
    await expect(rail.verify(hedera, requirements)).resolves.toEqual({
      isValid: false,
      invalidReason: 'unsupported_scheme',
    });
    await expect(rail.settle(hedera, requirements)).resolves.toMatchObject({
      success: false,
      errorReason: 'unsupported_scheme',
    });
  });

  it('settles once per nonce with a deterministic transaction hash', async () => {
    const { rail, requirements } = setup();
    const payload = paymentPayload(requirements);
    const first = await rail.settle(payload, requirements);
    expect(first).toMatchObject({ success: true, network: 'eip155:31337', payer: payer(payload) });
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
    expect(T0).toBe(Date.UTC(2026, 10, 3, 12));
  });
});
