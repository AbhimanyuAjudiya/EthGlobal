/**
 * GET /sponsor/:id/analytics — the campaign console's analytics. Auth is GET /sponsor/:id's: the `SponsorLogin`
 * bearer, and the signer must be both the registered and the on-chain sponsor. Then four bounded ledger reads — the
 * campaign's World ID claim receipts and free plans, and the paid top-ups (human and agent) — joined on the
 * entitlement hash a receipt carries and a plan's ledger index is built from, aggregated with the DataDrop counters.
 *
 * The ledger part is cached 30 s per campaign (one read in flight per campaign); the chain read stays per request,
 * the ownership check needs it. Rate limit: the global per-IP limit, as GET /sponsor/:id. The answer carries no plan
 * key, ledger index, entitlement hash, claim key or payer — only counts, times, tiers, claim txs and Arkiv entity keys.
 */
import { INDEX_PREFIX, sizeBundle, type Campaign, type Found } from '@ethglobal/octroi';
import { dayBucket, hourBucket, type Hex } from '@ethglobal/protocol/ids';
import type {
  AnalyticsTier,
  Entitlement,
  NotInstalledRow,
  Receipt,
  SponsorAnalytics,
} from '@ethglobal/protocol/schemas';
import { usd6FromWire, usd6ToWire } from '@ethglobal/protocol/units';

import { fail } from '../errors.js';
import { sponsorFromHeader } from '../middleware/sponsor-auth.js';

import type { ChainCampaign } from '../chain.js';
import type { AppEnv } from '../context.js';
import type { Deps } from '../deps.js';
import type { Hono } from 'hono';

/** Rows one ledger read keeps; it asks for one more to tell "exactly the cap" from "more" (Arkiv caps at 1,000). */
export const ANALYTICS_SCAN_MAX = 500;
export const ANALYTICS_CACHE_MS = 30_000;
export const NOT_INSTALLED_ROWS_MAX = 100;
const LATEST_MAX = 20;
const DAYS = 14;
const HOURS = 48;
const HOUR = 3_600_000;
const DAY = 86_400_000;
/** IST is UTC+05:30 all year. */
const IST_MS = 19_800_000;
const ID = /^0x[0-9a-fA-F]{64}$/;

export interface CampaignScan {
  at: number;
  cap: number;
  /** Some read returned more than `cap` rows: everything below covers the first `cap` of each. */
  sampled: boolean;
  claims: Found<Receipt>[];
  plans: Found<Entitlement>[];
  /** Paid top-ups whose entitlement is one of these claims' plans. */
  topUps: Receipt[];
}

/** One claimer: the claim receipt (kept 38 days) and/or the plan (gone at its expiry), and the plan's top-ups. */
interface Member {
  claim?: Found<Receipt>;
  plan?: Found<Entitlement>;
  topUps: Receipt[];
}
type State = 'pending' | 'ready' | 'installed' | 'active' | 'expired';

/** A plan's ledger index is `hk:` + the sha256 its receipts carry as `entitlementKeyHash`. */
const planHash = (plan: Found<Entitlement>): string =>
  plan.payload.key.slice(INDEX_PREFIX.length).toLowerCase();
const receiptHash = (r: Receipt): string => r.entitlementKeyHash.toLowerCase();

/** The four bounded reads. Kept: at most `cap` rows of each, and only the top-ups of this campaign's plans. */
export async function scanCampaign(
  deps: Deps,
  campaignId: Hex,
  cap = ANALYTICS_SCAN_MAX,
): Promise<CampaignScan> {
  const at = deps.now();
  // ponytail: top-up receipts carry no campaignId, so both kinds are read app-wide and joined here; annotate top-ups
  // with the plan's campaignId if they outgrow the cap
  const [claims, plans, topups, agentTopups] = await Promise.all([
    deps.stores.receipts.listKind('claim', cap + 1, campaignId),
    deps.stores.entitlements.forCampaign(campaignId, 'free', cap + 1),
    deps.stores.receipts.listKind('topup', cap + 1),
    deps.stores.receipts.listKind('agent-topup', cap + 1),
  ]);
  const sampled = [claims, plans, topups, agentTopups].some((rows) => rows.length > cap);
  // the dashboard's claims: World ID claim receipts carry the published claim key as payer
  const keptClaims = claims.slice(0, cap).filter((r) => r.payload.payer !== undefined);
  const keptPlans = plans.slice(0, cap);
  const ours = new Set([
    ...keptClaims.map((r) => receiptHash(r.payload)),
    ...keptPlans.map(planHash),
  ]);
  const topUps = [...topups.slice(0, cap), ...agentTopups.slice(0, cap)]
    .map((r) => r.payload)
    .filter((r) => ours.has(receiptHash(r)));
  return { at, cap, sampled, claims: keptClaims, plans: keptPlans, topUps };
}

