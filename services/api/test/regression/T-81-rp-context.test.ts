/** T-81, AP17: rp_context is server-clocked, ttl 300, our action only, and rate-limited before signing. */
import { describe, expect, it } from 'vitest';

import { rpContextSchema } from '@ethglobal/protocol/schemas';

import { harness } from '../support/harness.js';

describe('T-81 rp_context', () => {
  it('two contexts differ in nonce, share the action, and live exactly 300 s from the server clock', async () => {
    const h = await harness();
    const issue = async () =>
      rpContextSchema.parse(
        await (
          await h.json('/world/rp-context', {
            audience: 'recharge',
            path: '/claim',
            ttl: 9999,
            action: 'other',
          })
        ).json(),
      );
    const [a, b] = [await issue(), await issue()];
    expect(a.nonce).not.toBe(b.nonce);
    expect([a.action, a.expires_at - a.created_at, a.created_at]).toEqual([
      'recharge-welcome',
      300,
      Math.floor(h.clock.now() / 1000),
    ]);
  });
});
