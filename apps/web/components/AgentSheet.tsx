'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
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
import { Button, Hash } from '@ethglobal/ui/components';

import { ProofPanel } from './ProofPanel';
import { QrCode } from './QrCode';
import { AppHeader, Screen, TabBar } from './Shell';
import { useLang, useNetworkName } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { planHash, readTopUps, topUpsRequest, type AgentTopUp } from '../lib/arkiv-read';
import { config, explorerName, explorerTemplate } from '../lib/env';
import { clockIst, dayLabel, formatMb, money, moneyUsdc, soldPlan } from '../lib/format';
import { useEnsureChain, usePlans, useWallet, WrongChainError } from '../lib/hooks';
import { buildProof, type Proof } from '../lib/proof';
import { plans as store } from '../lib/store';
import { isUserRejection } from '../lib/wallet';

/** Daily caps that buy at least one 1 GB step ($4.00): one, two or five top-ups a day. */
const CAPS_USD = [4, 8, 20];
const USD6 = 1_000_000;

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
  const [key, setKey] = useState<string | null | undefined>();
  const [policy, setPolicy] = useState<TopUpPolicyWire | undefined>();
  const [view, setView] = useState<AgentPolicyView | undefined>();
  const [rows, setRows] = useState<ReceiptPublic[]>([]);
  const [status, setStatus] = useState<'idle' | 'signing' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | undefined>();
  const [proof, setProof] = useState<Proof>();
  const [loadError, setLoadError] = useState<ReturnType<typeof errorKey>>();
  const [loadRound, setLoadRound] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const k = await store.latest();
      if (!alive) return;
      setLoadError(undefined);
      setKey(k ?? null);
      if (!k) return;
      const m = await api.me(k).catch(() => undefined);
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
      if (alive) setLoadError(errorKey(error instanceof ApiError ? error.code : 'network'));
    });
    return () => {
      alive = false;
    };
  }, [loadRound]);

  // World ID Agent Pass (docs/WORLD_AGENT_PASS.md): while the agent waits for the human, re-read the policy
  const passState = view?.pass?.state;
  useEffect(() => {
    if (!key || passState !== 'pending') return;
    const id = setInterval(
      () =>
        void api
          .agentPolicy(key)
          .then(setView)
          .catch(() => undefined),
      5000,
    );
    return () => clearInterval(id);
  }, [key, passState]);

  const save = useCallback(
    async (next: TopUpPolicyWire) => {
      if (!wallet || !key) return;
      setStatus('signing');
      setMessage(undefined);
      setProof(undefined);
      try {
        // the AgentPolicy is signed over the Recharge EIP-712 domain, on its chain
        const owner = await ensureChain(wallet, config.chainId);
        const issuedAt = Date.now();
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
        if (!isUserRejection(e)) setProof(buildProof({ error: e, signedOn: config.chainId }));
        setStatus(isUserRejection(e) ? 'idle' : 'error');
        if (e instanceof WrongChainError)
          setMessage(t('wallet.switchNeeded', { network: e.chainName }));
        else if (!isUserRejection(e))
          setMessage(t(errorKey(e instanceof ApiError ? e.code : 'network')));
      }
    },
    [wallet, ensureChain, key, t],
  );

  if (key === null)
    return (
      <Screen>
        <AppHeader />
        <p className="note" role="status" lang={lang}>
          {t('agent.noPlan')}
        </p>
      </Screen>
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

  return (
    <Screen money wide className="agent-screen">
      <AppHeader />
      <div className="agent-layout">
        <section className="sheet agent" aria-labelledby="agent-title">
          <h1 id="agent-title" className="sheet__title" lang={lang}>
            {t('agent.title')}
          </h1>
          <p className="agent__sentence" data-testid="agent-sentence" lang={lang}>
            {loadError ? t(loadError) : sentence}
          </p>
          <p className="note" lang={lang}>
            {t('agent.enrollmentNote')}
          </p>
          {loadError ? (
            <Button variant="secondary" onClick={() => setLoadRound((n) => n + 1)}>
              {t('verify.retry')}
            </Button>
          ) : null}
          {policy ? (
            <>
              {/* one row of three equal segments: "$4 · $8 · $20", the "/ day" said once (no orphan chip) */}
              <p className="segmented__legend" id="agent-cap-legend">
                {t('agent.capLegend')}
              </p>
              <div
                className="segmented segmented--even"
                role="radiogroup"
                aria-labelledby="agent-cap-legend"
                data-testid="agent-cap"
                style={{ '--segments': CAPS_USD.length } as CSSProperties}
              >
                {CAPS_USD.map((usd) => (
                  <button
                    key={usd}
                    type="button"
                    role="radio"
                    aria-label={t('agent.capAria', { cap: `$${usd}` })}
                    aria-checked={capUsd6 === BigInt(usd * USD6)}
                    disabled={status === 'signing' || status === 'saving' || !wallet}
                    onClick={() => {
                      const next = {
                        ...policy,
                        stepMb: sold.mb,
                        maxUsd6PerDay: String(usd * USD6),
                      };
                      if (view) void save(next);
                      else setPolicy(next);
                    }}
                  >
                    {`$${usd}`}
                  </button>
                ))}
              </div>
              {/* the one wallet control is the header's; saving without a wallet opens its modal from here */}
              {wallet ? (
                <Button
                  variant="secondary"
                  disabled={status === 'signing' || status === 'saving'}
                  onClick={() =>
                    void save({ ...policy, stepMb: sold.mb, paused: view ? !policy.paused : false })
                  }
                  {...(view ? { 'aria-pressed': policy.paused } : {})}
                >
                  {!view ? t('agent.enable') : policy.paused ? t('agent.resume') : t('agent.pause')}
                </Button>
              ) : (
                <Button variant="secondary" disabled={!openConnectModal} onClick={openConnectModal}>
                  {t('agent.connectToSave')}
                </Button>
              )}
            </>
          ) : (
            <div className="skeleton skeleton--line" aria-hidden="true" />
          )}
          <p className="note" role="status" data-testid="agent-status" lang={lang}>
            {status === 'signing'
              ? t('agent.save')
              : status === 'saved' && view
                ? t('agent.saved', { address: `${view.owner.slice(0, 6)}…${view.owner.slice(-4)}` })
                : (message ?? ' ')}
          </p>
          <ProofPanel proof={proof} />
          {view && capUsd6 > 0n ? (
            <p className="note" lang={lang}>
              {spent >= capUsd6
                ? t('agent.capReached', {
                    cap: money(capUsd6),
                    mb: formatMb(sold.mb),
                    price: money(sold.usd6),
                  })
                : t('agent.spent', { spent: money(spent), cap: money(capUsd6) })}
            </p>
          ) : null}
          {view?.pass && view.pass.state !== 'none' ? (
            <div
              className="agent__pass"
              data-testid="agent-pass"
              data-state={view.pass.state}
              lang={lang}
            >
              {view.pass.state === 'pending' ? (
                <>
                  <p className="note">
                    {t('agent.passPending', { code: view.pass.userCode ?? '' })}
                  </p>
                  <QrCode
                    url={view.pass.verificationUriComplete ?? view.pass.verificationUri ?? ''}
                    label={t('agent.passQr')}
                    sizeMm={40}
                  />
                  <p className="mono-key" data-testid="agent-pass-code">
                    {view.pass.userCode}
                  </p>
                  <a
                    className="note"
                    href={view.pass.verificationUriComplete ?? view.pass.verificationUri}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t('agent.passOpen')}
                  </a>
                </>
              ) : view.pass.state === 'armed' ? (
                <p className="note">
                  {t('agent.passArmed', { until: clockIst(view.pass.passUntil ?? 0) })}
                </p>
              ) : view.pass.state === 'denied' ? (
                <p className="note">{t('agent.passDenied', { reason: view.pass.reason ?? '' })}</p>
              ) : (
                <p className="note">{t('agent.passExpired')}</p>
              )}
            </div>
          ) : null}
        </section>
        <div className="agent-history">
          {process.env.NEXT_PUBLIC_MODE === 'local' ? (
            <section className="agent__rows" aria-label="Agent top-ups">
              {rows.length === 0 ? (
                <p className="ghost-row" lang={lang}>
                  {t('agent.empty')}
                </p>
              ) : (
                <ul className="ledger-rows">
                  {rows.map((r) => {
                    const template = explorerTemplate(r.network);
                    return (
                      <li key={`${r.tx}-${r.at}`} data-testid="agent-row">
                        <span>{clockIst(r.at)}</span>
                        <span>{r.mb ? `+${formatMb(r.mb)}` : ''}</span>
                        <span>{r.usd6 ? money(r.usd6) : ''}</span>
                        <span className="mono-key" data-hash title={r.uaid}>
                          {r.uaid ? `agent ${r.uaid.slice(0, 18)}…` : 'agent'}
                        </span>
                        {r.tx ? (
                          <Hash
                            value={r.tx}
                            kind="transaction hash"
                            {...(template
                              ? {
                                  explorerHref: template.replace('{hash}', r.tx),
                                  explorerName: 'HashScan',
                                }
                              : {})}
                          />
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ) : null}
          {key ? <ArkivHistory planKey={key} policy={view ? policy : undefined} /> : null}
        </div>
      </div>
      {/* the agent is its own screen, not the Add-data tab (RT design review: wrong active tab) */}
      <TabBar />
    </Screen>
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

  return (
    <section className="sheet" aria-labelledby="arkiv-history-title" data-testid="arkiv-history">
      <h2 id="arkiv-history-title" className="sheet__kicker" lang={lang}>
        {t('agent.historyTitle')}
      </h2>
      {history && policy ? (
        <p className="note" lang={lang}>
          {t('agent.spent', {
            spent: money(history.spentToday),
            cap: money(BigInt(policy.maxUsd6PerDay)),
          })}
        </p>
      ) : null}
      {failed ? (
        <div className="row-actions" style={{ alignItems: 'center' }}>
          <p className="note" role="status" lang={lang}>
            {t('agent.historyError')}
          </p>
          <Button variant="quiet" onClick={() => setAttempt((n) => n + 1)}>
            {t('verify.retry')}
          </Button>
        </div>
      ) : null}
      {!history ? (
        failed ? null : (
          <div className="skeleton skeleton--line" aria-hidden="true" />
        )
      ) : history.rows.length === 0 ? (
        <p className="ghost-row" lang={lang}>
          {policy
            ? t('agent.historyEmpty', {
                step: formatMb(policy.stepMb),
                threshold: formatMb(policy.thresholdMb),
              })
            : t('agent.empty')}
        </p>
      ) : (
        <ul className="ledger-rows">
          {history.rows.map((r) => {
            const template = explorerTemplate(r.network);
            const name = explorerName(r.network);
            return (
              <li key={r.entityKey} data-testid="arkiv-row">
                <span>{`${dayLabel(r.at, lang)} ${clockIst(r.at)}`}</span>
                {r.mb ? <span>{`+${formatMb(r.mb)}`}</span> : null}
                {r.usd6 ? <span>{moneyUsdc(r.usd6)}</span> : null}
                <span>{netName(r.network)}</span>
                {r.uaid ? <Hash value={r.uaid} kind="agent UAID" lang={lang} /> : null}
                {r.tx ? (
                  <Hash
                    value={r.tx}
                    kind="transaction hash"
                    {...(template ? { explorerHref: template.replace('{hash}', r.tx) } : {})}
                    {...(name ? { explorerName: name } : {})}
                  />
                ) : null}
                <Hash
                  value={r.entityKey}
                  kind="Arkiv entity key"
                  explorerHref={`${config.arkivExplorer}/entity/${r.entityKey}`}
                  explorerName="Arkiv"
                />
                {r.hcs ? (
                  <Hash
                    value={r.hcs.topic}
                    kind="HCS topic"
                    explorerHref={`${config.explorerHedera}/topic/${r.hcs.topic}`}
                    explorerName={`HCS #${r.hcs.sequence}`}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {hash ? (
        <details className="disclosure">
          <summary lang={lang}>{t('agent.historyHow')}</summary>
          <p lang={lang}>{t('agent.historyHowBody', { rpc: config.arkivRpc })}</p>
          <pre className="mono-key" lang="en" data-testid="arkiv-query">
            {JSON.stringify(topUpsRequest(hash))}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
