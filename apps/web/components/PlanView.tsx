'use client';

import { useEffect, useState } from 'react';

import type { MeResponse, ReceiptPublic } from '@ethglobal/protocol/schemas';
import { Countdown, dataAmount, dateLocale, uiStrings, UsageAsOf } from '@ethglobal/ui/components';

import { AddToHomeScreen, NotificationAsk } from './AddToHomeScreen';
import { CopyButton } from './InstallSteps';
import { IssuingRows, useOdometer } from './IssuingRows';
import {
  ActionBar,
  AppShell,
  Avatar,
  BalanceCard,
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ListGroup,
  ListRow,
  Notice,
  Pill,
  QuickActions,
  Section,
  Skeleton,
} from './kit';
import { PlanActions } from './PlanActions';
import { ProofPanel } from './ProofPanel';
import { QrCode } from './QrCode';
import { useLang, useNetworkName } from '../i18n/lang';
import { activationBlocked } from '../lib/activation-policy';
import { api, ApiError } from '../lib/api';
import { recoverActivation } from '../lib/deliver';
import { arkivEntityUrl } from '../lib/env';
import { clockIst, dayLabel, formatMb, money, moneyUsdc } from '../lib/format';
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
    <>
      <ListGroup data-testid="no-plan">
        <ListRow
          leading={<Avatar icon="human" />}
          title={t('hub.free')}
          href="/verify"
          lang={lang}
        />
        <ListRow leading={<Avatar icon="card" />} title={t('hub.buy')} href="/pay" lang={lang} />
      </ListGroup>
      <Notice tone="info" lang={lang}>
        {t('plan.elsewhere')}
      </Notice>
    </>
  );
}

/**
 * "Open on another device": this plan's own URL as a QR code and a copy, behind a tap, under its warning. The other
 * device opens it read-only and keeps it with "Keep this plan on this phone"; the activation code never travels.
 */
