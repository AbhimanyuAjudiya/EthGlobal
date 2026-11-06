import { describe, expect, it } from 'vitest';

import { fakeClock, TEST_USDC } from '@ethglobal/adapters/testing';
import type { Entitlement, PaymentRequirements } from '@ethglobal/protocol/schemas';
import {
  encodePaymentRequired,
  paymentRequired,
  PAYMENT_REQUIRED_HEADER,
} from '@ethglobal/protocol/x402';

import { ALLOW, EVM_ACCEPT, evmPayer, HEDERA_ACCEPT, KEY, STRANGER } from './helpers.js';
import { allowListField, Buyer, TermsGuard, type BuyerDeps } from '../src/buyer.js';
import { parseAllowList } from '../src/config.js';
import { memoryLog } from '../src/log.js';

const allowList = parseAllowList(ALLOW);
const legit = { ...EVM_ACCEPT, amount: '400000' } as PaymentRequirements;
const resource = {
  url: 'http://api.test/esim/topup',
  description: 'x',
  mimeType: 'application/json',
};
const required402 = () =>
  new Response('{}', {
    status: 402,
    headers: {
      [PAYMENT_REQUIRED_HEADER]: encodePaymentRequired(
        paymentRequired({ resource, accepts: [legit] }),
      ),
    },
  });
const ent = (mbTotal: number) => ({ mbTotal }) as Entitlement;

async function buyer(fetchFn: typeof fetch, over: Partial<BuyerDeps> = {}) {
  const clock = fakeClock();
  const evm = await evmPayer(clock.now);
  const log = memoryLog();
  const b = new Buyer({
    apiUrl: 'http://api.test',
    fetch: fetchFn,
    now: clock.now,
    payers: [evm.payer],
    allowList,
    maxUsd6PerStep: 1_000_000n,
    reads: { entitlement: async () => ent(1000), latestTopupTx: async () => undefined },
    uaid: 'uaid:aid:x',
    log,
    sleep: async () => undefined,
    ...over,
  });
  const buy = () =>
    b.buy({
      key: KEY,
      mb: 100,
      reason: 'threshold',
      expectedUsd6: 400_000n,
      expiresAt: clock.now() + 1e9,
      mbTotalBefore: 1000,
    });
  return { buy, evm, log, clock };
}

