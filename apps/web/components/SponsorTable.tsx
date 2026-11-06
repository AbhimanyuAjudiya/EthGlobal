'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import type { SponsorView } from '@ethglobal/protocol/schemas';
import { Button, Hash } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { CampaignAnalytics } from './CampaignAnalytics';
import { EnsCampaign } from './EnsCampaign';
import { ProofPanel } from './ProofPanel';
import { SlideToConfirm } from './SlideToConfirm';
import { SponsorTickets } from './SponsorTickets';
import { useLang } from '../i18n/lang';
import { api, ApiError } from '../lib/api';
import {
  arkivEntityUrl,
  config,
  contractUrl,
  explorerName,
  explorerTemplate,
  networkName,
} from '../lib/env';
import { clockIst, dayLabel, formatMb, money } from '../lib/format';
import { useClock, useEnsureChain, useWallet, WrongChainError } from '../lib/hooks';
import { buildProof, type Proof } from '../lib/proof';
import { pauseCall, refundCall, sponsorLogin } from '../lib/sponsor';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { caip2, isUserRejection } from '../lib/wallet';

import type { StringKey } from '../i18n/strings';

const enIN = new Intl.NumberFormat('en-IN');
const TIERS = ['orb', 'document', 'device'] as const;
const HOURS = 24;

/** One line of claims per hour, --series-1, no fill, the hourly cap as a dashed rule, axes labelled. */
function ClaimsPerHour({
  claims,
  cap,
  now,
}: {
  claims: SponsorView['claims'];
  cap: number;
  now: number;
}) {
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
    <figure
      className="chart"
      aria-label={`Claims per hour, last ${HOURS} hours; hourly cap ${cap}`}
    >
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
    [
      new Date(c.at).toISOString(),
      c.campaignClaimKey,
      c.tier,
      c.mb,
      c.usd6,
      c.tx ?? '',
      c.status,
    ].join(','),
  );
  return ['at,claim_key_hmac,tier,mb,usd6,tx,status', ...rows].join('\n');
}