function stateOf(m: Member): State {
  const plan = m.plan?.payload;
  if (!plan) return 'expired';
  if (plan.mbUsed > 0 || plan.status === 'active') return 'active';
  if (plan.status === 'installed') return 'installed';
  return plan.status === 'ready' ? 'ready' : 'pending';
}

/** The live plan's tier; an expired one's from its bundle size, unless both tiers get the same size. */
function tierOf(campaign: Campaign, m: Member): AnalyticsTier {
  const tier = m.plan?.payload.tier;
  if (tier === 'orb' || tier === 'document') return tier;
  if (m.plan) return 'unknown';
  const [orb, document] = [sizeBundle(campaign, 'orb'), sizeBundle(campaign, 'document')];
  const mb = m.claim?.payload.mb;
  if (orb === document) return 'unknown';
  return mb === orb ? 'orb' : mb === document ? 'document' : 'unknown';
}

const claimedAt = (m: Member): number => m.claim?.payload.at ?? m.plan?.payload.createdAt ?? 0;
const safeNumber = (n: bigint): number =>
  n > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(n);
const sumUsd6 = (rows: Receipt[]): bigint =>
  rows.reduce((sum, r) => sum + usd6FromWire(r.usd6 ?? '0'), 0n);

/** The answer, from one scan and one chain read, at `now`. Pure. */
export function buildAnalytics(
  campaignId: Hex,
  campaign: Campaign,
  chain: ChainCampaign,
  scan: CampaignScan,
  now: number,
): SponsorAnalytics {
  const members = new Map<string, Member>();
  const member = (hash: string): Member => {
    const found = members.get(hash) ?? { topUps: [] };
    members.set(hash, found);
    return found;
  };
  for (const claim of scan.claims) member(receiptHash(claim.payload)).claim = claim;
  for (const plan of scan.plans) member(planHash(plan)).plan = plan;
  for (const topUp of scan.topUps) members.get(receiptHash(topUp))?.topUps.push(topUp);

  const status: Record<State, number> = {
    pending: 0,
    ready: 0,
    installed: 0,
    active: 0,
    expired: 0,
  };
  const byTier: Record<AnalyticsTier, number> = { orb: 0, document: 0, unknown: 0 };
  const daily = new Array<number>(DAYS).fill(0);
  const hourly = new Array<number>(HOURS).fill(0);
  const firstDay = dayBucket(now + IST_MS) - (DAYS - 1);
  const firstHour = hourBucket(now) - (HOURS - 1);
  const notInstalled: NotInstalledRow[] = [];
  let mbDelivered = 0;
  let mbUsed = 0;
  let livePlans = 0;
  let toppedUp = 0;
  let last24h = 0;
  for (const m of members.values()) {
    const state = stateOf(m);
    const tier = tierOf(campaign, m);
    const at = claimedAt(m);
    status[state] += 1;
    byTier[tier] += 1;
    if (m.topUps.length > 0) toppedUp += 1;
    const plan = m.plan;
    if (plan) {
      livePlans += 1;
      mbDelivered += plan.payload.mbTotal;
      mbUsed += plan.payload.mbUsed;
    } else {
      mbDelivered += (m.claim?.payload.mb ?? 0) + m.topUps.reduce((s, t) => s + (t.mb ?? 0), 0);
    }
    if (at > now - DAY && at <= now) last24h += 1;
    const d = dayBucket(at + IST_MS) - firstDay;
    if (d >= 0 && d < DAYS) daily[d] = (daily[d] ?? 0) + 1;
    const h = hourBucket(at) - firstHour;
    if (h >= 0 && h < HOURS) hourly[h] = (hourly[h] ?? 0) + 1;
    if (plan && (state === 'pending' || state === 'ready')) {
      const tx = m.claim?.payload.tx;
      notInstalled.push({
        claimedAt: at,
        tier,
        status: state === 'ready' ? 'ready' : 'pending-profile',
        // usageAsOf is the reseller's last report (webhook or poll); 'none' = it never reported
        ...(plan.payload.usageSource === 'none' ? {} : { statusAsOf: plan.payload.usageAsOf }),
        ageHours: Math.max(0, Math.floor((now - at) / HOUR)),
        expiresAt: plan.payload.expiresAt,
        ...(tx === undefined ? {} : { claimTx: tx }),
        arkivKey: plan.entityKey,
      });
    }
  }

  const claimed = members.size;
  const share = (n: number) => (claimed === 0 ? 0 : Math.round((n / claimed) * 10_000) / 10_000);
  const installed = status.installed + status.active;
  const notInstalledCount = status.pending + status.ready;
  const topUps = [...members.values()].flatMap((m) => m.topUps);
  const price = chain.pricePerClaim;
  const remaining = chain.budget > chain.spent ? chain.budget - chain.spent : 0n;
  const remainingClaims = price > 0n ? safeNumber(remaining / price) : 0;
  const perHour = last24h / 24;
  const claims = scan.claims;
  return {
    campaignId,
    network: campaign.network,
    asOf: now,
    scannedAt: scan.at,
    sampled: scan.sampled,
    scanCap: scan.cap,
    totals: {
      claims: claimed,
      uniqueHumans: claimed,
      byTier,
      mbDelivered,
      mbUsed,
      avgMbUsed: livePlans === 0 ? 0 : Math.round(mbUsed / livePlans),
    },
    money: {
      budgetUsd6: usd6ToWire(chain.budget),
      spentUsd6: usd6ToWire(chain.spent),
      remainingUsd6: usd6ToWire(remaining),
      pricePerClaimUsd6: usd6ToWire(price),
      remainingClaims,
      burnPerHour: Math.round(perHour * 100) / 100,
      runOutAt:
        remainingClaims === 0
          ? now
          : perHour > 0
            ? Math.round(now + (remainingClaims / perHour) * HOUR)
            : null,
      endsAt: chain.expiresAt,
      daysLeft: Math.max(0, Math.round(((chain.expiresAt - now) / DAY) * 10) / 10),
    },
    daily: daily.map((n, i) => {
      const day = firstDay + i;
      return {
        day: new Date(day * DAY).toISOString().slice(0, 10),
        start: day * DAY - IST_MS,
        claims: n,
      };
    }),
    hourly: hourly.map((n, i) => ({ at: (firstHour + i) * HOUR, claims: n })),
    hourlyCap: chain.claimsPerHour,
    funnel: {
      claimed,
      installed,
      active: status.active,
      toppedUp,
      notInstalled: notInstalledCount,
      installedRate: share(installed),
      activeRate: share(status.active),
      toppedUpRate: share(toppedUp),
      notInstalledRate: share(notInstalledCount),
      topUps: topUps.length,
      topUpRevenueUsd6: usd6ToWire(sumUsd6(topUps)),
    },
    status,
    notInstalled: {
      count: notInstalledCount,
      usd6: usd6ToWire(BigInt(notInstalledCount) * price),
      rows: notInstalled.sort((a, b) => a.claimedAt - b.claimedAt).slice(0, NOT_INSTALLED_ROWS_MAX),
    },
    proof: {
      onChainClaims: price > 0n ? safeNumber(chain.spent / price) : claimed,
      claimTxs: claims.filter((r) => r.payload.tx !== undefined).length,
      arkivReceipts: claims.length,
      arkivPlans: livePlans,
      hcsMessages: claims.filter((r) => r.payload.hcs !== undefined).length,
    },
    latest: [...members.values()]
      .flatMap((m) => (m.claim ? [{ m, claim: m.claim }] : []))
      .sort((a, b) => b.claim.payload.at - a.claim.payload.at)
      .slice(0, LATEST_MAX)
      .map(({ m, claim }) => ({
        at: claim.payload.at,
        tier: tierOf(campaign, m),
        ...(claim.payload.tx === undefined ? {} : { tx: claim.payload.tx }),
        arkivKey: claim.entityKey,
      })),
  };
}

