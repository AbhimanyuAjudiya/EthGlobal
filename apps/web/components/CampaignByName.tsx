'use client';
/**
 * `/c/<slug>` — claim by ENS name (ens/README.md): `<slug>.re-charge.eth` is resolved in the browser on Sepolia
 * (lib/ens.ts). A live name that points at our DataDrop shows the sponsor's branding and "Get … free", which opens the
 * World ID claim for THAT campaign (/verify?campaign=<id>); anything else (unknown, expired, a look-alike) says the
 * campaign has ended and offers paid data. In MODE=live the API discloses a campaign only to a ticket preview, so a
 * live name shows the branding and says the organizer's private pass link is the way in.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AppHeader, Screen } from './Shell';
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
  const [avatarFailed, setAvatarFailed] = useState(false);

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
          // live never answers with the campaign: only the pass link can open (and verify) the claim
          const live = plans ? plans.mode === 'live' : process.env.NEXT_PUBLIC_MODE === 'live';
          if (live) {
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
  let body;
  if (state.kind === 'loading') {
    body = <p className="skeleton skeleton--line" aria-label={`Looking up ${name}`} />;
  } else if (state.kind === 'offline') {
    body = (
      <>
        <p role="status">Could not reach Sepolia to look up {name}.</p>
        <div className="sheet__actions">
          <button
            type="button"
            className="ui-button"
            data-variant="secondary"
            onClick={() => {
              setState({ kind: 'loading' });
              setRound((n) => n + 1);
            }}
          >
            Try again
          </button>
        </div>
      </>
    );
  } else if (!state.ok) {
    body = (
      <div role="status" className="campaign-page__ended" data-testid="campaign-ended">
        <p className="sheet__lede">This campaign has ended.</p>
        <div className="sheet__actions">
          <Link href="/pay" className="ui-button" data-variant="primary" prefetch={false}>
            Buy data
          </Link>
        </div>
      </div>
    );
  } else {
    const bundle = state.bundle?.split('·')[0]?.trim() ?? 'data';
    // "1 GB" → the figure and its unit: the bundle is this page's one hero, as the MB is on the coupon
    const [figure, ...unit] = bundle.split(' ');
    body = (
      <div className="campaign-page__live" data-testid="campaign-live">
        {state.bundle ? (
          <p className="campaign-hero">
            <span className="campaign-hero__figure">{figure}</span>
            <span className="campaign-hero__unit">{unit.join(' ')} free</span>
          </p>
        ) : null}
        {state.avatar && !avatarFailed ? (
          // ENS's avatar service, not next/image: no image proxy on our side; CSP img-src allows only that host
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ensAvatarUrl(state.name)}
            alt=""
            width={48}
            height={48}
            className="campaign-page__avatar"
            onError={() => setAvatarFailed(true)}
          />
        ) : null}
        {state.description ? <p className="sheet__lede">{state.description}</p> : null}
        {state.twitter ? (
          <p className="quiet-rows">
            <a href={`https://x.com/${state.twitter}`} target="_blank" rel="noreferrer">
              @{state.twitter} on X
            </a>
          </p>
        ) : null}
        {state.bundle ? <p className="note">{state.bundle}, paid by the sponsor</p> : null}
        {state.passRequired ? (
          <>
            <p role="status" data-testid="pass-required">
              This event&apos;s {bundle} is claimed through the private pass link your organizer
              sent with your ticket. This public name alone does not open the claim.
            </p>
            <div className="sheet__actions">
              <Link href="/pay" className="ui-button" data-variant="secondary" prefetch={false}>
                Buy data
              </Link>
            </div>
          </>
        ) : (
          <div className="sheet__actions">
            <Link
              href={`/verify?campaign=${state.campaignId}`}
              className="ui-button ui-button--block"
              data-variant="primary"
              prefetch={false}
            >
              Get {bundle} free
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <Screen>
      <AppHeader />
      <section className="sheet campaign-page" aria-labelledby="campaign-name">
        <h1 id="campaign-name" className="sheet__kicker mono-key">
          {name}
        </h1>
        {body}
        <p className="note">
          Read from ENS on Sepolia ·{' '}
          <a href={ensAppUrl(name)} target="_blank" rel="noreferrer">
            ENS app
          </a>
        </p>
      </section>
    </Screen>
  );
}
