'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useCallback, useEffect, useState } from 'react';
import { toBytes } from 'viem';

import { keccak256 } from '@ethglobal/crypto';
import { dayBucket, PLAN_MB, STEP_MB } from '@ethglobal/protocol/ids';
import type {
  AgentPolicyView,
  MeResponse,
  ReceiptPublic,
  TopUpPolicyWire,
} from '@ethglobal/protocol/schemas';
import { AGENT_POLICY_TYPES, canonicalJson, rechargeDomain } from '@ethglobal/protocol/typed-data';
import { priceUsd6, usd6FromWire } from '@ethglobal/protocol/units';
import { Hash } from '@ethglobal/ui/components';

import {
  ActionBar,
  Amount,
  Avatar,
  Button,
  ButtonLink,
  Card,
  ChoiceChips,
  EmptyState,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  Section,
  Sheet,
  Skeleton,
} from './kit';
import { ProofPanel } from './ProofPanel';
import { QrCode } from './QrCode';
import { useLang, useNetworkName } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { planHash, readTopUps, topUpsRequest, type AgentTopUp } from '../lib/arkiv-read';
import { planHref } from '../lib/deliver';
import { config, explorerName, explorerTemplate } from '../lib/env';
import { clockIst, dayLabel, formatMb, money, moneyUsdc, soldPlan } from '../lib/format';
import { useClock, useEnsureChain, usePlans, useWallet, WrongChainError } from '../lib/hooks';
import { buildProof, type Proof } from '../lib/proof';
import { plans as store } from '../lib/store';
import { isUserRejection } from '../lib/wallet';

/** Daily caps that buy at least one 1 GB step ($4.00): one, two or five top-ups a day. */
const CAPS_USD = [4, 8, 20];
const USD6 = 1_000_000;

function planEnded(me: MeResponse, now: number): boolean {
  return me.cancelledAt !== undefined || me.expiresAt <= now;
}

export function defaultPolicy(me: MeResponse | undefined): TopUpPolicyWire {
  return {
    maxUsd6PerDay: String(8 * USD6),
    thresholdMb: Math.max(1, Math.floor((me?.mbTotal ?? PLAN_MB) * 0.2)),
    // the one size the API sells; the agent skips a step it does not sell (`step-not-sold`)
    stepMb: PLAN_MB,
    paused: false,
    topUpOnExpiry: true,
    expiryLeadS: 1800,
  };
}

