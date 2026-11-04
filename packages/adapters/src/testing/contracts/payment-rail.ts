/** describePaymentRail: the x402 exact-EVM port contract (E-series, L10), run against every rail that verifies locally. */
import { describe, expect, it } from 'vitest';

import { paymentPayload, requirementInput } from '../builders.js';
import { T0 } from '../clock.js';

import type {
  Hex,
  PaymentAuthorization,
  PaymentPayload,
  PaymentRail,
  PaymentRequirements,
} from '../../types.js';

export interface PaymentRailSubject {
  rail: PaymentRail;
  /** Signs an authorization for the subject's token; rails that check signatures must provide it. */
  signer?: (auth: PaymentAuthorization) => Promise<Hex>;
  /** Signs as someone other than `from` (the wrong-signer case); defaults to skipping that case. */
  wrongSigner?: (auth: PaymentAuthorization) => Promise<Hex>;
}

const seconds = (ms: number): string => String(Math.floor(ms / 1000));

export function describePaymentRail(name: string, make: () => Promise<PaymentRailSubject>): void {
  describe(`PaymentRail contract: ${name}`, () => {
    async function setup() {
      const subject = await make();
      const requirements: PaymentRequirements =
        subject.rail.createPaymentRequirement(requirementInput()).accepts[0]!;
      let nonceSeq = 0;
      const pay = async (
        overrides: Partial<PaymentAuthorization> = {},
        sign = subject.signer,
      ): Promise<PaymentPayload> => {
        nonceSeq += 1;
        const draft = paymentPayload(requirements, {
          nonce: `0x${nonceSeq.toString(16).padStart(64, '0')}`,
          ...overrides,
        });
        if (!sign || !('authorization' in draft.payload)) return draft;
        return {
          ...draft,
          payload: { ...draft.payload, signature: await sign(draft.payload.authorization) },
        };
      };
      return { ...subject, requirements, pay };
    }

    it('verifies a matching, in-window payload and names the payer', async () => {
      const { rail, requirements, pay } = await setup();
      const payload = await pay();
      const result = await rail.verify(payload, requirements);
      expect(result).toMatchObject({ isValid: true });
      expect(result.isValid && result.payer.toLowerCase()).toBe(
        'authorization' in payload.payload && payload.payload.authorization.from.toLowerCase(),
      );
    });

    it.each<[string, (now: number) => Partial<PaymentAuthorization>]>([
      ['insufficient_amount', () => ({ value: '999999' })],
      ['recipient_mismatch', () => ({ to: '0x0000000000000000000000000000000000000001' })],
      ['expired', (now) => ({ validBefore: seconds(now - 1000) })],
      ['not_yet_valid', (now) => ({ validAfter: seconds(now + 3_600_000) })],
      ['not_yet_valid', (now) => ({ validAfter: seconds(now) })], // strict: validAfter == now is not yet valid (D-24)
    ])('rejects %s', async (reason, overrides) => {
      const { rail, requirements, pay } = await setup();
      const result = await rail.verify(await pay(overrides(T0)), requirements);
      expect(result).toMatchObject({ isValid: false, invalidReason: reason });
    });

    it('rejects a payload that accepted other requirements', async () => {
      const { rail, requirements, pay } = await setup();
      const payload = await pay();
      const other = { ...requirements, payTo: '0x0000000000000000000000000000000000000002' };
      await expect(
        rail.verify({ ...payload, accepted: other }, requirements),
      ).resolves.toMatchObject({
        isValid: false,
        invalidReason: 'requirements_mismatch',
      });
    });

    it('a Hedera payload is unsupported_scheme on verify and settle', async () => {
      const { rail, requirements, pay } = await setup();
      const payload = { ...(await pay()), payload: { transaction: 'AAAA' } } as PaymentPayload;
      await expect(rail.verify(payload, requirements)).resolves.toMatchObject({
        isValid: false,
        invalidReason: 'unsupported_scheme',
      });
      await expect(rail.settle(payload, requirements)).resolves.toMatchObject({
        success: false,
        errorReason: 'unsupported_scheme',
      });
    });

    it('settles once per nonce: a 32-byte tx hash, then nonce_already_used; a re-settle never pays twice', async () => {
      const { rail, requirements, pay } = await setup();
      const payload = await pay();
      const settled = await rail.settle(payload, requirements);
      expect(settled).toMatchObject({ success: true, network: requirements.network });
      expect(settled.success && settled.transaction).toMatch(/^0x[0-9a-f]{64}$/);
      await expect(rail.verify(payload, requirements)).resolves.toMatchObject({
        isValid: false,
        invalidReason: 'nonce_already_used',
      });
      // a second settle never moves money twice: it fails, or (idempotent rails) answers the same transaction
      const again = await rail.settle(payload, requirements);
      if (again.success) expect(again.transaction).toBe(settled.success && settled.transaction);
    });

    it('a signature by someone other than `from` is invalid_signature (when the rail checks signatures)', async (ctx) => {
      const { rail, requirements, pay, wrongSigner } = await setup();
      if (!wrongSigner) return ctx.skip();
      await expect(rail.verify(await pay({}, wrongSigner), requirements)).resolves.toMatchObject({
        isValid: false,
        invalidReason: 'invalid_signature',
      });
    });
  });
}
