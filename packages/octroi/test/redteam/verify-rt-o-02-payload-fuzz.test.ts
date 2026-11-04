/**
 * Red-team verification variant for RT-O-02 (validate, then use; strict payload branches — A-32, A-40): fuzz payment
 * payload shapes with an extra key at EVERY nesting level (top, accepted, accepted.extra, payload,
 * payload.authorization, resource), including prototype-ish own keys (`__proto__`, `constructor`) that a JSON body
 * can carry. Properties:
 *   - decide() never throws on any shape;
 *   - a Hedera payment on an LPA route is never served and never settled, whatever the extra key;
 *   - an EVM payment that is served hands the rail exactly the honest validated payload (no extra key ever reaches
 *     verify/settle) and mints the honest entitlement key.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import type { PaymentRail } from '@ethglobal/adapters';
import { paymentPayload } from '@ethglobal/adapters/testing';
import { keccak256 } from '@ethglobal/crypto';
import { NETWORKS } from '@ethglobal/protocol/ids';
import type { PaymentPayload, PaymentRequirements } from '@ethglobal/protocol/schemas';

import { buildAccepts, decide } from '../../src/index.js';
import { deps, resource, SPK, type TestDeps } from '../helpers.js';

const LEVELS = [
  [],
  ['accepted'],
  ['accepted', 'extra'],
  ['payload'],
  ['payload', 'authorization'],
] as const;
const SPECIAL = [
  '__proto__',
  'constructor',
  'prototype',
  'authorization',
  'transaction',
  'signature',
  'maxAmountRequired',
  'from',
  'nonce',
  'value',
  'to',
  'payer',
  'network',
];
const keyArb = fc.oneof(fc.constantFrom(...SPECIAL), fc.string({ minLength: 1, maxLength: 12 }));
const valueArb = fc.oneof(
  fc.jsonValue({ maxDepth: 2 }),
  fc.constant({
    from: '0x' + '9'.repeat(40),
    to: '0x' + '9'.repeat(40),
    value: '1',
    nonce: '0x' + '7'.repeat(64),
  }),
);

/** Adds `key` as an OWN enumerable property at `path` (so `__proto__` is data, as JSON.parse makes it), JSON round-trip. */
function inject(base: unknown, path: readonly string[], key: string, value: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(base)) as Record<string, unknown>;
  let target: Record<string, unknown> = copy;
  for (const p of path) {
    const next = target[p];
    if (typeof next !== 'object' || next === null) return null;
    target = next as Record<string, unknown>;
  }
  if (Object.prototype.hasOwnProperty.call(target, key)) return null; // adding, not changing
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return JSON.parse(JSON.stringify(copy)) as unknown;
}

/** Key-order-insensitive JSON (zod emits keys in schema order). */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x: unknown) =>
    x && typeof x === 'object' && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x,
  );

type Recorded = PaymentRail & { seen: unknown[]; settled: number };
function recording(rail: PaymentRail): Recorded {
  const r: Recorded = {
    seen: [],
    settled: 0,
    createPaymentRequirement: (i) => rail.createPaymentRequirement(i),
    verify: async (p, q) => {
      r.seen.push(JSON.parse(JSON.stringify(p)));
      return rail.verify(p, q);
    },
    settle: async (p, q) => {
      r.seen.push(JSON.parse(JSON.stringify(p)));
      r.settled += 1;
      return rail.settle(p, q);
    },
  };
  return r;
}

const offer = (d: TestDeps, network: string, lpa: boolean): PaymentRequirements =>
  buildAccepts(d, 100, { sessionKeyRequired: lpa }).find((o) => o.network === network)!;

const honestHedera = (): PaymentRail & { settled: number } => {
  const rail = {
    settled: 0,
    createPaymentRequirement: () => {
      throw new Error('unused');
    },
    verify: async () => ({ isValid: true as const, payer: '0.0.777' }),
    settle: async () => {
      rail.settled += 1;
      return {
        success: true as const,
        transaction: '0.0.9185802@1762200000.000000001',
        network: NETWORKS.hederaTestnet,
        payer: '0.0.777',
      };
    },
  };
  return rail;
};

describe('verify RT-O-02: extra keys at every nesting level never reach a consumer', () => {
  it('EVM: served ⇒ the rail saw exactly the honest payload and the honest key (fuzz, 300 runs)', async () => {
    // the honest baseline
    const d0 = deps();
    const honest = paymentPayload(offer(d0, NETWORKS.anvil, false));
    const base = await decide({ resource, mb: 100, payment: honest }, d0);
    expect(base.kind).toBe('serve-paid');
    const honestKey = base.kind === 'serve-paid' ? base.entitlement.key : '';
    const honestJson = canon(honest);

    await fc.assert(
      fc.asyncProperty(fc.constantFrom(...LEVELS), keyArb, valueArb, async (path, key, value) => {
        const mutated = inject(honest, path, key, value);
        fc.pre(mutated !== null);
        const d = deps();
        const rail = recording(d.payments);
        const r = await decide(
          { resource, mb: 100, payment: mutated as PaymentPayload },
          { ...d, payments: rail },
        );
        if (r.kind === 'serve-paid') {
          expect(r.entitlement.key).toBe(honestKey);
          for (const seen of rail.seen) expect(canon(seen)).toBe(honestJson);
          expect(path).not.toEqual(['payload']); // the payload branches are strict; authorization extras are stripped
        } else {
          expect(r.kind).toBe('deny');
          if (path[0] === 'payload' && path.length === 1) expect(rail.settled).toBe(0);
        }
      }),
      { numRuns: 300, seed: 0x5eed02 },
    );
  });

  it('Hedera on an LPA route: never served, never settled, never a throw (fuzz, 300 runs)', async () => {
    const d0 = deps();
    const honest = {
      x402Version: 2,
      accepted: offer(d0, NETWORKS.hederaTestnet, true),
      payload: { transaction: Buffer.from('victim-hts-transfer').toString('base64') },
    };
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom(...LEVELS.slice(0, 4)),
        keyArb,
        valueArb,
        async (path, key, value) => {
          const mutated = inject(honest, path, key, value);
          fc.pre(mutated !== null);
          const rail = honestHedera();
          const d = { ...deps(), payments: rail };
          const r = await decide(
            {
              resource,
              mb: 100,
              payment: mutated as PaymentPayload,
              requireSessionKey: true,
              sessionPubKey: SPK,
            },
            d,
          );
          expect(r.kind).toBe('deny');
          expect(rail.settled).toBe(0);
        },
      ),
      { numRuns: 300, seed: 0x5eed03 },
    );
  });

  it('a JSON body with an own `__proto__` carrying an authorization beside a Hedera transaction is refused', async () => {
    const rail = honestHedera();
    const d = { ...deps(), payments: rail };
    const accepted = offer(d, NETWORKS.hederaTestnet, true);
    const body = `{"x402Version":2,"accepted":${JSON.stringify(accepted)},"payload":{"transaction":"${Buffer.from('v').toString('base64')}","__proto__":{"authorization":{"nonce":"0x${'7'.repeat(64)}"}}}}`;
    const payment = JSON.parse(body) as PaymentPayload;
    const r = await decide(
      { resource, mb: 100, payment, requireSessionKey: true, sessionPubKey: SPK },
      d,
    );
    expect(r.kind).toBe('deny');
    expect(rail.settled).toBe(0);
    expect(keccak256).toBeTypeOf('function');
  });
});