/** `/agent` — one sheet, two controls; the policy as a sentence; persisted by a signed PUT /agent/policy. */
export function AgentSheet() {
  const { t, lang } = useLang();
  const netName = useNetworkName();
  const { plans } = usePlans();
  const { wallet } = useWallet('human');
  const ensureChain = useEnsureChain();
  const { openConnectModal } = useConnectModal();
  const now = useClock();
  const [key, setKey] = useState<string | null | undefined>();
  const [me, setMe] = useState<MeResponse>();
  const [unavailable, setUnavailable] = useState<'ended' | 'missing'>();
  const [policy, setPolicy] = useState<TopUpPolicyWire | undefined>();
  const [view, setView] = useState<AgentPolicyView | undefined>();
  const [rows, setRows] = useState<ReceiptPublic[]>([]);
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'signing' | 'saving' | 'saved' | 'error'
  >('idle');
  const [message, setMessage] = useState<string | undefined>();
  const [proof, setProof] = useState<Proof>();
  const [loadError, setLoadError] = useState<ReturnType<typeof errorKey>>();
  const [loadRound, setLoadRound] = useState(0);
  const nativePaid = me?.kind === 'paid' && me.network?.startsWith('hedera:') === true;
  const eventUnavailable = me?.autoTopUpAvailable === false;
  const unavailableReason = unavailable ?? (me && planEnded(me, now) ? 'ended' : undefined);
  const busy = status === 'checking' || status === 'signing' || status === 'saving';
  // the policy belongs to the plan and is signed by one wallet; another connected wallet may read it, not change it
  const otherOwner =
    view && wallet && view.owner.toLowerCase() !== wallet.address.toLowerCase()
      ? view.owner
      : undefined;
  const locked = busy || !wallet || otherOwner !== undefined;

  const markUnavailable = useCallback((reason: 'ended' | 'missing') => {
    setUnavailable(reason);
    setPolicy(undefined);
    setView(undefined);
    setRows([]);
    setProof(undefined);
    setMessage(undefined);
    setStatus('idle');
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const k = await store.latest();
      if (!alive) return;
      setMe(undefined);
      setUnavailable(undefined);
      setPolicy(undefined);
      setView(undefined);
      setRows([]);
      setProof(undefined);
      setMessage(undefined);
      setStatus('idle');
      setLoadError(undefined);
      setKey(k ?? null);
      if (!k) return;
      const m = await api.me(k);
      if (!alive) return;
      setMe(m);
      if (planEnded(m, Date.now())) {
        markUnavailable('ended');
        return;
      }
      const unsupported = m.kind === 'paid' && m.network?.startsWith('hedera:') === true;
      if (unsupported || m.autoTopUpAvailable === false) return;
      const existing = await api.agentPolicy(k).catch((error: unknown) => {
        if (error instanceof ApiError && error.code === 'not_found') return undefined;
        throw error;
      });
      if (!alive) return;
      setView(existing);
      setPolicy(existing?.policy ?? defaultPolicy(m));
      // live reads the agent's history from Arkiv only (ArkivHistory); the API-fed list stays for the local e2e
      if (process.env.NEXT_PUBLIC_MODE === 'local') {
        const receipts = await api.receipts(k).catch(() => []);
        if (alive) setRows(receipts.filter((r) => r.kind === 'agent-topup'));
      }
    })().catch((error: unknown) => {
      if (!alive) return;
      setMe(undefined);
      setPolicy(undefined);
      setView(undefined);
      setRows([]);
      if (error instanceof ApiError && error.status === 404) markUnavailable('missing');
      else if (error instanceof ApiError && error.code === 'expired') markUnavailable('ended');
      else setLoadError(errorKey(error instanceof ApiError ? error.code : 'network'));
    });
    return () => {
      alive = false;
    };
  }, [loadRound, markUnavailable]);

  // World ID Agent Pass (docs/WORLD_AGENT_PASS.md): while the agent waits for the human, re-read the policy
  const passState = view?.pass?.state;
  useEffect(() => {
    if (
      !key ||
      passState !== 'pending' ||
      unavailableReason ||
      nativePaid ||
      eventUnavailable ||
      loadError
    )
      return;
    let alive = true;
    const id = setInterval(
      () =>
        void api
          .agentPolicy(key)
          .then((next) => {
            if (alive) setView(next);
          })
          .catch(() => undefined),
      5000,
    );
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [key, passState, unavailableReason, nativePaid, eventUnavailable, loadError]);

  const save = useCallback(
    async (next: TopUpPolicyWire) => {
      if (
        !wallet ||
        !key ||
        nativePaid ||
        eventUnavailable ||
        unavailableReason ||
        loadError ||
        busy ||
        otherOwner
      )
        return;
      setStatus('checking');
      setMessage(undefined);
      setProof(undefined);
      let checked = false;
      try {
        // /me may return a cancellation receipt even after the live entitlement has gone.
        // Recheck before opening the wallet; a stale policy must not revive an ended plan.
        const current = await api.me(key);
        setMe(current);
        if (planEnded(current, Date.now())) {
          markUnavailable('ended');
          return;
        }
        if (
          current.autoTopUpAvailable === false ||
          (current.kind === 'paid' && current.network?.startsWith('hedera:') === true)
        ) {
          setPolicy(undefined);
          setView(undefined);
          setRows([]);
          setStatus('idle');
          return;
        }
        checked = true;
        setStatus('signing');
        // the AgentPolicy is signed over the Recharge EIP-712 domain, on its chain
        const owner = await ensureChain(wallet, config.chainId);
        const issuedAt = Date.now();
        if (planEnded(current, issuedAt)) {
          markUnavailable('ended');
          return;
        }
        const policyHash = keccak256(toBytes(canonicalJson(next)));
        const signature = await owner.signTypedData({
          domain: rechargeDomain(config.chainId),
          types: AGENT_POLICY_TYPES,
          primaryType: 'AgentPolicy',
          message: {
            entitlementKey: key,
            owner: owner.address,
            policyHash,
            issuedAt: BigInt(issuedAt),
          },
        });
        setStatus('saving');
        const holder = await store.holder(key);
        const saved = await api.putAgentPolicy({
          entitlementKey: key,
          owner: owner.address,
          policy: next,
          issuedAt,
          signature,
          ...(holder && /^0x[0-9a-f]{64}$/i.test(holder) ? { sessionPubKey: holder } : {}),
        });
        setView(saved);
        setPolicy(saved.policy);
        setStatus('saved');
        setProof(
          buildProof({
            response: saved,
            network: owner.network,
            signedOn: config.chainId,
          }),
        );
      } catch (e) {
        if (e instanceof ApiError && (e.status === 404 || e.code === 'expired')) {
          markUnavailable(e.code === 'expired' ? 'ended' : 'missing');
          return;
        }
        if (!checked) {
          setPolicy(undefined);
          setView(undefined);
          setRows([]);
          setLoadError(errorKey(e instanceof ApiError ? e.code : 'network'));
          setStatus('idle');
          return;
        }
        if (!isUserRejection(e)) setProof(buildProof({ error: e, signedOn: config.chainId }));
        setStatus(isUserRejection(e) ? 'idle' : 'error');
        if (e instanceof WrongChainError)
          setMessage(t('wallet.switchNeeded', { network: e.chainName }));
        else if (!isUserRejection(e))
          setMessage(t(errorKey(e instanceof ApiError ? e.code : 'network')));
      }
    },
    [
      wallet,
      ensureChain,
      key,
      t,
      nativePaid,
      eventUnavailable,
      unavailableReason,
      loadError,
      busy,
      otherOwner,
      markUnavailable,
    ],
  );

  if (key === null || unavailableReason)
    return (
      <>
        <PageHeader title={t('agent.autoTitle')} lang={lang} />
        <Notice tone="warning" role="status" data-testid="agent-unavailable" lang={lang}>
          {t(
            key === null
              ? 'agent.noPlan'
              : unavailableReason === 'ended'
                ? 'agent.planEnded'
                : 'agent.planMissing',
          )}
        </Notice>
        {key && unavailableReason === 'ended' ? (
          <ListGroup label={t('agent.viewPlan')}>
            <ListRow title={t('agent.viewPlan')} href={planHref(key)} />
          </ListGroup>
        ) : null}
        <ActionBar>
          <ButtonLink href="/pay" block size="lg" native>
            {t('agent.buyNewPlan')}
          </ButtonLink>
        </ActionBar>
      </>
    );

  if (eventUnavailable && key)
    return (
      <>
        <PageHeader title={t('agent.autoTitle')} lang={lang} />
        <Notice tone="info" role="status" lang={lang}>
          {t('plan.eventBundleOnly')}
        </Notice>
        <ListGroup label={t('agent.viewPlan')}>
          <ListRow title={t('agent.viewPlan')} href={planHref(key)} />
        </ListGroup>
        <ActionBar>
          <ButtonLink href="/pay" block size="lg" native>
            {t('agent.buyNewPlan')}
          </ButtonLink>
        </ActionBar>
      </>
    );

  if (nativePaid && key)
    return (
      <>
        <PageHeader title={t('agent.autoTitle')} lang={lang} />
        <Notice tone="info" role="status" lang={lang}>
          {t('agent.nativeUnavailable')}
        </Notice>
        <ActionBar>
          <ButtonLink href={`/pay?key=${encodeURIComponent(key)}`} block size="lg" native>
            {t('agent.manualTopup')}
          </ButtonLink>
        </ActionBar>
      </>
    );

  const step = plans?.paid.priceUsd6PerStep ?? '400000';
  const sold = soldPlan(plans);
  const capUsd6 = policy ? BigInt(policy.maxUsd6PerDay) : 0n;
  const spent = view ? BigInt(view.spentTodayUsd6) : 0n;
  const agentNetwork =
    plans?.paid.accepts.find((a) => a.network.startsWith('hedera:'))?.network ??
    plans?.paid.accepts[0]?.network;
  // the step the policy buys, priced like the API prices it (octroi decide: priceUsd6(mb, stepMb, perStep))
  const buyMb = policy?.stepMb ?? STEP_MB;
  const sentence = !policy
    ? t('agent.loading')
    : view && policy.paused
      ? t('agent.sentencePaused')
      : t(view ? 'agent.sentence' : 'agent.sentenceDraft', {
          mb: formatMb(buyMb),
          threshold: formatMb(policy?.thresholdMb ?? Math.floor(PLAN_MB * 0.2)),
          price: money(priceUsd6(buyMb, plans?.paid.stepMb ?? STEP_MB, usd6FromWire(step))),
          network: netName(agentNetwork),
          cap: money(capUsd6),
        });
  const statusText =
    status === 'checking'
      ? t('agent.checkingPlan')
      : status === 'signing'
        ? t('agent.save')
        : status === 'saved' && view
          ? t('agent.saved', { address: `${view.owner.slice(0, 6)}…${view.owner.slice(-4)}` })
          : message;
  const pass = view?.pass && view.pass.state !== 'none' ? view.pass : undefined;
  const passUrl = pass?.verificationUriComplete ?? pass?.verificationUri;

  return (
    <>
      <PageHeader
        title={t('agent.autoTitle')}
        lead={<span data-testid="agent-sentence">{loadError ? t(loadError) : sentence}</span>}
        lang={lang}
      />
      {loadError ? (
        <Button variant="secondary" block onClick={() => setLoadRound((n) => n + 1)}>
          {t('verify.retry')}
        </Button>
      ) : null}
      {otherOwner ? (
        <Notice tone="warning" data-testid="agent-other-owner" lang={lang}>
          {t('agent.otherOwner', { address: `${otherOwner.slice(0, 6)}…${otherOwner.slice(-4)}` })}
        </Notice>
      ) : null}
      {policy ? (
        <Card lang={lang}>
          {/* $4 · $8 · $20, the "/ day" said once in the caption */}
          <ChoiceChips
            label={t('agent.capLegend')}
            showLabel
            data-testid="agent-cap"
            options={CAPS_USD.map((usd) => ({
              value: String(usd),
              label: `$${usd}`,
              disabled: locked,
            }))}
            value={CAPS_USD.find((usd) => capUsd6 === BigInt(usd * USD6))?.toString()}
            onChange={(usd) => {
              const next = {
                ...policy,
                stepMb: sold.mb,
                maxUsd6PerDay: String(Number(usd) * USD6),
              };
              if (view) void save(next);
              else setPolicy(next);
            }}
          />
          {view ? (
            <ListGroup flush label={t('agent.capLegend')}>
              <ListRow
                title={t('agent.pause')}
                trailing="switch"
                checked={policy.paused}
                disabled={locked}
                onCheckedChange={() =>
                  void save({ ...policy, stepMb: sold.mb, paused: !policy.paused })
                }
              />
            </ListGroup>
          ) : null}
        </Card>
      ) : !loadError ? (
        <Skeleton shape="card" />
      ) : null}
      {view && capUsd6 > 0n ? (
        <Section title={t('agent.spentToday')} lang={lang}>
          <Amount value={money(spent)} unit={`/ ${money(capUsd6)}`} size="title" />
        </Section>
      ) : null}
      {process.env.NEXT_PUBLIC_MODE === 'local' ? (
        <Section title={t('agent.history')} lang={lang}>
          {rows.length === 0 ? (
            <EmptyState title={t('agent.empty')} />
          ) : (
            <ListGroup label="Agent top-ups">
              {rows.map((r) => {
                const template = explorerTemplate(r.network);
                return (
                  <ListRow
                    key={`${r.tx}-${r.at}`}
                    data-testid="agent-row"
                    leading={<Avatar icon="agent" />}
                    title={r.mb ? `+${formatMb(r.mb)}` : 'agent'}
                    subtitle={`${clockIst(r.at)} · ${r.uaid ? `agent ${r.uaid.slice(0, 18)}…` : 'agent'}`}
                    {...(r.usd6 ? { value: money(r.usd6) } : {})}
                    {...(r.tx && template
                      ? { href: template.replace('{hash}', r.tx), external: true }
                      : {})}
                  />
                );
              })}
            </ListGroup>
          )}
        </Section>
      ) : null}
      {key ? <ArkivHistory planKey={key} policy={view ? policy : undefined} /> : null}
      {statusText ? (
        <Notice
          tone={status === 'error' ? 'negative' : status === 'saved' ? 'positive' : 'info'}
          role="status"
          data-testid="agent-status"
          lang={lang}
        >
          {statusText}
        </Notice>
      ) : null}
      {view && capUsd6 > 0n && spent >= capUsd6 ? (
        <Notice tone="warning" lang={lang}>
          {t('agent.capReached', {
            cap: money(capUsd6),
            mb: formatMb(sold.mb),
            price: money(sold.usd6),
          })}
        </Notice>
      ) : null}
      {pass ? (
        <Card data-testid="agent-pass" data-state={pass.state} lang={lang}>
          {pass.state === 'pending' ? (
            <>
              <Notice tone="info">{t('agent.passPending', { code: pass.userCode ?? '' })}</Notice>
              <QrCode url={passUrl ?? ''} label={t('agent.passQr')} sizeMm={40} />
              <ListGroup flush label={t('agent.passQr')}>
                <ListRow
                  title={t('agent.passOpen')}
                  value={<span data-testid="agent-pass-code">{pass.userCode}</span>}
                  mono
                  {...(passUrl ? { href: passUrl, external: true } : {})}
                />
              </ListGroup>
            </>
          ) : pass.state === 'armed' ? (
            <Notice tone="positive">
              {t('agent.passArmed', { until: clockIst(pass.passUntil ?? 0) })}
            </Notice>
          ) : pass.state === 'denied' ? (
            <Notice tone="warning">{t('agent.passDenied', { reason: pass.reason ?? '' })}</Notice>
          ) : (
            <Notice tone="warning">{t('agent.passExpired')}</Notice>
          )}
        </Card>
      ) : null}
      <Notice tone="info" lang={lang}>
        {t('agent.enrollmentNote')}
      </Notice>
      <ProofPanel proof={proof} />
      {policy && !wallet ? (
        // the one wallet control is the header's; saving without a wallet opens its modal from here
        <ActionBar>
          <Button block size="lg" disabled={!openConnectModal} onClick={openConnectModal}>
            {t('agent.connectToSave')}
          </Button>
        </ActionBar>
      ) : policy && !view ? (
        <ActionBar>
          <Button
            block
            size="lg"
            disabled={busy}
            onClick={() => void save({ ...policy, stepMb: sold.mb, paused: false })}
          >
            {t('agent.enable')}
          </Button>
        </ActionBar>
      ) : null}
    </>
  );
}

