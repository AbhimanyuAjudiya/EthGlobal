'use client';

import { useEffect, useState } from 'react';

import { PLAN_MB } from '@ethglobal/protocol/ids';
import type { PlansResponse } from '@ethglobal/protocol/schemas';

import { captureInstallPrompt } from './AddToHomeScreen';
import {
  AppShell,
  Avatar,
  BalanceCard,
  ButtonLink,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  Pill,
  QuickActions,
  Section,
  Skeleton,
} from './kit';
import { DESTINATIONS } from './Shell';
import { useLang } from '../i18n/lang';
import { planHref } from '../lib/deliver';
import { parseDevice } from '../lib/device';
import { clockIst, formatMb, money, soldPlan } from '../lib/format';
import { useHydrated, usePlans } from '../lib/hooks';
import { get, plans as store, set } from '../lib/store';

const enIN = new Intl.NumberFormat('en-IN');

/** The last /plans reading this phone saved, and when it arrived. */
interface Saved {
  at: number;
  plans: PlansResponse;
}

/** "1 GB" → ["1", "GB"] (formatMb joins them with a no-break space). */
const split = (mb: number) => {
  const [figure = '', unit = ''] = formatMb(mb).split(' ');
  return { figure, unit };
};

/** Pre-flight line under the hero (the Airalo borrow), from the UA only. */
function Preflight() {
  const { t, lang } = useLang();
  const hydrated = useHydrated();
  const device = hydrated ? parseDevice(navigator.userAgent) : undefined;
  // A user-agent identifies software, never the hardware variant or carrier lock.
  const line = device
    ? `${device.os === 'other' ? '' : `${device.label} · `}${t('preflight.unknown')}`
    : undefined;
  return (
    <p className="t-caption" data-testid="preflight" lang={lang}>
      {line ?? ' '}
    </p>
  );
}

/**
 * `/` Home (DESIGN.md §7): PageHeader → the sponsor bundle as a BalanceCard → QuickActions → How it works → every
 * other flow → the ONE primary pill. The live card carries the real count from this load's own GET /plans ("free ·
 * 1,214 of 2,000 left"); while it is on its way the card is a skeleton and the ActionBar is empty, never a stored
 * reading presented as current. Only a network failure brings back the last reading this phone saved, labelled "as of
 * 14:02" (and the button follows it); an API error omits the count. A device that already holds a plan goes to it.
 */
export function ClaimPaths() {
  const { t, lang } = useLang();
  const { plans: live, at: liveAt, error } = usePlans();
  const [saved, setSaved] = useState<Saved>();

  useEffect(() => {
    captureInstallPrompt();
    void get<Saved>('plans').then(setSaved);
    // DESIGN.md §7: Home with a plan on this device is that plan; the server-rendered landing stays the shell
    void store.latest().then((key) => key && window.location.replace(planHref(key)));
  }, []);
  useEffect(() => {
    if (live && liveAt) void set('plans', { at: liveAt, plans: live });
  }, [live, liveAt]);

  // offline: this visit's own reading if it had one, else the one saved on an earlier visit
  const stale: Saved | undefined =
    error?.code === 'network' ? (live && liveAt ? { at: liveAt, plans: live } : saved) : undefined;
  const plans = stale?.plans ?? (error ? undefined : live);
  const pending = !live && !error;
  const campaign = plans?.campaign ?? null;
  const freeMb = campaign?.bundleMb.orb ?? PLAN_MB;
  const free = formatMb(freeMb);
  // the paid lane sells one size: 1 GB · $4.00 (its list price until a /plans reading says otherwise)
  const sold = soldPlan(plans);
  const planMb = formatMb(sold.mb);
  const planPrice = money(sold.usd6);
  const exhausted = Boolean(campaign && (campaign.paused || campaign.remainingClaims === 0));
  // live /plans never discloses a campaign (the organizer's pass link does): its free path stays open
  const liveMode = plans?.mode === 'live';
  // claim-first unless the reading shown says no sponsor bundle is open
  const claimable = !plans || liveMode || (campaign !== null && !exhausted);

  // the count only from a live reading; a saved one says when it was read, an exhausted one says so
  const status = stale ? (
    <Pill tone="warning">{t('landing.asOf', { time: clockIst(stale.at) })}</Pill>
  ) : exhausted ? (
    <Pill tone="warning">{t('landing.exhausted')}</Pill>
  ) : undefined;
  const note =
    campaign && !stale && !exhausted
      ? t('home.left', {
          left: enIN.format(campaign.remainingClaims),
          max: enIN.format(campaign.maxClaims),
        })
      : t('home.free');
  const { figure, unit } = split(freeMb);

  const action = pending ? undefined : claimable ? (
    <ButtonLink href="/verify" size="lg" block lang={lang}>
      {liveMode && !campaign ? t('claim.withPass') : t('landing.human', { mb: free })}
    </ButtonLink>
  ) : (
    <ButtonLink href="/pay" size="lg" block lang={lang}>
      {t('home.buy', { mb: planMb, price: planPrice })}
    </ButtonLink>
  );

  return (
    <AppShell nav="home" action={action}>
      <PageHeader
        size="display"
        title={t('home.title')}
        lead={t('home.lead', { mb: free })}
        lang={lang}
      />
      {pending ? (
        <Skeleton shape="balance" label="Loading the sponsor bundle" />
      ) : (
        // no validity line: /plans does not carry the campaign's validity, and a guess is fake specificity
        <BalanceCard
          id="landing-coupon"
          tone="brand"
          lang={lang}
          aria-label={t('home.bundleLabel', { mb: free })}
          amount={figure}
          unit={unit}
          note={note}
          status={status}
          caption={campaign ? t('home.from', { sponsor: campaign.name }) : t('landing.sponsored')}
        >
          <Preflight />
        </BalanceCard>
      )}
      <QuickActions
        label={t('home.actions')}
        items={[
          { icon: 'human', label: t('home.qa.prove'), href: '/verify' },
          { icon: 'add', label: t('home.qa.pay'), href: '/pay' },
          { icon: 'card', label: t('home.qa.card'), href: '/card' },
          { icon: 'organizers', label: t('home.qa.organizers'), href: '/sponsor' },
        ]}
      />
      {plans && !stale && !campaign && !liveMode ? (
        <Notice tone="info" lang={lang}>
          {t('landing.noCampaign')}
        </Notice>
      ) : null}
      <Section title={t('how.title')} lang={lang}>
        <ListGroup label={t('how.title')}>
          <ListRow
            leading={<Avatar label="1" />}
            title={t('how.verify')}
            subtitle={t('home.how.prove')}
            href="/verify"
          />
          <ListRow
            leading={<Avatar label="2" />}
            title={t('how.install')}
            subtitle={t('home.how.install')}
            href="/install"
          />
          <ListRow
            leading={<Avatar label="3" />}
            title={t('how.topup')}
            subtitle={t('home.how.topup', { mb: planMb, price: planPrice })}
            href="/pay"
          />
        </ListGroup>
      </Section>
      <Section title={t('home.everything')} lang={lang}>
        {DESTINATIONS.map((group) => (
          <ListGroup key={group.group} title={t(group.group)}>
            {group.items.map((item) => (
              <ListRow
                key={item.href}
                href={item.href}
                title={t(item.title)}
                subtitle={t(item.line, { price: planPrice, mb: planMb })}
              />
            ))}
          </ListGroup>
        ))}
      </Section>
    </AppShell>
  );
}
