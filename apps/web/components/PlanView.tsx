'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { MeResponse, ReceiptPublic } from '@ethglobal/protocol/schemas';
import {
  Button,
  Countdown,
  Coupon,
  dateLocale,
  MbMeter,
  Receipt,
  uiStrings,
  type CouponLang,
} from '@ethglobal/ui/components';

import { AddToHomeScreen, NotificationAsk } from './AddToHomeScreen';
import { CopyButton } from './InstallSteps';
import { IssuingRows, useOdometer } from './IssuingRows';
import { PlanActions } from './PlanActions';
import { ProofPanel } from './ProofPanel';
import { QrCode } from './QrCode';
import { AppHeader, Caution, Screen, TabBar } from './Shell';
import { useLang } from '../i18n/lang';
import { activationBlocked } from '../lib/activation-policy';
import { api, ApiError } from '../lib/api';
import { recoverActivation } from '../lib/deliver';
import { arkivEntityUrl } from '../lib/env';
import { clockIst, dayLabel, formatMb, money, moneyUsdc, soldPlan } from '../lib/format';
import { useClock, usePlans } from '../lib/hooks';
import { plans as store, type IssuedFacts } from '../lib/store';

type Translate = ReturnType<typeof useLang>['t'];

/**
 * Where the plan came from, for the card's line and the first issuing row (/me's kind and tier, its receipts): a World
 * ID claim is "because you're human" and "Verified · Orb"; a paid plan says what was paid; a gift or a card says so.
 */
function origin(m: MeResponse, receipts: readonly ReceiptPublic[], t: Translate) {
  if (m.kind === 'paid') {
    const usd6 = receipts.find((r) => r.kind === 'provision')?.usd6;
    return {
      reason: usd6 ? t('plan.kindPaid', { amount: moneyUsdc(usd6) }) : t('plan.kindBought'),
    };
  }
  if (m.kind === 'gift') return { reason: t('plan.kindGift') };
  if (m.kind === 'card') return { reason: t('plan.kindCard') };
  const tier = m.tier === 'orb' ? 'Orb' : m.tier === 'document' ? 'Document' : undefined;
  return { verified: tier ? `${t('issuing.verified')} · ${tier}` : t('issuing.verified') };
}

/** No plan to show: the two ways to get one, and how to bring over one that lives on another device. */
export function NoPlanSteps() {
  const { t, lang } = useLang();
  return (
    <div className="plan__actions" data-testid="no-plan">
      <Link
        href="/verify"
        className="ui-button ui-button--block"
        data-variant="primary"
        prefetch={false}
      >
        {t('hub.free')}
      </Link>
      <Link
        href="/pay"
        className="ui-button ui-button--block"
        data-variant="secondary"
        prefetch={false}
      >
        {t('hub.buy')}
      </Link>
      <p className="note" lang={lang}>
        {t('plan.elsewhere')}
      </p>
    </div>
  );
}

/**
 * "Open on another device": this plan's own URL as a QR code and a copy, behind a tap, under its warning. The other
 * device opens it read-only and keeps it with "Keep this plan on this phone"; the activation code never travels.
 */
function OtherDevice({ entitlementKey }: { entitlementKey: string }) {
  const { t } = useLang();
  const url = `${window.location.origin}/plan/${encodeURIComponent(entitlementKey)}`;
  return (
    <details className="disclosure" data-testid="other-device">
      <summary>{t('plan.otherDevice')}</summary>
      <div className="second-device">
        <Caution k="plan.otherDeviceWarn" />
        <QrCode url={url} sizeMm={40} label={t('plan.otherDevice')} />
        <CopyButton value={url} label={t('plan.copyLink')} testId="copy-plan-link" />
      </div>
    </details>
  );
}

type Load =
  | { kind: 'loading' }
  | { kind: 'ok'; me: MeResponse; offlineAt?: number }
  | { kind: 'unknown' }
  | { kind: 'expired' }
  | { kind: 'offline' };

function receiptLines(receipt: ReceiptPublic | undefined, facts: IssuedFacts | undefined) {
  if (receipt?.kind === 'claim' || receipt?.kind === 'card-redeem')
    return { you: '$0.00', sponsor: receipt.usd6 ? money(receipt.usd6) : '—' };
  if (receipt?.usd6) return { you: money(receipt.usd6), sponsor: '—' };
  return { you: facts?.you ?? '$0.00', sponsor: '—' };
}

/**
 * /me, falling back to the last IndexedDB snapshot ("Offline · as of 14:02"); 404 / 410 are their own states, and
 * a network failure with no snapshot is the honest offline card (RT-W-06), never a blank screen. `refresh` skips the
 * API's 60-s /me cache (a pending profile's re-read).
 */
