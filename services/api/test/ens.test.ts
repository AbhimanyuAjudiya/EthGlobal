/** ENSv2 campaign names (flows/ens.ts): enqueued after POST /sponsor, persisted on the campaign, never failing the 201. */
import { describe, expect, it } from 'vitest';

import { MockCampaignNames } from '@ethglobal/adapters';
import { T0 } from '@ethglobal/adapters/testing';
import type { Hex } from '@ethglobal/protocol/ids';
import { plansResponseSchema, sponsorViewSchema } from '@ethglobal/protocol/schemas';

import { campaignFields } from './support/campaign.js';
import { scopedCampaignId, sponsorAuthorization, sponsorLogin } from './support/client.js';
import { DAY, harness, SPONSOR, SPONSOR_KEY, type Harness } from './support/harness.js';
import { bundleText, slugFor } from '../src/flows/ens.js';

const EXPIRES = T0 + 10 * DAY;

/** Campaign `n` of SPONSOR on chain and registered through POST /sponsor. */
async function register(h: Harness, n: bigint, name = 'Mumbai Airport Wi-Fi') {
  const id = scopedCampaignId(SPONSOR, n);
  h.dataDrop.create(id, {
    sponsor: SPONSOR,
    pricePerClaim: 1_200_000n,
    budget: 10_000_000n,
    spent: 0n,
    claimsPerHour: 10,
    expiresAt: EXPIRES,
  });
  const login = await sponsorLogin(SPONSOR_KEY, h.deps.chainId, id, h.clock.now());
  const res = await h.json('/sponsor', {
    campaign: campaignFields({
      id,
      sponsor: SPONSOR,
      name,
      bundleMb: { orb: 1000, document: 1000, device: 0 },
      contract: h.dataDrop.address,
      expiresAt: EXPIRES,
    }),
    auth: { issuedAt: login.issuedAt, signature: login.signature },
  });
  return { id, res };
}

const setup = (names: MockCampaignNames) =>
  harness({ overrides: { ensNames: names, ensRetryMs: [0, 0] } });

const ensOf = async (h: Harness, id: Hex) => (await h.deps.stores.campaigns.get(id))?.payload.ens;

