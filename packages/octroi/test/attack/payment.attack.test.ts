import { describe, expect, it, vi } from 'vitest';

import { anvilAccounts, anvilRoles, paymentPayload } from '@ethglobal/adapters/testing';
import { keccak256 } from '@ethglobal/crypto';
import { NETWORKS } from '@ethglobal/protocol/ids';
import type { PaymentPayload, PaymentRequirements } from '@ethglobal/protocol/schemas';
import { sessionNonce } from '@ethglobal/protocol/x402';

import { deps, resource, SPK, type TestDeps } from './fixture.js';
import { buildAccepts, decide, type OctroiDeps } from '../../src/index.js';

const req = (d: OctroiDeps, mb: number, i = 0) => buildAccepts(d, mb)[i]!;
const pay = (d: OctroiDeps, mb: number, over = {}) => paymentPayload(req(d, mb), over);
const withSettle = (d: TestDeps, settle: PaymentRailSettle): TestDeps => ({
  ...d,
  payments: { ...d.payments, verify: d.payments.verify.bind(d.payments), settle },
});
type PaymentRailSettle = OctroiDeps['payments']['settle'];
const ok = {
  success: true as const,
  network: NETWORKS.anvil,
  payer: anvilAccounts[anvilRoles.human],
};

describe('attack: O9 payment ↔ MB mismatch (T-26)', () => {
  it.each([199, 3100, 0, -100, Number.NaN])('mb = %s → deny', async (mb) => {
    const d = deps();
    expect((await decide({ resource, mb, payment: pay(d, 100) }, d)).kind).toBe('deny');
  });

  it('200 MB requested, one step paid → invalid-payment; over-payment rejected (exact)', async () => {
    const d = deps();
    expect(await decide({ resource, mb: 200, payment: pay(d, 100) }, d)).toMatchObject({
      reason: 'invalid-payment',
    });
    expect(
      await decide({ resource, mb: 100, payment: pay(d, 100, { value: '800000' }) }, d),
    ).toMatchObject({ reason: 'invalid-payment' });
  });

  it('buildAccepts amount is exactly steps × price and carries no extra top-level fields', () => {
    const d = deps();
    const r = req(d, 300);
    expect(r.amount).toBe('1200000');
    expect(Object.keys(r).sort()).toEqual([
      'amount',
      'asset',
      'extra',
      'maxTimeoutSeconds',
      'network',
      'payTo',
      'scheme',
    ]);
  });
});

describe('attack: O10 serve-before-settle (T-27)', () => {
  it.each<[string, PaymentRailSettle]>([
    ['settle throws', async () => Promise.reject(new Error('down'))],
    [
      'success:false',
      async () => ({ success: false, errorReason: 'nope', network: NETWORKS.anvil }),
    ],
    [
      'settlement_pending',
      async () => ({
        success: false,
        errorReason: 'settlement_pending',
        network: NETWORKS.anvil,
        transaction: `0x${'aa'.repeat(32)}`,
      }),
    ],
    ['short tx', async () => ({ ...ok, transaction: '0x12' })],
    [
      'other network',
      async () => ({ ...ok, network: NETWORKS.baseSepolia, transaction: `0x${'aa'.repeat(32)}` }),
    ],
    [
      'Hedera id on an EVM settlement',
      async () => ({ ...ok, transaction: '0.0.5@1762171200.000000001' }),
    ],
  ])('%s ⇒ deny invalid-payment, never serve-paid', async (_n, settle) => {
    const d = withSettle(deps(), settle);
    expect(await decide({ resource, mb: 100, payment: pay(d, 100) }, d)).toMatchObject({
      kind: 'deny',
      reason: 'invalid-payment',
    });
  });

  it('an EVM hash on a Hedera settlement ⇒ deny', async () => {
    const d = deps();
    const hd: TestDeps = {
      ...d,
      payments: {
        ...d.payments,
        verify: async () => ({ isValid: true, payer: '0.0.7' }),
        settle: async () => ({
          success: true,
          transaction: `0x${'aa'.repeat(32)}`,
          network: NETWORKS.hederaTestnet,
          payer: '0.0.7',
        }),
      },
    };
    const payment: PaymentPayload = {
      x402Version: 2,
      accepted: req(hd, 100, 1),
      payload: { transaction: 'AAAA' },
    };
    expect(await decide({ resource, mb: 100, payment }, hd)).toMatchObject({
      reason: 'invalid-payment',
      detail: 'settlement_tx',
    });
  });

  it('verify false ⇒ settle never called', async () => {
    const d = deps();
    const settle = vi.spyOn(d.payments, 'settle');
    const notYet = pay(d, 100, { validAfter: String(Math.floor(d.now() / 1000) + 10) });
    expect(await decide({ resource, mb: 100, payment: notYet }, d)).toMatchObject({
      reason: 'invalid-payment',
    });
    expect(settle).not.toHaveBeenCalled();
  });
});

describe('attack: O11 accepts[] substitution (T-28)', () => {
  it.each<[string, (r: PaymentRequirements) => unknown]>([
    ['scheme permit', (r) => ({ ...r, scheme: 'permit' })],
    ['Hedera feePayer swapped', (r) => ({ ...r, extra: { ...r.extra, feePayer: '0.0.666' } })],
    [
      'extra.sessionKeyRequired dropped',
      (r) => ({ ...r, extra: { ...r.extra, sessionKeyRequired: undefined } }),
    ],
  ])('%s ⇒ deny invalid-payment', async (_n, tamper) => {
    const d = deps();
    const accepted = tamper(req(d, 100, 1)) as PaymentRequirements;
    const payment = {
      x402Version: 2,
      accepted,
      payload: { transaction: 'AAAA' },
    } as PaymentPayload;
    expect(await decide({ resource, mb: 100, payment }, d)).toMatchObject({
      reason: 'invalid-payment',
      detail: 'requirements_mismatch',
    });
  });
});

describe('attack: C4 sessionNonce binding end to end (T-32)', () => {
  const lpaReq = (d: OctroiDeps) => buildAccepts(d, 100, { sessionKeyRequired: true })[0]!;
  it('random nonce on an LPA route ⇒ deny; sessionNonce ⇒ serve; key swapped after signing ⇒ deny; plain top-up accepts random', async () => {
    const d = deps();
    const lpa = (payment: PaymentPayload, sessionPubKey = SPK) =>
      decide({ resource, mb: 100, payment, requireSessionKey: true, sessionPubKey }, d);
    expect(await lpa(paymentPayload(lpaReq(d), { nonce: `0x${'42'.repeat(32)}` }))).toMatchObject({
      reason: 'invalid-payment',
    });
    const bound = paymentPayload(lpaReq(d), { nonce: sessionNonce(SPK, keccak256) });
    expect((await lpa(bound)).kind).toBe('serve-paid');
    expect(await lpa(bound, `0x${'07'.repeat(32)}`)).toMatchObject({
      reason: 'invalid-payment',
      detail: 'session_binding',
    });
    const topUp = await decide(
      { resource, mb: 100, payment: pay(d, 100, { nonce: `0x${'43'.repeat(32)}` }) },
      d,
    );
    expect(topUp.kind).toBe('serve-paid');
  });
});
