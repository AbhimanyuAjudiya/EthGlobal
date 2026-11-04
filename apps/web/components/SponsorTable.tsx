'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import type { SponsorView } from '@ethglobal/protocol/schemas';
import { Hash } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { DemoWalletPanel } from './Shell';
import { SlideToConfirm } from './SlideToConfirm';
import { api, ApiError } from '../lib/api';
import { explorerName, explorerTemplate, networkName } from '../lib/env';
import { clockIst, dayLabel, formatMb, money } from '../lib/format';
import { useClock, useWallet } from '../lib/hooks';
import { pauseCall, refundCall, sponsorLogin } from '../lib/sponsor';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { isUserRejection } from '../lib/wallet';


const enIN = new Intl.NumberFormat('en-IN');
const TIERS = ['orb', 'document', 'device'] as const;
const HOURS = 24;

/** One line of claims per hour, --series-1, no fill, the hourly cap as a dashed rule, axes labelled. */
function ClaimsPerHour({ claims, cap, now }: { claims: SponsorView['claims']; cap: number; now: number }) {
  const buckets = Array.from({ length: HOURS }, (_, i) => {
    const end = now - (HOURS - 1 - i) * 3_600_000;
    return claims.filter((c) => c.at > end - 3_600_000 && c.at <= end).length;
  });
  const max = Math.max(cap, ...buckets, 1);
  const w = 320;
  const h = 120;
  const x = (i: number) => 32 + (i / (HOURS - 1)) * (w - 40);
  const y = (v: number) => h - 20 - (v / max) * (h - 32);
  const points = buckets.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return (
    <figure className="chart" aria-label={`Claims per hour, last ${HOURS} hours; hourly cap ${cap}`}>
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-hidden="true">
        <line x1="32" x2={w - 8} y1={y(cap)} y2={y(cap)} className="chart__cap" />
        <line x1="32" x2={w - 8} y1={h - 20} y2={h - 20} className="chart__axis" />
        <polyline points={points} className="chart__line" />
        <text x="4" y={y(cap) + 4} className="chart__label">
          {cap}/h
        </text>
        <text x="32" y={h - 4} className="chart__label">
          −24 h
        </text>
        <text x={w - 8} y={h - 4} textAnchor="end" className="chart__label">
          now
        </text>
      </svg>
      <figcaption className="note">Claims per hour · dashed line = hourly cap</figcaption>
    </figure>
  );
}

function csv(view: SponsorView): string {
  const rows = view.claims.map((c) =>
    [new Date(c.at).toISOString(), c.campaignClaimKey, c.tier, c.mb, c.usd6, c.tx ?? '', c.status].join(','),
  );
  return ['at,claim_key_hmac,tier,mb,usd6,tx,status', ...rows].join('\n');
}

