'use client';

/**
 * Client entry points that read the URL (params / search params) — rendered by the route files inside
 * <Suspense> so the static shell prerenders under cacheComponents. /install deliberately has none: it accepts
 * no URL parameter (T-62).
 */
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ClaimGift, ReclaimGift } from './ClaimGift';
import { GiftForm } from './GiftForm';
import { PaySheet } from './PaySheet';
import { NoPlanSteps, PlanView } from './PlanView';
import { ReceiptList } from './ReceiptList';
import { ScratchRedeem } from './ScratchRedeem';
import { AppHeader, Screen, TabBar } from './Shell';
import { SponsorTable } from './SponsorTable';
import { VerifySheet } from './VerifySheet';
import { useLang } from '../i18n/lang';
import { planHref } from '../lib/deliver';
import { useHydrated } from '../lib/hooks';
import { plans } from '../lib/store';

const param = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

export function PlanRoute() {
  const params = useParams<{ key: string }>();
  const key = decodeURIComponent(param(params.key) ?? '');
  return <PlanView key={key} entitlementKey={key} />;
}

/** The key in `/plan/<key>` when this shell was served for it (the service worker's offline answer). */
function keyFromAddressBar(): string | undefined {
  const match = /^\/plan\/([^/?#]+)/.exec(window.location.pathname);
  if (!match?.[1]) return undefined;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return undefined;
  }
}

/**
 * `/plan` (the manifest's start_url): resolves to the plan stored on this device. Offline, the service worker
 * answers every `/plan/<key>` navigation with this precached shell (RT-W-06); it then renders that plan directly
 * from the IndexedDB snapshot instead of a client navigation that would need the network.
 */
export function PlanIndex() {
  const router = useRouter();
  const { t, lang } = useLang();
  const [none, setNone] = useState(false);
  // read after hydration only: the server rendered this shell for /plan, whatever the address bar says
  const hydrated = useHydrated();
  const shellKey = hydrated ? keyFromAddressBar() : undefined;
  useEffect(() => {
    if (!hydrated || shellKey) return;
    void plans.latest().then((key) => (key ? router.replace(planHref(key)) : setNone(true)));
  }, [router, hydrated, shellKey]);
  if (shellKey) return <PlanView key={shellKey} entitlementKey={shellKey} />;
  return (
    <Screen>
      <AppHeader />
      {none ? (
        <>
          <p className="plan-empty" role="status" lang={lang}>
            {t('plan.none')}
          </p>
          <NoPlanSteps />
        </>
      ) : (
        <div className="skeleton skeleton--coupon" aria-label="Opening your plan" />
      )}
    </Screen>
  );
}

export function PayRoute() {
  const search = useSearchParams();
  // one size is sold (/plans paid.sizesMb), so an old `?mb=` link is ignored rather than quoted
  const key = search.get('key') ?? undefined;
  return <PaySheet key={key ?? 'new'} {...(key ? { entitlementKey: key } : {})} />;
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
      <ClaimGift
        {...(id && /^0x[0-9a-f]{64}$/i.test(id) ? { giftId: id } : {})}
        {...(name ? { name } : {})}
      />
    </Screen>
  );
}

/** `/verify?campaign=<id>`: the claim for that campaign (claim by ENS name, /c/<slug>); no param = the default one. */
export function VerifyRoute() {
  const id = useSearchParams().get('campaign') ?? '';
  return <VerifySheet {...(/^0x[0-9a-fA-F]{64}$/.test(id) ? { campaignId: id } : {})} />;
}

export function ReceiptsRoute() {
  const key = useSearchParams().get('key') ?? undefined;
  return <ReceiptList {...(key ? { entitlementKey: key } : {})} />;
}

export function CardRoute() {
  const params = useParams<{ serial: string }>();
  const serial = param(params.serial);
  return (
    <ScratchRedeem
      {...(serial && /^[0-9a-f]{8}$/.test(serial) ? { serial } : { serial: 'invalid' })}
    />
  );
}

export function SponsorRoute() {
  const params = useParams<{ id: string }>();
  return <SponsorTable id={param(params.id) ?? ''} />;
}
