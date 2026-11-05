import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { MockPersonhood, type Ledger, type LedgerQuery } from '@ethglobal/adapters';
import { fixtureProof } from '@ethglobal/adapters/testing';
import { hourBucket } from '@ethglobal/protocol/ids';

import { decide, EntitlementStore } from '../../src/index.js';
import {
  campaign,
  claimChallenge,
  deps,
  failing,
  freeReq,
  ledgerWith,
  type TestDeps,
} from '../helpers.js';

const RUNS = { numRuns: 200 };
const PRICE = 500_000n;

/** A fresh mock per call: signal binding and the level-from-identifier map, but no one-shot rule (O1). */
const repeatable = () => ({
  verify: (...args: Parameters<MockPersonhood['verify']>) =>
    new MockPersonhood({ expectSignal: true }).verify(...args),
});

const step = fc.record({
  person: fc.nat({ max: 7 }),
  level: fc.constantFrom('orb' as const, 'document' as const, 'device' as const),
  replayChallenge: fc.boolean(),
  wrongSignal: fc.boolean(),
  togglePause: fc.boolean(),
  advanceMs: fc.integer({ min: 0, max: 20 * 60_000 }),
});

describe('budget properties', () => {
  it('no sequence of ≤ 200 free-lane requests serves more than the budget or a nullifier twice', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(step, { maxLength: 200 }),
        fc.bigInt({ min: 0n, max: 6n * PRICE }),
        async (steps, budgetUsd6) => {
          const d = deps({ personhood: repeatable() });
          const c = campaign({ expiresAt: d.now() + 365 * 86_400_000 });
          // A model of DataDrop: paused, spent, per-hour count.
          const chain = { paused: false, spent: 0n, bucket: hourBucket(d.now()), inBucket: 0 };
          const served = new Set<string>();
          let servedMb = 0;
          let last = claimChallenge(d);
          for (const s of steps) {
            d.clock.advance(s.advanceMs);
            if (s.togglePause) chain.paused = !chain.paused;
            if (hourBucket(d.now()) !== chain.bucket)
              Object.assign(chain, { bucket: hourBucket(d.now()), inBucket: 0 });
            const ch = s.replayChallenge ? last : claimChallenge(d);
            last = ch;
            const signal = s.wrongSignal ? claimChallenge(d).signal : ch.signal;
            const counters = {
              paused: chain.paused,
              budgetUsd6,
              spentUsd6: chain.spent,
              claimsThisHour: chain.inBucket,
              hourBucket: chain.bucket,
            };
            const r = await decide(
              freeReq(d, {
                challenge: ch,
                campaign: c,
                counters,
                proof: fixtureProof(s.level, signal, `p${s.person}`),
              }),
              d,
            );
            if (r.kind !== 'serve-free') continue;
            expect(served.has(r.entitlement.key)).toBe(false);
            served.add(r.entitlement.key);
            servedMb += r.mb;
            await new EntitlementStore(d.ledger, d.now).create(r.entitlement); // the API's write after DataDrop.claim
            chain.spent += c.pricePerClaimUsd6;
            chain.inBucket += 1;
          }
          expect(BigInt(served.size) * PRICE <= budgetUsd6).toBe(true);
          expect(servedMb).toBeLessThanOrEqual(served.size * 300);
        },
      ),
      RUNS,
    );
  });

  it('fail closed: whichever ledger call throws, the free lane denies ledger-unavailable and never serves', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom('put', 'query', 'nonce-query', 'entitlement-query'),
        async (which) => {
          const d = deps({ personhood: repeatable() });
          const only = (type: string) => (q?: LedgerQuery) =>
            q?.annotations?.type === type ? failing() : d.ledger.query(q);
          const methods: Record<string, Partial<Ledger>> = {
            put: { put: failing },
            query: { query: failing },
            'nonce-query': { query: only('nonce') },
            'entitlement-query': { query: only('entitlement') },
          };
          const broken: TestDeps = { ...d, ledger: ledgerWith(d.ledger, methods[which]!) };
          expect(await decide(freeReq(broken), broken)).toMatchObject({
            kind: 'deny',
            reason: 'ledger-unavailable',
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});