/** `/sponsor/[id]` — a table that is the product: "1,214 claims" beside spend, cap and rate; Pause by slide. */
export function SponsorTable({ id }: { id: string }) {
  const { wallet } = useWallet('sponsor');
  const [view, setView] = useState<SponsorView | undefined>();
  const [auditKey, setAuditKey] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [login, setLogin] = useState<Awaited<ReturnType<typeof sponsorLogin>> | undefined>();
  const action = useOnchainAction();
  const now = useClock(60_000);
  const [actionTitle, setActionTitle] = useState<string | undefined>();

  const load = useCallback(
    async (auth = login) => {
      if (!auth) return;
      try {
        const next = await api.sponsor(id, auth);
        setView(next);
        if (next.auditKey) setAuditKey(next.auditKey);
      } catch (e) {
        setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
      }
    },
    [id, login],
  );

  useEffect(() => {
    if (!wallet || login) return;
    sponsorLogin(wallet, id as Hex).then(
      (auth) => {
        setLogin(auth);
        void load(auth);
      },
      (e: unknown) => setError(isUserRejection(e) ? 'Sign in with the sponsor wallet to see this campaign.' : String(e)),
    );
  }, [wallet, login, id, load]);

  const runTx = useCallback(
    async (title: string, tx: { to: `0x${string}`; data: `0x${string}` }) => {
      if (!wallet) return;
      setActionTitle(title);
      action.newRow();
      action.dispatch({ type: 'start', at: Date.now() });
      try {
        const hash = await wallet.sendTransaction(tx);
        action.dispatch({ type: 'signed', hash, at: Date.now() });
        await followTransaction({ hash, network: wallet.network, label: title, reader: wallet.reader, dispatch: action.dispatch });
        await load();
      } catch (e) {
        action.dispatch(isUserRejection(e) ? { type: 'rejected' } : { type: 'preBroadcastError', reason: 'the wallet could not send the transaction' });
      }
    },
    [wallet, action, load],
  );

  const byTier = useMemo(
    () =>
      TIERS.map((tier) => {
        const rows = view?.claims.filter((c) => c.tier === tier) ?? [];
        const mb = rows.reduce((s, c) => s + c.mb, 0);
        const cost = rows.reduce((s, c) => s + BigInt(c.usd6), 0n);
        return { tier, claims: rows.length, mb, cost, avg: rows.length ? Math.round(mb / rows.length) : 0 };
      }),
    [view],
  );

  if (!view)
    return (
      <div className="sponsor-view">
        <DemoWalletPanel wallet={wallet} />
        <p className="note" role="status">
          {error ?? 'Signing in with the sponsor wallet…'}
        </p>
      </div>
    );

  const { campaign, chain } = view;
  const budget = BigInt(chain.budgetUsd6);
  const spent = BigInt(chain.spentUsd6);
  const spentPct = budget > 0n ? Number((spent * 10_000n) / budget) / 100 : 0;
  const expired = campaign.expiresAt <= now;
  const soon = view.expiring.filter((e) => e.expiresAt - now <= 86_400_000).length;
  const template = explorerTemplate(campaign.network);
  const xName = explorerName(campaign.network);

  const download = () => {
    const url = URL.createObjectURL(new Blob([csv(view)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `claims-${campaign.id.slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <div className="sponsor-view">
      <DemoWalletPanel wallet={wallet} />
      <header className="sponsor-hero">
        <h1 className="sponsor-hero__name">
          {campaign.name} <span className="pill" data-state={chain.paused ? 'paused' : 'live'}>{chain.paused ? 'Paused' : 'Live'}</span>
        </h1>
        <p className="sponsor-hero__figure" data-testid="sponsor-claims">
          {enIN.format(chain.claims)} claims
        </p>
        <p className="sponsor-hero__line">
          {money(spent)} of {money(budget)} · {enIN.format(campaign.maxClaims)} cap · {campaign.claimsPerHour}/h ·{' '}
          {networkName(campaign.network)}
        </p>
        <p className="note">This hour: {chain.claimsThisHour} claims · ends {dayLabel(campaign.expiresAt)}</p>
      </header>
      {auditKey ? (
        <section className="audit-key" data-testid="audit-key">
          <h2 className="pane__title">Audit key · shown once</h2>
          <Hash value={auditKey} kind="audit key" />
        </section>
      ) : null}
      <section className="pane" aria-label="Budget">
        <div className="budget-bar" role="img" aria-label={`Spent ${spentPct} % of the budget`}>
          <span className="budget-bar__spent" style={{ transform: `scaleX(${spentPct / 100})` }} />
        </div>
        <p className="budget-legend">
          <span>Spent {money(spent)}</span>
          <span>Remaining {money(budget - spent)}</span>
        </p>
        <ClaimsPerHour claims={view.claims} cap={campaign.claimsPerHour} now={now} />
      </section>
      <section className="pane" aria-labelledby="tiers-title">
        <h2 id="tiers-title" className="pane__title">
          Claims by credential level
        </h2>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Level</th>
              <th scope="col" className="num">Claims</th>
              <th scope="col" className="num">MB issued</th>
              <th scope="col" className="num">Cost (USDC)</th>
              <th scope="col" className="num">Avg MB</th>
            </tr>
          </thead>
          <tbody>
            {byTier.map((r) => (
              <tr key={r.tier}>
                <td>{r.tier === 'orb' ? 'Orb' : r.tier === 'document' ? 'Document' : 'Device'}</td>
                <td className="num">{r.claims}</td>
                <td className="num">{enIN.format(r.mb)}</td>
                <td className="num">{money(r.cost)}</td>
                <td className="num">{r.avg}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="pane" aria-labelledby="expiring-title">
        <h2 id="expiring-title" className="pane__title">
          Expiring quotas · {soon} plans expire in 24 h
        </h2>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Arkiv key</th>
              <th scope="col" className="num">MB left</th>
              <th scope="col">Expires</th>
              <th scope="col">Tier</th>
            </tr>
          </thead>
          <tbody>
            {view.expiring.length === 0 ? (
              <tr className="ghost">
                <td colSpan={4}>No plan expires yet.</td>
              </tr>
            ) : (
              view.expiring.map((e) => (
                <tr key={e.arkivKey}>
                  <td className="mono-key" data-hash title={e.arkivKey}>
                    {e.arkivKey.slice(0, 14)}…
                  </td>
                  <td className="num">{formatMb(e.remainingMb)}</td>
                  <td>
                    expires {dayLabel(e.expiresAt)} {clockIst(e.expiresAt)}
                  </td>
                  <td>{e.tier}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
      <section className="pane" aria-labelledby="claims-title">
        <h2 id="claims-title" className="pane__title">
          Claims
        </h2>
        <div className="table-scroll">
          <table className="data-table" data-testid="claims-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Claim key (HMAC)</th>
                <th scope="col">Tier</th>
                <th scope="col" className="num">MB</th>
                <th scope="col" className="num">Cost</th>
                <th scope="col">Tx</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {view.claims.length === 0 ? (
                <tr className="ghost">
                  <td colSpan={7}>Claims appear here as travellers prove they are human.</td>
                </tr>
              ) : (
                view.claims.map((c) => (
                  <tr key={`${c.campaignClaimKey}-${c.at}`} data-testid="claim-row">
                    <td>
                      {dayLabel(c.at)} {clockIst(c.at)}
                    </td>
                    <td>
                      <Hash value={c.campaignClaimKey} kind="claim key" />
                    </td>
                    <td>{c.tier}</td>
                    <td className="num">{c.mb}</td>
                    <td className="num">{money(c.usd6)}</td>
                    <td>
                      {c.tx ? (
                        <Hash
                          value={c.tx}
                          kind="transaction hash"
                          {...(template ? { explorerHref: template.replace('{hash}', c.tx) } : {})}
                          {...(xName ? { explorerName: xName } : {})}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{c.status}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="row-actions">
          <button type="button" className="ui-button" data-variant="secondary" onClick={download}>
            Export claims CSV (HMAC&apos;d keys)
          </button>
        </div>
      </section>
      <section className="pane" aria-labelledby="controls-title">
        <h2 id="controls-title" className="pane__title">
          Controls
        </h2>
        {chain.paused ? (
          <button
            type="button"
            className="ui-button"
            data-variant="secondary"
            onClick={() => void runTx('Resume the campaign', pauseCall(campaign.id as Hex, false))}
          >
            Resume claims
          </button>
        ) : (
          <SlideToConfirm
            label="Slide to pause claims"
            disabled={!wallet}
            onConfirm={() => void runTx('Pause the campaign', pauseCall(campaign.id as Hex, true))}
          />
        )}
        <button
          type="button"
          className="ui-button"
          data-variant="quiet"
          disabled={!expired}
          onClick={() => void runTx('Refund the unspent budget', refundCall(campaign.id as Hex))}
        >
          {expired ? `Refund ${money(budget - spent)}` : `Refund opens after ${dayLabel(campaign.expiresAt)}`}
        </button>
        {actionTitle ? (
          <ActionView
            row={action.row}
            now={action.now}
            title={actionTitle}
            network={campaign.network}
            networkLabel={networkName(campaign.network)}
            actionLabel={actionTitle}
            walletName={wallet?.name ?? 'your wallet'}
            result={chain.paused ? 'Campaign paused · no new claims' : 'Done'}
            expectedMs={expectedMsFor(campaign.network)}
          />
        ) : null}
      </section>
    </div>
  );
}
