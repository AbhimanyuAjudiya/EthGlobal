'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { PLAN_MB, type Hex } from '@ethglobal/protocol/ids';
import type { ChallengeWire } from '@ethglobal/protocol/schemas';
import { Button, Coupon } from '@ethglobal/ui/components';

import { ProofPanel } from './ProofPanel';
import { QrCode } from './QrCode';
import { AppHeader, Caution, Screen } from './Shell';
import { TierLedger } from './TierLedger';
import { useLang } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { deliver, planHref } from '../lib/deliver';
import { isHandheld } from '../lib/device';
import { config } from '../lib/env';
import { formatMb, mmss, money, soldPlan } from '../lib/format';
import { useClock, usePlans } from '../lib/hooks';
import { buildProof, type Proof } from '../lib/proof';
import { finishRedemption, prepareFreeClaim } from '../lib/redeem';

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

/** `campaignId`: claim for that campaign (from /c/<slug>, the ENS name) instead of the default one. */
export function VerifySheet({ campaignId }: { campaignId?: string } = {}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const { plans } = usePlans(campaignId);
  const now = useClock(1000);
  const [phase, setPhase] = useState<Phase>({ kind: 'preparing' });
  // read once on the client; the server never renders the `waiting` phase, so no hydration mismatch
  const [handheld] = useState(() => typeof window !== 'undefined' && isHandheld(window));
  const [showQr, setShowQr] = useState(false);
  // a failed claim's proof (the API's error answer); a served claim's travels to /plan with the issued facts
  const [proof, setProof] = useState<Proof>();
  const session = useRef<Awaited<ReturnType<typeof prepareFreeClaim>> | undefined>(undefined);

  const translate = useRef(t);
  useEffect(() => {
    translate.current = t;
  }, [t]);
  const attempt = useRef(0);
  const [round, setRound] = useState(0);
  useEffect(() => {
    let alive = true;
    prepareFreeClaim(campaignId).then(
      (next) => {
        if (!alive) return;
        session.current = next;
        setPhase({ kind: 'ready' });
      },
      (e: unknown) => alive && setPhase(phaseFor(e, translate.current)),
    );
    return () => {
      alive = false;
    };
  }, [round, campaignId]);
  const prepare = () => {
    setPhase({ kind: 'preparing' });
    setRound((n) => n + 1);
  };
  const fail = useCallback((e: unknown) => setPhase(phaseFor(e, translate.current)), []);

  const claim = useCallback(
    async (proof: unknown, s = session.current) => {
      const campaign = plans?.campaign;
      if (!s || !campaign) return;
      session.current = undefined;
      setPhase({ kind: 'checking', since: Date.now() });
      setProof(undefined);
      try {
        // the IDKit result is forwarded UNCHANGED as `proof` (A-25)
        const res = await api.claim(
          {
            proof,
            campaignId: campaign.id as Hex,
            challenge: s.challenge,
            sessionPubKey: s.spk,
          },
          s.recoveryToken,
        );
        const key = await deliver(
          res.data,
          s.challenge.nonce as Hex,
          {
            network: campaign.network,
            you: '$0.00',
            sponsor: campaign.name,
            proof: buildProof({
              response: res.data,
              status: res.status,
              network: campaign.network,
              world: true,
            }),
          },
          s.spk,
        );
        await finishRedemption(s.operation, key, res.status === 201 && !res.data.sealedLpa);
        // 201 and 202 deliver the same way: a pending profile has no LPA yet and /plan says so (T-25)
        router.push(planHref(key));
      } catch (e) {
        setProof(buildProof({ error: e, network: campaign.network, world: true }));
        // no answer is not "nothing happened": the API keeps claiming after the socket drops (RT-W-13)
        if (e instanceof ApiError && e.code === 'network') setPhase({ kind: 'unconfirmed' });
        else fail(e);
      }
    },
    [plans, router, fail],
  );

  const start = useCallback(async () => {
    const ticket = ++attempt.current;
    setPhase({ kind: 'waiting', since: Date.now() });
    try {
      let s = session.current;
      if (!s || s.challenge.exp <= Date.now()) {
        s = await prepareFreeClaim(campaignId);
        session.current = s;
      }
      if (ticket !== attempt.current) return;
      // an expired rp_context (rp_signature_expired | timestamp_too_old) is re-fetched once
      for (let retry = 0; retry < 2; retry += 1) {
        // the backend-signed rp_context, after the challenge and before IDKit opens (A-25)
        const rp = await api.rpContext('/claim');
        if (ticket !== attempt.current) return;
        if (process.env.NEXT_PUBLIC_MODE === 'local') {
          // compiled out of a live build (RT-W-12): the simulator call lives in lib/local/world-sim.ts
          const { simulatedProof } = await import('../lib/local/world-sim');
          const proof = await simulatedProof(s.challenge.signal as Hex, 'orb', simulatedSeed());
          if (ticket === attempt.current) await claim(proof, s);
          return;
        }
        const done = await openIdkit(
          s.challenge,
          rp,
          (uri) =>
            ticket === attempt.current &&
            setPhase({ kind: 'waiting', since: Date.now(), ...(uri ? { connectorURI: uri } : {}) }),
        );
        if (ticket !== attempt.current) return;
        if (done.success) return await claim(done.result, s);
        if (done.error === 'user_rejected') return setPhase({ kind: 'ready' });
        if (done.error === 'credential_unavailable') return setPhase({ kind: 'noCredential' });
        if (done.error !== 'rp_signature_expired' && done.error !== 'timestamp_too_old') break;
      }
      setPhase({ kind: 'failed' });
    } catch (e) {
      if (ticket === attempt.current) fail(e);
    }
  }, [claim, fail, campaignId]);
  useEffect(
    () => () => {
      attempt.current += 1;
    },
    [],
  );

  const mb = plans?.campaign?.bundleMb.orb ?? PLAN_MB;
  // "pay instead" sells the paid lane's one size (1 GB · $4.00), whatever the free bundle is
  const sold = soldPlan(plans);
  const price = money(sold.usd6);
  const payMb = formatMb(sold.mb);

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
          {t('verify.failed', { price, mb: payMb })}
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
    <Screen wide className="verify-screen">
      <AppHeader />
      <div className="verify-layout">
        {plans?.campaign ? (
          <div className="verify__coupon" aria-hidden="true">
            <Coupon mb={mb} sponsor={plans.campaign.name} lang={lang} />
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
                {process.env.NEXT_PUBLIC_MODE === 'local'
                  ? t('verify.simulated')
                  : t('verify.open')}
              </Button>
            ) : null}
            {phase.kind === 'waiting' && process.env.NEXT_PUBLIC_MODE !== 'local' ? (
              <Button
                variant="quiet"
                onClick={() => {
                  attempt.current += 1;
                  session.current = undefined;
                  setPhase({ kind: 'ready' });
                }}
              >
                {t('verify.cancel')}
              </Button>
            ) : null}
            {phase.kind === 'closed' ? (
              <Button variant="secondary" onClick={prepare}>
                {t('verify.retry')}
              </Button>
            ) : null}
            {phase.kind === 'unconfirmed' ? (
              <Button variant="secondary" onClick={() => void start()} disabled={!plans?.campaign}>
                {t('verify.recover')}
              </Button>
            ) : null}
            {phase.kind === 'failed' ||
            phase.kind === 'noCredential' ||
            phase.kind === 'sponsorFailed' ? (
              <Link href="/pay" className="ui-button" data-variant="secondary" prefetch={false}>
                {t('landing.payInstead', { price, mb: payMb })}
              </Link>
            ) : null}
          </div>
          {process.env.NEXT_PUBLIC_MODE === 'local' ? (
            <p className="note" lang={lang}>
              {t('verify.simulatedNote')}
            </p>
          ) : null}
          <ProofPanel proof={proof} />
          {plans ? <TierLedger plans={plans} /> : null}
        </section>
      </div>
    </Screen>
  );
}
