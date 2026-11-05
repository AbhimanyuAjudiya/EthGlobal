'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';

import type { PlansResponse } from '@ethglobal/protocol/schemas';
import { Coupon } from '@ethglobal/ui/components';

import { captureInstallPrompt } from './AddToHomeScreen';
import { AppHeader, DESTINATIONS } from './Shell';
import { useLang } from '../i18n/lang';
import { parseDevice } from '../lib/device';
import { clockIst, formatMb, money, priceFor } from '../lib/format';
import { useHydrated, usePlans } from '../lib/hooks';
import { get, plans as store, set } from '../lib/store';

import type { StringKey } from '../i18n/strings';

const enIN = new Intl.NumberFormat('en-IN');

/** The last /plans reading this phone saved, and when it arrived. */
interface Saved {
  at: number;
  plans: PlansResponse;
}

/** Pre-flight line under the button (the Airalo borrow), from the UA only. */
function Preflight() {
  const { t, lang } = useLang();
  const hydrated = useHydrated();
  const device = hydrated ? parseDevice(navigator.userAgent) : undefined;
  const line = device
    ? device.esimReady
      ? t('preflight.ready', { device: device.label })
      : t('preflight.unknown')
    : undefined;
  return (
    <p className="preflight" data-testid="preflight" lang={lang}>
      {line ?? ' '}
    </p>
  );
}

/** One numbered step of "How it works": a title, a sentence or two, and the route(s) that do it. */
function Step({
  title,
  body,
  links,
  children,
}: {
  title: string;
  body: string;
  links: readonly { href: string; label: string }[];
  children?: ReactNode;
}) {
  return (
    <li>
      <h3 className="how__title">{title}</h3>
      <p className="how__body">{body}</p>
      {children}
      <p className="quiet-rows">
        {links.map((link) => (
          <Link key={link.href} href={link.href} prefetch={false}>
            {link.label}
          </Link>
        ))}
      </p>
    </li>
  );
}

/** "How it works": verify, install (all three ways), top up, gift, agent, with the warnings where they apply. */
function HowItWorks({ price }: { price: string }) {
  const { t, lang } = useLang();
  const [key, setKey] = useState<string>();
  useEffect(() => {
    void store.latest().then(setKey);
  }, []);
  // a plan on this phone is topped up (as the Add data tab does); without one, /pay sells the first bundle
  const topUp = key ? `/pay?key=${encodeURIComponent(key)}` : '/pay';
  return (
    <section className="landing__section" aria-labelledby="how-title" lang={lang}>
      <h2 id="how-title" className="landing__h2">
        {t('how.title')}
      </h2>
      <ol className="how">
        <Step
          title={t('how.verify')}
          body={t('how.verifyBody')}
          links={[{ href: '/verify', label: t('how.verifyLink') }]}
        />
        <Step
          title={t('how.install')}
          body={t('how.installBody')}
          links={[{ href: '/install', label: t('how.installLink') }]}
        >
          <ul className="how__ways">
            <li>{t('how.installHere')}</li>
            <li>{t('how.installQr')}</li>
            <li>{t('how.installManual')}</li>
          </ul>
        </Step>
        <Step
          title={t('how.topup')}
          body={t('how.topupBody', { price })}
          links={[{ href: topUp, label: t('tab.add') }]}
        />
        <Step
          title={t('tab.gift')}
          body={t('how.giftBody')}
          links={[
            { href: '/gift', label: t('how.giftLink') },
            { href: '/gift/claim', label: t('gift.claimTitle') },
          ]}
        />
        <Step
          title={t('how.agent')}
          body={t('how.agentBody')}
          links={[{ href: '/agent', label: t('how.agentLink') }]}
        />
      </ol>
    </section>
  );
}

