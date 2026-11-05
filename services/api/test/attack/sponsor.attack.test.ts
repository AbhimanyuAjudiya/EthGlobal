/** AP13 — sponsor dashboard authorisation and campaign-name injection (T-72, T-70, T-04). */
import { describe, expect, it } from 'vitest';

import { T0 } from '@ethglobal/adapters/testing';

import {
  DAY,
  harness,
  scopedCampaignId,
  SPONSOR,
  SPONSOR_KEY,
  sponsorAuthorization,
  sponsorLogin,
  type Harness,
} from './fixture.js';

const registerNamed = async (h: Harness, name: string) => {
  const id = scopedCampaignId(SPONSOR, 4n);
  h.dataDrop.create(id, {
    sponsor: SPONSOR,
    pricePerClaim: 1n,
    budget: 10n,
    spent: 0n,
    claimsPerHour: 1,
    expiresAt: T0 + DAY,
  });
  const login = await sponsorLogin(SPONSOR_KEY, h.deps.chainId, id, h.clock.now());
  return h.json('/sponsor', {
    campaign: {
      id,
      sponsor: SPONSOR,
      name,
      bundleMb: { orb: 300, document: 160, device: 0 },
      pricePerClaimUsd6: '1',
      maxClaims: 10,
      claimsPerHour: 1,
      validityDays: 7,
      wholesaleUsd6PerGb: '1140000',
      idResaleUsd6: '500000',
      planId: 'in-300mb-7d',
      network: 'eip155:31337',
      contract: h.dataDrop.address,
      expiresAt: T0 + DAY,
    },
    auth: { issuedAt: login.issuedAt, signature: login.signature },
  });
};

describe('attack: sponsor dashboard (AP13)', () => {
  it('a captured valid header replayed from another IP within the hour ⇒ 200 (accepted bearer risk) and never logged', async () => {
    const h = await harness();
    const auth = await sponsorAuthorization(
      SPONSOR_KEY,
      h.deps.chainId,
      h.campaignId,
      h.clock.now(),
    );
    expect(
      (
        await h.request(`/sponsor/${h.campaignId}`, {
          ip: '198.51.100.200',
          headers: { authorization: auth },
        })
      ).status,
    ).toBe(200);
    const view = await (
      await h.request(`/sponsor/${h.campaignId}`, {
        ip: '198.51.100.201',
        headers: { authorization: auth },
      })
    ).text();
    expect(h.lines.join('')).not.toContain(auth.split(' ')[1]);
    expect(h.lines.join('')).not.toMatch(/auditKey/);
    expect(view).not.toMatch(/auditKey/);
  });

  it.each([['Demo‮sponsor'], ['a\u0000b'], ['x'.repeat(65)]])(
    'campaign name %j ⇒ 400',
    async (name) => {
      const h = await harness();
      expect((await registerNamed(h, name)).status).toBe(400);
    },
  );

  it('an HTML name is printable ASCII: accepted and returned byte-identical as data', async () => {
    const h = await harness();
    const name = '<img src=x onerror=alert(1)>';
    expect((await registerNamed(h, name)).status).toBe(201);
    expect((await h.deps.stores.campaigns.get(scopedCampaignId(SPONSOR, 4n)))?.payload.name).toBe(
      name,
    );
  });
});