describe('buyer', () => {
  it('tampered 402 (each of amount, payTo, network, asset) → no signature produced (T-56)', async () => {
    const { evm } = await evmPayer(fakeClock().now).then((e) => ({ evm: e }));
    const tampered: [keyof PaymentRequirements, string][] = [
      ['amount', '4000000'],
      ['payTo', STRANGER],
      ['network', 'eip155:1'],
      ['asset', '0x0000000000000000000000000000000000000bad'],
    ];
    for (const [field, value] of tampered) {
      const guard = new TermsGuard({
        payers: [evm.payer],
        allowList,
        expectedUsd6: 400_000n,
        maxUsd6PerStep: 1_000_000n,
      });
      expect(guard.choose([{ ...legit, [field]: value }]), field).toBeUndefined();
      expect(guard.rejections[0]?.field).toBe(field);
    }
    expect(evm.account.signatures).toBe(0);
  });

  it('amount above AGENT_MAX_USD6_PER_STEP → skip', async () => {
    const { evm } = { evm: await evmPayer(fakeClock().now) };
    const guard = new TermsGuard({
      payers: [evm.payer],
      allowList,
      expectedUsd6: 4_000_000n,
      maxUsd6PerStep: 1_000_000n,
    });
    expect(guard.choose([{ ...legit, amount: '4000000' }])).toBeUndefined();
    expect(guard.rejections).toEqual([
      { index: 0, network: 'eip155:31337', field: 'max-per-step' },
    ]);
  });

  it('network error after signing → same payload resent, no second signature (T-57)', async () => {
    const sent: string[] = [];
    let n = 0;
    const f: typeof fetch = async (_u, init) => {
      const sig = new Headers(init?.headers).get('PAYMENT-SIGNATURE');
      if (!sig) return required402();
      sent.push(sig);
      n += 1;
      if (n === 1) throw new TypeError('ECONNRESET');
      return new Response(JSON.stringify({}), { status: 200 });
    };
    const { buy, evm } = await buyer(f);
    const out = await buy();
    expect(sent).toHaveLength(2);
    expect(sent[1]).toBe(sent[0]);
    expect(evm.account.signatures).toBe(1);
    expect(out).toMatchObject({ ok: false, reason: 'unexpected-status', signed: true }); // 200 without any settlement
  });

  it('an unrelated increase in mbTotal cannot prove this authorization settled', async () => {
    let paidSends = 0;
    const f: typeof fetch = async (_u, init) => {
      if (!new Headers(init?.headers).has('PAYMENT-SIGNATURE')) return required402();
      paidSends += 1;
      return new Response('bad gateway', { status: 502 });
    };
    const { buy } = await buyer(f, {
      maxAttempts: 2,
      reads: {
        entitlement: async () => ent(1100),
        latestTopupTx: async () => Promise.reject(new Error('down')),
      },
    });
    expect(await buy()).toMatchObject({ ok: false, signed: true, reason: 'network-error' });
    expect(paidSends).toBe(2);
  });

  it('gives up after maxAttempts with the authorization still blocking the trigger', async () => {
    const f: typeof fetch = async (_u, init) =>
      new Headers(init?.headers).has('PAYMENT-SIGNATURE')
        ? new Response('', { status: 503 })
        : required402();
    const { buy } = await buyer(f, {
      maxAttempts: 2,
      reads: {
        entitlement: async () => Promise.reject(new Error('ledger down')),
        latestTopupTx: async () => undefined,
      },
    });
    const out = await buy();
    expect(out).toMatchObject({ ok: false, reason: 'network-error', signed: true });
    expect(out.ok ? 0 : out.validBefore).toBeGreaterThan(0);
  });

  it('settlement read from the body when the header is missing; unknown failures are unexpected-status', async () => {
    const settlement = {
      success: true,
      transaction: '0x' + 'ab'.repeat(32),
      network: 'eip155:31337',
      payer: '0x1',
    };
    const body = {
      entitlementKey: KEY,
      mbTotal: 1100,
      mbUsed: 900,
      expiresAt: 1,
      settlement,
      receipt: { arkivKey: 'ent_1' },
    };
    const f: typeof fetch = async (_u, init) =>
      new Headers(init?.headers).has('PAYMENT-SIGNATURE') ? Response.json(body) : required402();
    expect(await (await buyer(f)).buy()).toMatchObject({ ok: true, tx: settlement.transaction });
    const g: typeof fetch = async (_u, init) =>
      new Headers(init?.headers).has('PAYMENT-SIGNATURE')
        ? new Response('', { status: 409 })
        : required402();
    expect(await (await buyer(g)).buy()).toMatchObject({
      ok: false,
      reason: 'unexpected-status',
      signed: true,
    });
  });

  it('nothing signed: a network error, a 200 without payment, a 404', async () => {
    const down: typeof fetch = async () => Promise.reject(new TypeError('ECONNREFUSED'));
    expect(await (await buyer(down)).buy()).toMatchObject({
      ok: false,
      reason: 'network-error',
      signed: false,
    });
    const free: typeof fetch = async () => Response.json({});
    expect(await (await buyer(free)).buy()).toMatchObject({
      ok: false,
      reason: 'unexpected-status',
      signed: false,
    });
    const gone: typeof fetch = async () => new Response('', { status: 404 });
    expect(await (await buyer(gone)).buy()).toMatchObject({
      ok: false,
      reason: 'unexpected-status',
      signed: false,
    });
  });

  it('TermsGuard signs at most once, only the entry it chose, and reports allow-listed entries no payer can take', async () => {
    const clock = fakeClock();
    const { payer } = await evmPayer(clock.now);
    const guard = new TermsGuard({
      payers: [payer],
      allowList,
      expectedUsd6: 400_000n,
      maxUsd6PerStep: 1_000_000n,
    });
    const hedera = { ...HEDERA_ACCEPT, amount: '400000' } as PaymentRequirements;
    await expect(guard.sign(legit, { resource, now: clock.now() })).rejects.toThrow(/did not pick/);
    expect(guard.choose([hedera, legit])).toBe(legit);
    await guard.sign(legit, { resource, now: clock.now() });
    await expect(guard.sign(legit, { resource, now: clock.now() })).rejects.toThrow(/at most once/);
    const noPayer = new TermsGuard({
      payers: [payer],
      allowList,
      expectedUsd6: 400_000n,
      maxUsd6PerStep: 1_000_000n,
    });
    expect(noPayer.choose([hedera])).toBeUndefined();
    expect(noPayer.rejections).toEqual([
      { index: 0, network: 'hedera:testnet', field: 'no-payer' },
    ]);
  });

  it('allowListField compares EVM case-insensitively and Hedera exactly', () => {
    expect(
      allowListField(
        {
          ...legit,
          asset: TEST_USDC.toLowerCase(),
          payTo: legit.payTo.toUpperCase().replace('0X', '0x'),
        },
        allowList,
      ),
    ).toBeUndefined();
    expect(allowListField({ ...HEDERA_ACCEPT, amount: '1' }, allowList)).toBeUndefined();
    expect(allowListField({ ...HEDERA_ACCEPT, amount: '1', extra: {} }, allowList)).toBe(
      'fee-payer',
    );
  });
});
