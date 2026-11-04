import { describe, expect, it } from 'vitest';

import { fixtureProof, T0 } from '@ethglobal/adapters/testing';
import { sponsorViewSchema } from '@ethglobal/protocol/schemas';

import { scopedCampaignId, sponsorAuthorization, sponsorLogin } from './support/client.js';
import {
  DAY,
  errorOf,
  harness,
  provisioned,
  SPONSOR,
  SPONSOR_KEY,
  STRANGER_KEY,
  type Harness,
} from './support/harness.js';

const register = async (
  h: Harness,
  key: `0x${string}` = SPONSOR_KEY,
  id = scopedCampaignId(SPONSOR, 2n),
  issuedAt = h.clock.now(),
) => {
  const login = await sponsorLogin(key, h.deps.chainId, id, issuedAt);
  return h.json('/sponsor', {
    campaign: {
      id,
      sponsor: SPONSOR,
      name: 'Second campaign',
      bundleMb: { orb: 300, document: 160, device: 0 },
      pricePerClaimUsd6: '500000',
      maxClaims: 100,
      claimsPerHour: 10,
      validityDays: 7,
      wholesaleUsd6PerGb: '1140000',
      idResaleUsd6: '500000',
      planId: 'in-300mb-7d',
      network: 'eip155:31337',
      contract: h.dataDrop.address,
      expiresAt: T0 + 10 * DAY,
    },
    auth: { issuedAt: login.issuedAt, signature: login.signature },
  });
};

describe('POST /sponsor', () => {
  it('register with a valid SponsorLogin → 201 + auditKey', async () => {
    const h = await harness();
    const id = scopedCampaignId(SPONSOR, 2n);
    h.dataDrop.create(id, {
      sponsor: SPONSOR,
      pricePerClaim: 500_000n,
      budget: 10_000_000n,
      spent: 0n,
      claimsPerHour: 10,
      expiresAt: T0 + 10 * DAY,
    });
    const res = await register(h);
    expect(res.status).toBe(201);
    const registered = (await res.json()) as { id: string; auditKey: string };
    expect(registered.id).toBe(id);
    expect(registered.auditKey).toMatch(/^0x[0-9a-f]{64}$/);
    expect(await h.deps.stores.campaigns.get(id)).not.toBeNull();
  });

  it('no on-chain campaign → 404; on-chain sponsor differs / stranger signs → 401; stale login → 401', async () => {
    const h = await harness();
    expect((await register(h)).status).toBe(404);
    const id = scopedCampaignId(SPONSOR, 2n);
    h.dataDrop.create(id, {
      sponsor: '0x14dC79964da2C08b23698B3D3cc7Ca32193d9955',
      pricePerClaim: 1n,
      budget: 10n,
      spent: 0n,
      claimsPerHour: 1,
      expiresAt: T0 + DAY,
    });
    expect(await errorOf(await register(h))).toBe('unauthorized');
    expect((await register(h, STRANGER_KEY)).status).toBe(401);
    expect((await register(h, SPONSOR_KEY, id, h.clock.now() - 3_600_001)).status).toBe(401);
  });
});

describe('GET /sponsor/:id', () => {
  it('lists campaignClaimKeys (never a nullifier), chain counters and expiring quotas; auditKey once', async () => {
    const h = await harness();
    await provisioned(h, 'sponsor-view');
    const auth = await sponsorAuthorization(
      SPONSOR_KEY,
      h.deps.chainId,
      h.campaignId,
      h.clock.now(),
    );
    const first = sponsorViewSchema.parse(
      await (await h.get(`/sponsor/${h.campaignId}`, { authorization: auth })).json(),
    );
    expect(first.claims).toHaveLength(1);
    expect(first.claims[0]).toMatchObject({ tier: 'orb', mb: 300, usd6: '500000' });
    expect(JSON.stringify(fixtureProof('orb', undefined, 'sponsor-view'))).not.toContain(
      first.claims[0]?.campaignClaimKey.slice(2) ?? '',
    );
    expect(first.chain).toMatchObject({
      budgetUsd6: '1000000000',
      spentUsd6: '500000',
      claims: 1,
      claimsThisHour: 1,
      paused: false,
    });
    expect(first.auditKey).toMatch(/^0x[0-9a-f]{64}$/);
    h.clock.advance(6 * DAY + 1);
    const auth2 = await sponsorAuthorization(
      SPONSOR_KEY,
      h.deps.chainId,
      h.campaignId,
      h.clock.now(),
    );
    const second = sponsorViewSchema.parse(
      await (await h.get(`/sponsor/${h.campaignId}`, { authorization: auth2 })).json(),
    );
    expect(second.auditKey).toBeUndefined();
    expect(second.expiring).toHaveLength(1);
  });

  it('missing, malformed, stranger-signed, other-campaign, stale or future logins → 401', async () => {
    const h = await harness();
    const url = `/sponsor/${h.campaignId}`;
    expect((await h.get(url)).status).toBe(401);
    expect((await h.get(url, { authorization: 'Recharge-Sponsor !!!' })).status).toBe(401);
    const cases = [
      [STRANGER_KEY, h.campaignId, 0],
      [SPONSOR_KEY, scopedCampaignId(SPONSOR, 9n), 0],
      [SPONSOR_KEY, h.campaignId, -3_601_000],
      [SPONSOR_KEY, h.campaignId, 61_000],
    ] as const;
    for (const [key, id, skew] of cases) {
      const authorization = await sponsorAuthorization(
        key,
        h.deps.chainId,
        id,
        h.clock.now() + skew,
      );
      expect((await h.get(url, { authorization })).status).toBe(401);
    }
    expect((await h.get('/sponsor/0x1234')).status).toBe(401);
  });
});
