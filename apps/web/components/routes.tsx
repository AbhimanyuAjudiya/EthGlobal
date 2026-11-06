'use client';

/**
 * Client entry points that read the URL (params / search params) — rendered by the route files inside
 * <Suspense> so the static shell prerenders under cacheComponents. /install deliberately has none: it accepts
 * no URL parameter (T-62). Each consumer route sits in the kit AppShell with its tab / Back (DESIGN.md §7); the
 * screens' own legacy Screen / AppHeader / TabBar step aside inside it.
 */
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { ClaimGift, ReclaimGift } from './ClaimGift';
import { GiftForm } from './GiftForm';
import { PaySheet } from './PaySheet';
import { NoPlanSteps, PlanView } from './PlanView';
import { ReceiptList } from './ReceiptList';
import { ScratchRedeem } from './ScratchRedeem';
import { AppHeader, AppShell, Screen, TabBar } from './Shell';
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
  return (
    <AppShell nav="plan">
      <PlanView key={key} entitlementKey={key} />
    </AppShell>
  );
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
  if (shellKey)
    return (
      <AppShell nav="plan">
        <PlanView key={shellKey} entitlementKey={shellKey} />
      </AppShell>
    );
  return (
    <AppShell nav="plan">
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
    </AppShell>
  );
}

export function PayRoute() {
  const search = useSearchParams();
  // one size is sold (/plans paid.sizesMb), so an old `?mb=` link is ignored rather than quoted
  const key = search.get('key') ?? undefined;
  return (
    <AppShell nav="add" money>
      <PaySheet key={key ?? 'new'} {...(key ? { entitlementKey: key } : {})} />
    </AppShell>
  );
}

export function GiftPage() {
  const [sent, setSent] = useState(0);
  const { t, lang } = useLang();
  return (
    <AppShell nav="gift" money>
      <Screen className="gift-screen">
        <AppHeader />
        <div className="gift-layout">
          <GiftForm onSent={() => setSent((n) => n + 1)} />
          <aside className="gift-context">
            <section className="gift-guide" lang={lang}>
              <p className="eyebrow">{t('flow.coverage')}</p>
              <h2 className="section-title">{t('how.giftLink')}</h2>
              <p>{t('gift.intro')}</p>
              <p className="note">{t('how.giftBody')}</p>
              <p className="note">{t('warn.unlocked')}</p>
            </section>
            <ReclaimGift refreshKey={sent} />
          </aside>
        </div>
        <TabBar active="gift" />
      </Screen>
    </AppShell>
  );
}

export function ClaimRoute() {
  const search = useSearchParams();
  const id = search.get('id') ?? undefined;
  const name = search.get('name') ?? undefined;
  return (
    <AppShell nav="gift" back="/gift">
      <Screen className="claim-screen">
        <AppHeader />
        <ClaimGift
          {...(id && /^0x[0-9a-f]{64}$/i.test(id) ? { giftId: id } : {})}
          {...(name ? { name } : {})}
        />
      </Screen>
    </AppShell>
  );
}

/** `/verify?campaign=<id>`: the claim for that campaign (claim by ENS name, /c/<slug>); no param = the default one. */
export function VerifyRoute() {
  const id = useSearchParams().get('campaign') ?? '';
  return (
    <AppShell back="/">
      <VerifySheet key={id} {...(/^0x[0-9a-fA-F]{64}$/.test(id) ? { campaignId: id } : {})} />
    </AppShell>
  );
}

export function ReceiptsRoute() {
  const key = useSearchParams().get('key') ?? undefined;
  return (
    <AppShell nav="more" back={key ? `/plan/${encodeURIComponent(key)}` : '/plan'}>
      <ReceiptList key={key ?? 'latest'} {...(key ? { entitlementKey: key } : {})} />
    </AppShell>
  );
}

export function CardRoute() {
  const params = useParams<{ serial: string }>();
  const serial = param(params.serial);
  return (
    <AppShell nav="more" back="/card">
      <ScratchRedeem
        key={serial}
        {...(serial && /^[0-9a-f]{8}$/.test(serial) ? { serial } : { serial: 'invalid' })}
      />
    </AppShell>
  );
}

/** The sponsor console keeps its own frame (app/sponsor/layout.tsx; kit ConsoleShell). */
export function SponsorRoute() {
  const params = useParams<{ id: string }>();
  return <SponsorTable id={param(params.id) ?? ''} />;
}
