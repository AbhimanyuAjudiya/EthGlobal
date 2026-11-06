'use client';

import { useEffect, useState } from 'react';

import { SPONSOR_AUTH_SCHEME } from '@ethglobal/protocol/events';
import {
  sponsorAnalyticsSchema,
  type AnalyticsTier,
  type SponsorAnalytics,
} from '@ethglobal/protocol/schemas';
import { Hash, Icon } from '@ethglobal/ui/components';

import {
  Button,
  Card,
  ListGroup,
  ListRow,
  Notice,
  Pill,
  Section,
  Skeleton,
  StatTile,
  Table,
} from './kit';
import { useLang } from '../i18n/lang';
import { ApiError, call } from '../lib/api';
import { arkivEntityUrl, explorerName, explorerTemplate } from '../lib/env';
import { clockIst, dayLabel, formatMb, money } from '../lib/format';

import type { StringKey } from '../i18n/strings';

/** The SponsorLogin bearer the campaign page already signed (valid 1 h, T-72). */
export interface SponsorBearer {
  sponsor: string;
  issuedAt: number;
  signature: string;
}

const REFRESH_MS = 60_000;
/** A not-installed bundle this close to its expiry is flagged. */
export const SOON_MS = 48 * 3_600_000;
const enIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });
const pct = (rate: number): string => `${Math.round(rate * 100)}%`;
const TIER: Record<AnalyticsTier, StringKey> = {
  orb: 'analytics.tier.orb',
  document: 'analytics.tier.document',
  unknown: 'analytics.tier.unknown',
};

export async function fetchAnalytics(id: string, login: SponsorBearer): Promise<SponsorAnalytics> {
  const { data } = await call(`/sponsor/${encodeURIComponent(id)}/analytics`, {
    headers: { authorization: `${SPONSOR_AUTH_SCHEME} ${btoa(JSON.stringify(login))}` },
    schema: sponsorAnalyticsSchema,
  });
  return data;
}