function OtherDevice({ entitlementKey }: { entitlementKey: string }) {
  const { t, lang } = useLang();
  const [open, setOpen] = useState(false);
  const url = `${window.location.origin}/plan/${encodeURIComponent(entitlementKey)}`;
  return (
    <>
      <ListGroup>
        <ListRow
          leading={<Avatar icon="share" size={32} />}
          title={t('plan.otherDevice')}
          onClick={() => setOpen((o) => !o)}
          lang={lang}
          data-testid="other-device"
        />
      </ListGroup>
      {open ? (
        <Card>
          <Notice tone="warning" lang={lang}>
            {t('plan.otherDeviceWarn')}
          </Notice>
          <QrCode url={url} sizeMm={40} label={t('plan.otherDevice')} />
          <CopyButton value={url} label={t('plan.copyLink')} testId="copy-plan-link" />
        </Card>
      ) : null}
    </>
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

  // the one permitted flourish: data left ticks 0 → its value once, on the bundle's first view
  const odometer = useOdometer(me?.remainingMb ?? 0, firstView && Boolean(me));
  const netName = useNetworkName();
  const k = encodeURIComponent(entitlementKey);

  if (load.kind === 'loading')
    return (
      <AppShell nav="plan">
        <Skeleton shape="balance" label="Loading your plan" />
        <Skeleton shape="row" count={4} />
      </AppShell>
    );
  if (load.kind === 'offline')
    return (
      <AppShell nav="plan">
        <Notice
          tone="warning"
          role="status"
          title={t('offline.title')}
          lang={lang}
          data-testid="plan-offline"
        >
          {t('plan.offlineNone')}
        </Notice>
      </AppShell>
    );
  if (load.kind === 'unknown' || load.kind === 'expired')
    return (
      <AppShell nav="plan">
        <EmptyState title={load.kind === 'expired' ? t('plan.gone') : t('plan.unknown')} />
        {/* a plan /me no longer knows cannot be topped up: the next step is a new one */}
        <NoPlanSteps />
      </AppShell>
    );

  const m = load.me;
  const mobileExpiry = m.lifecycle?.serviceExpiresAt;
  const expired = m.expiresAt <= now || (mobileExpiry !== undefined && mobileExpiry <= now);
  const isCancelled = cancelled || Boolean(m.cancelledAt);
  const terminal = expired || isCancelled;
  const activationUnavailable = activationBlocked(m, now);
  const lines = receiptLines(receipts.find((r) => r.kind === 'claim') ?? receipts[0], facts);
  const latest = receipts[0];
  const ready = Boolean(facts) && odometer.done && owned === true;
  const foreign = owned === false;
  const from = origin(m, receipts, t);
  const tx = facts?.claimTx ?? facts?.settlement;
  const arkivUrl = arkivEntityUrl(m.arkivKey);
  const installed = INSTALLED.has(m.status);
  const canTopUp = !terminal && m.topUpAvailable !== false;
  const installable = !(
    foreign ||
    terminal ||
    activationUnavailable ||
    installed ||
    m.status === 'pending-profile'
  );
  // the activation code was opened in another browser (it never travels): install from there
  const installElsewhere = installable && hasLpa === false && m.status === 'ready';
  const left = dataAmount(terminal ? 0 : firstView ? odometer.value : m.remainingMb);
  const simulated =
    m.usageSource === 'simulated' ||
    (process.env.NEXT_PUBLIC_MODE === 'local' &&
      m.usageSource === 'none' &&
      plans?.simulated.usage);
  const status = isCancelled ? (
    <Pill tone="negative">{t('plans.cancelled')}</Pill>
  ) : expired ? (
    <Pill tone="negative">{t('plans.expired')}</Pill>
  ) : m.status === 'pending-profile' || (firstView && !odometer.done) ? (
    <Pill tone="warning" dot>
      {t('plan.pillIssuing')}
    </Pill>
  ) : installed ? (
    <Pill tone="positive" dot>
      {m.status === 'active' ? t('plans.active') : t('plans.installed')}
    </Pill>
  ) : (
    <Pill tone="neutral" dot>
      {t('plan.pillReady')}
    </Pill>
  );
  // the issue moment: the facts sit under the number on the first view, then fold into the details
  const issuing = (title?: string) =>
    facts ? (
      <IssuingRows
        {...(title ? { title } : {})}
        facts={{
          ...(from.verified ? { verified: from.verified } : {}),
          ...(tx ? { tx } : {}),
          ...(facts.network ? { network: facts.network } : {}),
          paidBySponsor: Boolean(facts.claimTx),
          arkivKey: m.arkivKey,
          ...(facts.hcs ? { hcs: facts.hcs } : {}),
        }}
      />
    ) : null;
  const when = (ms: number) => `${dayLabel(ms, lang)} ${clockIst(ms)}`;
  const expiry = m.lifecycle ? (
    [
      mobileExpiry !== undefined
        ? t('plan.serviceExpiry', { date: when(mobileExpiry) })
        : t(
            m.lifecycle.startsOn === 'first-network'
              ? 'plan.lifecycleNetwork'
              : m.lifecycle.startsOn === 'installation'
                ? 'plan.lifecycleInstall'
                : 'plan.lifecycleUnknown',
          ),
      m.lifecycle.validityDays && mobileExpiry === undefined
        ? t('plan.serviceValidity', { days: m.lifecycle.validityDays })
        : undefined,
      m.lifecycle.installBy !== undefined && m.lifecycle.activatedAt === undefined && !installed
        ? t('plan.installDeadline', { date: when(m.lifecycle.installBy) })
        : undefined,
    ]
      .filter(Boolean)
      .join(' · ')
  ) : (
    <Countdown
      until={m.expiresAt}
      lead=""
      ended={t('plan.ended')}
      template={(l, at) => t('plan.expiresIn', { left: l, at })}
      units={uiStrings[lang].units}
      locale={dateLocale(lang)}
    />
  );

  return (
    <AppShell nav="plan">
      <BalanceCard
        id="plan-coupon"
        amount={left.value}
        unit={left.unit}
        eyebrow={t('plan.dataLeft')}
        status={status}
        {...(simulated ? { note: t('plan.simulated') } : {})}
        meter={{
          used: terminal ? m.mbTotal : m.mbTotal - m.remainingMb,
          total: m.mbTotal,
          label: t('plan.dataLeft'),
        }}
        caption={<UsageAsOf at={m.usageAsOf} lang={lang} />}
        lang={lang}
      />
      <QuickActions
        label={t('plan.manageTitle')}
        items={[
          {
            icon: 'install',
            label: t('plan.qaInstall'),
            href: '/install',
            disabled: !installable || installElsewhere,
          },
          { icon: 'add', label: t('tab.add'), href: `/pay?key=${k}`, disabled: !canTopUp },
          { icon: 'gift', label: t('tab.gift'), href: '/gift' },
          { icon: 'receipt', label: t('receipts.title'), href: '/receipts' },
        ]}
      />
      {firstView ? issuing() : null}
      {m.degraded ? (
        <Notice tone="warning" role="status" lang={lang} data-testid="degraded-banner">
          {t('plan.degraded')}
        </Notice>
      ) : null}
      {load.offlineAt ? (
        <Notice tone="warning" role="status" lang={lang} data-testid="plan-offline-banner">
          {t('plan.offline', { time: clockIst(load.offlineAt) })}
        </Notice>
      ) : null}
      {m.status === 'pending-profile' ? (
        <Notice tone="info" role="status" lang={lang}>
          {t('plan.pendingProfile')}
        </Notice>
      ) : null}
      {isCancelled ? (
        <Notice tone="negative" role="status" lang={lang}>
          {t('plan.cancelledState')}
        </Notice>
      ) : null}
      {foreign ? (
        <Notice
          tone="info"
          lang={lang}
          data-testid="foreign-plan"
          action={
            <Button
              variant="secondary"
              onClick={() => {
                void store.adopt(entitlementKey).then(() => setOwned(true));
              }}
              data-testid="keep-plan"
            >
              {t('plan.keep')}
            </Button>
          }
        >
          {t('plan.notHere')}
        </Notice>
      ) : null}
      {installElsewhere ? (
        <Notice tone="info" role="note" lang={lang} data-testid="install-elsewhere">
          {t('install.noLpa')}
        </Notice>
      ) : null}
      {m.campaignReclaim ? (
        <Notice tone="info" role="status" lang={lang}>
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
            { date: when(m.campaignReclaim.reclaimAfter) },
          )}
        </Notice>
      ) : null}
      {m.topUpAvailable === false ? (
        <Notice tone="info" lang={lang}>
          {t('plan.eventBundleOnly')}
        </Notice>
      ) : null}
      <Section title={t('plan.detailsTitle')} lang={lang}>
        <ListGroup>
          <ListRow
            title={t('plan.rowExpires')}
            subtitle={expiry}
            lang={lang}
            data-testid="plan-expiry"
          />
          <ListRow
            title={t('plan.rowFrom')}
            value={m.sponsorName ?? from.reason ?? from.verified}
            lang={lang}
          />
          {facts?.network ? (
            <ListRow title={t('plan.rowNetwork')} value={netName(facts.network)} lang={lang} />
          ) : null}
          <ListRow
            title={t('plan.rowArkiv')}
            subtitle={t('plan.whyBody')}
            mono
            value={
              <span data-hash title={m.arkivKey} data-testid="arkiv-key" lang="en">
                {arkivUrl ? (
                  <a href={arkivUrl} target="_blank" rel="noreferrer">
                    {m.arkivKey}
                  </a>
                ) : (
                  m.arkivKey
                )}
              </span>
            }
            trailing={
              <CopyButton value={m.arkivKey} label={t('install.copy')} testId="copy-arkiv-key" />
            }
            lang={lang}
          />
        </ListGroup>
        <ListGroup
          title={t('plan.rowReceipt')}
          meta={
            latest
              ? `${latest.mb && latest.mb !== m.mbTotal ? `+${formatMb(latest.mb)}` : t('plan.bundle')} · ${when(latest.at)} · ${t('receipts.final')}`
              : t('plan.bundle')
          }
        >
          <ListRow title={t('plan.rowYou')} value={lines.you} lang={lang} />
          <ListRow title={t('plan.rowSponsor')} value={lines.sponsor} lang={lang} />
          <ListRow title={t('plan.rowFee')} value="$0.00" lang={lang} />
        </ListGroup>
        {firstView ? null : issuing(t('plan.issuedTitle'))}
        <ProofPanel proof={facts?.proof} />
      </Section>
      <Section title={t('plan.manageTitle')} lang={lang}>
        <AddToHomeScreen ready={ready} />
        <NotificationAsk ready={ready} />
        {foreign || terminal || activationUnavailable ? null : (
          <OtherDevice entitlementKey={entitlementKey} />
        )}
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
      </Section>
      {installable && !installElsewhere ? (
        <ActionBar>
          <ButtonLink href="/install" size="lg" block>
            {t('plan.install')}
          </ButtonLink>
          <p className="t-caption" lang={lang}>
            {t('plan.later')}
          </p>
        </ActionBar>
      ) : null}
    </AppShell>
  );
}
