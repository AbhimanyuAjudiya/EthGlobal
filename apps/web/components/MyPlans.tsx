'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import type { MeResponse } from '@ethglobal/protocol/schemas';

import {
  Avatar,
  ButtonLink,
  EmptyState,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  Pill,
  Skeleton,
} from './kit';
import { PlanView } from './PlanView';
import { useLang } from '../i18n/lang';
import { activationBlocked } from '../lib/activation-policy';
import { api, ApiError } from '../lib/api';
import { planHref } from '../lib/deliver';
import { dayLabel, formatMb } from '../lib/format';
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
    <>
      <PageHeader title={t('plans.yourPlans')} lead={t('plans.deviceOnly')} lang={lang} />
      {rows === undefined ? (
        <Skeleton shape="row" count={2} label={t('plans.loading')} />
      ) : rows.length === 0 ? (
        <EmptyState
          title={t('plans.empty')}
          body={t('plan.elsewhere')}
          action={
            <ButtonLink href="/" size="lg">
              {t('plans.getBundle')}
            </ButtonLink>
          }
        />
      ) : (
        <ListGroup label={t('plans.yourPlans')}>
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
            const name =
              row.metadata?.eventName ??
              me?.event?.name ??
              row.metadata?.planName ??
              me?.sponsorName ??
              t('plans.saved');
            return (
              <ListRow
                key={row.key}
                leading={<Avatar label={destination} />}
                title={
                  <>
                    <span>{name}</span>
                    {isCurrent ? (
                      <>
                        {' '}
                        <Pill tone="brand">{t('plans.current')}</Pill>
                      </>
                    ) : null}
                  </>
                }
                subtitle={
                  <>
                    <span>{destination}</span>
                    <span aria-hidden="true"> · </span>
                    <span role="status">{t(status)}</span>
                    {me && !expired && !cancelled ? (
                      <span>{` · ${t('plans.until', { date: dayLabel(me.expiresAt, lang) })}`}</span>
                    ) : null}
                    {row.offline ? <span>{` · ${t('plans.offline')}`}</span> : null}
                  </>
                }
                {...(me ? { value: formatMb(expired || cancelled ? 0 : me.remainingMb) } : {})}
                lang={lang}
                // the current plan opens; another one becomes current first (the plan Install and Add act on)
                {...(isCurrent
                  ? { href: planHref(row.key) }
                  : {
                      onClick: () => {
                        void plans.setCurrent(row.key).then((owned) => {
                          if (owned) router.push(planHref(row.key));
                        });
                      },
                    })}
              />
            );
          })}
        </ListGroup>
      )}
      {rows?.length ? (
        <Notice tone="info" lang={lang}>
          {t('plans.switchNote')}
        </Notice>
      ) : null}
    </>
  );
}