async function readPlan(key: string, refresh = false): Promise<Load> {
  try {
    const me = await api.me(key, refresh);
    void store.saveSnapshot(key, me);
    return { kind: 'ok', me };
  } catch (e) {
    const err = e instanceof ApiError ? e : undefined;
    if (err?.code === 'expired') return { kind: 'expired' };
    const snap = await store.snapshot(key);
    // the API answers expired and unknown with the same 404 (RT-O-01); this device's own copy tells them apart
    if (err?.code === 'not_found') {
      return snap && snap.me.expiresAt <= Date.now() ? { kind: 'expired' } : { kind: 'unknown' };
    }
    if (snap) return { kind: 'ok', me: snap.me, offlineAt: snap.at };
    return err?.code === 'network' || !err ? { kind: 'offline' } : { kind: 'unknown' };
  }
}

const INSTALLED = new Set<MeResponse['status']>(['installed', 'active']);
/** "This page updates by itself": a pending profile's /me is read again this often while the tab is visible. */
export const PENDING_POLL_MS = 15_000;

/**
 * `/plan/[key]` — the MB number at 2× everything else, "usage as of", expiry from the entity's expiresAt.
 * A key this device does not hold renders read-only with an explicit "Keep this plan on this phone" (RT-W-03):
 * a link never re-points the plan /install, /agent and the tabs act on.
 */
