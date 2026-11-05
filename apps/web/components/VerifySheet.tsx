'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import type { ChallengeWire } from '@ethglobal/protocol/schemas';
import { Button, Coupon } from '@ethglobal/ui/components';

import { QrCode } from './QrCode';
import { AppHeader, Caution, Screen } from './Shell';
import { TierLedger } from './TierLedger';
import { useLang } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { deliver, planHref } from '../lib/deliver';
import { isHandheld } from '../lib/device';
import { config } from '../lib/env';
import { formatMb, mmss, money, priceFor } from '../lib/format';
import { useClock, usePlans } from '../lib/hooks';
import { beginSession } from '../lib/session-key';

type Phase =
  | { kind: 'preparing' }
  | { kind: 'ready' }
  | { kind: 'waiting'; since: number; connectorURI?: string }
  | { kind: 'checking'; since: number }
  /** The claim request died (timeout, network) after the proof left: the API may have served it (RT-W-13). */
  | { kind: 'unconfirmed' }
  | { kind: 'failed' }
  | { kind: 'seen' }
  | { kind: 'noCredential' }
  | { kind: 'sponsorFailed'; why: string }
  | { kind: 'closed'; retryS: number; message: string };

const SEED_KEY = 'recharge.sim.seed';
/** Past this the "Checking" line says what is running (chain claim + eSIM order) and that it takes a while. */
export const SLOW_CLAIM_MS = 10_000;

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
  onConnector(req.connectorURI === '' ? undefined : req.connectorURI);
  return req.pollUntilCompletion({ pollInterval: 2000, timeout: 120_000 });
}

/** The session keypair is generated here, in memory only (T-60); the challenge MAC binds it. */
async function prepareClaim(): Promise<{ spk: Hex; challenge: ChallengeWire }> {
  const spk = beginSession();
  return { spk, challenge: await api.challenge('/claim', spk) };
}

const SEEN = new Set(['replay', 'already_claimed']);
const SPONSOR = new Set(['hourly_cap', 'budget_exhausted', 'campaign_paused', 'campaign_expired']);

/** API error → the sheet's state (design-references §1b states). */
function phaseFor(e: unknown, t: (k: ReturnType<typeof errorKey>) => string): Phase {
  const err = e instanceof ApiError ? e : new ApiError(0, 'network', String(e));
  if (SEEN.has(err.code)) return { kind: 'seen' };
  if (err.code === 'payment_required') return { kind: 'noCredential' };
  if (err.code === 'invalid_proof' || err.code === 'unauthorized') return { kind: 'failed' };
  if (SPONSOR.has(err.code)) return { kind: 'sponsorFailed', why: t(errorKey(err.code)) };
  return { kind: 'closed', retryS: err.retryAfterS ?? 30, message: t(errorKey(err.code)) };
}

