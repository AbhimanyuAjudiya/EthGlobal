import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import {
  encodeTransferWithAuthorization,
  fromPaymentAuthorization,
  typedDataReceiveWithAuthorization,
  typedDataTransferWithAuthorization,
  domain,
} from '@ethglobal/eip3009';

import { MockPaymentRail } from '../../src/index.js';
import { RoutingPaymentRail } from '../../src/live/routing-rail.js';
import {
  PAYMENT_RECOVERY_MAX_AGE_S,
  SelfRunFacilitator,
} from '../../src/live/self-run-facilitator.js';
import {
  anvilAccounts,
  anvilKeys,
  anvilRoles,
  describePaymentRail,
  fakeClock,
  FakeUsdc3009,
  paymentPayload,
  requirementInput,
  T0,
  TEST_USDC,
} from '../../src/testing/index.js';

import type { PaymentAuthorization, PaymentPayload } from '../../src/types.js';

const human = privateKeyToAccount(anvilKeys[anvilRoles.human]);
const stranger = privateKeyToAccount(anvilKeys[anvilRoles.stranger]);
const RELAYER = anvilAccounts[anvilRoles.relayer];
const PAYOUT = anvilAccounts[anvilRoles.payout];

function setup(opts: { perFromRateLimit?: number; name?: string; erc5267?: boolean } = {}) {
  const clock = fakeClock();
  const token = new FakeUsdc3009({
    address: TEST_USDC,
    chainId: 31337,
    name: opts.name ?? 'USD Coin',
    version: '2',
    now: clock.now,
    balances: { [human.address]: 10_000_000n },
    ...(opts.erc5267 === undefined ? {} : { erc5267: opts.erc5267 }),
  });
  const rail = new SelfRunFacilitator({
    publicClient: token.publicClient(),
    relayer: token.relayer(RELAYER),
    token: TEST_USDC,
    chainId: 31337,
    network: 'eip155:31337',
    now: clock.now,
    ...(opts.perFromRateLimit ? { perFromRateLimit: opts.perFromRateLimit } : {}),
  });
  const d = domain(TEST_USDC, 31337, 'USD Coin', '2');
  const sign = (signer: typeof human) => (auth: PaymentAuthorization) =>
    signer.signTypedData(typedDataTransferWithAuthorization(d, fromPaymentAuthorization(auth)));
  const requirements = rail.createPaymentRequirement(requirementInput()).accepts[0]!;
  let n = 1000;
  const pay = async (
    over: Partial<PaymentAuthorization> = {},
    signer = human,
  ): Promise<PaymentPayload> => {
    n += 1;
    const p = paymentPayload(requirements, {
      nonce: `0x${n.toString(16).padStart(64, '0')}`,
      ...over,
    });
    if (!('authorization' in p.payload)) throw new Error('evm');
    return {
      ...p,
      payload: { ...p.payload, signature: await sign(signer)(p.payload.authorization) },
    };
  };
  return { clock, token, rail, requirements, pay, sign };
}

describePaymentRail('SelfRunFacilitator over FakeUsdc3009', async () => {
  const { rail, sign } = setup();
  return { rail, signer: sign(human), wrongSigner: sign(stranger) };
});

describePaymentRail('RoutingPaymentRail → MockPaymentRail', async () => ({
  rail: new RoutingPaymentRail({ 'eip155:31337': new MockPaymentRail({ now: fakeClock().now }) }),
}));