/** `/sponsor/[id]` — a table that is the product: "1,214 claims" beside spend, cap and rate; Pause by slide. */
export function SponsorTable({ id }: { id: string }) {
  const { t, lang } = useLang();
  const { wallet } = useWallet('sponsor');
  const ensureChain = useEnsureChain();
  const { openConnectModal } = useConnectModal();
  const [view, setView] = useState<SponsorView | undefined>();
  const [auditKey, setAuditKey] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [login, setLogin] = useState<Awaited<ReturnType<typeof sponsorLogin>> | undefined>();
  const action = useOnchainAction();
  const now = useClock(60_000);
  const [actionTitle, setActionTitle] = useState<string | undefined>();
  const [proof, setProof] = useState<Proof>();

  const loginIdentity = useRef<string | undefined>(undefined);
  const identity = `${id}:${wallet?.address.toLowerCase() ?? ''}`;
  const load = useCallback(
    async (auth = login) => {
      if (!auth) return;
      const requestedIdentity = identity;
      try {
        const next = await api.sponsor(id, auth);
        if (loginIdentity.current !== requestedIdentity) return;
        setView(next);
        if (next.auditKey) setAuditKey(next.auditKey);
      } catch (e) {
        if (loginIdentity.current !== requestedIdentity) return;
        if (e instanceof ApiError && e.status === 401) setLogin(undefined);
        setError(e instanceof ApiError ? `${e.code}: ${e.message}` : String(e));
      }
    },
    [id, login, identity],
  );

  const signingIn = useRef<string | undefined>(undefined);
  const signIn = useCallback(async () => {
    if (!wallet || signingIn.current === identity) return;
    signingIn.current = identity;
    setError(undefined);
    const requestedIdentity = identity;
    try {
      const sponsor = await ensureChain(wallet, config.chainId);
      const auth = await sponsorLogin(sponsor, id as Hex);
      if (loginIdentity.current !== requestedIdentity) return;
      setLogin(auth);
      await load(auth);
    } catch (e) {
      if (loginIdentity.current === requestedIdentity)
        setError(
          isUserRejection(e)
            ? 'Sign in with the sponsor wallet to see this campaign.'
            : e instanceof Error
              ? e.message
              : String(e),
        );
    } finally {
      if (signingIn.current === requestedIdentity) signingIn.current = undefined;
    }
  }, [wallet, ensureChain, id, load, identity]);
  useEffect(() => {
    if (loginIdentity.current === identity) return;
    loginIdentity.current = identity;
    setLogin(undefined);
    setView(undefined);
    setError(undefined);
    void signIn();
  }, [identity, signIn]);
  useEffect(() => {
    if (!login) return;
    const timer = setTimeout(
      () => {
        setLogin(undefined);
        setError('Your sponsor sign-in expired. Sign in again to refresh this campaign.');
      },
      Math.max(1, login.issuedAt + 55 * 60_000 - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [login]);

  const runTx = useCallback(
    async (title: string, tx: { to: `0x${string}`; data: `0x${string}` }, label: StringKey) => {
      if (!wallet) return;
      setActionTitle(title);
      setProof(undefined);
      action.newRow();
      action.dispatch({ type: 'start', at: Date.now() });
      const contract = { address: tx.to, network: caip2(config.chainId) };
      try {
        // pause and refund are DataDrop calls: the sponsor wallet sends them on its chain
        const sponsor = await ensureChain(wallet, config.chainId);
        const hash = await sponsor.sendTransaction(tx);
        action.dispatch({ type: 'signed', hash, at: Date.now() });
        setProof(buildProof({ txs: [{ label, hash, network: sponsor.network }], contract }));
        await followTransaction({
          hash,
          network: sponsor.network,
          label: title,
          reader: sponsor.reader,
          dispatch: action.dispatch,
        });
        await load();
      } catch (e) {
        if (!isUserRejection(e)) setProof(buildProof({ error: e, contract }));
        action.dispatch(
          isUserRejection(e)
            ? { type: 'rejected' }
            : {
                type: 'preBroadcastError',
                reason:
                  e instanceof WrongChainError
                    ? e.message
                    : 'the wallet could not send the transaction',
              },
        );
      }
    },
    [wallet, ensureChain, action, load],
  );

  const byTier = useMemo(
    () =>
      TIERS.map((tier) => {
        const rows = view?.claims.filter((c) => c.tier === tier) ?? [];
        const mb = rows.reduce((s, c) => s + c.mb, 0);
        const cost = rows.reduce((s, c) => s + BigInt(c.usd6), 0n);
        return {
          tier,
          claims: rows.length,
          mb,
          cost,
          avg: rows.length ? Math.round(mb / rows.length) : 0,
        };
      }),
    [view],
  );

  if (!view)
    return (
      <div className="sponsor-view">
        <p className="note" role="status">
          {error ??
            (wallet
              ? 'Signing in with the sponsor wallet…'
              : 'Connect the sponsor wallet to see this campaign.')}
        </p>
        {wallet ? null : (
          <Button onClick={() => openConnectModal?.()}>Connect the sponsor wallet</Button>
        )}
        {wallet && error ? <Button onClick={() => void signIn()}>Sign in again</Button> : null}
        {error ? (
          <p className="quiet-rows">
            <Link href="/sponsor" prefetch={false}>
              Back to campaigns
            </Link>
          </p>
        ) : null}
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
  const contractHref = contractUrl(campaign.network, campaign.contract);

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
      <header className="sponsor-hero">
        <h1 className="sponsor-hero__name">
          {campaign.name}{' '}
          <span className="pill" data-state={chain.paused ? 'paused' : 'live'}>
            {expired ? t('event.closed') : chain.paused ? 'Paused' : 'Live'}
          </span>
        </h1>
        <p className="sponsor-hero__figure" data-testid="sponsor-claims">
          {enIN.format(chain.claims)} claims
        </p>
        <p className="sponsor-hero__line">
          {money(spent)} of {money(budget)} · {enIN.format(campaign.maxClaims)} cap ·{' '}
          {campaign.claimsPerHour}/h · {networkName(campaign.network)}
        </p>
        <p className="note">
          This hour: {chain.claimsThisHour} claims · ends {dayLabel(campaign.expiresAt)}
        </p>
        <p className="note">
          {'DataDrop '}
          <Hash
            value={campaign.contract}
            kind="contract address"
            {...(contractHref ? { explorerHref: contractHref } : {})}
            {...(xName ? { explorerName: xName } : {})}
          />
        </p>
      </header>
      {campaign.event ? (
        <section className="pane" lang={lang} aria-label={t('event.details')}>
          <h2 className="pane__title">{t('event.details')}</h2>
          <p>
            {campaign.event.destinationCountry} · {dayLabel(campaign.event.startsAt)} —{' '}
            {dayLabel(campaign.event.endsAt)}
          </p>
          <p className="note">
            {t('event.dashboardPackage', {
              id: campaign.planId,
              mb: formatMb(campaign.bundleMb.orb),
              days: campaign.validityDays,
            })}
          </p>
          <p className="note">{t('event.ticketNotice')}</p>
          <p className="note">
            {t(campaign.event.reclaimUnused ? 'event.reclaimTerms' : 'event.reclaimOff')}
          </p>
          {campaign.event.reclaimUnused ? (
            <p className="note">
              {t('event.reclaimScheduled', {
                date: `${dayLabel(campaign.event.reclaimAfter)} ${clockIst(campaign.event.reclaimAfter)}`,
              })}
            </p>
          ) : null}
        </section>
      ) : null}
      {auditKey ? (
        <section className="audit-key" data-testid="audit-key">
          <h2 className="pane__title">Audit key · shown once</h2>
          <Hash value={auditKey} kind="audit key" />
        </section>
      ) : null}
      <EnsCampaign campaign={campaign} />
      {campaign.event?.ticketRequired ? (
        <SponsorTickets
          key={identity}
          id={id as Hex}
          sponsor={campaign.sponsor}
          login={login}
          closed={expired || chain.paused}
        />
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
      {!login ? <Button onClick={() => void signIn()}>Sign in again</Button> : null}
      {error ? <p role="status">{error}</p> : null}
      <CampaignAnalytics id={id} login={login} />
      {view.reclaim ? (
        <section className="pane" lang={lang} aria-labelledby="reclaim-summary-title">
          <h2 id="reclaim-summary-title" className="pane__title">
            {t('event.returnsTitle')}
          </h2>
          <p className="note">{t('event.reclaimTerms')}</p>
          <dl className="offer-facts">
            <div>
              <dt>{t('event.scheduled')}</dt>
              <dd>{view.reclaim.scheduled}</dd>
            </div>
            <div>
              <dt>{t('event.pending')}</dt>
              <dd>{view.reclaim.pending}</dd>
            </div>
            <div>
              <dt>{t('event.completed')}</dt>
              <dd>{view.reclaim.completed}</dd>
            </div>
            <div>
              <dt>{t('event.ineligible')}</dt>
              <dd>{view.reclaim.ineligible}</dd>
            </div>
          </dl>
          <p>
            {t('event.refundAmounts', {
              pending: money(view.reclaim.refundPendingUsd6),
              refunded: money(view.reclaim.refundedUsd6),
            })}
          </p>
          <Button variant="quiet" disabled={!login} onClick={() => void load()}>
            {t('event.refresh')}
          </Button>
        </section>
      ) : null}
      <section className="pane" aria-labelledby="tiers-title">
        <h2 id="tiers-title" className="pane__title">
          Claims by credential level
        </h2>
        <div className="table-scroll" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Level</th>
                <th scope="col" className="num">
                  Claims
                </th>
                <th scope="col" className="num">
                  MB issued
                </th>
                <th scope="col" className="num">
                  Cost (USDC)
                </th>
                <th scope="col" className="num">
                  Avg MB
                </th>
              </tr>
            </thead>
            <tbody>
              {byTier.map((r) => (
                <tr key={r.tier}>
                  <td>
                    {r.tier === 'orb' ? 'Orb' : r.tier === 'document' ? 'Document' : 'Device'}
                  </td>
                  <td className="num">{r.claims}</td>
                  <td className="num">{enIN.format(r.mb)}</td>
                  <td className="num">{money(r.cost)}</td>
                  <td className="num">{r.avg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="pane" aria-labelledby="expiring-title">
        <h2 id="expiring-title" className="pane__title">
          Expiring quotas · {soon} plans expire in 24 h
        </h2>
        <div className="table-scroll" tabIndex={0}>
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Arkiv key</th>
                <th scope="col" className="num">
                  MB left
                </th>
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
                view.expiring.map((e) => {
                  const entity = arkivEntityUrl(e.arkivKey);
                  return (
                    <tr key={e.arkivKey}>
                      <td className="mono-key" data-hash title={e.arkivKey}>
                        {entity ? (
                          <a href={entity} target="_blank" rel="noreferrer">
                            {e.arkivKey.slice(0, 14)}…
                          </a>
                        ) : (
                          `${e.arkivKey.slice(0, 14)}…`
                        )}
                      </td>
                      <td className="num">{formatMb(e.remainingMb)}</td>
                      <td>
                        expires {dayLabel(e.expiresAt)} {clockIst(e.expiresAt)}
                      </td>
                      <td>{e.tier}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="pane" aria-labelledby="claims-title">
        <h2 id="claims-title" className="pane__title">
          Claims
        </h2>
        <div className="table-scroll">
          <table className="data-table mobile-records" data-testid="claims-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Claim key (HMAC)</th>
                <th scope="col">Tier</th>
                <th scope="col" className="num">
                  MB
                </th>
                <th scope="col" className="num">
                  Cost
                </th>
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
                    <td data-label="Time">
                      {dayLabel(c.at)} {clockIst(c.at)}
                    </td>
                    <td data-label="Claim key">
                      <Hash value={c.campaignClaimKey} kind="claim key" />
                    </td>
                    <td data-label="Level">{c.tier}</td>
                    <td className="num" data-label="Data (MB)">
                      {c.mb}
                    </td>
                    <td className="num" data-label="Cost">
                      {money(c.usd6)}
                    </td>
                    <td data-label="Transaction">
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
                    <td data-label="Status">{c.status}</td>
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
        <p className="note" lang={lang}>
          {t('event.unspentTerms')}
        </p>
        {chain.paused ? (
          <button
            type="button"
            className="ui-button"
            data-variant="secondary"
            onClick={() =>
              void runTx(
                'Resume the campaign',
                pauseCall(campaign.id as Hex, false),
                'proof.pauseTx',
              )
            }
          >
            Resume claims
          </button>
        ) : (
          <SlideToConfirm
            label="Slide to pause claims"
            releaseLabel="Release to pause"
            disabled={!wallet}
            onConfirm={() =>
              void runTx('Pause the campaign', pauseCall(campaign.id as Hex, true), 'proof.pauseTx')
            }
          />
        )}
        <button
          type="button"
          className="ui-button"
          data-variant="quiet"
          disabled={!expired}
          onClick={() =>
            void runTx(
              'Refund the unspent budget',
              refundCall(campaign.id as Hex),
              'proof.refundTx',
            )
          }
        >
          {expired
            ? `Refund ${money(budget - spent)}`
            : `Refund opens after ${dayLabel(campaign.expiresAt)}`}
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
        <ProofPanel proof={proof} />
      </section>
    </div>
  );
}
