'use client';

import { useEffect, useState } from 'react';

import type { ReceiptRef } from '@ethglobal/protocol/schemas';
import { Hash, usePrefersReducedMotion } from '@ethglobal/ui/components';

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
    <li data-done data-testid="issuing-hcs">
      <span lang={lang}>{t('issuing.hcs')}</span>
      <Hash
        value={hcs.topic}
        kind="HCS topic"
        explorerHref={hcsTopicUrl(hcs.topic)}
        explorerName={`HashScan · #${hcs.sequence}`}
        lang={lang}
      />
    </li>
  );
}

/**
 * "Verified · Orb" · "Sponsor paid 0x1a2b…9f3e ↗" · "Plan written to Arkiv 0x7f3a…ab12 ↗" · "Receipt on Hedera ↗":
 * each row is a fact this device kept from the issue, with its explorer link. No spinner.
 */
export function IssuingRows({ facts }: { facts: IssuingFacts }) {
  const { t, lang } = useLang();
  const template = explorerTemplate(facts.network);
  const name = explorerName(facts.network);
  return (
    <ol className="issuing-rows" data-testid="issuing-rows">
      {facts.verified ? (
        <li data-done data-testid="issuing-verified">
          <span lang={lang}>{facts.verified}</span>
        </li>
      ) : null}
      {facts.tx ? (
        <li data-done data-testid="issuing-paid">
          <span lang={lang}>
            {facts.paidBySponsor ? t('issuing.sponsorPaid') : t('issuing.youPaid')}
          </span>
          <Hash
            value={facts.tx}
            kind="transaction hash"
            {...(template ? { explorerHref: template.replace('{hash}', facts.tx) } : {})}
            {...(name ? { explorerName: name } : {})}
            lang={lang}
          />
        </li>
      ) : null}
      <li data-done={Boolean(facts.arkivKey) || undefined} data-testid="issuing-arkiv">
        <span lang={lang}>{t('issuing.arkiv')}</span>
        {facts.arkivKey ? <ArkivKey value={facts.arkivKey} /> : null}
      </li>
      {facts.hcs ? <HcsRow hcs={facts.hcs} /> : null}
    </ol>
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
    <ul className="issuing-rows" data-testid="proof-rows">
      {arkiv ? (
        <li data-done>
          <span lang={lang}>{t('issuing.arkiv')}</span>
          <ArkivKey value={receipt.arkivKey} />
        </li>
      ) : null}
      {receipt.hcs ? <HcsRow hcs={receipt.hcs} /> : null}
    </ul>
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