describe('SelfRunFacilitator (T-13, T-15, T-16, T-17, A-21)', () => {
  it('recovers the signer from a real viem signature and settles through the relayer', async () => {
    const { rail, requirements, pay, token } = setup();
    const payload = await pay();
    await expect(rail.verify(payload, requirements)).resolves.toEqual({
      isValid: true,
      payer: human.address,
    });
    const settled = await rail.settle(payload, requirements);
    expect(settled).toMatchObject({ success: true, payer: human.address, network: 'eip155:31337' });
    expect(token.balanceOf(PAYOUT)).toBe(1_000_000n);
    expect(token.sent).toHaveLength(1);
  });

  it.each<[string, Partial<PaymentAuthorization>]>([
    ['amount_mismatch', { value: '1000001' }],
    ['insufficient_funds', { from: human.address, value: '1000000' }],
  ])('rejects %s', async (reason, over) => {
    const { rail, requirements, pay, token } = setup();
    if (reason === 'insufficient_funds') token.mint(human.address, -10_000_000n + 999_999n);
    await expect(rail.verify(await pay(over), requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: reason,
    });
  });

  it('a malformed signature or authorization never reaches the chain', async () => {
    const { rail, requirements, pay, token } = setup();
    const good = await pay();
    if (!('authorization' in good.payload)) throw new Error('evm');
    const bad = (payload: PaymentPayload['payload']): PaymentPayload => ({ ...good, payload });
    const s = good.payload.signature;
    const highS = `${s.slice(0, 66)}${'f'.repeat(64)}${s.slice(130)}` as const;
    await expect(
      rail.verify(bad({ ...good.payload, signature: highS }), requirements),
    ).resolves.toMatchObject({ invalidReason: 'invalid_signature' });
    await expect(
      rail.verify(bad({ ...good.payload, signature: '0x1234' }), requirements),
    ).resolves.toMatchObject({ invalidReason: 'invalid_signature' });
    await expect(
      rail.verify(
        bad({ ...good.payload, authorization: { ...good.payload.authorization, value: 'x' } }),
        requirements,
      ),
    ).resolves.toMatchObject({ invalidReason: 'invalid_payload' });
    await expect(
      rail.settle(bad({ ...good.payload, signature: highS }), requirements),
    ).resolves.toMatchObject({ success: false });
    expect(token.sent).toEqual([]);
  });

  it('domain: the advertised extra must equal the token domain (Base Sepolia "USDC" vs "USD Coin", A-21); readDomain falls back to name()/version()', async () => {
    const usdc = setup({ name: 'USDC' });
    await expect(usdc.rail.verify(await usdc.pay(), usdc.requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: 'requirements_mismatch',
    });
    const legacy = setup({ erc5267: false });
    await expect(
      legacy.rail.verify(await legacy.pay(), legacy.requirements),
    ).resolves.toMatchObject({ isValid: true });
    const { rail, requirements, pay } = setup();
    const noExtra = { ...requirements, extra: {} };
    const p = await pay();
    await expect(rail.verify({ ...p, accepted: noExtra }, noExtra)).resolves.toMatchObject({
      invalidReason: 'requirements_mismatch',
    });
    const otherToken = { ...requirements, asset: anvilAccounts[9] };
    await expect(rail.verify({ ...p, accepted: otherToken }, otherToken)).resolves.toMatchObject({
      invalidReason: 'requirements_mismatch',
    });
    const otherNet = { ...requirements, network: 'eip155:84532' };
    await expect(rail.verify({ ...p, accepted: otherNet }, otherNet)).resolves.toMatchObject({
      invalidReason: 'unsupported_scheme',
    });
    await expect(
      rail.verify({ ...p, x402Version: 1 } as unknown as PaymentPayload, requirements),
    ).resolves.toMatchObject({
      invalidReason: 'unsupported_x402_version',
    });
  });

  it('settle returns success after a front-run that burned the nonce (A15, T-15)', async () => {
    const { rail, requirements, pay, token } = setup();
    const payload = await pay();
    if (!('authorization' in payload.payload)) throw new Error('evm');
    const auth = fromPaymentAuthorization(payload.payload.authorization);
    const front = await token.execute(
      encodeTransferWithAuthorization(auth, payload.payload.signature as `0x${string}`),
      anvilAccounts[7],
    );
    expect(front.status).toBe('success');
    // verify now says the nonce is used, but settle recognises the authorization already paid payTo
    const verdict = await rail.verify(payload, requirements);
    expect(verdict).toMatchObject({ isValid: false, invalidReason: 'nonce_already_used' });
    await expect(rail.settle(payload, requirements)).resolves.toEqual({
      success: true,
      transaction: front.hash,
      network: 'eip155:31337',
      payer: human.address,
    });
    expect(token.sent).toEqual([]); // nothing re-submitted
  });

  it('a nonce used by cancelAuthorization (no Transfer in its tx) is never reported as paid', async () => {
    const { rail, requirements, pay, token } = setup();
    const payload = await pay();
    if (!('authorization' in payload.payload)) throw new Error('evm');
    const auth = fromPaymentAuthorization(payload.payload.authorization);
    // another payment of the same value from the same payer exists in range…
    await rail.settle(await pay(), requirements);
    // …and this authorization's nonce is consumed without a transfer (as a cancel would)
    (token as unknown as { authorizationsUsed: unknown[] }).authorizationsUsed.length = 0;
    await token.execute(
      encodeTransferWithAuthorization(auth, payload.payload.signature as `0x${string}`),
      anvilAccounts[7],
    );
    token.transfers.pop();
    await expect(rail.settle(payload, requirements)).resolves.toMatchObject({
      success: false,
      errorReason: 'nonce_already_used',
    });
  });

  it('recovers an expired payment days after execution without submitting it again', async () => {
    const { rail, requirements, pay, token, clock } = setup();
    const payload = await pay();
    const first = await rail.settle(payload, requirements);
    expect(first.success).toBe(true);
    // Move well beyond both the twenty-block fast path and the authorization lifetime.
    clock.advance(7 * 86_400_000);
    token.blockNumber += 7n * 86_400n;
    const restarted = new SelfRunFacilitator({
      publicClient: token.publicClient(),
      relayer: token.relayer(RELAYER),
      token: TEST_USDC,
      chainId: 31337,
      network: 'eip155:31337',
      now: clock.now,
    });
    await expect(restarted.verify(payload, requirements)).resolves.toMatchObject({
      isValid: false,
      invalidReason: 'nonce_already_used',
    });
    await expect(restarted.settle(payload, requirements)).resolves.toEqual(first);
    expect(token.sent).toHaveLength(1);
    expect(token.balanceOf(PAYOUT)).toBe(1_000_000n);
  });

  it('does not execute an expired unused authorization while recovering old payments', async () => {
    const { rail, requirements, pay, token, clock } = setup();
    const payload = await pay();
    clock.advance(3_600_000);
    await expect(rail.settle(payload, requirements)).resolves.toMatchObject({
      success: false,
      errorReason: 'expired',
    });
    expect(token.sent).toHaveLength(0);
  });

  it.each([false, true])(
    'never recovers an old payment after consumption markers may expire (far-future expiry=%s)',
    async (farFuture) => {
      const { rail, requirements, pay, token, clock } = setup();
      const payload = await pay(
        farFuture ? { validBefore: String(Math.floor(clock.now() / 1000) + 365 * 86_400) } : {},
      );
      expect((await rail.settle(payload, requirements)).success).toBe(true);
      // Exactly the safety boundary must fail even if the latest twenty blocks contain the payment.
      clock.advance(PAYMENT_RECOVERY_MAX_AGE_S * 1000);
      const currentClient = token.publicClient();
      const originalTimestamp = BigInt(Math.floor(clock.now() / 1000) - PAYMENT_RECOVERY_MAX_AGE_S);
      const publicClient = {
        ...currentClient,
        getBlock: async () => ({ timestamp: originalTimestamp }),
      } as typeof currentClient;
      const restarted = new SelfRunFacilitator({
        publicClient,
        relayer: token.relayer(RELAYER),
        token: TEST_USDC,
        chainId: 31337,
        network: 'eip155:31337',
        now: clock.now,
      });
      await expect(restarted.settle(payload, requirements)).resolves.toMatchObject({
        success: false,
        errorReason: 'nonce_already_used',
      });
      expect(token.sent).toHaveLength(1);
    },
  );

  it('a front-run between our verify and our send ⇒ success with the front-runner tx (simulation reverted)', async () => {
    const { rail, requirements, pay, token } = setup();
    const payload = await pay();
    if (!('authorization' in payload.payload)) throw new Error('evm');
    const auth = fromPaymentAuthorization(payload.payload.authorization);
    const data = encodeTransferWithAuthorization(auth, payload.payload.signature as `0x${string}`);
    const relayer = token.relayer(RELAYER);
    const racing = new (rail.constructor as typeof SelfRunFacilitator)({
      publicClient: token.publicClient(),
      relayer: {
        address: relayer.address!,
        submit: async (t, d) => {
          await token.execute(data, anvilAccounts[7]);
          return relayer.submit(t, d);
        },
      },
      token: TEST_USDC,
      chainId: 31337,
      network: 'eip155:31337',
      now: () => T0,
    });
    const settled = await racing.settle(payload, requirements);
    expect(settled).toEqual({
      success: true,
      transaction: token.transfers[0]!.transactionHash,
      network: 'eip155:31337',
      payer: human.address,
    });
    const reverting = new SelfRunFacilitator({
      publicClient: token.publicClient(),
      relayer: { submit: async () => ({ hash: `0x${'00'.repeat(32)}`, status: 'reverted' }) },
      token: TEST_USDC,
      chainId: 31337,
      network: 'eip155:31337',
      now: () => T0,
    });
    await expect(reverting.settle(await pay(), requirements)).resolves.toMatchObject({
      success: false,
      errorReason: 'settle_reverted',
    });
  });

  it('per-from rate limit (A16): the 4th settle in a minute from one payer is rate_limited', async () => {
    const { rail, requirements, pay, clock } = setup({ perFromRateLimit: 3 });
    for (let i = 0; i < 3; i += 1)
      await expect(rail.settle(await pay(), requirements)).resolves.toMatchObject({
        success: true,
      });
    await expect(rail.settle(await pay(), requirements)).resolves.toMatchObject({
      success: false,
      errorReason: 'rate_limited',
    });
    clock.advance(60_000);
    await expect(
      rail.settle(
        await pay({
          validAfter: String(Math.floor(T0 / 1000)),
          validBefore: String(Math.floor(T0 / 1000) + 300),
        }),
        requirements,
      ),
    ).resolves.toMatchObject({ success: true });
  });

  it('50 authorizations from unfunded accounts ⇒ 0 transactions sent (A16, T-16)', async () => {
    const { rail, requirements, pay, token } = setup();
    for (let i = 0; i < 50; i += 1) {
      const result = await rail.settle(await pay({}, stranger), requirements);
      expect(result.success).toBe(false);
    }
    expect(token.sent).toEqual([]);
  });

  it('receiveWithAuthorization is used only when payTo is the relayer itself', async () => {
    const { token } = setup();
    const rail = new SelfRunFacilitator({
      publicClient: token.publicClient(),
      relayer: token.relayer(RELAYER),
      token: TEST_USDC,
      chainId: 31337,
      network: 'eip155:31337',
      now: () => T0,
    });
    const requirements = rail.createPaymentRequirement(requirementInput({ payTo: RELAYER }))
      .accepts[0]!;
    const p = paymentPayload(requirements, { nonce: `0x${'77'.repeat(32)}` });
    if (!('authorization' in p.payload)) throw new Error('evm');
    const d = domain(TEST_USDC, 31337, 'USD Coin', '2');
    const signature = await human.signTypedData(
      typedDataReceiveWithAuthorization(d, fromPaymentAuthorization(p.payload.authorization)),
    );
    const settled = await rail.settle({ ...p, payload: { ...p.payload, signature } }, requirements);
    expect(settled).toMatchObject({ success: true });
    expect(token.balanceOf(RELAYER)).toBe(1_000_000n);
  });

  it('an RPC outage is AdapterError unavailable, never a verdict', async () => {
    const { rail, requirements, pay, token } = setup();
    const payload = await pay();
    token.failReads = true;
    await expect(rail.verify(payload, requirements)).rejects.toMatchObject({
      adapter: 'payments',
      code: 'unavailable',
    });
    expect(
      () =>
        new SelfRunFacilitator({
          publicClient: token.publicClient(),
          relayer: token.relayer(RELAYER),
          token: TEST_USDC,
          chainId: 1,
          network: 'eip155:31337',
          now: () => T0,
        }),
    ).toThrow(/eip155:1/);
  });
});

describe('RoutingPaymentRail', () => {
  it('dispatches by network; an unknown network is unsupported_scheme on verify/settle and throws only on createPaymentRequirement', async () => {
    const mock = new MockPaymentRail({ now: () => T0 });
    const routing = new RoutingPaymentRail({ 'eip155:31337': mock });
    expect(routing.networks).toEqual(['eip155:31337']);
    const requirements = routing.createPaymentRequirement(requirementInput()).accepts[0]!;
    const foreign = { ...requirements, network: 'eip155:1' };
    const payload = { ...paymentPayload(requirements), accepted: foreign };
    await expect(routing.verify(payload, foreign)).resolves.toEqual({
      isValid: false,
      invalidReason: 'unsupported_scheme',
    });
    await expect(routing.settle(payload, foreign)).resolves.toMatchObject({
      success: false,
      errorReason: 'unsupported_scheme',
    });
    await expect(routing.verify(paymentPayload(requirements), foreign)).resolves.toMatchObject({
      invalidReason: 'unsupported_scheme',
    });
    expect(() =>
      routing.createPaymentRequirement(requirementInput({ network: 'eip155:1' })),
    ).toThrow(expect.objectContaining({ code: 'unsupported_scheme' }));
  });
});
