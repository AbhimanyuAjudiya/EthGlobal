'use client';

import { useCallback, useEffect, useState } from 'react';

import type { MeResponse } from '@ethglobal/protocol/schemas';
import { Button, Icon } from '@ethglobal/ui/components';

import { QrCode } from './QrCode';
import { AppHeader, Screen, TabBar } from './Shell';
import { useLang } from '../i18n/lang';
import { api } from '../lib/api';
import { parseDevice, type DeviceInfo } from '../lib/device';
import { config } from '../lib/env';
import { formatMb } from '../lib/format';
import { useHydrated } from '../lib/hooks';
import { ANDROID_EUICC_INTENT, iosUniversalLink, isLpa, splitLpa } from '../lib/lpa-links';
import { plans } from '../lib/store';

const SECOND_DEVICE_MS = 60_000;
const TROUBLE_AFTER_MS = 3 * 60_000;

/** The OS's own words as a status pill: "No Service" → "Searching…" → "LTE · …" (role=status). */
function StatusPill({ status }: { status: MeResponse['status'] | undefined }) {
  const { t } = useLang();
  const text =
    status === 'active'
      ? t('status.lte', { carrier: 'Recharge' })
      : status === 'installed'
        ? t('status.searching')
        : t('status.noService');
  return (
    <p
      className="status-pill"
      role="status"
      data-state={status ?? 'ready'}
      data-testid="status-pill"
    >
      <span className="status-pill__dot" aria-hidden="true" />
      <span key={text} className="status-pill__text">
        {text}
      </span>
    </p>
  );
}

function CodeBlock({ lpa }: { lpa: string }) {
  const { t } = useLang();
  return (
    <div className="lpa-code" aria-label={t('install.code')}>
      {splitLpa(lpa).map((part, i) => (
        <span key={i} data-hash>
          {i > 0 ? '$' : ''}
          {part}
        </span>
      ))}
    </div>
  );
}

