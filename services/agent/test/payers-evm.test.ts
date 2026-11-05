import { describe, expect, it } from 'vitest';

import {
  TEST_USDC,
  fakeClock,
  FakeUsdc3009,
  anvilAccounts,
  anvilRoles,
} from '@ethglobal/adapters/testing';
import {
  digestTransferWithAuthorization,
  domainFromRequirements,
  fromPaymentAuthorization,
  recoverSigner,
} from '@ethglobal/eip3009';
import { isEvmExact, type PaymentRequirements } from '@ethglobal/protocol/schemas';

import { countingAccount, EVM_ACCEPT, evmPayer, PAYOUT } from './helpers.js';
import { EvmPayer, AnvilEvmSigner } from '../src/payers/evm.js';
import { PayerRefusal } from '../src/payers/types.js';

const resource = {
  url: 'http://api.test/esim/topup',
  description: 'top-up',
  mimeType: 'application/json',
};
const req = (over: Partial<PaymentRequirements> = {}): PaymentRequirements => ({
  ...EVM_ACCEPT,
  amount: '400000',
  ...over,
});

describe('EvmPayer (AnvilEvmSigner)', () => {
  it('signature recovers to the agent address via @ethglobal/eip3009', async () => {
    const clock = fakeClock();
    const { payer } = await evmPayer(clock.now);
    const paid = await payer.sign(req(), { resource, now: clock.now() });
    expect(isEvmExact(paid.payload)).toBe(true);
    if (!isEvmExact(paid.payload)) return;
    const auth = fromPaymentAuthorization(paid.payload.authorization);
    const signer = await recoverSigner(
      digestTransferWithAuthorization(domainFromRequirements(paid.accepted), auth),
      paid.payload.signature as `0x${string}`,
    );
    expect(signer).toBe(anvilAccounts[anvilRoles.agent]);
    expect(paid.payload.authorization).toMatchObject({ to: PAYOUT, value: '400000' });
    const nowS = Math.floor(clock.now() / 1000);
    expect(Number(paid.payload.authorization.validBefore)).toBe(nowS + 300);
    expect(Number(paid.payload.authorization.validAfter)).toBeLessThan(nowS);
    expect(AnvilEvmSigner).toBe(EvmPayer);
  });

  it('a fresh random nonce per signature, unless the route binds one', async () => {
    const clock = fakeClock();
    const { payer } = await evmPayer(clock.now);
    const a = await payer.sign(req(), { resource, now: clock.now() });
    const b = await payer.sign(req(), { resource, now: clock.now() });
    const nonce = (p: typeof a) => (isEvmExact(p.payload) ? p.payload.authorization.nonce : '');
    expect(nonce(a)).not.toBe(nonce(b));
    const bound = await payer.sign(req(), {
      resource,
      now: clock.now(),
      nonce: `0x${'ab'.repeat(32)}`,
    });
    expect(nonce(bound)).toBe(`0x${'ab'.repeat(32)}`);
  });

  it('refuses when balance < value', async () => {
    const clock = fakeClock();
    const { payer, account } = await evmPayer(clock.now, { balance: 1n });
    await expect(payer.sign(req(), { resource, now: clock.now() })).rejects.toMatchObject({
      reason: 'insufficient-balance',
    });
    expect(account.signatures).toBe(0);
    expect(await payer.balanceUsd6()).toBe(1n);
  });

  it('domain read from the token, not hard-coded (ERC-5267 absent ⇒ name()/version())', async () => {
    const clock = fakeClock();
    const usdc = new FakeUsdc3009({
      address: TEST_USDC,
      chainId: 31337,
      name: 'USD Coin',
      version: '2',
      now: clock.now,
      erc5267: false,
    });
    const payer = await new EvmPayer({
      account: countingAccount(),
      publicClient: usdc.publicClient(),
      network: 'eip155:31337',
      asset: TEST_USDC,
    }).init();
    expect(payer.domain).toEqual({ name: 'USD Coin', version: '2', chainId: 31337 });
    // a token deployed with another name: the 402's "USD Coin" no longer matches what the token says
    const other = new FakeUsdc3009({
      address: TEST_USDC,
      chainId: 31337,
      name: 'Mock Dollar',
      version: '2',
      now: clock.now,
    });
    const p2 = await new EvmPayer({
      account: countingAccount(),
      publicClient: other.publicClient(),
      network: 'eip155:31337',
      asset: TEST_USDC,
    }).init();
    expect(p2.refusal(req())).toBe('domain-mismatch');
    await expect(p2.sign(req(), { resource, now: clock.now() })).rejects.toBeInstanceOf(
      PayerRefusal,
    );
  });

  it('EvmPayer: domain name from extra ("USDC" for eip155:84532), refuses on readDomain mismatch', async () => {
    const clock = fakeClock();
    const { payer } = await evmPayer(clock.now, {
      chainId: 84532,
      network: 'eip155:84532',
      name: 'USDC',
    });
    const base = req({ network: 'eip155:84532', extra: { name: 'USDC', version: '2' } });
    expect(payer.refusal(base)).toBeUndefined();
    expect(payer.refusal({ ...base, extra: { name: 'USD Coin', version: '2' } })).toBe(
      'domain-mismatch',
    );
    expect(payer.choose([{ ...base, extra: { name: 'USD Coin', version: '2' } }, base])).toBe(base);
  });

  it('refuses another network or asset, and an RPC on the wrong chain fails init', async () => {
    const clock = fakeClock();
    const { payer } = await evmPayer(clock.now);
    expect(payer.refusal(req({ network: 'eip155:1' }))).toBe('network');
    expect(payer.refusal(req({ asset: '0x0000000000000000000000000000000000000bad' }))).toBe(
      'asset',
    );
    const usdc = new FakeUsdc3009({
      address: TEST_USDC,
      chainId: 1,
      name: 'USD Coin',
      version: '2',
      now: clock.now,
    });
    await expect(
      new EvmPayer({
        account: countingAccount(),
        publicClient: usdc.publicClient(),
        network: 'eip155:31337',
        asset: TEST_USDC,
      }).init(),
    ).rejects.toThrow(/chain 1/);
    const fresh = new EvmPayer({
      account: countingAccount(),
      publicClient: usdc.publicClient(),
      network: 'eip155:31337',
      asset: TEST_USDC,
    });
    expect(fresh.refusal(req())).toBe('domain-unknown');
  });
});
