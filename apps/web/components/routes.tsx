'use client';

/**
 * Client entry points that read the URL (params / search params) — rendered by the route files inside
 * <Suspense> so the static shell prerenders under cacheComponents. /install deliberately has none: it accepts
 * no URL parameter (T-62).
 */
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useLang } from '../i18n/lang';
import { planHref } from '../lib/deliver';
import { plans } from '../lib/store';

import { ClaimGift, ReclaimGift } from './ClaimGift';
import { GiftForm } from './GiftForm';
import { PaySheet } from './PaySheet';
import { PlanView } from './PlanView';
import { ReceiptList } from './ReceiptList';
import { ScratchRedeem } from './ScratchRedeem';
import { AppHeader, Screen, TabBar } from './Shell';
import { SponsorTable } from './SponsorTable';

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function PlanRoute() {
  const params = useParams<{ key: string }>();
  const key = decodeURIComponent(param(params.key) ?? '');
  return <PlanView key={key} entitlementKey={key} />;
}

/** `/plan` (the manifest's start_url): resolves to the plan stored on this device. */
export function PlanIndex() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [none, setNone] = useState(false);
  useEffect(() => {
    void plans.latest().then((key) => (key ? router.replace(planHref(key)) : setNone(true)));
  }, [router]);
  return (
    <Screen>
      <AppHeader />
      {none ? (
        <p className="note" role="status" lang={lang}>
          {t('plan.unknown')}
        </p>
      ) : (
        <div className="skeleton skeleton--coupon" aria-label="Opening your plan" />
      )}
    </Screen>
  );
}

export function PayRoute() {
  const search = useSearchParams();
  const key = search.get('key') ?? undefined;
  const mb = Number(search.get('mb') ?? '') || undefined;
  return (
    <PaySheet
      key={`${key ?? 'new'}-${mb ?? ''}`}
      {...(key ? { entitlementKey: key } : {})}
      {...(mb ? { initialMb: mb } : {})}
    />
  );
}

export function GiftPage() {
  const [sent, setSent] = useState(0);
  return (
    <Screen money>
      <AppHeader />
      <GiftForm onSent={() => setSent((n) => n + 1)} />
      <ReclaimGift refreshKey={sent} />
      <TabBar active="gift" />
    </Screen>
  );
}

export function ClaimRoute() {
  const search = useSearchParams();
  const id = search.get('id') ?? undefined;
  const name = search.get('name') ?? undefined;
  return (
    <Screen>
      <AppHeader />
      <ClaimGift {...(id && /^0x[0-9a-f]{64}$/i.test(id) ? { giftId: id } : {})} {...(name ? { name } : {})} />
    </Screen>
  );
}

export function ReceiptsRoute() {
  const key = useSearchParams().get('key') ?? undefined;
  return <ReceiptList {...(key ? { entitlementKey: key } : {})} />;
}

export function CardRoute() {
  const params = useParams<{ serial: string }>();
  const serial = param(params.serial);
  return <ScratchRedeem {...(serial && /^[0-9a-f]{8}$/.test(serial) ? { serial } : { serial: 'invalid' })} />;
}

export function SponsorRoute() {
  const params = useParams<{ id: string }>();
  return <SponsorTable id={param(params.id) ?? ''} />;
}
