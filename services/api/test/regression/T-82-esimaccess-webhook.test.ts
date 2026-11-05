/** T-82, AP3 (eSIM Access): the pseudo-headers are route-owned; a client copy never authenticates. */
import { describe, expect, it } from 'vitest';

import type { Reseller } from '@ethglobal/adapters';

import { harness } from '../support/harness.js';

describe('T-82 eSIM Access webhook', () => {
  it('client-sent x-recharge-url-token / x-recharge-remote-ip are stripped and replaced by the route', async () => {
    const h = await harness();
    const seen: Record<string, string | undefined>[] = [];
    const stub: Partial<Reseller> = {
      name: 'esimaccess',
      verifyWebhook: (_raw, headers) => {
        seen.push(headers);
        return { ok: false, reason: 'bad_signature' };
      },
    };
    Object.assign(h.deps.adapters, { reseller: { ...h.reseller, ...stub } });
    const res = await h.request('/webhooks/reseller/esimaccess', {
      method: 'POST',
      ip: '198.51.100.9',
      headers: {
        'content-type': 'application/json',
        'x-recharge-url-token': 'forged',
        'x-recharge-remote-ip': '3.1.131.226',
      },
      body: '{}',
    });
    expect(res.status).toBe(401);
    expect(seen[0]?.['x-recharge-url-token']).toBeUndefined();
    expect(seen[0]?.['x-recharge-remote-ip']).toBe('198.51.100.9');
  });
});
