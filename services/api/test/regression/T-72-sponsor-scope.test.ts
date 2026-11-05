/** T-72, RT-A-04: the SponsorLogin bearer reads; registration is a one-time write; the audit key is shown once. */
import { describe, expect, it } from 'vitest';

import { T0 } from '@ethglobal/adapters/testing';

import { campaignFields } from '../support/campaign.js';
import { scopedCampaignId, sponsorAuthorization, sponsorLogin } from '../support/client.js';
import { DAY, errorOf, harness, SPONSOR, SPONSOR_KEY, type Harness } from '../support/harness.js';

const ID = scopedCampaignId(SPONSOR, 7n);

type App = Awaited<ReturnType<Harness['restart']>>['app'];

async function register(h: Harness, name: string, app?: App) {
  const login = await sponsorLogin(SPONSOR_KEY, h.deps.chainId, ID, h.clock.now());
  const body = {
    campaign: campaignFields({
      id: ID,
      sponsor: SPONSOR,
      name,
      maxClaims: 100,
      claimsPerHour: 10,
      contract: h.dataDrop.address,
      expiresAt: T0 + 10 * DAY,
    }),
    auth: { issuedAt: login.issuedAt, signature: login.signature },
  };
  const init = {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.10' },
    body: JSON.stringify(body),
  };
  return app ? app.request('/sponsor', init) : h.request('/sponsor', init);
}

describe('T-72 sponsor scopes (RT-A-04)', () => {
  it('first registration → 201 + auditKey; any later one (even the sponsor’s own fresh signature) → 409, no auditKey', async () => {
    const h = await harness();
    h.dataDrop.create(ID, {
      sponsor: SPONSOR,
      pricePerClaim: 500_000n,
      budget: 10_000_000n,
      spent: 0n,
      claimsPerHour: 10,
      expiresAt: T0 + 10 * DAY,
    });
    const [a, b] = await Promise.all([register(h, 'First'), register(h, 'Racer')]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]); // two concurrent first registrations: one wins
    h.clock.advance(5_000);
    const again = await register(h, 'Renamed');
    expect([again.status, await errorOf(again)]).toEqual([409, 'campaign_exists']);
    const stored = (await h.deps.stores.campaigns.get(ID))!.payload;
    expect(['First', 'Racer']).toContain(stored.name);
    // the dashboard still shows the audit key once (its own channel), then never — also after a restart
    const bearer = await sponsorAuthorization(SPONSOR_KEY, h.deps.chainId, ID, h.clock.now());
    const view = async (app: {
      request: Harness['request'] | ((p: string, i: RequestInit) => Response | Promise<Response>);
    }) =>
      (await (
        await app.request(`/sponsor/${ID}`, {
          headers: { authorization: bearer, 'x-forwarded-for': '203.0.113.9' },
        })
      ).json()) as { auditKey?: string };
    expect(typeof (await view(h)).auditKey).toBe('string');
    expect((await view(h)).auditKey).toBeUndefined();
    const restarted = await h.restart();
    expect((await view(restarted.app)).auditKey).toBeUndefined();
    // a restarted process cannot be talked into a second first registration either
    const late = await register(h, 'After restart', restarted.app);
    expect(late.status).toBe(409);
  });
});