type Cell = string | number | undefined;
const csvCell = (value: Cell): string => {
  const text = value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const iso = (ms: number): string => new Date(ms).toISOString();

/** One table for a spreadsheet: every figure, both series, the not-installed rows and the latest claims. */
export function analyticsCsv(a: SponsorAnalytics): string {
  const rows: Cell[][] = [];
  const figures = (section: string, values: Record<string, string | number>) => {
    for (const [name, value] of Object.entries(values)) rows.push([section, name, value]);
  };
  const { byTier, ...totals } = a.totals;
  figures('totals', { ...totals, ...byTier });
  figures('money', {
    ...a.money,
    runOutAt: a.money.runOutAt === null ? '' : iso(a.money.runOutAt),
    endsAt: iso(a.money.endsAt),
  });
  figures('funnel', a.funnel);
  figures('status', a.status);
  figures('proof', a.proof);
  for (const d of a.daily) rows.push(['claims_per_day', d.day, d.claims, iso(d.start)]);
  for (const h of a.hourly) rows.push(['claims_per_hour', iso(h.at), h.claims, iso(h.at)]);
  for (const r of a.notInstalled.rows)
    rows.push([
      'not_installed',
      'age_hours',
      r.ageHours,
      iso(r.claimedAt),
      r.tier,
      r.status,
      iso(r.expiresAt),
      r.claimTx,
      r.arkivKey,
      r.statusAsOf === undefined ? undefined : iso(r.statusAsOf),
    ]);
  for (const l of a.latest)
    rows.push(['latest_claim', '', '', iso(l.at), l.tier, '', '', l.tx, l.arkivKey]);
  return [
    'section,name,value,at,tier,status,expires_at,tx,arkiv_key,status_as_of',
    ...rows.map((row) => row.map(csvCell).join(',')),
  ].join('\n');
}

function download(a: SponsorAnalytics) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([analyticsCsv(a)], { type: 'text/csv' }));
  link.download = `analytics-${a.campaignId.slice(0, 10)}-${iso(a.asOf).slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
}

const W = 320;
const H = 120;
const LEFT = 28;
const RIGHT = 8;
const TOP = 10;
const BASE = H - 20;

/** Bars or a line on the console's 320 × 120 chart grid (--series-1, no fill); the cap as a dashed rule. */
function Chart({
  kind,
  label,
  points,
  cap,
  first,
  last,
}: {
  kind: 'bars' | 'line';
  label: string;
  points: { key: string; value: number }[];
  cap?: number;
  first: string;
  last: string;
}) {
  const top = Math.max(1, cap ?? 0, ...points.map((p) => p.value));
  const slot = (W - LEFT - RIGHT) / points.length;
  const y = (v: number) => BASE - (v / top) * (BASE - TOP);
  const mid = (i: number) => LEFT + (i + 0.5) * slot;
  const text = 'fill-ink-tertiary';
  return (
    <figure className="m-0 grid gap-2" aria-label={label}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-hidden="true"
        className="h-auto w-full"
        fontSize="8"
      >
        <line className="stroke-border-strong" x1={LEFT} x2={W - RIGHT} y1={BASE} y2={BASE} />
        <line className="stroke-border-strong" x1={LEFT} x2={LEFT} y1={TOP} y2={BASE} />
        <text className={text} x="2" y={BASE + 3}>
          0
        </text>
        {kind === 'bars' ? (
          points.map((p, i) => (
            <rect
              key={p.key}
              className="chart__bar fill-series-1"
              x={(mid(i) - slot * 0.35).toFixed(1)}
              width={(slot * 0.7).toFixed(1)}
              y={y(p.value).toFixed(1)}
              height={(BASE - y(p.value)).toFixed(1)}
            />
          ))
        ) : (
          <polyline
            className="fill-none stroke-series-1"
            strokeWidth="2"
            strokeLinejoin="round"
            points={points.map((p, i) => `${mid(i).toFixed(1)},${y(p.value).toFixed(1)}`).join(' ')}
          />
        )}
        {cap === undefined ? (
          <text className={text} x="2" y={TOP + 3}>
            {top}
          </text>
        ) : (
          <>
            <line
              className="chart__cap stroke-ink-tertiary"
              strokeDasharray="4 3"
              x1={LEFT}
              x2={W - RIGHT}
              y1={y(cap)}
              y2={y(cap)}
            />
            <text className={text} x="2" y={y(cap) + 3}>
              {cap}/h
            </text>
          </>
        )}
        <text className={text} x={LEFT} y={H - 5}>
          {first}
        </text>
        <text className={text} x={W - RIGHT} y={H - 5} textAnchor="end">
          {last}
        </text>
      </svg>
      <figcaption className="note note--quiet">{label}</figcaption>
    </figure>
  );
}

/**
 * The campaign page's analytics (GET /sponsor/:id/analytics, the same SponsorLogin as the page): ruled figure rows, claims
 * per day and per hour, the funnel, plan status, every claimed-but-not-installed eSIM, the latest claims with their
 * proofs, and a CSV of all of it. Refreshes every 60 s while the tab is visible.
 */
export function CampaignAnalytics({ id, login }: { id: string; login: SponsorBearer | undefined }) {
  const { t, lang } = useLang();
  const [data, setData] = useState<SponsorAnalytics | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [attempt, setAttempt] = useState(0);

  // now, then every 60 s while the tab is visible and at once when it comes back; Try again re-runs it
  useEffect(() => {
    if (!login) return;
    let live = true;
    const load = () =>
      fetchAnalytics(id, login).then(
        (next) => {
          if (!live) return;
          setData(next);
          setError(undefined);
        },
        (e: unknown) => {
          if (live) setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
        },
      );
    void load();
    const refresh = () => {
      if (document.visibilityState === 'visible') void load();
    };
    const timer = setInterval(refresh, REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      live = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [id, login, attempt]);

  if (!login) return null;
  if (!data)
    return (
      <Section title={t('analytics.title')} lang={lang}>
        {error ? (
          <Notice
            tone="negative"
            action={
              <Button variant="quiet" onClick={() => setAttempt((n) => n + 1)}>
                {t('analytics.retry')}
              </Button>
            }
          >
            <p role="status">{t('analytics.error', { reason: error })}</p>
          </Notice>
        ) : (
          <>
            <p className="note" role="status">
              {t('analytics.loading')}
            </p>
            <Skeleton shape="card" />
          </>
        )}
      </Section>
    );

  const { totals, money: m, funnel, status, notInstalled, proof } = data;
  const now = data.asOf;
  const when = (ms: number) => `${dayLabel(ms, lang)} ${clockIst(ms)}`;
  const template = explorerTemplate(data.network);
  const xName = explorerName(data.network);
  const txLink = (tx: string) =>
    template
      ? { explorerHref: template.replace('{hash}', tx), ...(xName ? { explorerName: xName } : {}) }
      : {};
  const arkivLink = (key: string) => {
    const href = arkivEntityUrl(key);
    return href ? { explorerHref: href, explorerName: 'Arkiv' } : {};
  };
  const runOut =
    m.remainingClaims === 0
      ? t('analytics.kpi.runOutSpent')
      : m.runOutAt === null
        ? t('analytics.kpi.runOutNone')
        : m.runOutAt > m.endsAt
          ? t('analytics.kpi.runOutAfterEnd')
          : when(m.runOutAt);
  /** The three figures the page's own tiles do not show. */
  const tiles: [StringKey, string, string][] = [
    [
      'analytics.kpi.delivered',
      formatMb(totals.mbDelivered),
      t('analytics.kpi.deliveredSub', {
        used: formatMb(totals.mbUsed),
        avg: formatMb(totals.avgMbUsed),
      }),
    ],
    [
      'analytics.kpi.activation',
      pct(funnel.installedRate),
      t('analytics.kpi.activationSub', {
        installed: enIN.format(funnel.installed),
        claimed: enIN.format(funnel.claimed),
      }),
    ],
    [
      'analytics.kpi.runOut',
      runOut,
      t('analytics.kpi.runOutSub', {
        rate: enIN.format(m.burnPerHour),
        days: enIN.format(m.daysLeft),
      }),
    ],
  ];
  /** The rest as rows: value right, the breakdown under the title. */
  const figures: [StringKey, string, string][] = [
    [
      'analytics.kpi.claims',
      enIN.format(totals.claims),
      t('analytics.kpi.claimsSub', {
        orb: enIN.format(totals.byTier.orb),
        document: enIN.format(totals.byTier.document),
      }),
    ],
    [
      'analytics.kpi.spent',
      money(m.spentUsd6),
      t('analytics.kpi.spentSub', { budget: money(m.budgetUsd6) }),
    ],
    [
      'analytics.kpi.remaining',
      enIN.format(m.remainingClaims),
      t('analytics.kpi.remainingSub', { price: money(m.pricePerClaimUsd6) }),
    ],
  ];
  const stages: [string, StringKey, number, number][] = [
    ['claimed', 'analytics.stage.claimed', funnel.claimed, funnel.claimed > 0 ? 1 : 0],
    ['installed', 'analytics.stage.installed', funnel.installed, funnel.installedRate],
    ['active', 'analytics.stage.active', funnel.active, funnel.activeRate],
    ['toppedUp', 'analytics.stage.toppedUp', funnel.toppedUp, funnel.toppedUpRate],
    ['notInstalled', 'analytics.stage.notInstalled', funnel.notInstalled, funnel.notInstalledRate],
  ];
  const parts: [string, number, string][] = [
    [
      'notInstalled',
      status.pending + status.ready,
      t('analytics.state.notInstalled', {
        pending: enIN.format(status.pending),
        ready: enIN.format(status.ready),
      }),
    ],
    ['installed', status.installed, t('analytics.state.installed')],
    ['active', status.active, t('analytics.stage.active')],
    ['expired', status.expired, t('analytics.state.expired')],
  ];
  const proofs: [StringKey, number][] = [
    ['analytics.proof.chain', proof.onChainClaims],
    ['analytics.proof.txs', proof.claimTxs],
    ['analytics.proof.receipts', proof.arkivReceipts],
    ['analytics.proof.plans', proof.arkivPlans],
    ['analytics.proof.hcs', proof.hcsMessages],
  ];
  const firstDay = data.daily[0];
  const lastDay = data.daily.at(-1);

  return (
    <Section title={t('analytics.title')} lang={lang}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="note">{t('analytics.updated', { time: clockIst(data.asOf) })}</p>
        <Button variant="secondary" onClick={() => download(data)}>
          {t('analytics.export')}
        </Button>
      </div>
      {error ? (
        <Notice tone="warning">
          <p role="status">{t('analytics.error', { reason: error })}</p>
        </Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map(([key, value, sub]) => (
          <StatTile key={key} label={t(key)} value={value} hint={sub} />
        ))}
      </div>
      <Card
        as="section"
        className="grid gap-5"
        aria-label={t('analytics.title')}
        lang={lang}
        data-testid="campaign-analytics"
      >
        {data.sampled ? (
          <p className="note">{t('analytics.sampled', { n: enIN.format(data.scanCap) })}</p>
        ) : null}
        <ListGroup label={t('analytics.title')} flush>
          {figures.map(([key, value, sub]) => (
            <ListRow key={key} title={t(key)} subtitle={sub} value={value} />
          ))}
        </ListGroup>
        {totals.claims === 0 ? (
          <p className="note">{t('analytics.empty')}</p>
        ) : (
          <>
            <div className="grid gap-5 md:grid-cols-2">
              <Chart
                kind="bars"
                label={t('analytics.daily')}
                points={data.daily.map((d) => ({ key: d.day, value: d.claims }))}
                first={firstDay ? dayLabel(firstDay.start, lang) : ''}
                last={lastDay ? dayLabel(lastDay.start, lang) : ''}
              />
              <Chart
                kind="line"
                label={t('analytics.hourly')}
                points={data.hourly.map((h) => ({ key: String(h.at), value: h.claims }))}
                cap={data.hourlyCap}
                first={t('analytics.hoursAgo', { h: data.hourly.length })}
                last={t('analytics.now')}
              />
            </div>

            <ListGroup title={t('analytics.funnel')} label={t('analytics.funnel')} flush>
              {stages.map(([stage, key, count, rate]) => (
                <ListRow
                  key={stage}
                  data-testid={`funnel-${stage}`}
                  title={t(key)}
                  value={`${enIN.format(count)} · ${pct(rate)}`}
                />
              ))}
            </ListGroup>
            <p className="note">
              {t('analytics.upsell', {
                count: enIN.format(funnel.topUps),
                usd: money(funnel.topUpRevenueUsd6),
              })}
            </p>
            {status.expired > 0 ? (
              <p className="note">
                {t('analytics.expiredNote', { n: enIN.format(status.expired) })}
              </p>
            ) : null}

            <ListGroup title={t('analytics.status')} label={t('analytics.status')} flush>
              {parts.map(([state, n, label]) => (
                <ListRow
                  key={state}
                  data-testid={`status-${state}`}
                  title={label}
                  value={enIN.format(n)}
                />
              ))}
            </ListGroup>

            <div className="grid gap-3">
              <h3 className="t-heading">{t('analytics.notInstalled')}</h3>
              {notInstalled.count === 0 ? (
                <p className="note">{t('analytics.notInstalled.none')}</p>
              ) : (
                <>
                  <p className="t-label" data-testid="not-installed-headline">
                    {notInstalled.count === 1
                      ? t('analytics.notInstalled.headlineOne', { usd: money(notInstalled.usd6) })
                      : t('analytics.notInstalled.headline', {
                          count: enIN.format(notInstalled.count),
                          usd: money(notInstalled.usd6),
                        })}
                  </p>
                  <Table
                    caption={t('analytics.notInstalled')}
                    data-testid="not-installed"
                    columns={[
                      { key: 'claimed', label: t('analytics.col.claimed') },
                      { key: 'tier', label: t('analytics.col.tier') },
                      { key: 'status', label: t('analytics.col.status') },
                      { key: 'age', label: t('analytics.col.age') },
                      { key: 'expires', label: t('analytics.col.expires') },
                      { key: 'tx', label: t('analytics.col.tx') },
                      { key: 'arkiv', label: t('analytics.col.arkiv') },
                    ]}
                    rowKey={(_, i) => notInstalled.rows[i]?.arkivKey ?? String(i)}
                    rows={notInstalled.rows.map((r) => {
                      const soon = r.expiresAt - now <= SOON_MS;
                      return {
                        claimed: when(r.claimedAt),
                        tier: t(TIER[r.tier]),
                        status: (
                          <>
                            <Pill tone={r.status === 'ready' ? 'positive' : 'neutral'}>
                              {t(
                                r.status === 'ready'
                                  ? 'analytics.state.ready'
                                  : 'analytics.state.pending',
                              )}
                            </Pill>
                            {r.statusAsOf === undefined ? null : (
                              <span className="note note--quiet">
                                {' '}
                                {t('analytics.statusAsOf', { time: when(r.statusAsOf) })}
                              </span>
                            )}
                          </>
                        ),
                        age: t('analytics.age', { h: enIN.format(r.ageHours) }),
                        expires: (
                          <span
                            className={soon ? 'text-warning' : undefined}
                            data-soon={soon ? '' : undefined}
                          >
                            {soon ? <Icon name="warning" /> : null}
                            {t('analytics.expiresUnused', { date: when(r.expiresAt) })}
                          </span>
                        ),
                        tx: r.claimTx ? (
                          <Hash
                            value={r.claimTx}
                            kind="transaction hash"
                            lang={lang}
                            {...txLink(r.claimTx)}
                          />
                        ) : (
                          '—'
                        ),
                        arkiv: (
                          <Hash
                            value={r.arkivKey}
                            kind="Arkiv entity"
                            lang={lang}
                            {...arkivLink(r.arkivKey)}
                          />
                        ),
                      };
                    })}
                  />
                  {notInstalled.rows.length < notInstalled.count ? (
                    <p className="note">
                      {t('analytics.notInstalled.more', {
                        shown: enIN.format(notInstalled.rows.length),
                        count: enIN.format(notInstalled.count),
                      })}
                    </p>
                  ) : null}
                </>
              )}
            </div>

            <div className="grid gap-3">
              <h3 className="t-heading">{t('analytics.latest')}</h3>
              <ListGroup label={t('analytics.latest')} flush>
                {proofs.map(([key, n]) => (
                  <ListRow key={key} title={t(key)} value={enIN.format(n)} />
                ))}
              </ListGroup>
              <Table
                caption={t('analytics.latest')}
                data-testid="latest-claims"
                columns={[
                  { key: 'time', label: t('analytics.col.time') },
                  { key: 'tier', label: t('analytics.col.tier') },
                  { key: 'tx', label: t('analytics.col.tx') },
                  { key: 'arkiv', label: t('analytics.col.arkiv') },
                ]}
                rowKey={(_, i) => data.latest[i]?.arkivKey ?? String(i)}
                rows={data.latest.map((l) => ({
                  time: when(l.at),
                  tier: t(TIER[l.tier]),
                  tx: l.tx ? (
                    <Hash value={l.tx} kind="transaction hash" lang={lang} {...txLink(l.tx)} />
                  ) : (
                    '—'
                  ),
                  arkiv: (
                    <Hash
                      value={l.arkivKey}
                      kind="Arkiv entity"
                      lang={lang}
                      {...arkivLink(l.arkivKey)}
                    />
                  ),
                }))}
              />
            </div>
          </>
        )}
      </Card>
    </Section>
  );
}