export function PlanView({ entitlementKey }: { entitlementKey: string }) {
  const { t, lang } = useLang();
  const { plans } = usePlans();
  const now = useClock(60_000);
  const [load, setLoad] = useState<Load>({ kind: 'loading' });
  const [facts, setFacts] = useState<IssuedFacts | undefined>();
  const [receipts, setReceipts] = useState<ReceiptPublic[]>([]);
  const [firstView, setFirstView] = useState(false);
  const [owned, setOwned] = useState<boolean | undefined>();
  const [cancelled, setCancelled] = useState(false);
  const [hasLpa, setHasLpa] = useState<boolean | undefined>();

  useEffect(() => {
    let alive = true;
    void store.owns(entitlementKey).then((own) => alive && setOwned(own));
    void store.lpa(entitlementKey).then((lpa) => alive && setHasLpa(Boolean(lpa)));
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
  const live = load.kind === 'ok' && !load.offlineAt;

  // a pending profile re-reads /me every 15 s until it is ready or gone (a 404 / 410 / offline load ends it too),
  // skipping while the tab is hidden and reading at once when it is shown again
  useEffect(() => {
    if (!owned || hasLpa || !me || !['pending-profile', 'ready'].includes(me.status)) return;
    let alive = true;
    const recover = () => {
      if (document.visibilityState !== 'visible') return;
      void recoverActivation(entitlementKey)
        .then((found) => {
          if (alive && found) setHasLpa(true);
        })
        .catch(() => undefined);
    };
    recover();
    const timer = setInterval(recover, PENDING_POLL_MS);
    document.addEventListener('visibilitychange', recover);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', recover);
    };
  }, [owned, hasLpa, me, entitlementKey]);
  const pending =
    live && (me?.status === 'pending-profile' || me?.refund?.recovery === 'automatic');
  useEffect(() => {
    if (!pending) return;
    let alive = true;
    const reread = () => {
      if (document.visibilityState !== 'visible') return;
      void readPlan(entitlementKey, true).then((next) => {
        // a failed read (offline, the snapshot) keeps the pending card and the polling; ready / gone replaces it
        if (alive && !(next.kind === 'offline' || (next.kind === 'ok' && next.offlineAt)))
          setLoad(next);
      });
    };
    const timer = setInterval(reread, PENDING_POLL_MS);
    document.addEventListener('visibilitychange', reread);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', reread);
    };
  }, [pending, entitlementKey]);
  useEffect(() => {
    if (!live || !owned || !me) return;
    // the API answered for a plan this device holds: it becomes the one /install acts on
    void store.setCurrent(entitlementKey);
    // installed: the activation code has done its job and leaves the device (T-76, RT-W-01)
    if (INSTALLED.has(me.status)) void store.forgetLpa(entitlementKey);
  }, [live, owned, me, entitlementKey]);

  const odometer = useOdometer(me?.mbTotal ?? 0, firstView && Boolean(me));
  // a top-up is the paid lane's one size: "+1 GB · $4.00"
  const price = money(soldPlan(plans).usd6);
  const k = encodeURIComponent(entitlementKey);
  const uiLang: CouponLang = lang;

  if (load.kind === 'loading')
    return (
      <Screen>
        <AppHeader />
        <div className="skeleton skeleton--coupon" aria-label="Loading your plan" />
        <div className="skeleton skeleton--line" aria-hidden="true" />
      </Screen>
    );
  if (load.kind === 'offline')
    return (
      <Screen>
        <AppHeader />
        <section className="offline-card" role="status" data-testid="plan-offline">
          <h1 className="screen__title">{t('offline.title')}</h1>
          <p className="note">{t('plan.offlineNone')}</p>
        </section>
        <TabBar active="plan" />
      </Screen>
    );
  if (load.kind === 'unknown' || load.kind === 'expired')
    return (
      <Screen>
        <AppHeader />
        <p className="plan-empty" role="status">
          {load.kind === 'expired' ? t('plan.gone') : t('plan.unknown')}
        </p>
        {/* a plan /me no longer knows cannot be topped up: the next step is a new one */}
        <NoPlanSteps />
      </Screen>
    );

  const m = load.me;
  const mobileExpiry = m.lifecycle?.serviceExpiresAt;
  const expired = m.expiresAt <= now || (mobileExpiry !== undefined && mobileExpiry <= now);
  const terminal = expired || cancelled || Boolean(m.cancelledAt);
  const activationUnavailable = activationBlocked(m, now);
  const lines = receiptLines(receipts.find((r) => r.kind === 'claim') ?? receipts[0], facts);
  const latest = receipts[0];
  const sponsor = m.sponsorName;
  const ready = Boolean(facts) && odometer.done && owned === true;
  const foreign = owned === false;
  const from = origin(m, receipts, t);
  const tx = facts?.claimTx ?? facts?.settlement;
  const arkivUrl = arkivEntityUrl(m.arkivKey);

  return (
    <Screen wide className="plan-screen">
      <AppHeader />
      {m.degraded ? (
        <p className="banner" role="status" data-testid="degraded-banner">
          {t('plan.degraded')}
        </p>
      ) : null}
      {load.offlineAt ? (
        <p className="banner" role="status" data-testid="plan-offline-banner">
          {t('plan.offline', { time: clockIst(load.offlineAt) })}
        </p>
      ) : null}
      {foreign ? (
        <section className="foreign-plan" data-testid="foreign-plan">
          <p className="note">{t('plan.notHere')}</p>
          <Button
            variant="secondary"
            onClick={() => {
              void store.adopt(entitlementKey).then(() => setOwned(true));
            }}
            data-testid="keep-plan"
          >
            {t('plan.keep')}
          </Button>
        </section>
      ) : null}
      <div className="plan-overview">
        <section className="plan__hero">
          <Coupon
            mb={terminal ? 0 : firstView ? odometer.value : m.mbTotal}
            {...(sponsor ? { sponsor } : {})}
            {...(from.reason ? { reason: from.reason } : {})}
            lang={uiLang}
            {...(expired
              ? { status: t('plan.expired', { when: dayLabel(mobileExpiry ?? m.expiresAt, lang) }) }
              : {})}
            {...(m.status === 'pending-profile' ? { status: t('plan.pendingProfile') } : {})}
            {...(cancelled || m.cancelledAt ? { status: t('plan.cancelledState') } : {})}
            id="plan-coupon"
          />
        </section>
        <section className="plan-summary" aria-labelledby="plan-summary-title">
          <p className="eyebrow" lang={lang}>
            {t('flow.coverage')}
          </p>
          <h1 id="plan-summary-title" className="screen__title" lang={lang}>
            {t('plan.summary')}
          </h1>
          <MbMeter
            remainingMb={m.remainingMb}
            totalMb={m.mbTotal}
            usageAsOf={m.usageAsOf}
            {...(m.usageSource === 'simulated' ||
            (process.env.NEXT_PUBLIC_MODE === 'local' &&
              m.usageSource === 'none' &&
              plans?.simulated.usage)
              ? { source: t('plan.simulated') }
              : {})}
            lang={uiLang}
            quietWhenFull
            fillOnce={firstView}
            className="plan__meter"
          />
          <div className="plan__expiry" data-testid="plan-expiry">
            {m.lifecycle ? (
              <>
                <p>
                  {mobileExpiry !== undefined
                    ? t('plan.serviceExpiry', {
                        date: `${dayLabel(mobileExpiry, lang)} ${clockIst(mobileExpiry)}`,
                      })
                    : t(
                        m.lifecycle.startsOn === 'first-network'
                          ? 'plan.lifecycleNetwork'
                          : m.lifecycle.startsOn === 'installation'
                            ? 'plan.lifecycleInstall'
                            : 'plan.lifecycleUnknown',
                      )}
                </p>
                {m.lifecycle.validityDays && mobileExpiry === undefined ? (
                  <p>{t('plan.serviceValidity', { days: m.lifecycle.validityDays })}</p>
                ) : null}
                {m.lifecycle.installBy !== undefined &&
                m.lifecycle.activatedAt === undefined &&
                !INSTALLED.has(m.status) ? (
                  <p>
                    {t('plan.installDeadline', {
                      date: `${dayLabel(m.lifecycle.installBy, lang)} ${clockIst(m.lifecycle.installBy)}`,
                    })}
                  </p>
                ) : null}
              </>
            ) : (
              <Countdown
                until={m.expiresAt}
                lead=""
                ended={t('plan.ended')}
                template={(left, at) => t('plan.expiresIn', { left, at })}
                units={uiStrings[lang].units}
                locale={dateLocale(lang)}
              />
            )}
          </div>
          {cancelled || m.cancelledAt ? (
            <p className="banner" role="status">
              {t('plan.cancelledState')}
            </p>
          ) : !m.lifecycle ? (
            <Caution k="esim.expiry" />
          ) : null}
          {m.campaignReclaim ? (
            <p className="note" role="status">
              {t(
                m.campaignReclaim.state === 'scheduled'
                  ? 'plan.eventScheduled'
                  : m.campaignReclaim.state === 'refunded'
                    ? 'plan.eventRefunded'
                    : m.campaignReclaim.state === 'manual'
                      ? 'plan.eventManual'
                      : m.campaignReclaim.state === 'ineligible'
                        ? 'plan.eventIneligible'
                        : 'plan.eventPending',
                {
                  date: `${dayLabel(m.campaignReclaim.reclaimAfter, lang)} ${clockIst(m.campaignReclaim.reclaimAfter)}`,
                },
              )}
            </p>
          ) : null}
          {foreign ||
          terminal ||
          activationUnavailable ||
          INSTALLED.has(m.status) ||
          m.status === 'pending-profile' ? null : hasLpa === false && m.status === 'ready' ? (
            // the activation code was opened in another browser (it never travels): install from there
            <p className="note" role="note" lang={lang} data-testid="install-elsewhere">
              {t('install.noLpa')}
            </p>
          ) : (
            <div className="action-dock">
              <Link
                href="/install"
                className="ui-button ui-button--block"
                data-variant="primary"
                prefetch={false}
              >
                {t('plan.install')}
              </Link>
              <p className="note">{t('plan.later')}</p>
            </div>
          )}
          {!terminal && m.topUpAvailable !== false ? (
            <Link
              href={`/pay?key=${k}`}
              className="ui-button ui-button--block"
              data-variant="secondary"
              prefetch={false}
            >
              {t('plan.add', { price })}
            </Link>
          ) : m.topUpAvailable === false ? (
            <p className="note">{t('plan.eventBundleOnly')}</p>
          ) : null}
        </section>
      </div>
      <div className="plan-support">
        <details className="disclosure plan-details">
          <summary lang={lang}>{t('plan.details')}</summary>
          <div className="plan-details__body">
            {facts ? (
              <IssuingRows
                facts={{
                  ...(from.verified ? { verified: from.verified } : {}),
                  ...(tx ? { tx } : {}),
                  ...(facts.network ? { network: facts.network } : {}),
                  paidBySponsor: Boolean(facts.claimTx),
                  arkivKey: m.arkivKey,
                  ...(facts.hcs ? { hcs: facts.hcs } : {}),
                }}
              />
            ) : null}
            <ProofPanel proof={facts?.proof} />
            <details className="disclosure">
              <summary>{t('plan.whyExpires')}</summary>
              <p>{t('plan.whyBody')}</p>
              <p
                className="mono-key"
                data-hash
                title={m.arkivKey}
                data-testid="arkiv-key"
                lang="en"
              >
                {arkivUrl ? (
                  <a href={arkivUrl} target="_blank" rel="noreferrer">
                    {m.arkivKey}
                  </a>
                ) : (
                  m.arkivKey
                )}
              </p>
            </details>
            {foreign || terminal || activationUnavailable ? null : (
              <OtherDevice entitlementKey={entitlementKey} />
            )}
            <Receipt
              heading={
                latest
                  ? `${latest.mb && latest.mb !== m.mbTotal ? `+${formatMb(latest.mb)}` : t('plan.bundle')} · ${dayLabel(latest.at, lang)} ${clockIst(latest.at)} · ${t('receipts.final')}`
                  : t('plan.bundle')
              }
              you={lines.you}
              sponsor={lines.sponsor}
              networkFee="$0.00"
              lang={uiLang}
            />
          </div>
        </details>
        <section className="plan-manage" aria-labelledby="plan-manage-title">
          <h2 id="plan-manage-title" className="section-title" lang={lang}>
            {t('plan.manage')}
          </h2>
          <div className="plan__actions">
            <AddToHomeScreen ready={ready} />
            <NotificationAsk ready={ready} />
          </div>
          {!activationUnavailable ? (
            <PlanActions
              entitlementKey={entitlementKey}
              me={m}
              onCancelled={() => {
                setCancelled(true);
                void readPlan(entitlementKey, true).then(setLoad);
              }}
            />
          ) : null}
        </section>
      </div>
      <TabBar active="plan" canTopUp={!terminal && m.topUpAvailable !== false} />
    </Screen>
  );
}
