'use client';

import Link from 'next/link';
import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';

import { PLAN_MB } from '@ethglobal/protocol/ids';
import type { MeResponse } from '@ethglobal/protocol/schemas';
import { Button, Icon } from '@ethglobal/ui/components';

import { QrCode } from './QrCode';
import { AppHeader, Caution, Screen, TabBar } from './Shell';
import { useLang } from '../i18n/lang';
import { activationBlocked, type ActivationPolicy } from '../lib/activation-policy';
import { api, ApiError } from '../lib/api';
import { planHref } from '../lib/deliver';
import { parseDevice, type DeviceInfo } from '../lib/device';
import { config } from '../lib/env';
import { formatMb } from '../lib/format';
import { useClock, useHydrated } from '../lib/hooks';
import { ANDROID_EUICC_INTENT, iosUniversalLink, isLpa, splitLpa } from '../lib/lpa-links';
import { get, plans } from '../lib/store';

/** How long a revealed QR code or set of activation details stays on screen (T-61). */
const REVEAL_MS = 60_000;
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

/** Copies one value to the clipboard (never a URL, a log or storage) and says so on the button. */
export function CopyButton({
  value,
  label,
  testId,
  describedBy,
  primary = false,
}: {
  value: string;
  label: string;
  testId: string;
  /** The id of the text naming what is copied ("SM-DP+ address"). */
  describedBy?: string;
  primary?: boolean;
}) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant={primary ? 'primary' : 'quiet'}
      block={primary}
      aria-describedby={describedBy}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => setCopied(true),
          () => setCopied(false),
        );
      }}
      data-testid={testId}
    >
      <Icon name={copied ? 'check' : 'copy'} size={20} />
      {copied ? t('install.android.copied') : label}
    </Button>
  );
}

/**
 * The activation code for another screen or for typing by hand: only behind an explicit tap, under its warning,
 * hidden again after 60 s (T-61). A shared laptop never prints the code on load (RT-W-01).
 */
function Reveal({
  show,
  warn,
  buttonId,
  panelId,
  children,
}: {
  show: string;
  warn: string;
  buttonId: string;
  panelId: string;
  children: ReactNode;
}) {
  const { t, lang } = useLang();
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(false), REVEAL_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  if (!shown)
    return (
      <Button variant="secondary" onClick={() => setShown(true)} data-testid={buttonId}>
        {show}
      </Button>
    );
  return (
    <div className="second-device" data-testid={panelId}>
      <p className="warning-line caution" lang={lang}>
        <Icon name="warning" /> {warn}
      </p>
      {children}
      <Button variant="quiet" onClick={() => setShown(false)}>
        {t('install.anotherHide')}
      </Button>
    </div>
  );
}

