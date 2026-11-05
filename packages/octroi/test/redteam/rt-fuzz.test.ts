/**
 * Red team (wave 1, octroi): schema-boundary fuzzing of every exported function (ARCHITECTURE §9 rule 2:
 * "octroi never throws for business outcomes … throws RechargeError('invalid_request') only for malformed input").
 * Every call must settle quickly; thrown values must be Error instances; the request-facing entry points must
 * throw only RechargeError. The tests once filed as findings (RT-O-01…09) are passing regressions named `… [RT-O-0N]`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { T0 } from '@ethglobal/adapters/testing';
import { RechargeError } from '@ethglobal/protocol/errors';
import type { Hex } from '@ethglobal/protocol/ids';

import {
  auditKey,
  buildAccepts,
  campaignClaimKey,
  campaignFromPayload,
  campaignToPayload,
  challenge,
  consumeChallenge,
  decide,
  decideGiftReclaim,
  onchainClaimKey,
  policyFromWire,
  policyToWire,
  quotaKey,
  shouldTopUp,
  signalFor,
  sizeBundle,
  tierFromLevel,
  type DecideRequest,
} from '../../src/index.js';
import { EntitlementStore, GiftStore, ReceiptStore } from '../../src/store/index.js';
import { claimChallenge, deps, freeReq, resource, SECRET, SPK } from '../helpers.js';

const RUNS = { numRuns: 300 };
const any = fc.anything({
  withBigInt: true,
  withNullPrototype: true,
  withTypedArray: true,
  withSparseArray: true,
});

type Outcome = { ok: true } | { ok: false; error: unknown };
const run = async (f: () => unknown): Promise<Outcome> => {
  try {
    await Promise.race([
      Promise.resolve().then(f),
      new Promise((_, rej) => setTimeout(() => rej(new Error('HANG')), 2_000)),
    ]);
    return { ok: true };
  } catch (error) {
    return { ok: false, error };
  }
};
const notHangAndErrorObject = (o: Outcome) => {
  if (!o.ok) {
    expect(o.error).toBeInstanceOf(Error);
    expect((o.error as Error).message).not.toBe('HANG');
  }
};
const typedOnly = (o: Outcome) => {
  if (!o.ok) expect(o.error).toBeInstanceOf(RechargeError);
};

describe('attack: rt fuzz — every export settles and throws only Error objects', () => {
  // Property: no export hangs or throws a non-Error, for arbitrary values in every argument position.
  it.each<[string, (a: unknown, b: unknown, c: unknown) => unknown]>([
    ['tierFromLevel', (a) => tierFromLevel(a as never)],
    ['campaignFromPayload', (a) => campaignFromPayload(a as never)],
    ['campaignToPayload', (a) => campaignToPayload(a as never)],
    ['quotaKey', (a, b) => quotaKey(a as never, b as never)],
    ['auditKey', (a, b) => auditKey(a as never, b as never)],
    ['campaignClaimKey', (a, b) => campaignClaimKey(a as never, b as never)],
    ['onchainClaimKey', (a, b) => onchainClaimKey(a as never, b as never)],
    ['sizeBundle', (a, b) => sizeBundle(a as never, b as never)],
    ['signalFor', (a, b) => signalFor(a as never, b as never)],
    ['challenge', (a, b, c) => challenge(a as never, b as never, SPK, c as never, SECRET)],
    ['buildAccepts', (a, b) => buildAccepts(deps(), a as never, b as never)],
    ['policyFromWire', (a) => policyFromWire(a as never)],
    ['policyToWire', (a) => policyToWire(a as never)],
    ['shouldTopUp', (a, b, c) => shouldTopUp(a as never, b as never, c as never, T0, 1n)],
    ['decideGiftReclaim', (a) => decideGiftReclaim(a as never)],
    [
      'EntitlementStore.getByKey',
      (a) =>
        new EntitlementStore(new InMemoryLedger({ now: () => T0 }), () => T0).getByKey(a as never),
    ],
    [
      'EntitlementStore.create',
      (a) =>
        new EntitlementStore(new InMemoryLedger({ now: () => T0 }), () => T0).create(a as never),
    ],
    [
      'EntitlementStore.patch',
      (a, b) =>
        new EntitlementStore(new InMemoryLedger({ now: () => T0 }), () => T0).patch(
          a as never,
          b as never,
        ),
    ],
    [
      'GiftStore.byPinKey',
      (a) => new GiftStore(new InMemoryLedger({ now: () => T0 }), () => T0).byPinKey(a as never),
    ],
    [
      'ReceiptStore.spentUsd6',
      (a, b, c) =>
        new ReceiptStore(new InMemoryLedger({ now: () => T0 }), () => T0).spentUsd6(
          a as never,
          b as never,
          c as never,
        ),
    ],
  ])('%s', async (_name, f) => {
    await fc.assert(
      fc.asyncProperty(any, any, any, async (a, b, c) =>
        notHangAndErrorObject(await run(() => f(a, b, c))),
      ),
      RUNS,
    );
  });

  // Property: consumeChallenge never throws for any challenge / key value — it answers 'invalid'.
  it('consumeChallenge(anything) resolves to "invalid" (or another ConsumeResult), never throws', async () => {
    await fc.assert(
      fc.asyncProperty(any, any, async (c, spk) => {
        const r = await consumeChallenge(
          new InMemoryLedger({ now: () => T0 }),
          new Set(),
          c as never,
          spk as Hex,
          T0,
          SECRET,
        );
        expect(['ok', 'replayed', 'expired', 'invalid', 'unavailable']).toContain(r);
        if (r === 'ok') throw new Error(`forged challenge accepted: ${JSON.stringify(c)}`);
      }),
      RUNS,
    );
  });

  // Regression RT-O-07 (fixed): decide() trusts an unvalidated Campaign (validityDays 0 ⇒ an entitlement born expired;
  // claimsPerHour ≤ 0 or a fractional claimsThisHour slips the cap comparison). Counterexample [-1, 0, -1.0000000000000002].
  it('decide(): free lane with hostile campaign / counters numbers never serves a malformed entitlement [RT-O-07]', async () => {
    const hostileNum = fc.oneof(
      fc.constant(Number.NaN),
      fc.constant(Infinity),
      fc.constant(-1),
      fc.constant(0),
      fc.double(),
      fc.integer(),
    );
    await fc.assert(
      fc.asyncProperty(
        hostileNum,
        hostileNum,
        hostileNum,
        async (perHour, validity, claimsThisHour) => {
          const d = deps();
          const req = freeReq(d, {
            challenge: claimChallenge(d),
            campaign: { ...freeReq(d).campaign!, claimsPerHour: perHour, validityDays: validity },
            counters: { ...freeReq(d).counters!, claimsThisHour },
          });
          let r;
          try {
            r = await decide(req, d);
          } catch (e) {
            expect(e).toBeInstanceOf(RechargeError);
            return;
          }
          if (r.kind === 'serve-free') {
            expect(Number.isSafeInteger(r.entitlement.expiresAt)).toBe(true);
            expect(r.entitlement.expiresAt).toBeGreaterThan(d.now());
          }
        },
      ),
      RUNS,
    );
  });

  // Regression RT-O-07 (fixed)
  it('decide() with hostile top-level request fields throws only RechargeError (or returns a Decision) [RT-O-07]', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          payment: fc.oneof(
            fc.constant(null),
            fc.constant({}),
            fc.constant({ accepted: null }),
            any,
          ),
          mb: fc.constantFrom(100, 200),
        }),
        async ({ payment, mb }) => {
          const d = deps();
          typedOnly(
            await run(() => decide({ resource, mb, payment } as unknown as DecideRequest, d)),
          );
        },
      ),
      { numRuns: 100 },
    );
  });

  // Regression RT-O-07 (fixed)
  it('decide(): a verifier returning a non-hex32 nullifier yields a deny, not a throw after the verification is burned [RT-O-07]', async () => {
    const d = {
      ...deps(),
      personhood: {
        verify: async () => ({ nullifierHash: '0x1234' as Hex, level: 'orb' as const }),
      },
    };
    typedOnly(await run(() => decide(freeReq(d), d)));
    await expect(decide(freeReq(d), d)).resolves.toMatchObject({ kind: 'deny' });
  });
});
