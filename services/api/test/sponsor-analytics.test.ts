import { describe, expect, it, vi } from 'vitest';

import { AdapterError } from '@ethglobal/adapters';
import { T0 } from '@ethglobal/adapters/testing';
import { sha256Hex } from '@ethglobal/crypto';
import { campaignFromPayload, type Found } from '@ethglobal/octroi';
import type { Hex } from '@ethglobal/protocol/ids';
import {
  sponsorAnalyticsSchema,
  type Entitlement,
  type Receipt,
  type SponsorAnalytics,
} from '@ethglobal/protocol/schemas';

import { campaignFields } from './support/campaign.js';
import { addressOf, scopedCampaignId, sponsorAuthorization } from './support/client.js';
import {
  DAY,
  harness,
  HUMAN_KEY,
  iccidOf,
  provisioned,
  SPONSOR,
  SPONSOR_KEY,
  STRANGER_KEY,
  topUp,
  type Harness,
} from './support/harness.js';
import {
  ANALYTICS_SCAN_MAX,
  buildAnalytics,
  NOT_INSTALLED_ROWS_MAX,
  scanCampaign,
  type CampaignScan,
} from '../src/routes/sponsor-analytics.js';

import type { ChainCampaign } from '../src/chain.js';

const HOUR = 3_600_000;

const analytics = async (h: Harness, key: Hex = SPONSOR_KEY, signedFor: Hex = h.campaignId) =>
  h.get(`/sponsor/${h.campaignId}/analytics`, {
    authorization: await sponsorAuthorization(key, h.deps.chainId, signedFor, h.clock.now()),
  });
const read = async (h: Harness): Promise<SponsorAnalytics> => {
  const res = await analytics(h);
  expect(res.status).toBe(200);
  return sponsorAnalyticsSchema.parse(await res.json());
};

/** The reseller's webhook for this plan's eSIM: usage and, when given, its status. */
const report = async (h: Harness, key: string, usedMb: number, status?: 'installed' | 'active') => {
  const at = h.clock.now();
  const d = h.reseller.signedWebhook(
    [
      {
        provider: 'mock',
        eventId: `ev-${key.slice(-8)}-${usedMb}-${at}`,
        iccid: iccidOf(h, key),
        usedMb,
        totalMb: 300,
        asOf: at,
        ...(status === undefined ? {} : { status }),
      },
    ],
    at,
  );
  const res = await h.request('/webhooks/reseller/mock', {
    method: 'POST',
    headers: d.headers,
    body: d.body,
  });
  expect(res.status).toBe(204);
};

