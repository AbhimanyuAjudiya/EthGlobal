import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { sizeBundle } from '../../src/index.js';

const RUNS = { numRuns: 500 };
const bundleMb = { orb: 300, document: 300, device: 0 as const };
const wholesale = fc.bigInt({ min: 100_000n, max: 50_000_000n });
const resale = fc.bigInt({ min: 100_000n, max: 10_000_000n });
const freeTier = fc.constantFrom('orb' as const, 'document' as const);

describe('sizeBundle properties', () => {
  it('bounds and the EV inequality: 0 ≤ mb ≤ 300 and mb × wholesale / 1000 ≤ 0.8 × idResale', () => {
    fc.assert(
      fc.property(wholesale, resale, freeTier, (wholesaleUsd6PerGb, idResaleUsd6, tier) => {
        const mb = sizeBundle({ bundleMb, idResaleUsd6, wholesaleUsd6PerGb }, tier);
        expect(Number.isInteger(mb) && mb >= 0 && mb <= 300).toBe(true);
        expect(BigInt(mb) * wholesaleUsd6PerGb * 10n <= 8n * idResaleUsd6 * 1000n).toBe(true);
      }),
      RUNS,
    );
  });

  it('monotone (non-increasing) in the wholesale price', () => {
    fc.assert(
      fc.property(wholesale, wholesale, resale, freeTier, (a, b, idResaleUsd6, tier) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const size = (wholesaleUsd6PerGb: bigint) =>
          sizeBundle({ bundleMb, idResaleUsd6, wholesaleUsd6PerGb }, tier);
        expect(size(lo)).toBeGreaterThanOrEqual(size(hi));
      }),
      RUNS,
    );
  });

  it('device and none are always 0, whatever the campaign says', () => {
    fc.assert(
      fc.property(
        fc.bigInt({ min: -10n, max: 50_000_000n }),
        resale,
        fc.constantFrom('device' as const, 'none' as const),
        (w, r, tier) => {
          expect(sizeBundle({ bundleMb, idResaleUsd6: r, wholesaleUsd6PerGb: w }, tier)).toBe(0);
        },
      ),
      RUNS,
    );
  });
});
