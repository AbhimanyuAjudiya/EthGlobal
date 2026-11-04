/** T-34, AP3: the route verifies the raw bytes; one byte of drift or a stale timestamp is a 401, a replay 409, garbage 400. */
import { describe, expect, it } from 'vitest';

import { harness, iccidOf, provisioned, webhook } from '../support/harness.js';

describe('T-34 webhook route', () => {
  it('raw bytes are the MAC input: valid 204, trailing newline 401, replay 409, old 401', async () => {
    const h = await harness();
    const { key } = await provisioned(h);
    const iccid = iccidOf(h, key);
    const hook = webhook(h, iccid, 33);
    expect((await hook.send({ ...hook.delivery, body: `${hook.delivery.body}\n` })).status).toBe(
      401,
    );
    expect((await hook.send()).status).toBe(204);
    expect((await hook.send()).status).toBe(409);
    expect((await webhook(h, iccid, 34, { at: h.clock.now() - 600_000 }).send()).status).toBe(401);
  });
});
