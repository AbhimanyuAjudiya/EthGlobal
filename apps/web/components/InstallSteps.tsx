'use client';

import { useCallback, useEffect, useId, useState, type ReactNode } from 'react';

import { PLAN_MB } from '@ethglobal/protocol/ids';
import type { MeResponse } from '@ethglobal/protocol/schemas';
import { Icon } from '@ethglobal/ui/components';

import {
  AppShell,
  Avatar,
  Button,
  ButtonLink,
  Card,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  Pill,
  Section,
  Skeleton,
  Stepper,
} from './kit';
import { QrCode } from './QrCode';
import { useLang } from '../i18n/lang';
import { activationBlocked, type ActivationPolicy } from '../lib/activation-policy';
import { api, ApiError } from '../lib/api';
import { planHref } from '../lib/deliver';
import { isHandheld, parseDevice, type DeviceInfo } from '../lib/device';
import { config } from '../lib/env';
import { formatMb, regionName } from '../lib/format';
import { useClock, useHydrated } from '../lib/hooks';
import { ANDROID_EUICC_INTENT, iosUniversalLink, isLpa, splitLpa } from '../lib/lpa-links';
import { get, plans, type PlanMetadata } from '../lib/store';

/** How long a revealed QR code or set of activation details stays on screen (T-61). */
const REVEAL_MS = 60_000;
const TROUBLE_AFTER_MS = 3 * 60_000;

/** The OS's own words as a status pill: "No Service" → "Searching…" → "LTE · …" (role=status), with a one-line hint. */
function StatusCard({
  status,
  handheld,
}: {
  status: MeResponse['status'] | undefined;
  /** A computer has no cellular status: "No Service" there reads as a fault, not as "not installed yet". */
  handheld: boolean;
}) {
  const { t, lang } = useLang();
  const text =
    status === 'active'
      ? t('status.lte', { carrier: 'Recharge' })
      : status === 'installed'
        ? t('status.searching')
        : handheld
          ? t('status.noService')
          : t('status.notInstalled');
  return (
    <Card>
      <Pill
        className="status-pill"
        tone={status === 'active' ? 'positive' : status === 'installed' ? 'warning' : 'neutral'}
        dot
        role="status"
        data-state={status ?? 'ready'}
        data-testid="status-pill"
      >
        {text}
      </Pill>
      <p className="t-body" lang={lang}>
        {t(
          status === 'active'
            ? 'install.hintActive'
            : status === 'installed'
              ? 'install.hintInstalled'
              : 'install.hintReady',
        )}
      </p>
    </Card>
  );
}

/** The activation code split on `$`, in mono, with its own copy. */
function CodeCard({ lpa }: { lpa: string }) {
  const { t, lang } = useLang();
  return (
    <Section title={t('install.code')} lang={lang}>
      <ListGroup label={t('install.code')}>
        <ListRow
          title={
            <span className="t-mono" lang="en">
              {splitLpa(lpa).map((part, i) => (
                <span key={i} data-hash>
                  {i > 0 ? '$' : ''}
                  {part}
                </span>
              ))}
            </span>
          }
          trailing={<CopyButton value={lpa} label={t('install.copy')} testId="copy-lpa" />}
        />
      </ListGroup>
    </Section>
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
  title,
  body,
  warn,
  buttonId,
  panelId,
  children,
}: {
  title: string;
  body: string;
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
      <ListGroup>
        <ListRow
          title={title}
          subtitle={body}
          onClick={() => setShown(true)}
          lang={lang}
          data-testid={buttonId}
        />
      </ListGroup>
    );
  return (
    <Card data-testid={panelId}>
      <Notice tone="warning" lang={lang}>
        {warn}
      </Notice>
      {children}
      <Button variant="quiet" onClick={() => setShown(false)}>
        {t('install.anotherHide')}
      </Button>
    </Card>
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
    <ListGroup flush>
      {rows.map((row) => (
        <ListRow
          key={row.id}
          title={<span id={`${id}-${row.id}`}>{row.label}</span>}
          subtitle={
            <span className="t-mono" data-hash lang="en">
              {row.value}
            </span>
          }
          trailing={
            <CopyButton
              value={row.value}
              label={t('install.copy')}
              testId={`copy-${row.id}`}
              describedBy={`${id}-${row.id}`}
            />
          }
        />
      ))}
    </ListGroup>
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
    <Card>
      <Button variant="secondary" block onClick={() => void run()} disabled={result === 'checking'}>
        {t('check.button')}
      </Button>
      {line ? (
        <p
          className="connection-check__result t-body"
          data-result={result}
          role="status"
          lang={lang}
        >
          {line}
        </p>
      ) : null}
      <p className="t-caption" lang={lang}>
        {config.attachMedianS
          ? t('check.expectMedian', { s: config.attachMedianS })
          : t('check.expect')}
      </p>
    </Card>
  );
}

