'use client';

import { useEffect, useMemo, useState } from 'react';

import type { ReceiptPublic } from '@ethglobal/protocol/schemas';
import { Hash, Receipt } from '@ethglobal/ui/components';

import {
  Avatar,
  Button,
  ButtonLink,
  EmptyState,
  ListGroup,
  ListRow,
  Notice,
  PageHeader,
  Pill,
  Sheet,
  Skeleton,
} from './kit';
import { PendingTransactions } from './PendingTransactions';
import { useLang, useNetworkName } from '../i18n/lang';
import { api } from '../lib/api';
import { explorerName, explorerTemplate, hcsTopicUrl } from '../lib/env';
import { clockIst, dayLabel, formatMb, money } from '../lib/format';
import { plans } from '../lib/store';

const SPONSORED = new Set(['claim', 'card-redeem', 'campaign-reclaim']);
/** Money back to the traveller (POST /plan/cancel): a credit row, never spend. */
const REFUND = 'plan-cancel';

function lines(r: ReceiptPublic) {
  const amount = r.usd6 ? money(r.usd6) : '$0.00';
  if (r.kind === 'campaign-reclaim') return { you: '$0.00', sponsor: r.tx ? `−${amount}` : '—' };
  if (r.kind === REFUND) return { you: `−${amount}`, sponsor: '—' };
  return SPONSORED.has(r.kind) ? { you: '$0.00', sponsor: amount } : { you: amount, sponsor: '—' };
}

/** What the traveller paid that day: the "You" column only — a sponsor's cost is not the traveller's spend. */
const youPaid = (rows: readonly ReceiptPublic[]): bigint =>
  rows.reduce(
    (sum, r) => (SPONSORED.has(r.kind) || r.kind === REFUND ? sum : sum + BigInt(r.usd6 ?? '0')),
    0n,
  );

const rowKey = (r: ReceiptPublic) => `${r.kind}-${r.at}-${r.tx ?? ''}`;

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

/** `/receipts` — one ListGroup per day; a row opens its three-line receipt and proof rows in a Sheet. */
export function ReceiptList({ entitlementKey }: { entitlementKey?: string }) {
  const { t, lang } = useLang();
  const netName = useNetworkName();
  const [receipts, setReceipts] = useState<ReceiptPublic[] | undefined>();
  const [foreign, setForeign] = useState(false);
  const [noPlan, setNoPlan] = useState(false);
  const [opened, setOpened] = useState<string>();

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

  const what = (r: ReceiptPublic) =>
    r.kind === 'campaign-reclaim'
      ? t('receipts.sponsorRefund')
      : r.kind === REFUND
        ? t('receipts.refund')
        : r.mb
          ? `+${formatMb(r.mb)}`
          : r.kind;
  const isPending = (r: ReceiptPublic) =>
    (r.kind === REFUND || r.kind === 'campaign-reclaim') && !r.tx;
  const subtitle = (r: ReceiptPublic) =>
    `${dayLabel(r.at, lang)} ${clockIst(r.at)} · ${netName(r.network)} · ${t(isPending(r) ? 'receipts.pending' : 'receipts.final')}`;
  const open = receipts?.find((r) => rowKey(r) === opened);
  const openTx = open?.tx ? explorerTemplate(open.network)?.replace('{hash}', open.tx) : undefined;
  const openTxName = explorerName(open?.network);

  return (
    <>
      <PageHeader
        title={t('receipts.title')}
        lead={t('receipts.intro')}
        lang={lang}
        {...(receipts && receipts.length > 0
          ? {
              action: (
                <Button variant="quiet" onClick={download}>
                  {t('receipts.csv')}
                </Button>
              ),
            }
          : {})}
      />
      <PendingTransactions />
      {foreign ? (
        <Notice tone="warning" role="note" data-testid="receipts-foreign" lang={lang}>
          {t('receipts.foreign')}
        </Notice>
      ) : null}
      {receipts === undefined ? (
        <Skeleton shape="row" count={3} />
      ) : receipts.length === 0 ? (
        <EmptyState
          title={t('receipts.empty')}
          {...(noPlan
            ? {
                action: (
                  <ButtonLink href="/" block>
                    {t('hub.get')}
                  </ButtonLink>
                ),
              }
            : {})}
        />
      ) : (
        days.map(([day, rows]) => (
          <ListGroup
            key={day}
            title={day}
            meta={t('receipts.dayYou', { amount: money(youPaid(rows)) })}
          >
            {rows.map((r) => {
              const pending = isPending(r);
              const sponsored = SPONSORED.has(r.kind);
              return (
                <ListRow
                  key={rowKey(r)}
                  data-testid="receipt-row"
                  leading={
                    <Avatar label={netName(r.network)} tone={pending ? 'warning' : 'brand-pale'} />
                  }
                  title={what(r)}
                  subtitle={subtitle(r)}
                  value={r.usd6 ? money(r.usd6) : '$0.00'}
                  valueTone={sponsored ? 'muted' : r.kind === REFUND ? 'positive' : 'default'}
                  {...(pending
                    ? { trailing: <Pill tone="warning">{t('receipts.pending')}</Pill> }
                    : {})}
                  onClick={() => setOpened(rowKey(r))}
                />
              );
            })}
          </ListGroup>
        ))
      )}
      <Sheet
        open={open !== undefined}
        onClose={() => setOpened(undefined)}
        title={t('receipts.details')}
        lang={lang}
      >
        {open ? (
          <>
            <Receipt
              heading={`${what(open)} · ${subtitle(open)}`}
              {...lines(open)}
              networkFee="$0.00"
              lang={lang}
            />
            {open.tx || open.hcs || open.uaid ? (
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
                {open.hcs ? (
                  <ListRow
                    title="HCS"
                    value={`${open.hcs.topic} · #${open.hcs.sequence}`}
                    mono
                    href={hcsTopicUrl(open.hcs.topic)}
                    external
                  />
                ) : null}
                {open.uaid ? (
                  <ListRow
                    title={t('receipts.rowAgent')}
                    value={<Hash value={open.uaid} kind="agent UAID" lang={lang} />}
                  />
                ) : null}
              </ListGroup>
            ) : null}
          </>
        ) : null}
      </Sheet>
    </>
  );
}
