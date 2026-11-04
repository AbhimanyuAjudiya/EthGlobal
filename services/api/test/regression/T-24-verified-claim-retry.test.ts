/** T-24, AP5.3: cheap checks before verify, and a verified-but-unserved human completes on retry from the same session. */
import { describe, expect, it, vi } from 'vitest';

import { hourBucket } from '@ethglobal/protocol/ids';

import { harness } from '../support/harness.js';

describe('T-24 verified claim retry', () => {
  it('a full hour is refused before verify; a chain outage after verify is recovered next hour without re-proving', async () => {
    const h = await harness({ campaign: { claimsPerHour: 10 } });
    h.dataDrop.failNext.claim = true;
    const first = await h.claim({ seed: 't24' });
    expect(first.res.status).toBe(503);
    h.dataDrop.campaigns.get(h.campaignId)?.perHour.set(hourBucket(h.clock.now()), 10);
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    expect((await h.claim({ seed: 't24-other' })).res.status).toBe(429);
    expect(verify).not.toHaveBeenCalled();
    h.clock.advance(3_600_000 - (h.clock.now() % 3_600_000));
    const retry = await h.claim({ seed: 't24', keys: first.keys });
    expect(retry.res.status).toBe(201);
    expect(verify).not.toHaveBeenCalled();
  });
});
