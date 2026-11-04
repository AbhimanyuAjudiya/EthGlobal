'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import type { PlansResponse } from '@ethglobal/protocol/schemas';
import { Coupon } from '@ethglobal/ui/components';

import { captureInstallPrompt } from './AddToHomeScreen';
import { AppHeader } from './Shell';
import { useLang } from '../i18n/lang';
import { parseDevice } from '../lib/device';
import { clockIst, formatMb, money, priceFor } from '../lib/format';
import { useHydrated, usePlans } from '../lib/hooks';
import { get, set } from '../lib/store';

const enIN = new Intl.NumberFormat('en-IN');

/** Pre-flight line under the button (the Airalo borrow), from the UA only. */
function Preflight() {
  const { t } = useLang();
  const hydrated = useHydrated();
  const device = hydrated ? parseDevice(navigator.userAgent) : undefined;
  const line = device
    ? device.esimReady
      ? t('preflight.ready', { device: device.label })
      : t('preflight.unknown')
    : undefined;
  return (
    <p className="preflight" data-testid="preflight">
      {line ?? ' '}
    </p>
  );
}

/**
 * `/` — one question, two paths. The live, unscratched coupon carries the real count from /plans
 * ("1,214 of 2,000 sponsor bundles left · Hedera"); when the API is degraded the count is omitted, never faked.
 */
export function ClaimPaths() {
  const { t, lang } = useLang();
  const { plans: live, error } = usePlans();
  const [cached, setCached] = useState<{ at: number; plans: PlansResponse }>();

  useEffect(() => {
    captureInstallPrompt();
    void get<{ at: number; plans: PlansResponse }>('plans').then(setCached);
  }, []);
  useEffect(() => {
    if (live) void set('plans', { at: Date.now(), plans: live });
  }, [live]);

  const plans = live ?? (error ? cached?.plans : undefined);
  const campaign = plans?.campaign ?? null;
  const freeMb = campaign?.bundleMb.orb ?? 300;
  const step = plans?.paid.priceUsd6PerStep;
  const exhausted = Boolean(campaign && (campaign.paused || campaign.remainingClaims === 0));
  const stepPrice = step ? money(step) : undefined;
  const bundlePrice = step ? money(priceFor(freeMb, step)) : undefined;

  let status: string | undefined;
  if (exhausted) status = t('landing.exhausted');
  else if (live && campaign)
    status = t('landing.left', {
      left: enIN.format(campaign.remainingClaims),
      max: enIN.format(campaign.maxClaims),
      sponsor: campaign.name,
    });
  else if (!live && cached && error) status = t('landing.asOf', { time: clockIst(cached.at) });

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
        <section className="landing__coupon" aria-live="polite">
          {plans ? (
            <Coupon
              mb={freeMb}
              {...(campaign ? { sponsor: campaign.name } : {})}
              validity={`Mumbai · ${plans.paid.validityDays} days`}
              {...(status ? { status } : {})}
              lang={lang === 'hi' ? 'hi' : 'en'}
              id="landing-coupon"
            />
          ) : (
            <div className="skeleton skeleton--coupon" aria-label="Loading the sponsor bundle" />
          )}
          {plans && !campaign ? <p className="note">{t('landing.noCampaign')}</p> : null}
        </section>
        <section className="landing__actions">
          <div className="paths">
            {campaign && !exhausted ? (
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
                  {t('landing.payInstead', { price: bundlePrice ?? '', mb: formatMb(freeMb) })}
                </span>
              </Link>
            )}
            <Link
              href="/pay"
              className="ui-button ui-button--block"
              data-variant="secondary"
              prefetch={false}
            >
              <span lang={lang}>{t('landing.pay', { price: stepPrice ?? '$0.40' })}</span>
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
    </main>
  );
}
