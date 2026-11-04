'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { MeResponse, ReceiptPublic } from '@ethglobal/protocol/schemas';
import { Countdown, Coupon, MbMeter, Receipt } from '@ethglobal/ui/components';

import { AddToHomeScreen, NotificationAsk } from './AddToHomeScreen';
import { IssuingRows, shortKey, useOdometer } from './IssuingRows';
import { AppHeader, Screen, TabBar } from './Shell';
import { useLang } from '../i18n/lang';
import { api, ApiError } from '../lib/api';
import { IS_LOCAL } from '../lib/env';
import { clockIst, dayLabel, formatMb, money } from '../lib/format';
import { useClock, usePlans } from '../lib/hooks';
import { plans as store, type IssuedFacts } from '../lib/store';


type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; me: MeResponse; offlineAt?: number }
  | { kind: 'unknown' }
  | { kind: 'expired' };

function receiptLines(receipt: ReceiptPublic | undefined, facts: IssuedFacts | undefined) {
  if (receipt?.kind === 'claim' || receipt?.kind === 'card-redeem')
    return { you: '$0.00', sponsor: receipt.usd6 ? money(receipt.usd6) : '—' };
  if (receipt?.usd6) return { you: money(receipt.usd6), sponsor: '—' };
  return { you: facts?.you ?? '$0.00', sponsor: facts?.sponsor ? '—' : '—' };
}

/** /me, falling back to the last IndexedDB snapshot ("Offline · as of 14:02"); 404 / 410 are their own states. */
async function readPlan(key: string): Promise<Load> {
  try {
    const me = await api.me(key);
    void store.saveSnapshot(key, me);
    return { kind: 'ok', me };
  } catch (e) {
    const err = e instanceof ApiError ? e : undefined;
    if (err?.code === 'expired') return { kind: 'expired' };
    if (err?.code === 'not_found') return { kind: 'unknown' };
    const snap = await store.snapshot(key);
    return snap ? { kind: 'ok', me: snap.me, offlineAt: snap.at } : { kind: 'unknown' };
  }
}

/** `/plan/[key]` — the MB number at 2× everything else, "usage as of", expiry from the entity's expiresAt. */
export function PlanView({ entitlementKey }: { entitlementKey: string }) {
  const { t, lang } = useLang();
  const { plans } = usePlans();
  const now = useClock(60_000);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [facts, setFacts] = useState<IssuedFacts | undefined>();
  const [receipts, setReceipts] = useState<ReceiptPublic[]>([]);
  const [firstView, setFirstView] = useState(false);

  useEffect(() => {
    let alive = true;
    void store.setCurrent(entitlementKey);
    void store.issued(entitlementKey).then((f) => {
      if (!alive) return;
      setFacts(f);
      setFirstView(Boolean(f && !f.shown));
      if (f && !f.shown) void store.markIssuedShown(entitlementKey);
    });
    void readPlan(entitlementKey).then((next) => alive && setLoad(next));
    void api.receipts(entitlementKey).then(
      (r) => alive && setReceipts(r),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [entitlementKey]);

  const me = load.kind === 'ok' ? load.me : undefined;
  const odometer = useOdometer(me?.mbTotal ?? 0, firstView && Boolean(me));
  const price = plans ? money(plans.paid.priceUsd6PerStep) : '$0.40';
  const k = encodeURIComponent(entitlementKey);

  if (load.kind === 'loading')
    return (
      <Screen>
        <AppHeader />
        <div className="skeleton skeleton--coupon" aria-label="Loading your plan" />
        <div className="skeleton skeleton--line" aria-hidden="true" />
      </Screen>
    );
  if (load.kind === 'unknown' || load.kind === 'expired')
    return (
      <Screen>
        <AppHeader />
        <p className="plan-empty" role="status" lang={lang}>
          {load.kind === 'expired' ? t('plan.gone') : t('plan.unknown')}
        </p>
        <Link href={`/pay?key=${k}`} className="ui-button ui-button--block" data-variant="primary" prefetch={false}>
          {t('plan.add', { price })}
        </Link>
      </Screen>
    );

  const m = load.me;
  const expired = m.expiresAt <= now;
  const lines = receiptLines(receipts.find((r) => r.kind === 'claim') ?? receipts[0], facts);
  const latest = receipts[0];
  const sponsor = m.sponsorName;
  const ready = Boolean(facts) && odometer.done;

  return (
    <Screen>
      <AppHeader />
      {m.degraded ? (
        <p className="banner" role="status" data-testid="degraded-banner" lang={lang}>
          {t('plan.degraded')}
        </p>
      ) : null}
      {load.offlineAt ? (
        <p className="banner" role="status" lang={lang}>
          {t('plan.offline', { time: clockIst(load.offlineAt) })}
        </p>
      ) : null}
      <section className="plan__hero">
        <Coupon
          mb={expired ? 0 : firstView ? odometer.value : m.mbTotal}
          {...(sponsor ? { sponsor } : {})}
          lang={lang === 'hi' ? 'hi' : 'en'}
          {...(expired ? { status: t('plan.expired', { when: dayLabel(m.expiresAt) }) } : {})}
          {...(m.status === 'pending-profile' ? { status: t('plan.pendingProfile') } : {})}
          id="plan-coupon"
        />
      </section>
      {facts ? (
        <IssuingRows
          facts={{
            verified: true,
            ...(facts.claimTx ?? facts.settlement ? { tx: facts.claimTx ?? facts.settlement } : {}),
            ...(facts.network ? { network: facts.network } : {}),
            paidBySponsor: Boolean(facts.claimTx),
            arkivKey: m.arkivKey,
          }}
        />
      ) : null}
      <MbMeter
        remainingMb={m.remainingMb}
        totalMb={m.mbTotal}
        usageAsOf={m.usageAsOf}
        {...(m.usageSource === 'simulated' || (IS_LOCAL && m.usageSource === 'none' && plans?.simulated.usage)
          ? { source: t('plan.simulated') }
          : {})}
        lang={lang === 'hi' ? 'hi' : 'en'}
        fillOnce={firstView}
        className="plan__meter"
      />
      <p className="plan__expiry" data-testid="plan-expiry">
        <Countdown until={m.expiresAt} lead="Expires in" ended="Expired" />
      </p>
      <details className="disclosure">
        <summary lang={lang}>{t('plan.whyExpires')}</summary>
        <p lang={lang}>{t('plan.whyBody')}</p>
        <p className="mono-key" data-hash title={m.arkivKey} data-testid="arkiv-key">
          {m.arkivKey}
        </p>
      </details>
      <Receipt
        heading={
          latest
            ? `${latest.mb ? `+${formatMb(latest.mb)}` : formatMb(m.mbTotal)} · ${dayLabel(latest.at)} ${clockIst(latest.at)} · ${t('receipts.final')}`
            : `${formatMb(m.mbTotal)} · ${shortKey(m.arkivKey)}`
        }
        you={lines.you}
        sponsor={lines.sponsor}
        networkFee="$0.00"
      />
      <div className="plan__actions">
        <Link href="/install" className="ui-button ui-button--block" data-variant="primary" prefetch={false}>
          <span lang={lang}>{t('plan.install')}</span>
        </Link>
        <p className="note" lang={lang}>
          {t('plan.later')}
        </p>
        <Link href={`/pay?key=${k}`} className="ui-button ui-button--block" data-variant="secondary" prefetch={false}>
          <span lang={lang}>{t('plan.add', { price })}</span>
        </Link>
        <AddToHomeScreen ready={ready} />
        <NotificationAsk ready={ready} />
      </div>
      <TabBar active="plan" />
    </Screen>
  );
}
