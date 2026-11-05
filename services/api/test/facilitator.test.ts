import { describe, expect, it } from 'vitest';

import { anvilAccounts, anvilRoles, fakeClock, T0 } from '@ethglobal/adapters/testing';
import { supportedResponseSchema, type PaymentRequirements } from '@ethglobal/protocol/schemas';

import { exactPayment } from './support/client.js';
import { fakeUsdcRail } from './support/fake-chain.js';
import { harness, HUMAN_KEY, provisioned, topUp, type Harness } from './support/harness.js';

const clock = fakeClock(T0);
const withFake = async () => {
  const fake = fakeUsdcRail(clock.now);
  const h = await harness({ overrides: { ...fake.overrides, now: clock.now } });
  return { h, usdc: fake.usdc };
};
const terms = (h: Harness): PaymentRequirements => ({ ...h.deps.accepts[0]!, amount: '400000' });
const post = async (h: Harness, path: string, req: PaymentRequirements, o: { ip?: string } = {}) =>
  h.request(path, {
    method: 'POST',
    ...(o.ip === undefined ? {} : { ip: o.ip }),
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      x402Version: 2,
      paymentPayload: await exactPayment(HUMAN_KEY, req, { now: h.clock.now() }),
      paymentRequirements: req,
    }),
  });

describe('/facilitator/* (self-run, A-30, T-75)', () => {
  it('supported lists the local network with its EIP-712 domain and the relayer', async () => {
    const { h } = await withFake();
    const body = supportedResponseSchema.parse(
      await (await h.get('/facilitator/supported')).json(),
    );
    expect(body).toEqual({
      kinds: [
        {
          x402Version: 2,
          scheme: 'exact',
          network: 'eip155:31337',
          extra: { name: 'USD Coin', version: '2' },
        },
      ],
      extensions: [],
      signers: { 'eip155:*': [anvilAccounts[anvilRoles.relayer]] },
    });
  });

  it('verify/settle round trip with a real viem signature', async () => {
    const { h, usdc } = await withFake();
    const req = terms(h);
    const verified = (await (await post(h, '/facilitator/verify', req)).json()) as {
      isValid: boolean;
    };
    expect(verified.isValid).toBe(true);
    const settled = (await (await post(h, '/facilitator/settle', req)).json()) as {
      success: boolean;
      transaction: string;
    };
    expect(settled.success).toBe(true);
    expect(usdc.transfers.at(-1)).toMatchObject({
      to: anvilAccounts[anvilRoles.payout],
      value: 400_000n,
      transactionHash: settled.transaction,
    });
  });

  it('foreign payTo / asset / network → 400 and zero relayed transactions', async () => {
    const { h, usdc } = await withFake();
    const base = terms(h);
    for (const req of [
      { ...base, payTo: anvilAccounts[anvilRoles.stranger] },
      { ...base, asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' },
      { ...base, network: 'eip155:1' },
    ]) {
      expect((await post(h, '/facilitator/settle', req)).status).toBe(400);
    }
    expect(usdc.sent).toHaveLength(0);
  });

  it('31st request in a minute from one IP → 429', async () => {
    const { h } = await withFake();
    const statuses: number[] = [];
    for (let i = 0; i < 31; i++)
      statuses.push((await h.request('/facilitator/supported', { ip: '192.0.2.99' })).status);
    expect(statuses.filter((s) => s === 429)).toHaveLength(1);
  });

  it('the whole top-up runs on real EIP-3009 recovery through the self-run rail', async () => {
    const { h, usdc } = await withFake();
    const { key } = await provisioned(h);
    const { paid } = await topUp(h, key);
    expect(paid.status).toBe(200);
    expect(usdc.transfers).toHaveLength(1);
  });
});
