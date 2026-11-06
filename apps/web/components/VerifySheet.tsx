'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

import { PLAN_MB, type Hex } from '@ethglobal/protocol/ids';
import type { ChallengeWire, PlansResponse } from '@ethglobal/protocol/schemas';

import {
  ActionBar,
  AppShell,
  Avatar,
  Button,
  ButtonLink,
  Card,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  PageSplit,
  Pill,
  Skeleton,
  Stepper,
} from './kit';
import { ProofPanel } from './ProofPanel';
import { QrCode } from './QrCode';
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
import {
  finishRedemption,
  prepareFreeClaim,
  rememberTicketPass,
  submitTicketPass,
  rejectTicketPass,
} from '../lib/redeem';
import { plans as planStore } from '../lib/store';

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
  | { kind: 'ticketError' }
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

/** "India" for IN in the reader's language; the code itself when the runtime has no name for it. */
function regionName(code: string, lang: string): string {
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

const SEEN = new Set(['replay', 'already_claimed']);
const SPONSOR = new Set(['hourly_cap', 'budget_exhausted', 'campaign_paused', 'campaign_expired']);

/** API error → the sheet's state (design-references §1b states). */
function phaseFor(e: unknown, t: (k: ReturnType<typeof errorKey>) => string): Phase {
  const err = e instanceof ApiError ? e : new ApiError(0, 'network', String(e));
  if (SEEN.has(err.code)) return { kind: 'seen' };
  if (err.code === 'ticket_required' || err.code === 'ticket_invalid' || err.code === 'ticket_used')
    return { kind: 'ticketError' };
  if (err.code === 'payment_required') return { kind: 'noCredential' };
  if (err.code === 'invalid_proof' || err.code === 'unauthorized') return { kind: 'failed' };
  if (SPONSOR.has(err.code)) return { kind: 'sponsorFailed', why: t(errorKey(err.code)) };
  return { kind: 'closed', retryS: err.retryAfterS ?? 30, message: t(errorKey(err.code)) };
}

/** `campaignId`: claim for that campaign (from /c/<slug>, the ENS name) instead of the default one. */
export function VerifySheet({ campaignId }: { campaignId?: string } = {}) {
  const { t, lang } = useLang();
  const router = useRouter();
  const { plans: fetched } = usePlans(campaignId);
  // live GET /plans names no ticketed campaign: a valid pass gets its facts from the preview, in the same shape
  const [previewPlans, setPreviewPlans] = useState<PlansResponse>();
  const plans = fetched?.campaign || !previewPlans ? fetched : previewPlans;
  const now = useClock(1000);
  const [phase, setPhase] = useState<Phase>({ kind: 'preparing' });
  // read once on the client; the server never renders the `waiting` phase, so no hydration mismatch
  const [handheld] = useState(() => typeof window !== 'undefined' && isHandheld(window));
  const [showQr, setShowQr] = useState(false);
  const [hasTicket, setHasTicket] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
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
    session.current = undefined;
    queueMicrotask(() => {
      if (alive) setHasTicket(false);
    });
    const prepareSession = async () => {
      const fragment = new URLSearchParams(window.location.hash.slice(1));
      const pass = fragment.get('ticket');
      const id = campaignId ?? fetched?.campaign?.id;
      // a pass without a campaign cannot be kept: the sheet then says the organizer's link is needed
      if (pass && id) {
        await rememberTicketPass(id, pass);
        fragment.delete('ticket');
        const rest = fragment.toString();
        window.history.replaceState(
          window.history.state,
          '',
          `${window.location.pathname}${window.location.search}${rest ? `#${rest}` : ''}`,
        );
      }
      const next = await prepareFreeClaim(id);
      // the pass is checked, and the event it is for disclosed, before the sheet asks for World ID
      const preview =
        next.ticketPass && id
          ? await api.previewTicket(
              { campaignId: id as Hex, ticketPass: next.ticketPass, sessionPubKey: next.spk },
              next.recoveryToken,
            )
          : undefined;
      return { next, preview };
    };
    prepareSession().then(
      ({ next, preview }) => {
        if (!alive) return;
        session.current = next;
        if (preview) setPreviewPlans(preview.plans);
        setHasTicket(!!next.ticketPass);
        setPhase({ kind: 'ready' });
      },
      (e: unknown) => alive && setPhase(phaseFor(e, translate.current)),
    );
    return () => {
      alive = false;
    };
  }, [round, campaignId, fetched?.campaign?.id]);
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
        if (s.ticketPass) await submitTicketPass(s.operation, s.ticketPass);
        // the IDKit result is forwarded UNCHANGED as `proof` (A-25)
        const res = await api.claim(
          {
            proof,
            campaignId: campaign.id as Hex,
            challenge: s.challenge,
            sessionPubKey: s.spk,
            ...(s.ticketPass ? { ticketPass: s.ticketPass } : {}),
            ...(campaign.event?.reclaimUnused && acceptedTerms
              ? { eventNoticeVersion: 1 as const }
              : {}),
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
        // which event and country this plan was claimed for, so the plans list can tell two trips apart
        await planStore
          .saveMetadata(key, {
            eventId: campaign.id,
            eventName: campaign.name,
            planName: campaign.name,
            createdAt: Date.now(),
            ...(campaign.event ? { destinationCountry: campaign.event.destinationCountry } : {}),
          })
          .catch(() => undefined);
        // 201 and 202 deliver the same way: a pending profile has no LPA yet and /plan says so (T-25)
        router.push(planHref(key));
      } catch (e) {
        if (
          s.ticketPass &&
          e instanceof ApiError &&
          ['ticket_invalid', 'ticket_used', 'ticket_required'].includes(e.code)
        )
          await rejectTicketPass(s.operation, s.ticketPass);
        setProof(buildProof({ error: e, network: campaign.network, world: true }));
        // no answer is not "nothing happened": the API keeps claiming after the socket drops (RT-W-13)
        if (e instanceof ApiError && e.code === 'network') setPhase({ kind: 'unconfirmed' });
        else fail(e);
      }
    },
    [plans, router, fail, acceptedTerms],
  );

  const start = useCallback(async () => {
    const campaign = plans?.campaign;
    if (!campaign) return;
    if ((plans.mode === 'live' || campaign.event?.ticketRequired) && !hasTicket) {
      setPhase({ kind: 'ticketError' });
      return;
    }
    if (campaign.event?.reclaimUnused && !acceptedTerms) return;
    const ticket = ++attempt.current;
    setPhase({ kind: 'waiting', since: Date.now() });
    try {
      let s = session.current;
      if (!s || s.challenge.exp <= Date.now()) {
        s = await prepareFreeClaim(campaignId ?? campaign.id);
        session.current = s;
      }
      if (ticket !== attempt.current) return;
      if (s.ticketPass) {
        await api.previewTicket(
          {
            campaignId: campaign.id as Hex,
            ticketPass: s.ticketPass,
            sessionPubKey: s.spk,
            ...(campaign.event?.reclaimUnused && acceptedTerms
              ? { eventNoticeVersion: 1 as const }
              : {}),
          },
          s.recoveryToken,
        );
        if (ticket !== attempt.current) return;
      }
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
  }, [claim, fail, campaignId, plans, hasTicket, acceptedTerms]);
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

  const canStart = phase.kind === 'ready' || phase.kind === 'failed';
  const campaign = plans?.campaign;
  const ticketRequired = plans?.mode === 'live' || campaign?.event?.ticketRequired;
  const event = campaign?.event;
  // no pass on this browser: in live there is no default campaign, so nothing can be claimed from here
  const needsPass = phase.kind === 'ready' && !!ticketRequired && !hasTicket;
  const admissionReady =
    !!campaign && (!ticketRequired || hasTicket) && (!event?.reclaimUnused || acceptedTerms);
  const waitingUri = phase.kind === 'waiting' ? phase.connectorURI : undefined;

  // the states, one Notice each (design-references §1b); only the live one carries role=status
  let status: ReactNode = null;
  switch (phase.kind) {
    case 'preparing':
      status = <Skeleton shape="text" />;
      break;
    case 'waiting':
      status = (
        <Notice
          role="status"
          lang={lang}
          title={
            <>
              {t('verify.waitingTitle')} <Pill dot>{mmss(now - phase.since)}</Pill>
            </>
          }
        />
      );
      break;
    case 'checking':
      status = (
        <Notice role="status" lang={lang}>
          {t(now - phase.since >= SLOW_CLAIM_MS ? 'verify.checkingLong' : 'verify.checking', {
            elapsed: `${Math.max(1, Math.round((now - phase.since) / 1000))} s`,
          })}
        </Notice>
      );
      break;
    case 'unconfirmed':
      status = (
        <Notice
          tone="warning"
          role="status"
          data-testid="claim-unconfirmed"
          lang={lang}
          action={
            <ButtonLink href="/plan" variant="quiet">
              {t('verify.checkPlans')}
            </ButtonLink>
          }
        >
          {t('verify.unconfirmed')}
        </Notice>
      );
      break;
    case 'failed':
      status = (
        <Notice tone="negative" role="status" lang={lang}>
          {t('verify.failed', { price, mb: payMb })}
        </Notice>
      );
      break;
    case 'seen':
      status = (
        <Notice
          tone="warning"
          role="status"
          data-testid="nullifier-seen"
          lang={lang}
          action={
            <>
              <ButtonLink href="/plan" variant="quiet">
                {t('verify.openThat')}
              </ButtonLink>
              <ButtonLink href="/pay" variant="quiet">
                {t('verify.payMore')}
              </ButtonLink>
            </>
          }
        >
          {t('verify.seen')}
        </Notice>
      );
      break;
    case 'noCredential':
      status = (
        <Notice tone="warning" role="status" lang={lang}>
          {t('verify.noCredential')}
        </Notice>
      );
      break;
    case 'ticketError':
      status = (
        <Notice tone="negative" role="alert" lang={lang}>
          {t('verify.ticketError')}
        </Notice>
      );
      break;
    case 'sponsorFailed':
      status = (
        <Notice tone="warning" role="status" lang={lang}>
          {t('verify.sponsorFailed', { why: phase.why, price })}
        </Notice>
      );
      break;
    case 'closed':
      status = (
        <Notice tone="warning" role="status" lang={lang}>
          {phase.message} {t('verify.closed', { s: phase.retryS })}
        </Notice>
      );
      break;
    case 'ready':
      break;
  }

  const pay =
    phase.kind === 'failed' ||
    phase.kind === 'noCredential' ||
    phase.kind === 'sponsorFailed' ||
    needsPass;
  const starts = canStart && !needsPass;

  return (
    <AppShell back="/" layout="split">
      <Stepper
        label={t('verify.steps')}
        lang={lang}
        current={1}
        steps={[t('verify.step.prove'), t('verify.step.issue'), t('verify.step.install')]}
      />
      <PageHeader id="verify-title" title={t('verify.title')} lead={t('verify.lead')} lang={lang} />
      <PageSplit
        hero={
          <>
            {campaign ? (
              // which event this page claims for: two pass links for two countries must not look alike
              <ListGroup title={t('verify.eventFor')} data-testid="claim-event">
                <ListRow
                  lang={lang}
                  leading={<Avatar label={campaign.name} />}
                  title={campaign.name}
                  subtitle={
                    event
                      ? `${regionName(event.destinationCountry, lang)} · ${new Date(event.startsAt).toLocaleDateString(lang)} – ${new Date(event.endsAt).toLocaleDateString(lang)}`
                      : t('verify.eventBundle', { mb: formatMb(mb) })
                  }
                  value={formatMb(mb)}
                />
              </ListGroup>
            ) : null}
            {/* the IDKit request: the QR on a computer, behind "Show QR instead" on a phone (World App opens from the bar) */}
            <Card tone="band" lang={lang}>
              {waitingUri && handheld ? (
                showQr ? (
                  <QrCode url={waitingUri} sizeMm={44} label={t('verify.scan')} />
                ) : (
                  <Button variant="quiet" onClick={() => setShowQr(true)}>
                    {t('verify.showQr')}
                  </Button>
                )
              ) : waitingUri ? (
                <>
                  <QrCode url={waitingUri} sizeMm={44} label={t('verify.scan')} />
                  <ButtonLink href={waitingUri} variant="quiet" native>
                    {t('verify.open')}
                  </ButtonLink>
                </>
              ) : (
                <p className="t-caption">
                  {process.env.NEXT_PUBLIC_MODE === 'local'
                    ? t('verify.simulatedNote')
                    : t('verify.well')}
                </p>
              )}
            </Card>
            {status}
            {needsPass ? (
              <Notice
                tone="warning"
                role="status"
                data-testid="pass-needed"
                lang={lang}
                title={t('verify.passNeeded')}
              >
                {t('verify.ticketNeeded')}
              </Notice>
            ) : ticketRequired && hasTicket ? (
              <Notice lang={lang}>{t('verify.ticketExplained')}</Notice>
            ) : null}
            <ActionBar>
              {starts ? (
                <Button size="lg" block onClick={() => void start()} disabled={!admissionReady}>
                  {process.env.NEXT_PUBLIC_MODE === 'local'
                    ? t('verify.simulated')
                    : t('verify.open')}
                </Button>
              ) : null}
              {waitingUri && handheld ? (
                // World App is on this phone: one tap opens it; the poll keeps running meanwhile
                <ButtonLink href={waitingUri} size="lg" block native lang={lang}>
                  {t('verify.open')}
                </ButtonLink>
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
                <Button size="lg" block onClick={prepare}>
                  {t('verify.retry')}
                </Button>
              ) : null}
              {phase.kind === 'unconfirmed' ? (
                <Button size="lg" block onClick={() => void start()} disabled={!admissionReady}>
                  {t('verify.recover')}
                </Button>
              ) : null}
              {pay ? (
                <ButtonLink
                  href="/pay"
                  variant={starts ? 'secondary' : 'primary'}
                  size="lg"
                  block
                  lang={lang}
                >
                  {t('landing.payInstead', { price, mb: payMb })}
                </ButtonLink>
              ) : null}
            </ActionBar>
          </>
        }
      >
        {event?.reclaimUnused ? (
          <ListGroup label={t('verify.acceptTerms')}>
            <ListRow
              lang={lang}
              title={t('verify.acceptTerms')}
              subtitle={t('verify.reclaimTerms', {
                date: new Date(event.reclaimAfter).toLocaleDateString(lang),
              })}
              trailing="switch"
              checked={acceptedTerms}
              onCheckedChange={setAcceptedTerms}
              disabled={phase.kind === 'waiting' || phase.kind === 'checking'}
            />
          </ListGroup>
        ) : null}
        {plans ? <TierLedger plans={plans} /> : null}
        <Notice lang={lang}>{t('verify.footnote')}</Notice>
        {event ? <Notice lang={lang}>{t('verify.travelPreparation')}</Notice> : null}
        <Notice tone="warning" lang={lang}>
          {t('warn.thisBrowser')}
        </Notice>
        <ProofPanel proof={proof} />
      </PageSplit>
    </AppShell>
  );
}
