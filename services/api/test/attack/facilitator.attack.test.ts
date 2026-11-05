/** AP19 — the public self-run facilitator (T-75, T-16): unfunded payers and floods spend no gas. */
import { describe, expect, it } from 'vitest';

import { anvilAccounts, anvilRoles } from '@ethglobal/adapters/testing';

import { exactPayment, harness } from './fixture.js';
import { fakeUsdcRail } from '../support/fake-chain.js';

describe('attack: public facilitator (AP19)', () => {
  it('50 settle requests from unfunded payers ⇒ 0 relayed transactions', async () => {
    let now = () => 0;
    const fake = fakeUsdcRail(() => now());
    const h = await harness({ overrides: fake.overrides });
    now = h.clock.now;
    const req = { ...h.deps.accepts[0]!, amount: '400000' };
    const keys = Array.from(
      { length: 50 },
      (_, i) => `0x${(i + 1).toString(16).padStart(64, '0')}` as const,
    );
    const results = await Promise.all(
      keys.map(async (key) =>
        h.request('/facilitator/settle', {
          method: 'POST',
          ip: '192.0.2.100',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            x402Version: 2,
            paymentPayload: await exactPayment(key, req, { now: h.clock.now() }),
            paymentRequirements: req,
          }),
        }),
      ),
    );
    const bodies = (await Promise.all(
      results.filter((r) => r.status === 200).map((r) => r.json()),
    )) as { success: boolean }[];
    expect(bodies.every((b) => !b.success)).toBe(true);
    expect(results.filter((r) => r.status === 429)).toHaveLength(20);
    expect(fake.usdc.sent).toHaveLength(0);
    expect(anvilAccounts[anvilRoles.relayer]).toBeDefined();
  });
});