/** The numbered rows in the order the system asks: iOS's five, Android's four. */
function StepRows({ steps }: { steps: readonly string[] }) {
  const { t, lang } = useLang();
  return (
    <Section title={t('install.stepsTitle')} lang={lang}>
      <ListGroup label={t('install.stepsTitle')}>
        {steps.map((step, i) => (
          <ListRow key={step} leading={<Avatar label={String(i + 1)} size={32} />} title={step} />
        ))}
      </ListGroup>
    </Section>
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
  // which plan this screen installs (the device's current one) and whether there are others to switch to
  const [trip, setTrip] = useState<{ metadata?: PlanMetadata; several: boolean }>();

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
      const [stored, snapshot, savedPolicy, metadata, keys] = await Promise.all([
        plans.lpa(key),
        plans.snapshot(key),
        get<ActivationPolicy>(`activation-policy:${key}`),
        plans.metadata(key),
        plans.keys(),
      ]);
      if (!alive) return;
      setTrip({ ...(metadata ? { metadata } : {}), several: keys.length > 1 });
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
  // the plan this installs: destination and event from the claim's own record, else the API's facts
  const destination = trip?.metadata?.destinationCountry ?? me?.event?.destinationCountry;
  const eventName = trip?.metadata?.eventName ?? me?.event?.name ?? me?.sponsorName;
  const eyebrow =
    destination || eventName
      ? [destination ? regionName(destination, lang) : undefined, eventName, formatMb(mb)]
          .filter(Boolean)
          .join(' · ')
      : t('flow.coverage');
  const handheld = hydrated && isHandheld(window);
  // a computer cannot hold the eSIM: it gets the two ways that reach the phone, not an empty "on this phone"
  const phone = device?.os === 'ios' || device?.os === 'android';
  const usable =
    lpa !== undefined && lpa !== null && device !== undefined && !removed && !installed && !blocked;
  const ios = usable && device.os === 'ios' && device.universalLink;
  const android = usable && device.os === 'android';
  const action = ios ? (
    <>
      <ButtonLink
        href={iosUniversalLink(lpa)}
        native
        size="lg"
        block
        rel="noreferrer"
        target="_top"
        data-testid="ios-universal-link"
      >
        {t('install.button')}
      </ButtonLink>
      <p className="t-caption" lang={lang}>
        {t('install.tapAgain')}
      </p>
    </>
  ) : android ? (
    <>
      <CopyButton
        value={lpa}
        label={t('install.android.copy')}
        testId="copy-activation-code"
        primary
      />
      <p className="t-caption" lang={lang}>
        <a href={ANDROID_EUICC_INTENT} rel="noreferrer" data-testid="android-intent">
          {t('install.android.intent')}
        </a>{' '}
        <span>{t('install.android.unverified')}</span>
      </p>
    </>
  ) : undefined;
  return (
    <AppShell back="/plan" nav="plan" {...(action ? { action } : {})}>
      <Stepper
        steps={[t('install.stepProve'), t('install.stepIssue'), t('install.stepInstall')]}
        current={3}
        label={t('install.stepsLabel')}
        lang={lang}
      />
      <PageHeader
        eyebrow={<span data-testid="install-plan">{eyebrow}</span>}
        title={t('install.title')}
        lang={lang}
      />
      <StatusCard status={me?.status} handheld={handheld} />
      {trip?.several ? (
        <ListGroup>
          <ListRow title={t('install.switchPlan')} href="/plan" lang={lang} />
        </ListGroup>
      ) : null}
      {lpa === undefined || !device ? (
        <Skeleton shape="row" count={3} />
      ) : removed || installed ? (
        <Notice tone="positive" role="status" lang={lang} data-testid="lpa-removed">
          {t('install.done')}
        </Notice>
      ) : blocked ? (
        <Notice tone="warning" role="status" lang={lang} data-testid="install-blocked">
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
        </Notice>
      ) : lpa === null ? (
        <Notice tone="info" role="status" lang={lang}>
          {t('install.noLpa')}
        </Notice>
      ) : (
        <>
          <Notice tone="warning" lang={lang}>
            <p>{t('install.onlyHere')}</p>
            <p>{t('warn.unlocked')}</p>
          </Notice>
          {ios ? (
            <StepRows
              steps={[
                t('install.ios.1'),
                t('install.ios.2', { mb: formatMb(mb) }),
                t('install.ios.3'),
                t('install.ios.4'),
                t('install.ios.5'),
              ]}
            />
          ) : android ? (
            <>
              <StepRows
                steps={[
                  t('install.android.1'),
                  t('install.android.2'),
                  t('install.android.3'),
                  t('install.android.4'),
                ]}
              />
              <CodeCard lpa={lpa} />
            </>
          ) : (
            <Notice tone="info" lang={lang}>
              {t('install.other')}
            </Notice>
          )}
          <Section
            title={phone ? t('install.anotherTitle') : t('install.waysComputer')}
            lang={lang}
          >
            <div data-testid="other-device">
              <Reveal
                title={t('install.wayQr')}
                body={t('install.wayQrBody')}
                warn={t('install.anotherWarn')}
                buttonId="another-phone"
                panelId="second-device-qr"
              >
                <QrCode url={lpa} sizeMm={40} label={t('install.code')} />
              </Reveal>
              <Reveal
                title={t('install.wayManual')}
                body={t('install.wayManualBody')}
                warn={t('install.detailsWarn')}
                buttonId="show-details"
                panelId="manual-details"
              >
                <ManualDetails lpa={lpa} />
              </Reveal>
            </div>
          </Section>
        </>
      )}
      {late && me?.status !== 'active' ? (
        <Notice tone="warning" title={t('trouble.title')} lang={lang}>
          <p>{t('trouble.roaming')}</p>
          <p>{t('trouble.line')}</p>
          <p>{t('trouble.airplane')}</p>
        </Notice>
      ) : null}
      <ConnectionCheck />
      {/* the install ends where the plan lives: data left, expiry, top-ups */}
      <ListGroup>
        <ListRow
          leading={<Avatar icon="plan" size={32} />}
          title={t('landing.open')}
          href={me ? planHref(me.entitlementKey) : '/plan'}
          lang={lang}
        />
      </ListGroup>
    </AppShell>
  );
}