describe('ENS campaign names', () => {
  it('a registration enqueues the name: records, owner, expiry, txs and status land on the campaign', async () => {
    const names = new MockCampaignNames({ now: () => T0 });
    const h = await setup(names);
    const { id, res } = await register(h, 2n);
    expect(res.status).toBe(201);
    await h.deps.ens!.idle();

    const ens = await ensOf(h, id);
    expect(ens).toMatchObject({
      name: 'mumbai-airport-wi-fi.re-charge.eth',
      status: 'registered',
    });
    expect(ens?.txs.map((t) => t.step)).toEqual(['resolver', 'register', 'grant']);
    const held = names.names.get('mumbai-airport-wi-fi')!;
    expect(ens?.resolver).toBe(held.resolver);
    expect(held.sponsor.toLowerCase()).toBe(SPONSOR.toLowerCase());
    expect(held.expiresAt).toBe(EXPIRES);
    expect(held.records).toMatchObject({
      url: 'https://app.recharge.ajudiya.com/c/mumbai-airport-wi-fi',
      'recharge.campaign': id,
      'recharge.pool': `eip155:${h.deps.chainId}:${h.dataDrop.address}`,
      'recharge.bundle': '1 GB · 7 days',
      description: 'Mumbai Airport Wi-Fi',
    });

    // the dashboard returns it
    const authorization = await sponsorAuthorization(
      SPONSOR_KEY,
      h.deps.chainId,
      id,
      h.clock.now(),
    );
    const view = sponsorViewSchema.parse(
      await (await h.get(`/sponsor/${id}`, { authorization })).json(),
    );
    expect(view.campaign.ens?.status).toBe('registered');
    expect(view.campaign.ens?.name).toBe('mumbai-airport-wi-fi.re-charge.eth');
  });

  it('an ENS outage never fails the 201; retries, then `failed` — the campaign stays registered', async () => {
    const names = new MockCampaignNames({ now: () => T0 });
    names.failNext = 99;
    const h = await setup(names);
    const { id, res } = await register(h, 2n);
    expect(res.status).toBe(201);
    expect(await ensOf(h, id)).toMatchObject({ status: 'pending' });
    await h.deps.ens!.idle();
    expect(await ensOf(h, id)).toMatchObject({ status: 'failed', txs: [] });
    expect(names.failNext).toBe(96); // 1 attempt + 2 retries
    expect(await h.deps.stores.campaigns.get(id)).not.toBeNull();
  });

  it('a transient failure is retried with the same name and ends registered', async () => {
    const names = new MockCampaignNames({ now: () => T0 });
    names.failNext = 1;
    const h = await setup(names);
    const { id } = await register(h, 2n);
    await h.deps.ens!.idle();
    expect(await ensOf(h, id)).toMatchObject({
      name: 'mumbai-airport-wi-fi.re-charge.eth',
      status: 'registered',
    });
  });

  it('a name already taken gets -2; two campaigns with one name never share it', async () => {
    const names = new MockCampaignNames({ now: () => T0 });
    const h = await setup(names);
    const a = await register(h, 2n, 'Goa Beach');
    const b = await register(h, 3n, 'Goa Beach');
    expect([a.res.status, b.res.status]).toEqual([201, 201]);
    await h.deps.ens!.idle();
    expect((await ensOf(h, a.id))?.name).toBe('goa-beach.re-charge.eth');
    expect((await ensOf(h, b.id))?.name).toBe('goa-beach-2.re-charge.eth');
  });

  it('a name left pending by a stopped process is finished on boot, nothing sent twice', async () => {
    const names = new MockCampaignNames({ now: () => T0 });
    names.failNext = 99;
    const h = await harness({ overrides: { ensNames: names, ensRetryMs: [] } });
    const { id } = await register(h, 2n);
    await h.deps.ens!.idle();
    expect(await ensOf(h, id)).toMatchObject({ status: 'failed' });
    // an operator flips it back to pending (or the process died mid-way): the next boot resumes it
    const found = (await h.deps.stores.campaigns.get(id))!;
    await h.deps.stores.campaigns.put({
      ...found.payload,
      ens: { ...found.payload.ens!, status: 'pending' },
    });
    names.failNext = 0;
    const next = await h.restart();
    await next.deps.ens!.resumeOnBoot();
    await next.deps.ens!.idle();
    expect(await ensOf(h, id)).toMatchObject({
      name: 'mumbai-airport-wi-fi.re-charge.eth',
      status: 'registered',
    });
  });

  it('off by default: no ENS job, registration unchanged', async () => {
    const h = await harness();
    expect(h.deps.ens).toBeUndefined();
    const { id, res } = await register(h, 2n);
    expect(res.status).toBe(201);
    expect(await ensOf(h, id)).toBeUndefined();
  });

  it('a client cannot set ens on registration', async () => {
    const names = new MockCampaignNames({ now: () => T0 });
    names.failNext = 99;
    const h = await harness({ overrides: { ensNames: names, ensRetryMs: [] } });
    const id = scopedCampaignId(SPONSOR, 2n);
    h.dataDrop.create(id, {
      sponsor: SPONSOR,
      pricePerClaim: 1_200_000n,
      budget: 10_000_000n,
      spent: 0n,
      claimsPerHour: 10,
      expiresAt: EXPIRES,
    });
    const login = await sponsorLogin(SPONSOR_KEY, h.deps.chainId, id, h.clock.now());
    const res = await h.json('/sponsor', {
      campaign: {
        ...campaignFields({
          id,
          sponsor: SPONSOR,
          contract: h.dataDrop.address,
          expiresAt: EXPIRES,
        }),
        ens: { name: 'vitalik.eth', status: 'registered', txs: [] },
      },
      auth: { issuedAt: login.issuedAt, signature: login.signature },
    });
    expect(res.status).toBe(201);
    await h.deps.ens!.idle();
    expect((await ensOf(h, id))?.name).not.toBe('vitalik.eth');
  });
});

describe('GET /plans?campaign=', () => {
  it('answers for the campaign asked for; an unknown one is null; junk is 400', async () => {
    const h = await harness();
    const { id } = await register(h, 2n, 'Second campaign');
    const asked = plansResponseSchema.parse(await (await h.get(`/plans?campaign=${id}`)).json());
    expect(asked.campaign?.id).toBe(id);
    expect(asked.campaign?.name).toBe('Second campaign');
    const fallback = plansResponseSchema.parse(await (await h.get('/plans')).json());
    expect(fallback.campaign?.id).toBe(h.campaignId);
    const unknown = plansResponseSchema.parse(
      await (await h.get(`/plans?campaign=0x${'9'.repeat(64)}`)).json(),
    );
    expect(unknown.campaign).toBeNull();
    expect((await h.get('/plans?campaign=0x12')).status).toBe(400);
  });
});

describe('slugs and bundle text', () => {
  it('kebab-cases names into [a-z0-9-] 3–40, falls back for names without latin letters', () => {
    expect(slugFor('  Mumbai Airport — Free Wi-Fi!! ', '0xabc')).toBe('mumbai-airport-free-wi-fi');
    expect(slugFor('Café Ünïcode', '0xabc')).toBe('cafe-unicode');
    expect(slugFor('मुंबई', '0x1234567890')).toBe('campaign-123456');
    expect(slugFor('x'.repeat(60), '0xabc')).toHaveLength(40);
    expect(slugFor('ab', '0xabcdef12')).toBe('campaign-abcdef');
    expect(bundleText({ bundleMb: { orb: 1000, document: 0, device: 0 }, validityDays: 7 })).toBe(
      '1 GB · 7 days',
    );
    expect(bundleText({ bundleMb: { orb: 300, document: 0, device: 0 }, validityDays: 1 })).toBe(
      '300 MB · 1 day',
    );
  });
});