describe('GET /sponsor/:id/analytics', () => {
  it('needs the campaign sponsor’s SponsorLogin: missing, malformed, stranger, other campaign, bad id → 401', async () => {
    const h = await harness();
    const url = `/sponsor/${h.campaignId}/analytics`;
    expect((await h.get(url)).status).toBe(401);
    expect((await h.get(url, { authorization: 'Recharge-Sponsor !!!' })).status).toBe(401);
    expect((await analytics(h, STRANGER_KEY)).status).toBe(401);
    expect((await analytics(h, SPONSOR_KEY, scopedCampaignId(SPONSOR, 9n))).status).toBe(401);
    expect((await h.get('/sponsor/0x1234/analytics')).status).toBe(401);
    expect((await analytics(h)).status).toBe(200);
  });

  it('no claims yet: zeros, 14 IST days and 48 hours zero-filled, nothing to track, no run-out', async () => {
    const h = await harness();
    const a = await read(h);
    expect(a).toMatchObject({ sampled: false, scanCap: ANALYTICS_SCAN_MAX, hourlyCap: 120 });
    expect(a.totals).toEqual({
      claims: 0,
      uniqueHumans: 0,
      byTier: { orb: 0, document: 0, unknown: 0 },
      mbDelivered: 0,
      mbUsed: 0,
      avgMbUsed: 0,
    });
    // T0 is 17:30 IST on 3 Nov: the last IST day starts at 18:30 UTC on 2 Nov
    expect(a.daily).toHaveLength(14);
    expect(a.daily.map((d) => d.claims)).toEqual(new Array(14).fill(0));
    expect(a.daily[0]?.day).toBe('2026-10-21');
    expect(a.daily.at(-1)).toEqual({
      day: '2026-11-03',
      start: Date.UTC(2026, 10, 2, 18, 30),
      claims: 0,
    });
    expect(a.hourly).toHaveLength(48);
    expect(a.hourly[0]?.at).toBe(T0 - 47 * HOUR);
    expect(a.hourly.at(-1)).toEqual({ at: T0, claims: 0 });
    expect(a.money).toEqual({
      budgetUsd6: '1000000000',
      spentUsd6: '0',
      remainingUsd6: '1000000000',
      pricePerClaimUsd6: '500000',
      remainingClaims: 2000,
      burnPerHour: 0,
      runOutAt: null,
      endsAt: T0 + 30 * DAY,
      daysLeft: 30,
    });
    expect(a.funnel).toMatchObject({ claimed: 0, installedRate: 0, topUpRevenueUsd6: '0' });
    expect(a.notInstalled).toEqual({ count: 0, usd6: '0', rows: [] });
    expect(a.latest).toEqual([]);
  });

  it('claims → install → use → top-up: funnel, status, money, series, proofs; tracks every eSIM not installed, oldest first', async () => {
    const h = await harness();
    // A: orb, never installed; the reseller reported on it once (statusAsOf)
    const a = await provisioned(h, 'analytics-a');
    h.clock.advance(HOUR);
    // B: document, installed, no data yet
    const b = await h.claim({ seed: 'analytics-b', level: 'document' });
    expect(b.res.status).toBe(201);
    const bKey = ((await b.res.json()) as { entitlementKey: string }).entitlementKey;
    await report(h, bKey, 0, 'installed');
    h.clock.advance(HOUR);
    // C: orb, using data, bought a 1 GB top-up
    const c = await provisioned(h, 'analytics-c');
    await report(h, c.key, 50);
    const paid = await topUp(h, c.key);
    expect(paid.paid.status).toBe(200);
    h.clock.advance(HOUR);
    // D: orb, the reseller is down: the plan waits in pending-profile
    vi.spyOn(h.reseller, 'order').mockRejectedValueOnce(
      new AdapterError('reseller', 'unavailable', 'outage'),
    );
    const d = await h.claim({ seed: 'analytics-d' });
    expect(d.res.status).toBe(202);
    const dKey = ((await d.res.json()) as { entitlementKey: string }).entitlementKey;
    h.clock.advance(60_000);
    await report(h, a.key, 0);

    const now = h.clock.now();
    const res = await analytics(h);
    const text = await res.clone().text();
    const x = sponsorAnalyticsSchema.parse(await res.json());
    expect(x.totals).toEqual({
      claims: 4,
      uniqueHumans: 4,
      byTier: { orb: 3, document: 1, unknown: 0 },
      // 300 + 160 + (300 + 1000 top-up) + 300
      mbDelivered: 2060,
      mbUsed: 50,
      avgMbUsed: 13,
    });
    expect(x.funnel).toEqual({
      claimed: 4,
      installed: 2,
      active: 1,
      toppedUp: 1,
      notInstalled: 2,
      installedRate: 0.5,
      activeRate: 0.25,
      toppedUpRate: 0.25,
      notInstalledRate: 0.5,
      topUps: 1,
      topUpRevenueUsd6: '4000000',
    });
    expect(x.status).toEqual({ pending: 1, ready: 1, installed: 1, active: 1, expired: 0 });
    expect(x.money).toMatchObject({
      spentUsd6: '2000000',
      remainingUsd6: '998000000',
      remainingClaims: 1996,
      burnPerHour: 0.17,
      runOutAt: Math.round(now + (1996 / (4 / 24)) * HOUR),
    });
    expect(x.daily.at(-1)?.claims).toBe(4);
    expect(x.hourly.slice(-4).map((b) => b.claims)).toEqual([1, 1, 1, 1]);
    expect(x.proof).toEqual({
      onChainClaims: 4,
      claimTxs: 4,
      arkivReceipts: 4,
      arkivPlans: 4,
      hcsMessages: 4,
    });
    expect(x.latest.map((l) => l.tier)).toEqual(['orb', 'orb', 'document', 'orb']);
    expect(x.latest[0]?.at).toBeGreaterThan(x.latest[1]?.at ?? Infinity);
    expect(x.latest.every((l) => /^0x[0-9a-f]{64}$/.test(l.tx ?? '') && l.arkivKey !== '')).toBe(
      true,
    );

    // claimed but not installed: A (ready, oldest) then D (pending-profile); what the sponsor paid for them
    expect(x.notInstalled.count).toBe(2);
    expect(x.notInstalled.usd6).toBe('1000000');
    const [rowA, rowD] = x.notInstalled.rows;
    expect(x.notInstalled.rows).toHaveLength(2);
    expect(rowA).toMatchObject({
      claimedAt: T0,
      tier: 'orb',
      status: 'ready',
      statusAsOf: now,
      ageHours: 3,
      expiresAt: T0 + 7 * DAY,
    });
    expect(rowD).toMatchObject({ tier: 'orb', status: 'pending-profile', ageHours: 0 });
    expect(rowD?.statusAsOf).toBeUndefined();
    for (const row of x.notInstalled.rows) {
      expect(row.claimTx).toMatch(/^0x[0-9a-f]{64}$/);
      expect(row.arkivKey).not.toBe('');
    }

    // nothing that identifies a claimer or opens a plan
    const plans = [a.key, bKey, c.key, dKey];
    const claimKeys = (await h.deps.stores.receipts.forCampaign(h.campaignId)).map((r) => r.payer);
    for (const secret of [
      ...plans,
      ...plans.map((k) => sha256Hex(k).slice(2)),
      ...claimKeys.map(String),
      // D never got a profile
      ...[a.key, bKey, c.key].map((k) => iccidOf(h, k)),
      addressOf(HUMAN_KEY).slice(2).toLowerCase(),
      'hk:',
      'ent:v1:',
    ])
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
  });

  it('after the plans expire: counted as expired, delivered MB kept from the receipts, nothing left to install', async () => {
    const h = await harness();
    const a = await provisioned(h, 'expired-a');
    await report(h, a.key, 20);
    await topUp(h, a.key);
    await h.claim({ seed: 'expired-b', level: 'document' });
    h.clock.advance(8 * DAY);
    const x = await read(h);
    expect(x.status).toEqual({ pending: 0, ready: 0, installed: 0, active: 0, expired: 2 });
    expect(x.totals).toMatchObject({
      claims: 2,
      byTier: { orb: 1, document: 1, unknown: 0 },
      mbDelivered: 300 + 1000 + 160,
      mbUsed: 0,
    });
    expect(x.funnel).toMatchObject({ claimed: 2, installed: 0, toppedUp: 1, notInstalled: 0 });
    expect(x.notInstalled).toEqual({ count: 0, usd6: '0', rows: [] });
    expect(x.daily.slice(-9).map((d) => d.claims)).toEqual([1 + 1, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(x.money).toMatchObject({ burnPerHour: 0, runOutAt: null });
  });

  it('the ledger read is cached 30 s per campaign; the chain counters are read every time', async () => {
    const h = await harness();
    await provisioned(h, 'cache-a');
    const first = await read(h);
    await provisioned(h, 'cache-b');
    h.clock.advance(10_000);
    const cached = await read(h);
    expect(cached.scannedAt).toBe(first.scannedAt);
    expect(cached.totals.claims).toBe(1);
    expect(cached.proof.onChainClaims).toBe(2);
    h.clock.advance(20_000);
    const fresh = await read(h);
    expect(fresh.scannedAt).toBe(h.clock.now());
    expect(fresh.totals.claims).toBe(2);
  });
});

describe('scanCampaign', () => {
  it('reads at most `cap` rows per query and says so (sampled)', async () => {
    const h = await harness();
    for (const seed of ['cap-a', 'cap-b', 'cap-c']) await provisioned(h, seed);
    const capped = await scanCampaign(h.deps, h.campaignId, 2);
    expect(capped).toMatchObject({ cap: 2, sampled: true });
    expect(capped.claims).toHaveLength(2);
    expect(capped.plans).toHaveLength(2);
    const whole = await scanCampaign(h.deps, h.campaignId, 3);
    expect(whole).toMatchObject({ cap: 3, sampled: false });
    expect(whole.claims).toHaveLength(3);
  });
});

describe('buildAnalytics', () => {
  const id = scopedCampaignId(SPONSOR, 1n);
  const campaign = (orbMb = 300, documentMb = 160) =>
    campaignFromPayload({
      v: 1,
      ...campaignFields({
        id,
        sponsor: SPONSOR,
        contract: SPONSOR,
        expiresAt: T0 + 30 * DAY,
        bundleMb: { orb: orbMb, document: documentMb, device: 0 },
      }),
      createdAt: T0 - 20 * DAY,
    });
  const chain: ChainCampaign = {
    sponsor: SPONSOR,
    pricePerClaim: 1_200_000n,
    budget: 12_000_000n,
    spent: 12_000_000n,
    claimsPerHour: 10,
    expiresAt: T0 + 5 * DAY + 12 * HOUR,
    paused: false,
  };
  const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}`;
  const claim = (n: number, at: number, mb = 300): Found<Receipt> => ({
    entityKey: `rcpt-${n}`,
    version: 1,
    expiresAt: null,
    payload: {
      v: 1,
      key: `rcpt:ledger:${n}`,
      kind: 'claim',
      entitlementKeyHash: hash(n),
      campaignId: id,
      mb,
      payer: hash(1000 + n).slice(2),
      at,
    },
  });
  const plan = (n: number, at: number, over: Partial<Entitlement> = {}): Found<Entitlement> => ({
    entityKey: `ent-${n}`,
    version: 1,
    expiresAt: at + 7 * DAY,
    payload: {
      v: 1,
      key: `hk:${hash(n)}`,
      kind: 'free',
      status: 'ready',
      tier: 'orb',
      campaignId: id,
      planId: 'in-300mb-7d',
      mbTotal: 300,
      mbUsed: 0,
      usageAsOf: at,
      usageSource: 'none',
      createdAt: at,
      expiresAt: at + 7 * DAY,
      ...over,
    },
  });
  const scan = (over: Partial<CampaignScan>): CampaignScan => ({
    at: T0,
    cap: ANALYTICS_SCAN_MAX,
    sampled: false,
    claims: [],
    plans: [],
    topUps: [],
    ...over,
  });

  it('buckets claims by IST day (00:00 IST, not UTC) and drops days outside the 14', () => {
    const istMidnight = Date.UTC(2026, 10, 2, 18, 30); // 00:00 IST on 3 Nov
    const x = buildAnalytics(
      id,
      campaign(),
      chain,
      scan({
        claims: [
          claim(1, istMidnight - 60_000), // 23:59 IST, 2 Nov
          claim(2, istMidnight + 60_000), // 00:01 IST, 3 Nov
          claim(3, istMidnight - 20 * DAY), // outside the window, still a claim
        ],
      }),
      T0,
    );
    expect(x.daily.slice(-2)).toEqual([
      { day: '2026-11-02', start: istMidnight - DAY, claims: 1 },
      { day: '2026-11-03', start: istMidnight, claims: 1 },
    ]);
    expect(x.daily.reduce((s, d) => s + d.claims, 0)).toBe(2);
    expect(x.totals.claims).toBe(3);
  });

  it('a spent budget runs out now; an expired claim’s tier is unknown when both tiers get the same bundle', () => {
    const x = buildAnalytics(
      id,
      campaign(1000, 1000),
      chain,
      scan({
        claims: [claim(1, T0 - DAY, 1000)],
        plans: [plan(2, T0 - HOUR, { tier: 'document' })],
      }),
      T0,
    );
    expect(x.money).toMatchObject({
      remainingUsd6: '0',
      remainingClaims: 0,
      runOutAt: T0,
      daysLeft: 5.5,
    });
    expect(x.totals.byTier).toEqual({ orb: 0, document: 1, unknown: 1 });
    expect(x.status).toMatchObject({ expired: 1, ready: 1 });
    expect(x.notInstalled.usd6).toBe('1200000');
  });

  it(`tracks at most ${NOT_INSTALLED_ROWS_MAX} not-installed rows, oldest first, and counts them all`, () => {
    const plans = Array.from({ length: NOT_INSTALLED_ROWS_MAX + 1 }, (_, i) =>
      plan(i + 1, T0 - (i + 1) * 60_000, {
        status: i % 2 === 0 ? 'ready' : 'pending-profile',
      }),
    );
    const x = buildAnalytics(id, campaign(), chain, scan({ plans, sampled: true }), T0);
    expect(x.sampled).toBe(true);
    expect(x.notInstalled.count).toBe(NOT_INSTALLED_ROWS_MAX + 1);
    expect(x.notInstalled.rows).toHaveLength(NOT_INSTALLED_ROWS_MAX);
    const times = x.notInstalled.rows.map((r) => r.claimedAt);
    expect(times).toEqual([...times].sort((p, q) => p - q));
    expect(times[0]).toBe(T0 - (NOT_INSTALLED_ROWS_MAX + 1) * 60_000);
    expect(x.notInstalled.rows.map((r) => r.claimTx)).toEqual(
      new Array(NOT_INSTALLED_ROWS_MAX).fill(undefined),
    );
  });
});