export function registerSponsorAnalytics(app: Hono<AppEnv>, deps: Deps): void {
  const cache = new Map<Hex, { at: number; scan: Promise<CampaignScan> }>();
  const scanOf = (campaignId: Hex): Promise<CampaignScan> => {
    const now = deps.now();
    const hit = cache.get(campaignId);
    if (hit && now - hit.at < ANALYTICS_CACHE_MS) return hit.scan;
    for (const [id, entry] of cache) if (now - entry.at >= ANALYTICS_CACHE_MS) cache.delete(id);
    const entry = { at: now, scan: scanCampaign(deps, campaignId) };
    cache.set(campaignId, entry);
    // a failed read is not cached (the caller still gets the error)
    entry.scan.catch(() => {
      if (cache.get(campaignId) === entry) cache.delete(campaignId);
    });
    return entry.scan;
  };

  app.get('/sponsor/:id/analytics', async (c) => {
    const id = c.req.param('id');
    if (!ID.test(id)) throw fail('unauthorized');
    const campaignId = id.toLowerCase() as Hex;
    const signer = (
      await sponsorFromHeader(deps, c.req.header('authorization'), campaignId)
    ).toLowerCase();
    const [found, chain] = await Promise.all([
      deps.stores.campaigns.get(campaignId),
      deps.dataDrop.campaign(campaignId),
    ]);
    if (found?.payload.sponsor.toLowerCase() !== signer || chain.sponsor.toLowerCase() !== signer)
      throw fail('unauthorized', { detail: 'not this campaign’s sponsor' });
    const scan = await scanOf(campaignId);
    return c.json(buildAnalytics(campaignId, found.payload, chain, scan, deps.now()));
  });
}
