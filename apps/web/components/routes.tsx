'use client';

/**
 * Client entry points that read the URL (params / search params) — rendered by the route files inside
 * <Suspense> so the static shell prerenders under cacheComponents. /install deliberately has none: it accepts
 * no URL parameter (T-62). Each consumer route sits in the kit AppShell with its tab / Back (DESIGN.md §7); the
 * screens' own legacy Screen / AppHeader / TabBar step aside inside it.
 */
import { useParams, useSearchParams } from 'next/navigation';

import { PaySheet } from './PaySheet';
import { PlanView } from './PlanView';
import { ReceiptList } from './ReceiptList';
import { ScratchRedeem } from './ScratchRedeem';
import { AppShell } from './Shell';
import { SponsorTable } from './SponsorTable';
import { VerifySheet } from './VerifySheet';

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
