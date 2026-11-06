'use client';

import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { Hex } from '@ethglobal/protocol/ids';
import type { SponsorView } from '@ethglobal/protocol/schemas';
import { Hash } from '@ethglobal/ui/components';

import { ActionView } from './ActionView';
import { CampaignAnalytics } from './CampaignAnalytics';
import { EnsCampaign } from './EnsCampaign';
import {
  Button,
  ButtonLink,
  Card,
  EmptyState,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  Pill,
  Section,
  Skeleton,
  StatTile,
  Table,
} from './kit';
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
import {
  forgetSponsorLogin,
  pauseCall,
  refundCall,
  SPONSOR_LOGIN_REUSE_MS,
  sponsorLogin,
} from '../lib/sponsor';
import { expectedMsFor, followTransaction, useOnchainAction } from '../lib/use-onchain';
import { caip2, isUserRejection } from '../lib/wallet';

import type { StringKey } from '../i18n/strings';

const enIN = new Intl.NumberFormat('en-IN');
const TIERS = ['orb', 'document', 'device'] as const;
const HOURS = 24;

/** One line of claims per hour (brand, no fill), the hourly cap as a dashed rule, axes labelled. */
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
  const label = 'fill-ink-tertiary';
  return (
    <figure
      className="m-0 grid gap-2"
      aria-label={`Claims per hour, last ${HOURS} hours; hourly cap ${cap}`}
    >
      <svg
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-hidden="true"
        className="h-auto w-full"
        fontSize="8"
      >
        <line
          x1="32"
          x2={w - 8}
          y1={y(cap)}
          y2={y(cap)}
          className="chart__cap stroke-ink-tertiary"
          strokeDasharray="4 3"
        />
        <line x1="32" x2={w - 8} y1={h - 20} y2={h - 20} className="stroke-border-strong" />
        <line x1="32" x2="32" y1="12" y2={h - 20} className="stroke-border-strong" />
        <text x="4" y={h - 17} className={label}>
          0
        </text>
        <polyline
          points={points}
          className="chart__line fill-none stroke-brand"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <text x="4" y={y(cap) + 4} className={label}>
          {cap}/h
        </text>
        <text x="32" y={h - 4} className={label}>
          −24 h
        </text>
        <text x={w - 8} y={h - 4} textAnchor="end" className={label}>
          now
        </text>
      </svg>
      <figcaption className="note note--quiet">
        Claims per hour, last 24 h · dashed rule = hourly cap
      </figcaption>
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
  const [copied, setCopied] = useState<boolean>();

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
        if (e instanceof ApiError && e.status === 401) {
          forgetSponsorLogin(id, auth.sponsor);
          setLogin(undefined);
        }
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
      Math.max(1, login.issuedAt + SPONSOR_LOGIN_REUSE_MS - Date.now()),
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
      <>
        <PageHeader title="Campaign" />
        {error ? (
          <Notice
            tone="negative"
            action={
              <div className="flex flex-wrap gap-2">
                {wallet ? <Button onClick={() => void signIn()}>Sign in again</Button> : null}
                <ButtonLink href="/sponsor" variant="quiet">
                  Back to campaigns
                </ButtonLink>
              </div>
            }
          >
            <p role="status">{error}</p>
          </Notice>
        ) : wallet ? (
          <>
            <p className="note" role="status">
              Signing in with the sponsor wallet…
            </p>
            <Skeleton shape="card" />
          </>
        ) : (
          <Notice
            tone="info"
            action={
              <Button onClick={() => openConnectModal?.()}>Connect the sponsor wallet</Button>
            }
          >
            <p role="status">Connect the sponsor wallet to see this campaign.</p>
          </Notice>
        )}
      </>
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
  // this campaign's live plans on Arkiv: the same filter the API's sponsor reads use (ANN.type, ANN.campaignId)
  const arkivQuery = `type = "entitlement" && campaignId = "${campaign.id.toLowerCase()}"`;

  const download = () => {
    const url = URL.createObjectURL(new Blob([csv(view)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `claims-${campaign.id.slice(0, 10)}.csv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <>
      <PageHeader
        title={
          <>
            {campaign.name}{' '}
            <Pill tone={expired ? 'neutral' : chain.paused ? 'warning' : 'positive'} dot>
              {expired ? t('event.closed') : chain.paused ? 'Paused' : 'Live'}
            </Pill>
          </>
        }
        lead={
          <>
            <span data-testid="sponsor-claims">{enIN.format(chain.claims)} claims</span> ·{' '}
            {money(spent)} of {money(budget)} · {enIN.format(campaign.maxClaims)} cap ·{' '}
            {campaign.claimsPerHour}/h · {networkName(campaign.network)}
          </>
        }
      />
      {auditKey ? (
        <Notice tone="positive" data-testid="audit-key" title="Audit key · shown once">
          <Hash value={auditKey} kind="audit key" />
        </Notice>
      ) : null}
      {!login || error ? (
        <Notice
          tone="warning"
          action={!login ? <Button onClick={() => void signIn()}>Sign in again</Button> : undefined}
        >
          {error ? <p role="status">{error}</p> : <p>Sign in to refresh this campaign.</p>}
        </Notice>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Claims"
          value={enIN.format(chain.claims)}
          hint={`of ${enIN.format(campaign.maxClaims)} cap`}
        />
        <StatTile label="Spent" value={money(spent)} hint={`${spentPct} % of ${money(budget)}`} />
        <StatTile
          label="Remaining"
          value={money(budget - spent)}
          hint={`ends ${dayLabel(campaign.expiresAt)}`}
        />
        <StatTile
          label="Claims/h"
          value={enIN.format(chain.claimsThisHour)}
          hint={`this hour · cap ${campaign.claimsPerHour}/h`}
        />
      </div>
      <Card as="section" aria-label="Claims per hour">
        <ClaimsPerHour claims={view.claims} cap={campaign.claimsPerHour} now={now} />
      </Card>
      <Section title="Claims by credential level">
        <Table
          caption="Claims by credential level"
          columns={[
            { key: 'level', label: 'Level' },
            { key: 'claims', label: 'Claims', numeric: true },
            { key: 'mb', label: 'MB issued', numeric: true },
            { key: 'cost', label: 'Cost (USDC)', numeric: true },
            { key: 'avg', label: 'Avg MB', numeric: true },
          ]}
          rows={byTier.map((r) => ({
            level: r.tier === 'orb' ? 'Orb' : r.tier === 'document' ? 'Document' : 'Device',
            claims: r.claims,
            mb: enIN.format(r.mb),
            cost: money(r.cost),
            avg: r.avg,
          }))}
        />
      </Section>
      <Section title={`Expiring quotas · ${soon} plans expire in 24 h`} id="expiring-title">
        {view.expiring.length === 0 ? (
          <Card>
            <EmptyState title="No plan expires yet" body="Plans show here a day before they end." />
          </Card>
        ) : (
          <Table
            caption="Expiring quotas"
            columns={[
              { key: 'key', label: 'Arkiv key' },
              { key: 'mb', label: 'MB left', numeric: true },
              { key: 'expires', label: 'Expires' },
              { key: 'tier', label: 'Tier' },
            ]}
            rowKey={(_, i) => view.expiring[i]?.arkivKey ?? String(i)}
            rows={view.expiring.map((e) => {
              const entity = arkivEntityUrl(e.arkivKey);
              return {
                key: (
                  <span className="mono-key" data-hash title={e.arkivKey}>
                    {entity ? (
                      <a href={entity} target="_blank" rel="noreferrer">
                        {e.arkivKey.slice(0, 14)}…
                      </a>
                    ) : (
                      `${e.arkivKey.slice(0, 14)}…`
                    )}
                  </span>
                ),
                mb: formatMb(e.remainingMb),
                expires: `expires ${dayLabel(e.expiresAt)} ${clockIst(e.expiresAt)}`,
                tier: e.tier,
              };
            })}
          />
        )}
      </Section>
      <Section title="Claims" id="claims-title">
        {view.claims.length === 0 ? (
          <Card>
            <EmptyState
              title="No claims yet"
              body="Claims appear here as travellers prove they are human."
            />
          </Card>
        ) : (
          <Table
            caption="Claims"
            data-testid="claims-table"
            columns={[
              { key: 'time', label: 'Time' },
              { key: 'key', label: 'Claim key (HMAC)' },
              { key: 'tier', label: 'Tier' },
              { key: 'mb', label: 'MB', numeric: true },
              { key: 'cost', label: 'Cost', numeric: true },
              { key: 'tx', label: 'Tx' },
              { key: 'status', label: 'Status' },
            ]}
            rowKey={(_, i) => {
              const c = view.claims[i];
              return c ? `${c.campaignClaimKey}-${c.at}` : String(i);
            }}
            rows={view.claims.map((c) => ({
              time: (
                <span data-testid="claim-row">
                  {dayLabel(c.at)} {clockIst(c.at)}
                </span>
              ),
              key: <Hash value={c.campaignClaimKey} kind="claim key" />,
              tier: c.tier,
              mb: c.mb,
              cost: money(c.usd6),
              tx: c.tx ? (
                <Hash
                  value={c.tx}
                  kind="transaction hash"
                  {...(template ? { explorerHref: template.replace('{hash}', c.tx) } : {})}
                  {...(xName ? { explorerName: xName } : {})}
                />
              ) : (
                '—'
              ),
              status: c.status,
            }))}
          />
        )}
      </Section>
      <Section title="Exports" id="exports-title">
        <Card className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={download}>
              Export claims CSV (HMAC&apos;d keys)
            </Button>
            <Button
              variant="quiet"
              data-testid="arkiv-query"
              onClick={() => {
                void navigator.clipboard?.writeText(arkivQuery).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              Copy Arkiv query
            </Button>
          </div>
          <p className="note">
            <code data-hash>{arkivQuery}</code>
          </p>
          <p className="note" role="status">
            {copied === true
              ? 'Arkiv query copied.'
              : copied === false
                ? 'Copy failed: select the query above.'
                : ''}
          </p>
        </Card>
      </Section>
      <Section title="Controls" id="controls-title">
        <Card className="grid gap-4">
          <p className="note" lang={lang}>
            {t('event.unspentTerms')}
          </p>
          {chain.paused ? (
            <Button
              variant="secondary"
              onClick={() =>
                void runTx(
                  'Resume the campaign',
                  pauseCall(campaign.id as Hex, false),
                  'proof.pauseTx',
                )
              }
            >
              Resume claims
            </Button>
          ) : (
            <SlideToConfirm
              label="Slide to pause claims"
              releaseLabel="Release to pause"
              disabled={!wallet}
              onConfirm={() =>
                void runTx(
                  'Pause the campaign',
                  pauseCall(campaign.id as Hex, true),
                  'proof.pauseTx',
                )
              }
            />
          )}
          <Button
            variant="quiet"
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
          </Button>
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
        </Card>
      </Section>
      <Section title={campaign.event ? t('event.details') : 'Details'} lang={lang}>
        <ListGroup label="Campaign details">
          {campaign.event ? (
            <>
              <ListRow
                title={campaign.event.destinationCountry}
                subtitle={`${dayLabel(campaign.event.startsAt)} — ${dayLabel(campaign.event.endsAt)}`}
              />
              <ListRow
                title={t('event.dashboardPackage', {
                  id: campaign.planId,
                  mb: formatMb(campaign.bundleMb.orb),
                  days: campaign.validityDays,
                })}
                subtitle={t('event.ticketNotice')}
              />
              <ListRow
                title={t(campaign.event.reclaimUnused ? 'event.reclaimTerms' : 'event.reclaimOff')}
                {...(campaign.event.reclaimUnused
                  ? {
                      subtitle: t('event.reclaimScheduled', {
                        date: `${dayLabel(campaign.event.reclaimAfter)} ${clockIst(campaign.event.reclaimAfter)}`,
                      }),
                    }
                  : {})}
              />
            </>
          ) : null}
          <ListRow
            title="DataDrop"
            subtitle={networkName(campaign.network)}
            value={
              <Hash
                value={campaign.contract}
                kind="contract address"
                {...(contractHref ? { explorerHref: contractHref } : {})}
                {...(xName ? { explorerName: xName } : {})}
              />
            }
          />
        </ListGroup>
      </Section>
      {campaign.event?.ticketRequired ? (
        <SponsorTickets
          key={identity}
          id={id as Hex}
          sponsor={campaign.sponsor}
          login={login}
          closed={expired || chain.paused}
        />
      ) : null}
      {view.reclaim ? (
        <Section title={t('event.returnsTitle')} lang={lang}>
          <Card className="grid gap-3">
            <p className="note">{t('event.reclaimTerms')}</p>
            <ListGroup label={t('event.returnsTitle')} flush>
              <ListRow title={t('event.scheduled')} value={view.reclaim.scheduled} />
              <ListRow title={t('event.pending')} value={view.reclaim.pending} />
              <ListRow title={t('event.completed')} value={view.reclaim.completed} />
              <ListRow title={t('event.ineligible')} value={view.reclaim.ineligible} />
            </ListGroup>
            <p>
              {t('event.refundAmounts', {
                pending: money(view.reclaim.refundPendingUsd6),
                refunded: money(view.reclaim.refundedUsd6),
              })}
            </p>
            <Button variant="quiet" disabled={!login} onClick={() => void load()}>
              {t('event.refresh')}
            </Button>
          </Card>
        </Section>
      ) : null}
      <EnsCampaign campaign={campaign} />
      <CampaignAnalytics id={id} login={login} />
    </>
  );
}
