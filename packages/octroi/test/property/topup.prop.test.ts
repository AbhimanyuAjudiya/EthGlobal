import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { dayBucket } from '@ethglobal/protocol/ids';

import { shouldTopUp, type TopUpPolicy } from '../../src/index.js';
import { entitlement, T0 } from '../helpers.js';

const MINUTE = 60_000;

describe('shouldTopUp properties', () => {
  it('a 24 h simulated loop never spends more than the cap per UTC day and buys at most once per expiresAt', () => {
    fc.assert(
      fc.property(
        fc.record({
          cap: fc.bigInt({ min: 0n, max: 5_000_000n }),
          stepMb: fc.constantFrom(100, 200, 300),
          thresholdMb: fc.integer({ min: 0, max: 200 }),
          expiryLeadS: fc.integer({ min: 60, max: 86_400 }),
          topUpOnExpiry: fc.boolean(),
          expiresInMin: fc.integer({ min: 1, max: 30 * 60 }),
          usage: fc.array(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 64 }),
        }),
        (g) => {
          const p: TopUpPolicy = {
            maxUsd6PerDay: g.cap,
            thresholdMb: g.thresholdMb,
            stepMb: g.stepMb,
            paused: false,
            topUpOnExpiry: g.topUpOnExpiry,
            expiryLeadS: g.expiryLeadS,
          };
          const price = BigInt(g.stepMb / 100) * 400_000n;
          let e = entitlement({ mbTotal: 300, mbUsed: 0, expiresAt: T0 + g.expiresInMin * MINUTE });
          const spent = new Map<number, bigint>();
          let lastExpiryBought: number | undefined;
          let expiryBuys = 0;
          for (let m = 0; m < 24 * 60; m += 1) {
            const now = T0 + m * MINUTE;
            const used = Math.min(e.mbTotal, e.mbUsed + g.usage[m % g.usage.length]!);
            e = { ...e, mbUsed: used };
            const day = dayBucket(now);
            const v = shouldTopUp(e, p, spent.get(day) ?? 0n, now, price, lastExpiryBought);
            if (!v.buy) continue;
            spent.set(day, (spent.get(day) ?? 0n) + v.costUsd6);
            e = { ...e, mbTotal: e.mbTotal + v.mb };
            if (v.reason === 'expiry') {
              lastExpiryBought = e.expiresAt;
              expiryBuys += 1;
            }
          }
          for (const total of spent.values()) expect(total <= g.cap).toBe(true);
          expect(expiryBuys).toBeLessThanOrEqual(1);
        },
      ),
      { numRuns: 300 },
    );
  });
});
