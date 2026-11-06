'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { MeResponse } from '@ethglobal/protocol/schemas';
import { Button } from '@ethglobal/ui/components';

import styles from './MyPlans.module.css';
import { NoPlanSteps, PlanView } from './PlanView';
import { AppHeader, Screen, TabBar } from './Shell';
import { useLang } from '../i18n/lang';
import { activationBlocked } from '../lib/activation-policy';
import { api, ApiError } from '../lib/api';
import { planHref } from '../lib/deliver';
import { formatMb } from '../lib/format';
import { useClock, useHydrated } from '../lib/hooks';
import { plans, type PlanMetadata } from '../lib/store';

interface SavedPlan {
  key: string;
  metadata?: PlanMetadata;
  me?: MeResponse;
  offline?: boolean;
  terminal?: boolean;
}

/** Keep the service worker's /plan/<key> offline shell working without redirecting to a different plan. */
export function MyPlans() {
  const hydrated = useHydrated();
  const match = hydrated ? /^\/plan\/([^/?#]+)/.exec(window.location.pathname) : null;
  let shellKey: string | undefined;
  if (match?.[1]) {
    try {
      shellKey = decodeURIComponent(match[1]);
    } catch {
      /* a malformed path falls back to this device's own list */
    }
  }
  if (shellKey) return <PlanView key={shellKey} entitlementKey={shellKey} />;
  return <SavedPlansList />;
}

function SavedPlansList() {
  const { t, lang } = useLang();
  const router = useRouter();
  const now = useClock();
  const [rows, setRows] = useState<SavedPlan[] | undefined>();
  const [current, setCurrent] = useState<string | undefined>();

  useEffect(() => {
    let alive = true;
    let generation = 0;
    const load = async () => {
      const version = ++generation;
      const keys = await plans.keys();
      const selected = await plans.latest();
      const local = await Promise.all(
        keys.map(async (key): Promise<SavedPlan> => {
          const [metadata, snapshot] = await Promise.all([
            plans.metadata(key),
            plans.snapshot(key),
          ]);
          return {
            key,
            ...(metadata ? { metadata } : {}),
            ...(snapshot ? { me: snapshot.me, offline: true } : {}),
          };
        }),
      );
      if (!alive || version !== generation) return;
      setRows(local);
      setCurrent(selected);
      // Stagger reads: a long travel history must not flood the provider/API on opening My plans.
      for (const row of local) {
        if (!alive || version !== generation) return;
        let next: SavedPlan;
        try {
          const me = await api.me(row.key);
          if (!alive || version !== generation) return;
          await plans.saveSnapshot(row.key, me);
          if (
            me.status === 'installed' ||
            me.status === 'active' ||
            me.cancelledAt !== undefined ||
            me.expiresAt <= Date.now() ||
            me.campaignReclaim?.state === 'refunded'
          )
            await plans.forgetLpa(row.key);
          next = { ...row, me, offline: false };
        } catch (error) {
          const terminal =
            error instanceof ApiError && ['expired', 'not_found'].includes(error.code);
          if (terminal && (row.me?.expiresAt ?? Infinity) <= Date.now())
            await plans.forgetLpa(row.key);
          next = { ...row, offline: !terminal, ...(terminal ? { terminal: true } : {}) };
        }
        if (alive && version === generation)
          setRows((previous) => previous?.map((item) => (item.key === row.key ? next : item)));
      }
    };
    const refresh = () => {
      void load();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    const unsubscribe = plans.subscribe(refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      generation++;
      unsubscribe();
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  return (
    <Screen wide>
      <AppHeader />
      <header className="flow-heading" lang={lang}>
        <h1 className="screen__title">{t('plans.title')}</h1>
        <p>{t('plans.subtitle')}</p>
        <p className="note">{t('plans.deviceOnly')}</p>
      </header>
      {rows === undefined ? (
        <ul className={styles.list} aria-label={t('plans.loading')}>
          {[0, 1].map((i) => (
            <li key={i} className={styles.row} aria-hidden="true">
              <div className={styles.main}>
                <span className={`skeleton ${styles.ghostName}`} />
                <span className={`skeleton ${styles.ghostMeta}`} />
              </div>
              <span className={`skeleton ${styles.ghostData}`} />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <>
          <p role="status">{t('plans.empty')}</p>
          <NoPlanSteps />
        </>
      ) : (
        <ul className={styles.list}>
          {rows.map((row) => {
            const me = row.me;
            const expired =
              row.terminal === true ||
              (me !== undefined &&
                (me.expiresAt <= now || (me.lifecycle?.serviceExpiresAt ?? Infinity) <= now));
            const cancelled =
              me?.cancelledAt !== undefined || me?.campaignReclaim?.state === 'refunded';
            const held = me && activationBlocked(me, now) && !expired && !cancelled;
            const country = row.metadata?.destinationCountry ?? me?.event?.destinationCountry;
            let destination = country ?? t('plans.countryUnknown');
            if (country) {
              try {
                destination =
                  new Intl.DisplayNames([lang], { type: 'region' }).of(country) ?? country;
              } catch {
                /* show ISO code */
              }
            }
            const status = cancelled
              ? 'plans.cancelled'
              : expired
                ? 'plans.expired'
                : held
                  ? 'plans.reclaim'
                  : !me
                    ? 'plans.unknown'
                    : me.status === 'active'
                      ? 'plans.active'
                      : me.status === 'installed'
                        ? 'plans.installed'
                        : me.status === 'pending-profile'
                          ? 'plans.pending'
                          : 'plans.ready';
            const isCurrent = row.key === current;
            return (
              <li key={row.key} className={styles.row} data-current={isCurrent || undefined}>
                <div className={styles.main}>
                  <h2 className={styles.name}>
                    {row.metadata?.eventName ??
                      me?.event?.name ??
                      row.metadata?.planName ??
                      me?.sponsorName ??
                      t('plans.saved')}
                  </h2>
                  <p className={styles.meta}>
                    <span>{destination}</span>
                    <span aria-hidden="true"> · </span>
                    <span role="status">{t(status)}</span>
                    {isCurrent ? (
                      <>
                        <span aria-hidden="true"> · </span>
                        <span className={styles.selected}>{t('plans.current')}</span>
                      </>
                    ) : null}
                  </p>
                  {row.offline ? <p className={styles.offline}>{t('plans.offline')}</p> : null}
                </div>
                <div className={styles.side}>
                  {me ? (
                    <p className={styles.data}>
                      {t('plans.data', {
                        remaining: formatMb(expired || cancelled ? 0 : me.remainingMb),
                        total: formatMb(me.mbTotal),
                      })}
                    </p>
                  ) : null}
                  <div className={styles.actions}>
                    {!isCurrent ? (
                      <Button
                        variant="quiet"
                        onClick={() => {
                          void plans.setCurrent(row.key).then((owned) => {
                            if (owned) router.push(planHref(row.key));
                          });
                        }}
                      >
                        {t('plans.select')}
                      </Button>
                    ) : null}
                    <Link
                      href={planHref(row.key)}
                      className="ui-button"
                      data-variant="secondary"
                      prefetch={false}
                    >
                      {t('plans.open')}
                    </Link>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <p className="note" lang={lang}>
        {t('plans.switchNote')}
      </p>
      <TabBar active="plan" canTopUp={false} />
    </Screen>
  );
}
