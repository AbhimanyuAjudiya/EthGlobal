'use client';
/**
 * `/c/<slug>` — claim by ENS name (ens/README.md): `<slug>.re-charge.eth` is resolved in the browser on Sepolia
 * (lib/ens.ts). A live name that points at our DataDrop shows the sponsor's branding and "Get … free", which opens the
 * World ID claim for THAT campaign (/verify?campaign=<id>); anything else (unknown, expired, a look-alike) says the
 * campaign has ended and offers paid data. In MODE=live the API discloses a ticketed campaign only to a ticket
 * preview, so such a live name shows the branding and says the organizer's private pass link is the way in.
 */
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  ActionBar,
  AppShell,
  Avatar,
  BalanceCard,
  Button,
  ButtonLink,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  PageSplit,
  QuickActions,
  Skeleton,
} from './kit';
import { api } from '../lib/api';
import {
  checkCampaignName,
  ENS_PARENT,
  ensAppUrl,
  ensAvatarUrl,
  readCampaignName,
  type CampaignName as Resolved,
} from '../lib/ens';

type State =
  { kind: 'loading' } | { kind: 'offline' } | ({ kind: 'done'; passRequired?: boolean } & Resolved);

export function CampaignByNameRoute() {
  const { slug: raw } = useParams<{ slug: string | string[] }>();
  const slug = Array.isArray(raw) ? raw[0] : raw;
  return <CampaignByName slug={decodeURIComponent(slug ?? '').toLowerCase()} />;
}

export function CampaignByName({ slug }: { slug: string }) {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [round, setRound] = useState(0);

  useEffect(() => {
    let alive = true;
    readCampaignName(slug).then(
      async (facts) => {
        const checked = checkCampaignName(facts, Date.now());
        // a name can point at our pool yet name a campaign our API never registered (or one that is paused or
        // used up): ask the API before offering the claim; if the API can't answer, fall back to the ENS facts
        if (checked.ok) {
          const plans = await api.plans(checked.campaignId).catch(() => undefined);
          const c = plans?.campaign;
          // live names a ticketed campaign only through the pass link; a silent live answer means exactly that
          const live = plans ? plans.mode === 'live' : process.env.NEXT_PUBLIC_MODE === 'live';
          if (live && !c) {
            if (alive) setState({ kind: 'done', ...checked, passRequired: true });
            return;
          }
          if (plans && (!c || c.paused || c.remainingClaims === 0)) {
            if (alive) setState({ kind: 'done', ok: false, name: checked.name, reason: 'expired' });
            return;
          }
        }
        if (alive) setState({ kind: 'done', ...checked });
      },
      () => alive && setState({ kind: 'offline' }),
    );
    return () => {
      alive = false;
    };
  }, [slug, round]);

  const name = `${slug}.${ENS_PARENT}`;
  const done = state.kind === 'done' ? state : undefined;
  const live = done?.ok ? done : undefined;
  // "1 GB · 7 days" → "1 GB" → the figure and its unit: the bundle is this page's one hero
  const bundle = live?.bundle?.split('·')[0]?.trim() ?? 'data';
  const [figure = '', ...unit] = bundle.split(' ');

  let action;
  if (state.kind === 'offline')
    action = (
      <Button
        size="lg"
        block
        onClick={() => {
          setState({ kind: 'loading' });
          setRound((n) => n + 1);
        }}
      >
        Try again
      </Button>
    );
  else if (done && (!live || live.passRequired))
    action = (
      <ButtonLink href="/pay" size="lg" block>
        Buy data
      </ButtonLink>
    );
  else if (live)
    action = (
      <ButtonLink href={`/verify?campaign=${live.campaignId}`} size="lg" block>
        Get {bundle} free
      </ButtonLink>
    );

  return (
    <AppShell back="/" layout="split">
      <PageHeader
        id="campaign-name"
        size="display"
        eyebrow={live?.description ? name : undefined}
        title={live?.description ?? name}
      />
      <PageSplit
        hero={
          <>
            {state.kind === 'loading' ? (
              <Skeleton shape="balance" label={`Looking up ${name}`} />
            ) : null}
            {state.kind === 'offline' ? (
              <Notice tone="warning" role="status">
                Could not reach Sepolia to look up {name}.
              </Notice>
            ) : null}
            {done && !live ? (
              <Notice
                tone="info"
                role="status"
                data-testid="campaign-ended"
                title="This campaign has ended."
              />
            ) : null}
            {live?.bundle ? (
              <BalanceCard
                tone="brand"
                amount={figure}
                unit={unit.join(' ')}
                note="free"
                caption={`${live.bundle}, paid by the sponsor`}
                status={
                  live.avatar ? <Avatar src={ensAvatarUrl(live.name)} size={48} /> : undefined
                }
              />
            ) : null}
            {live ? (
              <QuickActions
                label="Other ways to get data"
                items={[
                  { icon: 'add', label: 'Pay instead', href: '/pay' },
                  { icon: 'card', label: 'Scratch card', href: '/card' },
                  { icon: 'organizers', label: 'Organizers', href: '/sponsor' },
                ]}
              />
            ) : null}
            {action ? <ActionBar>{action}</ActionBar> : null}
          </>
        }
      >
        {live?.passRequired ? (
          <Notice tone="info" role="status" data-testid="pass-required">
            This event&apos;s {bundle} is claimed through the private pass link your organizer sent
            with your ticket. This public name alone does not open the claim.
          </Notice>
        ) : null}
        <ListGroup label={name} {...(live ? { 'data-testid': 'campaign-live' } : {})}>
          {live?.twitter ? (
            <ListRow
              href={`https://x.com/${live.twitter}`}
              external
              title={`@${live.twitter} on X`}
            />
          ) : null}
          <ListRow
            href={ensAppUrl(name)}
            external
            title="ENS app"
            subtitle="Read from ENS on Sepolia"
          />
        </ListGroup>
      </PageSplit>
    </AppShell>
  );
}
