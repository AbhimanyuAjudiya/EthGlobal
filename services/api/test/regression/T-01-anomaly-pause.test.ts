/** T-01, AP14: ≥ 80 % of claimsPerHour within 10 minutes ⇒ the attestor pauses the campaign once; the next claim is 423. */
import { describe, expect, it, vi } from 'vitest';

import { errorOf, harness, provisioned } from '../support/harness.js';

describe('T-01 anomaly auto-pause', () => {
  it('8 claims of a 10/h campaign inside 10 min ⇒ pause(id, true) once, then 423', async () => {
    const h = await harness({ campaign: { claimsPerHour: 10 } });
    for (let i = 0; i < 8; i++) await provisioned(h, `anomaly-${i}`);
    await vi.waitFor(() => expect(h.dataDrop.pauses).toEqual([{ id: h.campaignId, paused: true }]));
    expect(await errorOf((await h.claim({ seed: 'anomaly-9' })).res)).toBe('campaign_paused');
    expect(h.lines.join('')).toMatch(/"event":"anomaly"/);
  });
});