/**
 * "Spending history — read from Arkiv": this plan's agent top-ups, queried by the browser from the Arkiv node itself
 * (lib/arkiv-read.ts), on mount, when the page is shown again and every 30 s while it is visible.
 */
function ArkivHistory({
  planKey,
  policy,
}: {
  planKey: string;
  policy: TopUpPolicyWire | undefined;
}) {
  const { t, lang } = useLang();
  const netName = useNetworkName();
  const [hash, setHash] = useState<string | undefined>();
  const [history, setHistory] = useState<{ rows: AgentTopUp[]; spentToday: bigint } | undefined>();
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [selected, setSelected] = useState<string>();
  const [how, setHow] = useState(false);

  // on mount, on Retry, when the page is shown again and every 30 s while it is visible; one read at a time
  useEffect(() => {
    let alive = true;
    let busy = false;
    const load = () => {
      if (busy) return;
      busy = true;
      planHash(planKey)
        .then(async (h) => {
          if (alive) setHash(h);
          const rows = await readTopUps(h);
          // the API's daily cap counts the UTC day (T-30), so this line does too
          const today = dayBucket(Date.now());
          const spentToday = rows
            .filter((r) => dayBucket(r.at) === today)
            .reduce((sum, r) => sum + BigInt(r.usd6 ?? '0'), 0n);
          if (!alive) return;
          setHistory({ rows, spentToday });
          setFailed(false);
        })
        .catch(() => {
          if (alive) setFailed(true);
        })
        .finally(() => {
          busy = false;
        });
    };
    const again = () => {
      if (document.visibilityState === 'visible') load();
    };
    load();
    const timer = setInterval(again, 30_000);
    document.addEventListener('visibilitychange', again);
    return () => {
      alive = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', again);
    };
  }, [planKey, attempt]);

  const open = history?.rows.find((r) => r.entityKey === selected);
  const openTx = open?.tx ? explorerTemplate(open.network)?.replace('{hash}', open.tx) : undefined;
  const openTxName = explorerName(open?.network);

  return (
    <Section title={t('agent.historyTitle')} lang={lang}>
      <div data-testid="arkiv-history">
        {failed ? (
          <Notice
            tone="warning"
            role="status"
            lang={lang}
            action={
              <Button variant="quiet" onClick={() => setAttempt((n) => n + 1)}>
                {t('verify.retry')}
              </Button>
            }
          >
            {t('agent.historyError')}
          </Notice>
        ) : null}
        {!history ? (
          failed ? null : (
            <Skeleton shape="row" count={2} />
          )
        ) : history.rows.length === 0 ? (
          <EmptyState
            title={t('agent.empty')}
            {...(policy
              ? {
                  body: t('agent.historyEmpty', {
                    step: formatMb(policy.stepMb),
                    threshold: formatMb(policy.thresholdMb),
                  }),
                }
              : {})}
          />
        ) : (
          <ListGroup
            label={t('agent.historyTitle')}
            {...(policy
              ? {
                  meta: t('agent.spent', {
                    spent: money(history.spentToday),
                    cap: money(BigInt(policy.maxUsd6PerDay)),
                  }),
                }
              : {})}
          >
            {history.rows.map((r) => (
              <ListRow
                key={r.entityKey}
                data-testid="arkiv-row"
                leading={<Avatar label={netName(r.network)} />}
                title={r.mb ? `+${formatMb(r.mb)}` : t('agent.history')}
                subtitle={`${dayLabel(r.at, lang)} ${clockIst(r.at)} · ${netName(r.network)}`}
                {...(r.usd6 ? { value: moneyUsdc(r.usd6) } : {})}
                onClick={() => setSelected(r.entityKey)}
              />
            ))}
          </ListGroup>
        )}
        {hash ? (
          <ListGroup label={t('agent.historyHow')}>
            <ListRow title={t('agent.historyHow')} onClick={() => setHow(true)} />
          </ListGroup>
        ) : null}
      </div>
      <Sheet
        open={open !== undefined}
        onClose={() => setSelected(undefined)}
        title={t('receipts.details')}
      >
        {open ? (
          <ListGroup flush label={t('receipts.details')}>
            {open.tx ? (
              <ListRow
                title={t('receipts.rowTx')}
                value={
                  <Hash
                    value={open.tx}
                    kind="transaction hash"
                    {...(openTx ? { explorerHref: openTx } : {})}
                    {...(openTxName ? { explorerName: openTxName } : {})}
                  />
                }
              />
            ) : null}
            {open.uaid ? (
              <ListRow
                title={t('receipts.rowAgent')}
                value={<Hash value={open.uaid} kind="agent UAID" lang={lang} />}
              />
            ) : null}
            <ListRow
              title="Arkiv"
              value={
                <Hash
                  value={open.entityKey}
                  kind="Arkiv entity key"
                  explorerHref={`${config.arkivExplorer}/entity/${open.entityKey}`}
                  explorerName="Arkiv"
                />
              }
            />
            {open.hcs ? (
              <ListRow
                title="HCS"
                value={
                  <Hash
                    value={open.hcs.topic}
                    kind="HCS topic"
                    explorerHref={`${config.explorerHedera}/topic/${open.hcs.topic}`}
                    explorerName={`HCS #${open.hcs.sequence}`}
                  />
                }
              />
            ) : null}
          </ListGroup>
        ) : null}
      </Sheet>
      <Sheet
        open={how && hash !== undefined}
        onClose={() => setHow(false)}
        title={t('agent.historyHow')}
      >
        <Notice tone="info" lang={lang}>
          {t('agent.historyHowBody', { rpc: config.arkivRpc })}
        </Notice>
        {hash ? (
          <ListGroup flush label={t('agent.historyHow')}>
            <ListRow
              title="Arkiv query"
              mono
              lang="en"
              value={<span data-testid="arkiv-query">{JSON.stringify(topUpsRequest(hash))}</span>}
            />
          </ListGroup>
        ) : null}
      </Sheet>
    </Section>
  );
}