function CopyCode({ lpa }: { lpa: string }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      block
      onClick={() => {
        void navigator.clipboard?.writeText(lpa).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      data-testid="copy-activation-code"
    >
      <Icon name={copied ? 'check' : 'copy'} size={20} />
      {copied ? t('install.android.copied') : t('install.android.copy')}
    </Button>
  );
}

/** The QR for a second device: only behind an explicit tap, with the warning, hidden again after 60 s (T-61). */
function SecondDevice({ lpa }: { lpa: string }) {
  const { t, lang } = useLang();
  const [shownAt, setShownAt] = useState<number | undefined>();
  useEffect(() => {
    if (shownAt === undefined) return;
    const timer = setTimeout(() => setShownAt(undefined), SECOND_DEVICE_MS);
    return () => clearTimeout(timer);
  }, [shownAt]);
  if (shownAt === undefined)
    return (
      <Button variant="quiet" onClick={() => setShownAt(Date.now())} data-testid="another-phone">
        {t('install.another')}
      </Button>
    );
  return (
    <section className="second-device" data-testid="second-device-qr">
      <p className="warning-line" lang={lang}>
        <Icon name="warning" /> {t('install.anotherWarn')}
      </p>
      <QrCode url={lpa} sizeMm={40} label={t('install.code')} />
      <Button variant="quiet" onClick={() => setShownAt(undefined)}>
        {t('install.anotherHide')}
      </Button>
    </section>
  );
}

type Check = 'idle' | 'checking' | 'mobile' | 'wifi' | 'online' | 'offline';

/** "Check connection": a 1 KB probe (GET /healthz) plus navigator.connection where the browser has it. */
export function ConnectionCheck() {
  const { t, lang } = useLang();
  const [result, setResult] = useState<Check>('idle');
  const run = useCallback(async () => {
    setResult('checking');
    try {
      await api.health();
      const type = (navigator as { connection?: { type?: string } }).connection?.type;
      setResult(type === 'cellular' ? 'mobile' : type === 'wifi' ? 'wifi' : 'online');
    } catch {
      setResult('offline');
    }
  }, []);
  const line =
    result === 'mobile'
      ? t('check.mobile')
      : result === 'wifi'
        ? t('check.wifi')
        : result === 'offline'
          ? t('check.offline')
          : result === 'online'
            ? t('check.online')
            : undefined;
  return (
    <section className="connection-check">
      <Button variant="secondary" onClick={() => void run()} disabled={result === 'checking'}>
        {t('check.button')}
      </Button>
      {line ? (
        <p className="connection-check__result" data-result={result} role="status" lang={lang}>
          {line}
        </p>
      ) : null}
      <p className="note" lang={lang}>
        {config.attachMedianS
          ? t('check.expectMedian', { s: config.attachMedianS })
          : t('check.expect')}
      </p>
    </section>
  );
}

function IosSteps({ mb }: { mb: number }) {
  const { t, lang } = useLang();
  return (
    <ol className="steps" lang={lang}>
      <li>{t('install.ios.1')}</li>
      <li>{t('install.ios.2', { mb: formatMb(mb) })}</li>
      <li>{t('install.ios.3')}</li>
      <li>{t('install.ios.4')}</li>
      <li>{t('install.ios.5')}</li>
    </ol>
  );
}

function AndroidSteps({ lpa }: { lpa: string }) {
  const { t, lang } = useLang();
  return (
    <>
      <CopyCode lpa={lpa} />
      <CodeBlock lpa={lpa} />
      <ol className="steps" lang={lang}>
        <li>{t('install.android.1')}</li>
        <li>{t('install.android.2')}</li>
        <li>{t('install.android.3')}</li>
        <li>{t('install.android.4')}</li>
      </ol>
      <p className="intent-link">
        <a href={ANDROID_EUICC_INTENT} rel="noreferrer" data-testid="android-intent">
          {t('install.android.intent')}
        </a>{' '}
        <span className="unverified" lang={lang}>
          {t('install.android.unverified')}
        </span>
      </p>
    </>
  );
}

/** `/install` — honest by platform. Takes no URL parameter: the LPA comes only from this device's storage (T-62). */
export function InstallSteps() {
  const { t, lang } = useLang();
  const hydrated = useHydrated();
  const device: DeviceInfo | undefined = hydrated ? parseDevice(navigator.userAgent) : undefined;
  const [lpa, setLpa] = useState<string | null | undefined>();
  const [me, setMe] = useState<MeResponse | undefined>();
  const [late, setLate] = useState(false);

  useEffect(() => {
    void (async () => {
      const key = await plans.latest();
      const stored = key ? await plans.lpa(key) : undefined;
      setLpa(isLpa(stored) ? stored : null);
      if (key) setMe(await api.me(key).catch(() => undefined));
    })();
    const timer = setTimeout(() => setLate(true), TROUBLE_AFTER_MS);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!me || me.status === 'active') return;
    const timer = setInterval(() => {
      void api.me(me.entitlementKey).then(setMe, () => undefined);
    }, 10_000);
    return () => clearInterval(timer);
  }, [me]);

  const mb = me?.mbTotal ?? 300;
  return (
    <Screen>
      <AppHeader />
      <h1 className="screen__title" lang={lang}>
        {t('install.title')}
      </h1>
      <StatusPill status={me?.status} />
      {lpa === undefined || !device ? (
        <div className="skeleton skeleton--line" aria-hidden="true" />
      ) : lpa === null ? (
        <p className="note" role="status" lang={lang}>
          {t('install.noLpa')}
        </p>
      ) : (
        <>
          {device.os === 'ios' && device.universalLink ? (
            <>
              <a
                className="ui-button ui-button--block"
                data-variant="primary"
                href={iosUniversalLink(lpa)}
                rel="noreferrer"
                target="_top"
                data-testid="ios-universal-link"
              >
                {t('install.button')}
              </a>
              <p className="note" lang={lang}>
                {t('install.tapAgain')}
              </p>
              <IosSteps mb={mb} />
            </>
          ) : device.os === 'android' ? (
            <AndroidSteps lpa={lpa} />
          ) : (
            <>
              <p className="note" lang={lang}>
                {t('install.other')}
              </p>
              <CodeBlock lpa={lpa} />
            </>
          )}
          <p className="note note--quiet" lang={lang}>
            {t('install.screenshotNote')}
          </p>
          <SecondDevice lpa={lpa} />
        </>
      )}
      <ConnectionCheck />
      {late && me?.status !== 'active' ? (
        <section className="trouble" aria-labelledby="trouble-title">
          <h2 id="trouble-title" lang={lang}>
            {t('trouble.title')}
          </h2>
          <ul lang={lang}>
            <li>{t('trouble.roaming')}</li>
            <li>{t('trouble.line')}</li>
            <li>{t('trouble.airplane')}</li>
          </ul>
        </section>
      ) : null}
      <TabBar active="plan" />
    </Screen>
  );
}