/** What the phone's "enter details manually" screen asks for: the SM-DP+ address and the activation code. */
function ManualDetails({ lpa }: { lpa: string }) {
  const { t } = useLang();
  const id = useId();
  const [, smdp = '', code = ''] = splitLpa(lpa);
  const rows = [
    { id: 'smdp', label: t('install.smdp'), value: smdp },
    { id: 'code', label: t('install.code'), value: code },
    { id: 'full', label: t('install.full'), value: lpa },
  ];
  return (
    <dl className="lpa-details">
      {rows.map((row) => (
        <div key={row.id}>
          <dt id={`${id}-${row.id}`}>{row.label}</dt>
          <dd>
            <span data-hash>{row.value}</span>
            <CopyButton
              value={row.value}
              label={t('install.copy')}
              testId={`copy-${row.id}`}
              describedBy={`${id}-${row.id}`}
            />
          </dd>
        </div>
      ))}
    </dl>
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
      <CopyButton
        value={lpa}
        label={t('install.android.copy')}
        testId="copy-activation-code"
        primary
      />
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

/**
 * `/install` — honest by platform, with all three ways side by side: on this phone (the iOS universal link, or the
 * code pasted into Android's settings), a QR code for another screen, and the details typed by hand. Takes no URL
 * parameter: the LPA comes only from this device's storage (T-62), and leaves it only as a tap, a QR or a copy.
 */
export function InstallSteps() {
  const { t, lang } = useLang();
  const hydrated = useHydrated();
  const now = useClock();
  const device: DeviceInfo | undefined = hydrated ? parseDevice(navigator.userAgent) : undefined;
  const [lpa, setLpa] = useState<string | null | undefined>();
  const [me, setMe] = useState<MeResponse | undefined>();
  const [policy, setPolicy] = useState<ActivationPolicy | undefined>();
  const [unavailable, setUnavailable] = useState(false);
  const [late, setLate] = useState(false);

  const [removed, setRemoved] = useState(false);

  useEffect(() => {
    let alive = true;
    let key: string | undefined;
    let knownPolicy: ActivationPolicy | undefined;
    let pending: Promise<void> | undefined;
    const retainPolicy = (current: ActivationPolicy): ActivationPolicy => {
      // An older /me response or snapshot may omit newly disclosed terms; omission does not revoke them.
      knownPolicy = {
        ...current,
        ...(current.campaignReclaim === undefined && knownPolicy?.campaignReclaim !== undefined
          ? { campaignReclaim: knownPolicy.campaignReclaim }
          : {}),
        ...(current.lifecycle === undefined && knownPolicy?.lifecycle !== undefined
          ? { lifecycle: knownPolicy.lifecycle }
          : {}),
      };
      return knownPolicy;
    };
    const refresh = (fresh = false): Promise<void> => {
      if (!key || !alive) return Promise.resolve();
      if (pending) return pending;
      const requestedKey = key;
      pending = api
        .me(requestedKey, fresh)
        .then(
          (current) => {
            if (!alive) return;
            setMe(current);
            setPolicy(retainPolicy(current));
            setUnavailable(false);
            void plans.saveSnapshot(requestedKey, current);
          },
          (error: unknown) => {
            if (
              alive &&
              error instanceof ApiError &&
              ['expired', 'not_found', 'unauthorized'].includes(error.code)
            )
              setUnavailable(true);
            // A network failure retains known local policy; its deadline continues to apply offline.
          },
        )
        .finally(() => {
          pending = undefined;
        });
      return pending;
    };
    void (async () => {
      key = await plans.latest();
      if (!key) {
        if (alive) setLpa(null);
        return;
      }
      const [stored, snapshot, savedPolicy] = await Promise.all([
        plans.lpa(key),
        plans.snapshot(key),
        get<ActivationPolicy>(`activation-policy:${key}`),
      ]);
      if (!alive) return;
      knownPolicy = savedPolicy;
      setMe(snapshot?.me);
      setPolicy(snapshot ? retainPolicy(snapshot.me) : savedPolicy);
      // Online visitors first reconcile live state. Offline visitors retain pre-departure instructions
      // and their local code only while the saved policy still permits activation.
      if (navigator.onLine !== false) await refresh(true);
      else void refresh();
      if (!alive) return;
      setLpa(isLpa(stored) ? stored : null);
    })();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onResume = () => {
      void refresh();
    };
    const poll = setInterval(onVisible, 10_000);
    window.addEventListener('online', onResume);
    window.addEventListener('pageshow', onResume);
    document.addEventListener('visibilitychange', onVisible);
    const timer = setTimeout(() => setLate(true), TROUBLE_AFTER_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearInterval(poll);
      window.removeEventListener('online', onResume);
      window.removeEventListener('pageshow', onResume);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // installed (webhook `installed` / `active`): the activation code leaves this device for good (T-76, RT-W-01)
  useEffect(() => {
    if (!me || (me.status !== 'installed' && me.status !== 'active')) return;
    void plans.forgetLpa(me.entitlementKey).then(() => {
      setLpa(null);
      setRemoved(true);
    });
  }, [me]);

  const installed = me?.status === 'installed' || me?.status === 'active';
  const blocked = unavailable || (policy !== undefined && activationBlocked(policy, now));
  const reclaim = policy?.campaignReclaim;
  const mb = me?.mbTotal ?? PLAN_MB;
  return (
    <Screen wide className="install-screen">
      <AppHeader />
      <header className="flow-heading">
        <p className="eyebrow" lang={lang}>
          {t('flow.coverage')}
        </p>
        <h1 className="install__title" lang={lang}>
          {t('install.title')}
        </h1>
        <StatusPill status={me?.status} />
      </header>
      {lpa === undefined || !device ? (
        <div className="skeleton skeleton--line" aria-hidden="true" />
      ) : removed || installed ? (
        <p className="note" role="status" lang={lang} data-testid="lpa-removed">
          {t('install.done')}
        </p>
      ) : blocked ? (
        <p className="note" role="status" lang={lang} data-testid="install-blocked">
          {reclaim &&
          reclaim.state !== 'ineligible' &&
          (reclaim.state !== 'scheduled' || reclaim.reclaimAfter <= now)
            ? t(
                reclaim.state === 'refunded'
                  ? 'plan.eventRefunded'
                  : reclaim.state === 'manual'
                    ? 'plan.eventManual'
                    : 'plan.eventPending',
              )
            : policy?.cancelledAt !== undefined
              ? t('plan.cancelledState')
              : t('install.noLpa')}
        </p>
      ) : lpa === null ? (
        <p className="note" role="status" lang={lang}>
          {t('install.noLpa')}
        </p>
      ) : (
        <>
          <Caution k="install.onlyHere" />
          <Caution k="warn.unlocked" />
          <h2 className="install__ways" lang={lang}>
            {t('install.ways')}
          </h2>
          <ul className="install-ways" lang={lang}>
            <li>
              <h3>{t('install.wayHere')}</h3>
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
                  <p className="note">{t('install.tapAgain')}</p>
                  <IosSteps mb={mb} />
                </>
              ) : device.os === 'android' ? (
                <AndroidSteps lpa={lpa} />
              ) : (
                <p className="note">{t('install.other')}</p>
              )}
            </li>
            <li>
              <h3>{t('install.wayQr')}</h3>
              <p className="note">{t('install.wayQrBody')}</p>
              <Reveal
                show={t('install.another')}
                warn={t('install.anotherWarn')}
                buttonId="another-phone"
                panelId="second-device-qr"
              >
                <QrCode url={lpa} sizeMm={40} label={t('install.code')} />
              </Reveal>
            </li>
            <li>
              <h3>{t('install.wayManual')}</h3>
              <p className="note">{t('install.wayManualBody')}</p>
              <Reveal
                show={t('install.showDetails')}
                warn={t('install.detailsWarn')}
                buttonId="show-details"
                panelId="manual-details"
              >
                <ManualDetails lpa={lpa} />
              </Reveal>
            </li>
          </ul>
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
      {/* the install ends where the plan lives: data left, expiry, top-ups */}
      <div className="plan__actions">
        <Link
          href={me ? planHref(me.entitlementKey) : '/plan'}
          className="ui-button ui-button--block"
          data-variant="secondary"
          prefetch={false}
        >
          {t('landing.open')}
        </Link>
      </div>
      <TabBar active="plan" />
    </Screen>
  );
}
