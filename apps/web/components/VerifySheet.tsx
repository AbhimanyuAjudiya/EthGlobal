'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import type { ChallengeWire, EntitledResponse } from '@ethglobal/protocol/schemas';
import { Button, Coupon } from '@ethglobal/ui/components';

import { QrCode } from './QrCode';
import { AppHeader, Screen } from './Shell';
import { TierLedger } from './TierLedger';
import { useLang } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { deliver, planHref } from '../lib/deliver';
import { config, IS_LOCAL } from '../lib/env';
import { formatMb, mmss, money, priceFor } from '../lib/format';
import { useClock, usePlans } from '../lib/hooks';
import { beginSession } from '../lib/session-key';


type Phase =
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'waiting'; since: number; connectorURI?: string }
  | { kind: 'checking'; since: number }
  | { kind: 'failed' }
  | { kind: 'seen' }
  | { kind: 'noCredential' }
  | { kind: 'sponsorFailed'; why: string }
  | { kind: 'closed'; retryS: number; message: string };

const SEED_KEY = 'recharge.sim.seed';

/** One simulated human per browser profile, so a second claim from the same browser replays the nullifier. */
function simulatedSeed(): string {
  try {
    const existing = localStorage.getItem(SEED_KEY);
    if (existing) return existing;
    const seed = `web-${crypto.randomUUID()}`;
    localStorage.setItem(SEED_KEY, seed);
    return seed;
  } catch {
    return `web-${crypto.randomUUID()}`;
  }
}

interface IdkitCompletion {
  success: boolean;
  result?: unknown;
  error?: string;
}

/** Live mode only: IDKit 4.6 with the backend-signed rp_context (A-25). Loaded on demand. */
async function openIdkit(
  challenge: ChallengeWire,
  rp: Awaited<ReturnType<typeof api.rpContext>>,
  onConnector: (uri: string | undefined) => void,
): Promise<IdkitCompletion> {
  const idkit = await import('@worldcoin/idkit-core');
  const request = await idkit.IDKit.request({
    app_id: config.worldAppId as `app_${string}`,
    action: config.worldAction,
    rp_context: rp,
    allow_legacy_proofs: true,
    environment: config.worldEnvironment,
  }).preset(idkit.documentLegacy({ signal: challenge.signal }));
  const req = request as unknown as {
    connectorURI?: string;
    pollUntilCompletion(o: { pollInterval: number; timeout: number }): Promise<IdkitCompletion>;
  };
  onConnector(req.connectorURI || undefined);
  return req.pollUntilCompletion({ pollInterval: 2000, timeout: 120_000 });
}

