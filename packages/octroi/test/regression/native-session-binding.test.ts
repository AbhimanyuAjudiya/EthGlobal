import { describe, expect, it, vi } from 'vitest';

import { keccak256 } from '@ethglobal/crypto';
import type { PaymentPayload } from '@ethglobal/protocol/schemas';
import { sessionNonce } from '@ethglobal/protocol/x402';

import { buildAccepts, decide, type OctroiDeps } from '../../src/index.js';
import { deps, resource, SPK } from '../helpers.js';

function setup(over: Partial<OctroiDeps> = {}) {
  const d = deps(over);
  const verify = vi.fn(async () => ({ isValid: true as const, payer: '0.0.777' }));
  const settle = vi.fn(async () => ({
    success: true as const,
    network: 'hedera:testnet',
    payer: '0.0.777',
    transaction: '0.0.4242@1793941200.000000001',
  }));
  d.payments = {
    createPaymentRequirement: d.payments.createPaymentRequirement.bind(d.payments),
    verify,
    settle,
  };
  const payment: PaymentPayload = {
    x402Version: 2,
    accepted: buildAccepts(d, 1000, { sessionKeyRequired: true })[1]!,
    payload: { transaction: 'AAAA' },
  };
  const request = { resource, mb: 1000, payment, requireSessionKey: true, sessionPubKey: SPK };
  return { d, payment, request, verify, settle };
}

describe('native eSIM session-binding boundary', () => {
  it('advertises a versioned memo capability only for native delivery quotes', () => {
    const d = deps();
    const bound = buildAccepts(d, 1000, { sessionKeyRequired: true });
    expect(bound[1]!.extra).toMatchObject({
      sessionKeyRequired: true,
      sessionBinding: 'hedera-memo-v1',
    });
    expect(bound[0]!.extra).not.toHaveProperty('sessionBinding');
    expect(buildAccepts(d, 1000)[1]!.extra).not.toHaveProperty('sessionBinding');
  });

  it('serves a verified native transfer only for the originally bound session', async () => {
    const nativeSessionBinding = vi.fn(() => sessionNonce(SPK, keccak256));
    const t = setup({ nativeSessionBinding });
    expect(await decide(t.request, t.d)).toMatchObject({
      kind: 'serve-paid',
      entitlement: { payer: '0.0.777', network: 'hedera:testnet' },
    });
    expect(nativeSessionBinding).toHaveBeenCalledWith(t.payment);
    expect(t.settle).toHaveBeenCalledTimes(1);
    expect(
      await decide({ ...t.request, sessionPubKey: `0x${'ef'.repeat(32)}` }, t.d),
    ).toMatchObject({ kind: 'deny', detail: 'session_binding' });
    expect(t.settle).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-decoder', 'missing-memo', 'wrong-memo', 'malformed-transaction'] as const)(
    '%s fails before verify or settlement',
    async (failure) => {
      const t = setup(
        failure === 'missing-decoder'
          ? {}
          : {
              nativeSessionBinding: () => {
                if (failure === 'malformed-transaction') throw new Error('invalid protobuf');
                return failure === 'wrong-memo' ? `0x${'ef'.repeat(32)}` : undefined;
              },
            },
      );
      expect(await decide(t.request, t.d)).toMatchObject({
        kind: 'deny',
        reason: 'invalid-payment',
      });
      expect(t.verify).not.toHaveBeenCalled();
      expect(t.settle).not.toHaveBeenCalled();
    },
  );

  it('does not trust an unsigned JSON sessionBinding echo', async () => {
    const t = setup({ nativeSessionBinding: () => undefined });
    const injected = { ...t.payment, sessionBinding: sessionNonce(SPK, keccak256) };
    expect(await decide({ ...t.request, payment: injected }, t.d)).toMatchObject({
      kind: 'deny',
      reason: 'invalid-payment',
    });
    expect(t.settle).not.toHaveBeenCalled();
  });

  it.each(['0.0.999', '0.0.0777', '0x123'])(
    'rejects a facilitator settlement payer mismatch: %s',
    async (payer) => {
      const t = setup({ nativeSessionBinding: () => sessionNonce(SPK, keccak256) });
      t.settle.mockResolvedValueOnce({
        success: true,
        network: 'hedera:testnet',
        payer,
        transaction: '0.0.4242@1793941200.000000001',
      });
      expect(await decide(t.request, t.d)).toMatchObject({
        kind: 'deny',
        detail: 'settlement_payer',
      });
    },
  );
});
