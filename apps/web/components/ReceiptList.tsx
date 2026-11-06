'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ReceiptPublic } from '@ethglobal/protocol/schemas';
import { Hash, Receipt } from '@ethglobal/ui/components';

import { NoPlanSteps } from './PlanView';
import { AppHeader, Screen, TabBar } from './Shell';
import { useLang, useNetworkName } from '../i18n/lang';
import { api } from '../lib/api';
import { explorerName, explorerTemplate, hcsTopicUrl } from '../lib/env';
import { clockIst, dayLabel, formatMb, money } from '../lib/format';
import { plans } from '../lib/store';

const SPONSORED = new Set(['claim', 'card-redeem']);

function lines(r: ReceiptPublic) {
  const amount = r.usd6 ? money(r.usd6) : '$0.00';
  return SPONSORED.has(r.kind) ? { you: '$0.00', sponsor: amount } : { you: amount, sponsor: '—' };
}

/** What the traveller paid that day: the "You" column only — a sponsor's cost is not the traveller's spend. */
const youPaid = (rows: readonly ReceiptPublic[]): bigint =>
  rows.reduce((sum, r) => (SPONSORED.has(r.kind) ? sum : sum + BigInt(r.usd6 ?? '0')), 0n);

function csv(receipts: readonly ReceiptPublic[]): string {
  const head = 'at,kind,mb,usd6,network,tx,hcs_topic,hcs_sequence';
  const rows = receipts.map((r) =>
    [
      new Date(r.at).toISOString(),
      r.kind,
      r.mb ?? '',
      r.usd6 ?? '',
      r.network ?? '',
      r.tx ?? '',
      r.hcs?.topic ?? '',
      r.hcs?.sequence ?? '',
    ]
      .map((v) => String(v).replace(/[",\n]/g, ' '))
      .join(','),
  );
  return [head, ...rows].join('\n');
}

/** `/receipts` — the per-day ledger of three-line receipts; rows, not cards. */
export function ReceiptList({ entitlementKey }: { entitlementKey?: string }) {
  const { t, lang } = useLang();
  const netName = useNetworkName();
  const [receipts, setReceipts] = useState<ReceiptPublic[] | undefined>();
  const [foreign, setForeign] = useState(false);
  const [noPlan, setNoPlan] = useState(false);

  useEffect(() => {
    void (async () => {
      const key = entitlementKey ?? (await plans.latest());
      setNoPlan(!key);
      if (!key) return setReceipts([]);
      setForeign(!(await plans.owns(key)));
      setReceipts(await api.receipts(key).catch(() => []));
    })();
  }, [entitlementKey]);

  const days = useMemo(() => {
    const groups = new Map<string, ReceiptPublic[]>();
    for (const r of [...(receipts ?? [])].sort((a, b) => b.at - a.at)) {
      const day = dayLabel(r.at, lang);
      groups.set(day, [...(groups.get(day) ?? []), r]);
    }
    return [...groups.entries()];
  }, [receipts, lang]);

  const download = () => {
    const blob = new Blob([csv(receipts ?? [])], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'recharge-receipts.csv';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  return (
    <Screen>
      <AppHeader />
      <h1 className="screen__title" lang={lang}>
        {t('receipts.title')}
      </h1>
      {foreign ? (
        <p className="note" role="note" data-testid="receipts-foreign">
          {t('receipts.foreign')}
        </p>
      ) : null}
      {receipts === undefined ? (
        <div className="skeleton skeleton--line" aria-hidden="true" />
      ) : receipts.length === 0 ? (
        <div className="ghost-row">
          <Receipt
            you="—"
            sponsor="—"
            networkFee="—"
            heading={<span lang={lang}>{t('receipts.empty')}</span>}
            lang={lang}
          />
        </div>
      ) : (
        days.map(([day, rows]) => {
          return (
            <section key={day} className="receipt-day">
              <h2 className="receipt-day__head">
                <span>{day}</span>
                <span className="tnum">
                  {t('receipts.dayYou', { amount: money(youPaid(rows)) })}
                </span>
              </h2>
              {rows.map((r) => {
                const template = explorerTemplate(r.network);
                const name = explorerName(r.network);
                return (
                  <article
                    key={`${r.kind}-${r.at}-${r.tx ?? ''}`}
                    className="receipt-row"
                    data-kind={r.kind}
                  >
                    <Receipt
                      heading={`${r.mb ? `+${formatMb(r.mb)}` : r.kind} · ${day} ${clockIst(r.at)} · ${netName(r.network)} · ${t('receipts.final')}`}
                      {...lines(r)}
                      networkFee="$0.00"
                      lang={lang}
                    />
                    <details className="disclosure">
                      <summary lang={lang}>{t('receipts.details')}</summary>
                      {r.tx ? (
                        <Hash
                          value={r.tx}
                          kind="transaction hash"
                          {...(template ? { explorerHref: template.replace('{hash}', r.tx) } : {})}
                          {...(name ? { explorerName: name } : {})}
                        />
                      ) : null}
                      {r.hcs ? (
                        <p className="mono-key" data-hash>
                          <a href={hcsTopicUrl(r.hcs.topic)} target="_blank" rel="noreferrer">
                            HCS {r.hcs.topic} · #{r.hcs.sequence}
                          </a>
                        </p>
                      ) : null}
                      {r.uaid ? (
                        <p className="mono-key" data-hash>
                          {r.uaid}
                        </p>
                      ) : null}
                    </details>
                  </article>
                );
              })}
            </section>
          );
        })
      )}
      {receipts && receipts.length > 0 ? (
        <button type="button" className="ui-button" data-variant="quiet" onClick={download}>
          {t('receipts.csv')}
        </button>
      ) : null}
      {noPlan ? <NoPlanSteps /> : null}
      <TabBar active="receipts" />
    </Screen>
  );
}
