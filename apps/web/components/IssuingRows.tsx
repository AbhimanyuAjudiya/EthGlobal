'use client';

import { useEffect, useState, type ReactNode } from 'react';

import type { ReceiptRef } from '@ethglobal/protocol/schemas';
import { Hash, usePrefersReducedMotion } from '@ethglobal/ui/components';

import { Avatar, ListGroup, ListRow } from './kit';
import { useLang } from '../i18n/lang';
import { arkivEntityUrl, explorerName, explorerTemplate, hcsTopicUrl } from '../lib/env';

type HcsRef = NonNullable<ReceiptRef['hcs']>;

export interface IssuingFacts {
  /** The first row of a World ID claim ("Verified · Orb"); a paid, gift or card plan has none. */
  verified?: string;
  /** Sponsor's DataDrop.claim tx (free lane, card) or the settlement tx (paid lane). */
  tx?: string;
  network?: string;
  paidBySponsor: boolean;
  /** Present once the entity has been read back from the ledger. */
  arkivKey?: string;
  /** The issue's HCS receipt, when the API logged one. */
  hcs?: HcsRef;
}

/** The entity key, copyable; a live entity key (0x + 64 hex) links to its Arkiv explorer page. */
function ArkivKey({ value }: { value: string }) {
  const { lang } = useLang();
  const url = arkivEntityUrl(value);
  return (
    <Hash
      value={value}
      kind="Arkiv entity key"
      {...(url ? { explorerHref: url, explorerName: 'Arkiv' } : {})}
      lang={lang}
    />
  );
}

/** "Receipt on Hedera 0.0.x ↗ HashScan · #7": the HCS topic page, the message's sequence beside it. */
function HcsRow({ hcs }: { hcs: HcsRef }) {
  const { t, lang } = useLang();
  return (
    <ListRow
      leading={<Avatar icon="check" tone="positive" size={32} />}
      title={t('issuing.hcs')}
      value={
        <Hash
          value={hcs.topic}
          kind="HCS topic"
          explorerHref={hcsTopicUrl(hcs.topic)}
          explorerName={`HashScan · #${hcs.sequence}`}
          lang={lang}
        />
      }
      lang={lang}
      data-testid="issuing-hcs"
    />
  );
}

/** A fact's leading dot: a check once it has arrived, a quiet circle before. */
const Done = ({ done }: { done: boolean }) => (
  <Avatar icon={done ? 'check' : 'info'} tone={done ? 'positive' : 'neutral'} size={32} />
);

/**
 * "Verified · Orb" · "Sponsor paid 0x1a2b…9f3e ↗" · "Plan written to Arkiv 0x7f3a…ab12 ↗" · "Receipt on Hedera ↗":
 * each row is a fact this device kept from the issue, with its explorer link, turning on as it arrives. No spinner.
 */
export function IssuingRows({ facts, title }: { facts: IssuingFacts; title?: ReactNode }) {
  const { t, lang } = useLang();
  const template = explorerTemplate(facts.network);
  const name = explorerName(facts.network);
  return (
    <ListGroup title={title ?? t('plan.issuingTitle')} data-testid="issuing-rows">
      {facts.verified ? (
        <ListRow
          leading={<Done done />}
          title={facts.verified}
          lang={lang}
          data-testid="issuing-verified"
        />
      ) : null}
      {facts.tx ? (
        <ListRow
          leading={<Done done />}
          title={facts.paidBySponsor ? t('issuing.sponsorPaid') : t('issuing.youPaid')}
          value={
            <Hash
              value={facts.tx}
              kind="transaction hash"
              {...(template ? { explorerHref: template.replace('{hash}', facts.tx) } : {})}
              {...(name ? { explorerName: name } : {})}
              lang={lang}
            />
          }
          lang={lang}
          data-testid="issuing-paid"
        />
      ) : null}
      <ListRow
        leading={<Done done={Boolean(facts.arkivKey)} />}
        title={t('issuing.arkiv')}
        value={facts.arkivKey ? <ArkivKey value={facts.arkivKey} /> : undefined}
        lang={lang}
        data-testid="issuing-arkiv"
      />
      {facts.hcs ? <HcsRow hcs={facts.hcs} /> : null}
    </ListGroup>
  );
}

/**
 * The ledger proofs after an action's own transaction (a top-up, a gift, a refund): its Arkiv entity — only when the
 * API answered with a live entity key, not a logical `gift:` / `rcpt:` one — and its HCS receipt.
 */
export function ProofRows({ receipt }: { receipt: ReceiptRef }) {
  const { t, lang } = useLang();
  const arkiv = arkivEntityUrl(receipt.arkivKey) !== undefined;
  if (!arkiv && !receipt.hcs) return null;
  return (
    <ListGroup data-testid="proof-rows">
      {arkiv ? (
        <ListRow
          leading={<Done done />}
          title={t('issuing.arkiv')}
          value={<ArkivKey value={receipt.arkivKey} />}
          lang={lang}
        />
      ) : null}
      {receipt.hcs ? <HcsRow hcs={receipt.hcs} /> : null}
    </ListGroup>
  );
}

/**
 * The one permitted flourish: 0 → target in 400 ms, once, on the bundle's first read. Reduced motion
 * (or any later visit) sets the number directly.
 */
export function useOdometer(target: number, run: boolean): { value: number; done: boolean } {
  const reduced = usePrefersReducedMotion();
  const animate = run && !reduced;
  const [frame, setFrame] = useState({ value: 0, done: false });
  useEffect(() => {
    if (!animate) return;
    const start = performance.now();
    let id = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 400);
      setFrame({ value: Math.round(target * (1 - (1 - p) * (1 - p))), done: p >= 1 });
      if (p < 1) id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
    return () => cancelAnimationFrame(id);
  }, [animate, target]);
  return animate ? frame : { value: target, done: true };
}
