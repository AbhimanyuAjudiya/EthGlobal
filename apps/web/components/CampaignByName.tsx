'use client';
/**
 * `/c/<slug>` — claim by ENS name (ens/README.md): `<slug>.re-charge.eth` is resolved in the browser on Sepolia
 * (lib/ens.ts). A live name that points at our DataDrop shows the sponsor's branding and "Get … free", which opens the
 * World ID claim for THAT campaign (/verify?campaign=<id>); anything else (unknown, expired, a look-alike) says the
 * campaign has ended and offers paid data.
 */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

import { AppHeader, Screen } from './Shell';
import {
  checkCampaignName,
  ENS_PARENT,
  ensAppUrl,
  ensAvatarUrl,
  readCampaignName,
  type CampaignName as Resolved,
} from '../lib/ens';

type State = { kind: 'loading' } | { kind: 'offline' } | ({ kind: 'done' } & Resolved);

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
      (facts) => alive && setState({ kind: 'done', ...checkCampaignName(facts, Date.now()) }),
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
      <div role="status" data-testid="campaign-ended">
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
    body = (
      <div data-testid="campaign-live">
        {state.avatar && !avatarFailed ? (
          // ENS's avatar service, not next/image: no image proxy on our side; CSP img-src allows only that host
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ensAvatarUrl(state.name)}
            alt=""
            width={72}
            height={72}
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
      </div>
    );
  }

  return (
    <Screen>
      <AppHeader />
      <section className="sheet" aria-labelledby="campaign-name">
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