export function VerifySheet() {
  const { t, lang } = useLang();
  const router = useRouter();
  const { plans } = usePlans();
  const now = useClock(1000);
  const [phase, setPhase] = useState<Phase>({ kind: 'preparing' });
  // read once on the client; the server never renders the `waiting` phase, so no hydration mismatch
  const [handheld] = useState(() => typeof window !== 'undefined' && isHandheld(window));
  const [showQr, setShowQr] = useState(false);
  const session = useRef<{ spk: Hex; challenge: ChallengeWire } | undefined>(undefined);

  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    prepareClaim().then(
      (next) => {
        if (!alive) return;
        session.current = next;
        setPhase({ kind: 'ready' });
      },
      (e: unknown) => alive && setPhase(phaseFor(e, t)),
    );
    return () => {
      alive = false;
    };
  }, [t, round]);
  const prepare = () => {
    setPhase({ kind: 'preparing' });
    setRound((n) => n + 1);
  };
  const fail = useCallback((e: unknown) => setPhase(phaseFor(e, t)), [t]);

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
        // 201 and 202 deliver the same way: a pending profile has no LPA yet and /plan says so (T-25)
        router.push(planHref(key));
      } catch (e) {
        // no answer is not "nothing happened": the API keeps claiming after the socket drops (RT-W-13)
        if (e instanceof ApiError && e.code === 'network') setPhase({ kind: 'unconfirmed' });
        else fail(e);
      }
    },
    [plans, router, fail],
  );

  const start = useCallback(async () => {
    const s = session.current;
    if (!s) return;
    setPhase({ kind: 'waiting', since: Date.now() });
    try {
      // an expired rp_context (rp_signature_expired | timestamp_too_old) is re-fetched once
      for (let attempt = 0; attempt < 2; attempt += 1) {
        // the backend-signed rp_context, after the challenge and before IDKit opens (A-25)
        const rp = await api.rpContext('/claim');
        if (process.env.NEXT_PUBLIC_MODE === 'local') {
          // compiled out of a live build (RT-W-12): the simulator call lives in lib/local/world-sim.ts
          const { simulatedProof } = await import('../lib/local/world-sim');
          await claim(await simulatedProof(s.challenge.signal as Hex, 'orb', simulatedSeed()));
          return;
        }
        const done = await openIdkit(s.challenge, rp, (uri) =>
          setPhase({ kind: 'waiting', since: Date.now(), ...(uri ? { connectorURI: uri } : {}) }),
        );
        if (done.success) return await claim(done.result);
        if (done.error === 'user_rejected') return setPhase({ kind: 'ready' });
        if (done.error === 'credential_unavailable') return setPhase({ kind: 'noCredential' });
        if (done.error !== 'rp_signature_expired' && done.error !== 'timestamp_too_old') break;
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
          {phase.connectorURI && handheld ? (
            <>
              {/* World App is on this phone: one tap opens it; the poll keeps running meanwhile */}
              <a
                href={phase.connectorURI}
                className="ui-button ui-button--block"
                data-variant="primary"
                lang={lang}
              >
                {t('verify.open')}
              </a>
              {showQr ? (
                <QrCode url={phase.connectorURI} sizeMm={44} label={t('verify.scan')} />
              ) : (
                <Button variant="quiet" onClick={() => setShowQr(true)}>
                  {t('verify.showQr')}
                </Button>
              )}
            </>
          ) : phase.connectorURI ? (
            <>
              <QrCode url={phase.connectorURI} sizeMm={44} label={t('verify.scan')} />
              <p className="quiet-rows">
                <a href={phase.connectorURI} lang={lang}>
                  {t('verify.open')}
                </a>
              </p>
            </>
          ) : null}
        </>
      );
      break;
    case 'checking':
      status = (
        <p role="status" lang={lang}>
          {t(now - phase.since >= SLOW_CLAIM_MS ? 'verify.checkingLong' : 'verify.checking', {
            elapsed: `${Math.max(1, Math.round((now - phase.since) / 1000))} s`,
          })}
        </p>
      );
      break;
    case 'unconfirmed':
      status = (
        <div role="status" data-testid="claim-unconfirmed">
          <p lang={lang}>{t('verify.unconfirmed')}</p>
          <p className="quiet-rows">
            <Link href="/plan" prefetch={false}>
              {t('verify.checkPlans')}
            </Link>
          </p>
        </div>
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
          <Coupon mb={mb} sponsor={plans.campaign.name} variant="notification" lang={lang} />
        </div>
      ) : null}
      <section className="sheet" aria-labelledby="verify-title">
        <h1 id="verify-title" className="sheet__kicker" lang={lang}>
          {t('verify.title')}
        </h1>
        <p className="sheet__lede sheet__lede--dominant" lang={lang}>
          {t('verify.lede')}
        </p>
        <div className="verify__status">{status}</div>
        <Caution k="warn.thisBrowser" />
        <div className="sheet__actions">
          {canStart ? (
            <Button block onClick={() => void start()} disabled={!plans?.campaign}>
              {process.env.NEXT_PUBLIC_MODE === 'local' ? t('verify.simulated') : t('verify.open')}
            </Button>
          ) : null}
          {phase.kind === 'waiting' && process.env.NEXT_PUBLIC_MODE !== 'local' ? (
            <Button variant="quiet" onClick={() => setPhase({ kind: 'ready' })}>
              {t('verify.cancel')}
            </Button>
          ) : null}
          {phase.kind === 'closed' ? (
            <Button variant="secondary" onClick={prepare}>
              {t('verify.retry')}
            </Button>
          ) : null}
          {phase.kind === 'failed' ||
          phase.kind === 'noCredential' ||
          phase.kind === 'sponsorFailed' ? (
            <Link href={payHref} className="ui-button" data-variant="secondary" prefetch={false}>
              {t('landing.payInstead', { price, mb: formatMb(mb) })}
            </Link>
          ) : null}
        </div>
        {process.env.NEXT_PUBLIC_MODE === 'local' ? (
          <p className="note" lang={lang}>
            {t('verify.simulatedNote')}
          </p>
        ) : null}
        {plans ? <TierLedger plans={plans} /> : null}
      </section>
    </Screen>
  );
}