export function VerifySheet() {
  const { t, lang } = useLang();
  const router = useRouter();
  const { plans } = usePlans();
  const now = useClock(1000);
  const [phase, setPhase] = useState<Phase>({ kind: 'preparing' });
  const session = useRef<{ spk: Hex; challenge: ChallengeWire } | undefined>(undefined);
  const rpRetried = useRef(false);

  const prepare = useCallback(async () => {
    setPhase({ kind: 'preparing' });
    try {
      const spk = beginSession(); // the session keypair is generated here, in memory only (T-60)
      const challenge = await api.challenge('/claim', spk);
      session.current = { spk, challenge };
      setPhase({ kind: 'ready' });
    } catch (e) {
      const err = e instanceof ApiError ? e : undefined;
      setPhase({
        kind: 'closed',
        retryS: err?.retryAfterS ?? 30,
        message: t(errorKey(err?.code ?? 'network')),
      });
    }
  }, [t]);

  useEffect(() => {
    void prepare();
  }, [prepare]);

  const fail = useCallback(
    (e: unknown) => {
      const err = e instanceof ApiError ? e : new ApiError(0, 'network', String(e));
      switch (err.code) {
        case 'replay':
        case 'already_claimed':
          return setPhase({ kind: 'seen' });
        case 'payment_required':
          return setPhase({ kind: 'noCredential' });
        case 'invalid_proof':
        case 'unauthorized':
          return setPhase({ kind: 'failed' });
        case 'hourly_cap':
        case 'budget_exhausted':
        case 'campaign_paused':
        case 'campaign_expired':
          return setPhase({ kind: 'sponsorFailed', why: t(errorKey(err.code)) });
        default:
          return setPhase({
            kind: 'closed',
            retryS: err.retryAfterS ?? 30,
            message: t(errorKey(err.code)),
          });
      }
    },
    [t],
  );

  const claim = useCallback(
    async (proof: unknown) => {
      const s = session.current;
      const campaign = plans?.campaign;
      if (!s || !campaign) return;
      setPhase({ kind: 'checking', since: Date.now() });
      try {
        // the IDKit result is forwarded UNCHANGED as `proof` (A-25)
        const res = await api.claim({
          proof,
          campaignId: campaign.id as Hex,
          challenge: s.challenge,
          sessionPubKey: s.spk,
        });
        const key = await deliver(res.data, s.challenge.nonce as Hex, {
          network: campaign.network,
          you: '$0.00',
          sponsor: campaign.name,
        });
        router.push(planHref(key));
      } catch (e) {
        fail(e);
      }
    },
    [plans, router, fail],
  );

  const start = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    setPhase({ kind: 'waiting', since: Date.now() });
    try {
      // the backend-signed rp_context, after the challenge and before IDKit opens (A-25)
      const rp = await api.rpContext('/claim');
      if (IS_LOCAL) {
        const proof = await api.simulatedProof(s.challenge.signal as Hex, 'orb', simulatedSeed());
        await claim(proof);
        return;
      }
      const done = await openIdkit(s.challenge, rp, (uri) =>
        setPhase({ kind: 'waiting', since: Date.now(), ...(uri ? { connectorURI: uri } : {}) }),
      );
      if (done.success) return await claim(done.result);
      if (done.error === 'user_rejected') return setPhase({ kind: 'ready' });
      if (done.error === 'credential_unavailable') return setPhase({ kind: 'noCredential' });
      if (
        (done.error === 'rp_signature_expired' || done.error === 'timestamp_too_old') &&
        !rpRetried.current
      ) {
        rpRetried.current = true;
        return await start();
      }
      setPhase({ kind: 'failed' });
    } catch (e) {
      fail(e);
    }
  }, [claim, fail]);

  const mb = plans?.campaign?.bundleMb.orb ?? 300;
  const price = plans ? money(priceFor(mb, plans.paid.priceUsd6PerStep)) : '';
  const payHref = `/pay?mb=${mb}`;

  let status: ReactNode = null;
  switch (phase.kind) {
    case 'preparing':
      status = <p className="skeleton skeleton--line" aria-hidden="true" />;
      break;
    case 'waiting':
      status = (
        <>
          <p role="status" lang={lang}>
            {t('verify.waiting', { elapsed: mmss(now - phase.since) })}
          </p>
          {phase.connectorURI ? (
            <QrCode url={phase.connectorURI} sizeMm={44} label={t('verify.scan')} />
          ) : null}
        </>
      );
      break;
    case 'checking':
      status = (
        <p role="status" lang={lang}>
          {t('verify.checking', { elapsed: `${Math.max(1, Math.round((now - phase.since) / 1000))} s` })}
        </p>
      );
      break;
    case 'failed':
      status = (
        <p role="status" lang={lang}>
          {t('verify.failed', { price, mb: formatMb(mb) })}
        </p>
      );
      break;
    case 'seen':
      status = (
        <div role="status" data-testid="nullifier-seen">
          <p lang={lang}>{t('verify.seen')}</p>
          <p className="quiet-rows">
            <Link href="/plan" prefetch={false}>
              {t('verify.openThat')}
            </Link>
            <Link href="/pay" prefetch={false}>
              {t('verify.payMore')}
            </Link>
          </p>
        </div>
      );
      break;
    case 'noCredential':
      status = (
        <p role="status" lang={lang}>
          {t('verify.noCredential')}
        </p>
      );
      break;
    case 'sponsorFailed':
      status = (
        <p role="status" lang={lang}>
          {t('verify.sponsorFailed', { why: phase.why, price })}
        </p>
      );
      break;
    case 'closed':
      status = (
        <p role="status" lang={lang}>
          {phase.message} {t('verify.closed', { s: phase.retryS })}
        </p>
      );
      break;
    case 'ready':
      break;
  }

  const canStart = phase.kind === 'ready' || phase.kind === 'failed';
  return (
    <Screen>
      <AppHeader />
      {plans?.campaign ? (
        <div className="verify__coupon" aria-hidden="true">
          <Coupon mb={mb} sponsor={plans.campaign.name} variant="notification" />
        </div>
      ) : null}
      <section className="sheet" aria-labelledby="verify-title">
        <h1 id="verify-title" className="sheet__title" lang={lang}>
          {t('verify.title')}
        </h1>
        <p className="sheet__lede" lang={lang}>
          {t('verify.lede')}
        </p>
        <div className="verify__status">{status}</div>
        <div className="sheet__actions">
          {canStart ? (
            <Button block onClick={() => void start()} disabled={!plans?.campaign}>
              {IS_LOCAL ? t('verify.simulated') : t('verify.open')}
            </Button>
          ) : null}
          {phase.kind === 'waiting' && !IS_LOCAL ? (
            <Button variant="quiet" onClick={() => setPhase({ kind: 'ready' })}>
              {t('verify.cancel')}
            </Button>
          ) : null}
          {phase.kind === 'closed' ? (
            <Button variant="secondary" onClick={() => void prepare()}>
              {t('verify.retry')}
            </Button>
          ) : null}
          {phase.kind === 'failed' || phase.kind === 'noCredential' || phase.kind === 'sponsorFailed' ? (
            <Link href={payHref} className="ui-button" data-variant="secondary" prefetch={false}>
              {t('landing.payInstead', { price, mb: formatMb(mb) })}
            </Link>
          ) : null}
        </div>
        {IS_LOCAL ? (
          <p className="note" lang={lang}>
            {t('verify.simulatedNote')}
          </p>
        ) : null}
        {plans ? <TierLedger plans={plans} /> : null}
      </section>
    </Screen>
  );
}