/** Below the fold: every flow with one plain sentence — ruled rows, the same list as the header menu. */
function Everything({ price }: { price: string }) {
  const { t, lang } = useLang();
  return (
    <section className="landing__section" aria-labelledby="hub-title" lang={lang}>
      <h2 id="hub-title" className="landing__h2">
        {t('hub.title')}
      </h2>
      <div className="hub">
        {DESTINATIONS.map((group) => (
          <div key={group.group}>
            <h3 className="hub__label">{t(group.group)}</h3>
            <ul>
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} prefetch={false}>
                    <span className="hub__title">{t(item.title)}</span>{' '}
                    <span className="hub__line">{t(item.line, { price })}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

const ESIM_FACTS: readonly (readonly [StringKey, StringKey])[] = [
  ['esim.dataTerm', 'esim.data'],
  ['esim.simTerm', 'esim.sim'],
  ['esim.appsTerm', 'esim.apps'],
  ['esim.phoneTerm', 'esim.phone'],
  ['esim.installTerm', 'esim.install'],
  ['esim.topupTerm', 'esim.topup'],
  ['esim.expiryTerm', 'esim.expiry'],
];

/** "How the eSIM works": the facts a traveller asks before paying, one line each. */
function EsimFacts() {
  const { t, lang } = useLang();
  return (
    <section className="landing__section" aria-labelledby="esim-title" lang={lang}>
      <h2 id="esim-title" className="landing__h2">
        {t('esim.title')}
      </h2>
      <dl className="facts">
        {ESIM_FACTS.map(([term, fact]) => (
          <div key={term}>
            <dt>{t(term)}</dt>
            <dd>{t(fact)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * `/` — one question, two paths, then everything else. The live, unscratched coupon carries the real count from
 * this load's own GET /plans ("1,214 of 2,000 sponsor bundles left · Hedera"); while it is on its way the coupon and
 * the button are skeletons, never a stored reading presented as current. Only a network failure brings back the
 * last reading this phone saved, labelled "as of 14:02" (and the button follows it); an API error omits the count.
 */
export function ClaimPaths() {
  const { t, lang } = useLang();
  const { plans: live, at: liveAt, error } = usePlans();
  const [saved, setSaved] = useState<Saved>();

  useEffect(() => {
    captureInstallPrompt();
    void get<Saved>('plans').then(setSaved);
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
  const freeMb = campaign?.bundleMb.orb ?? 300;
  const step = plans?.paid.priceUsd6PerStep;
  const exhausted = Boolean(campaign && (campaign.paused || campaign.remainingClaims === 0));
  // claim-first unless the reading shown says no sponsor bundle is open
  const claimable = !plans || (campaign !== null && !exhausted);
  const stepPrice = step ? money(step) : '$0.40';

  let status: string | undefined;
  if (stale) status = t('landing.asOf', { time: clockIst(stale.at) });
  else if (exhausted) status = t('landing.exhausted');
  else if (campaign)
    // the sponsor is already named on the coupon's line; the stub carries only the count
    status = t('landing.left', {
      left: enIN.format(campaign.remainingClaims),
      max: enIN.format(campaign.maxClaims),
    });

  return (
    <main className="landing">
      <AppHeader />
      <div className="landing__grid">
        <section className="landing__copy">
          <h1 className="landing__title" lang={lang}>
            {t('landing.title')}
          </h1>
          <p className="landing__sub" lang={lang}>
            {t('landing.sub', { mb: formatMb(freeMb) })}
          </p>
        </section>
        {/* no validity line: /plans does not carry the campaign's validity, and a guess is fake specificity */}
        <section className="landing__coupon" aria-live="polite">
          {pending ? (
            <div className="skeleton skeleton--coupon" aria-label="Loading the sponsor bundle" />
          ) : (
            <Coupon
              mb={freeMb}
              {...(campaign ? { sponsor: campaign.name } : {})}
              {...(status ? { status } : {})}
              sealed
              lang={lang}
              id="landing-coupon"
            />
          )}
          {plans && !stale && !campaign ? (
            <p className="note" lang={lang}>
              {t('landing.noCampaign')}
            </p>
          ) : null}
        </section>
        <section className="landing__actions">
          <div className="paths">
            {pending ? (
              <div className="skeleton skeleton--button" aria-hidden="true" />
            ) : claimable ? (
              <Link
                href="/verify"
                className="ui-button ui-button--block"
                data-variant="primary"
                prefetch={false}
              >
                <span lang={lang}>{t('landing.human', { mb: formatMb(freeMb) })}</span>
              </Link>
            ) : (
              <Link
                href={`/pay?mb=${freeMb}`}
                className="ui-button ui-button--block"
                data-variant="primary"
                prefetch={false}
              >
                <span lang={lang}>
                  {t('landing.payInstead', {
                    price: step ? money(priceFor(freeMb, step)) : '',
                    mb: formatMb(freeMb),
                  })}
                </span>
              </Link>
            )}
            <Link
              href="/pay"
              className="ui-button ui-button--block"
              data-variant="secondary"
              prefetch={false}
            >
              <span lang={lang}>{t('landing.pay', { price: stepPrice })}</span>
            </Link>
          </div>
          <Preflight />
          <nav className="quiet-rows" aria-label="More ways in">
            <Link href="/card" prefetch={false}>
              <span lang={lang}>{t('landing.pin')}</span>
            </Link>
            <Link href="/plan" prefetch={false}>
              <span lang={lang}>{t('landing.open')}</span>
            </Link>
          </nav>
        </section>
      </div>
      <HowItWorks price={stepPrice} />
      <EsimFacts />
      <Everything price={stepPrice} />
    </main>
  );
}
