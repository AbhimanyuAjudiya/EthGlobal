'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { toBytes } from 'viem';

import { keccak256 } from '@ethglobal/crypto';
import type {
  AgentPolicyView,
  MeResponse,
  ReceiptPublic,
  TopUpPolicyWire,
} from '@ethglobal/protocol/schemas';
import { AGENT_POLICY_TYPES, canonicalJson, rechargeDomain } from '@ethglobal/protocol/typed-data';
import { Button, Hash } from '@ethglobal/ui/components';

import { AppHeader, Screen, TabBar, WalletButton } from './Shell';
import { useLang, useNetworkName } from '../i18n/lang';
import { errorKey } from '../i18n/strings';
import { api, ApiError } from '../lib/api';
import { config, explorerTemplate } from '../lib/env';
import { clockIst, formatMb, money } from '../lib/format';
import { usePlans, useWallet } from '../lib/hooks';
import { plans as store } from '../lib/store';
import { isUserRejection } from '../lib/wallet';

const CAPS_USD = [1, 5, 10, 25];
const USD6 = 1_000_000;

export function defaultPolicy(me: MeResponse | undefined): TopUpPolicyWire {
  return {
    maxUsd6PerDay: String(10 * USD6),
    thresholdMb: Math.max(1, Math.floor((me?.mbTotal ?? 300) * 0.2)),
    stepMb: 100,
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
  const { wallet, busy, error: walletError, pickInjected } = useWallet('human');
  const [key, setKey] = useState<string | null | undefined>();
  const [policy, setPolicy] = useState<TopUpPolicyWire | undefined>();
  const [view, setView] = useState<AgentPolicyView | undefined>();
  const [rows, setRows] = useState<ReceiptPublic[]>([]);
  const [status, setStatus] = useState<'idle' | 'signing' | 'saving' | 'saved' | 'error'>('idle');
  const [message, setMessage] = useState<string | undefined>();

  useEffect(() => {
    void (async () => {
      const k = await store.latest();
      setKey(k ?? null);
      if (!k) return;
      const m = await api.me(k).catch(() => undefined);
      const existing = await api.agentPolicy(k).catch(() => undefined);
      setView(existing);
      setPolicy(existing?.policy ?? defaultPolicy(m));
      const receipts = await api.receipts(k).catch(() => []);
      setRows(receipts.filter((r) => r.kind === 'agent-topup'));
    })();
  }, []);

  const save = useCallback(
    async (next: TopUpPolicyWire) => {
      setPolicy(next);
      if (!wallet || !key) return;
      setStatus('signing');
      setMessage(undefined);
      try {
        const issuedAt = Date.now();
        const policyHash = keccak256(toBytes(canonicalJson(next)));
        const signature = await wallet.signTypedData({
          domain: rechargeDomain(config.chainId),
          types: AGENT_POLICY_TYPES,
          primaryType: 'AgentPolicy',
          message: {
            entitlementKey: key,
            owner: wallet.address,
            policyHash,
            issuedAt: BigInt(issuedAt),
          },
        });
        setStatus('saving');
        const holder = await store.holder(key);
        const saved = await api.putAgentPolicy({
          entitlementKey: key,
          owner: wallet.address,
          policy: next,
          issuedAt,
          signature,
          ...(holder && /^0x[0-9a-f]{64}$/i.test(holder) ? { sessionPubKey: holder } : {}),
        });
        setView(saved);
        setPolicy(saved.policy);
        setStatus('saved');
      } catch (e) {
        setStatus(isUserRejection(e) ? 'idle' : 'error');
        if (!isUserRejection(e))
          setMessage(t(errorKey(e instanceof ApiError ? e.code : 'network')));
      }
    },
    [wallet, key, t],
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
  const capUsd6 = policy ? BigInt(policy.maxUsd6PerDay) : 0n;
  const spent = view ? BigInt(view.spentTodayUsd6) : 0n;
  const agentNetwork =
    plans?.paid.accepts.find((a) => a.network.startsWith('hedera:'))?.network ??
    plans?.paid.accepts[0]?.network;
  const sentence = policy?.paused
    ? t('agent.sentencePaused')
    : t('agent.sentence', {
        price: money(step),
        network: netName(agentNetwork),
        cap: money(capUsd6),
      });

  return (
    <Screen money>
      <AppHeader />
      <WalletButton
        wallet={wallet}
        busy={busy}
        error={walletError}
        onInjected={() => void pickInjected()}
      />
      <section className="sheet agent" aria-labelledby="agent-title">
        <h1 id="agent-title" className="sheet__title" lang={lang}>
          {t('agent.title')}
        </h1>
        <p className="agent__sentence" data-testid="agent-sentence" lang={lang}>
          {sentence}
        </p>
        {policy ? (
          <>
            {/* one row of four equal segments: "$1 · $5 · $10 · $25", the "/ day" said once (no orphan chip) */}
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
                  onClick={() => void save({ ...policy, maxUsd6PerDay: String(usd * USD6) })}
                >
                  {`$${usd}`}
                </button>
              ))}
            </div>
            <Button
              variant="secondary"
              disabled={status === 'signing' || status === 'saving' || !wallet}
              onClick={() => void save({ ...policy, paused: !policy.paused })}
              aria-pressed={policy.paused}
            >
              {policy.paused ? t('agent.resume') : t('agent.pause')}
            </Button>
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
        {view && capUsd6 > 0n ? (
          <p className="note" lang={lang}>
            {spent >= capUsd6
              ? t('agent.capReached', { cap: money(capUsd6), price: money(step) })
              : t('agent.spent', { spent: money(spent), cap: money(capUsd6) })}
          </p>
        ) : null}
      </section>
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
      <TabBar active="add" />
    </Screen>
  );
}
