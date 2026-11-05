/** AP1 — nullifier replay over HTTP, sequential and concurrent (T-18, T-46, N1). */
import { describe, expect, it, vi } from 'vitest';

import {
  DAY,
  errorOf,
  harness,
  permissivePersonhood,
  provisioned,
  scopedCampaignId,
  SPONSOR,
} from './fixture.js';

describe('attack: nullifier replay (AP1)', () => {
  it('sequential: the same human with a new challenge and a new session key ⇒ 409; one claim, one order', async () => {
    const h = await harness();
    await provisioned(h, 'h1');
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const again = await h.claim({ seed: 'h1' });
    expect([again.res.status, await errorOf(again.res)]).toEqual([409, 'replay']);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    expect(h.reseller.orders()).toHaveLength(1);
    expect(verify.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it.each([2, 10])(
    '%i concurrent claims of one human (permissive verifier) ⇒ exactly one 201, one DataDrop.claim, one order',
    async (n) => {
      const h = await harness({ overrides: { adapters: { personhood: permissivePersonhood() } } });
      const results = await Promise.all(Array.from({ length: n }, () => h.claim({ seed: 'h2' })));
      const statuses = results.map((r) => r.res.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(n - 1);
      expect(h.dataDrop.claimedEvents).toHaveLength(1);
      expect(h.reseller.orders()).toHaveLength(1);
    },
  );

  it('the ledger entity gone (expired) ⇒ still 409: DataDrop.claimed is authoritative; claimed() throwing ⇒ 503', async () => {
    const h = await harness({ overrides: { adapters: { personhood: permissivePersonhood() } } });
    await provisioned(h, 'h3');
    h.clock.advance(7 * DAY + 1);
    const res = await h.claim({ seed: 'h3' });
    expect([res.res.status, await errorOf(res.res)]).toEqual([409, 'replay']);
    h.dataDrop.failNext.claimed = true;
    const down = await h.claim({ seed: 'h4' });
    expect(down.res.status).toBe(503);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });

  it('another campaign, same human ⇒ 409 while the global ent:v1: entitlement lives (recorded: one free bundle per human)', async () => {
    const h = await harness({ overrides: { adapters: { personhood: permissivePersonhood() } } });
    await provisioned(h, 'h5');
    const other = scopedCampaignId(SPONSOR, 3n);
    const first = (await h.deps.stores.campaigns.get(h.campaignId))?.payload;
    if (!first) throw new Error('seed campaign missing');
    h.dataDrop.create(other, {
      sponsor: SPONSOR,
      pricePerClaim: 1n,
      budget: 100n,
      spent: 0n,
      claimsPerHour: 10,
      expiresAt: first.expiresAt,
    });
    await h.deps.stores.campaigns.put({ ...first, id: other });
    expect(await errorOf((await h.claim({ seed: 'h5', campaignId: other })).res)).toBe('replay');
  });
});
