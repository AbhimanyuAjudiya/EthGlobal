/** T-46, AP5.1: 20 concurrent humans against claimsPerHour 5 ⇒ exactly 5 served, 15 × 429, ≤ 5 verifications. */
import { describe, expect, it, vi } from 'vitest';

import { harness } from '../support/harness.js';

describe('T-46 hourly-cap race', () => {
  it('admission takes the slot before verify', async () => {
    const h = await harness({ campaign: { claimsPerHour: 5 } });
    // Isolate admission from the independently tested 80%-burst anomaly pause.
    vi.spyOn(h.deps.anomaly, 'record').mockResolvedValue(false);
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, i) => h.claim({ seed: `race-${i}` })),
    );
    const statuses = results.map((r) => r.res.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(5);
    expect(statuses.filter((s) => s === 429)).toHaveLength(15);
    expect(verify.mock.calls.length).toBeLessThanOrEqual(5);
    expect([h.dataDrop.claimedEvents.length, h.reseller.orders().length]).toEqual([5, 5]);
  });
});
