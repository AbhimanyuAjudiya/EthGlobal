'use client';

import { useEffect, useState } from 'react';

import { Hash, usePrefersReducedMotion } from '@ethglobal/ui/components';

import { useLang } from '../i18n/lang';
import { explorerName, explorerTemplate } from '../lib/env';

export interface IssuingFacts {
  verified: boolean;
  /** Sponsor's DataDrop.claim tx (free lane) or the settlement tx (paid lane). */
  tx?: string;
  network?: string;
  paidBySponsor: boolean;
  /** Present once the entity has been read back from the ledger. */
  arkivKey?: string;
}

/**
 * "Verified" · "Sponsor paid 0x1a2b…9f3e ↗" · "Plan written to Arkiv ent:7f3a…": each row turns
 * --text-tertiary → --text-primary the moment its fact exists. No spinner.
 */
export function IssuingRows({ facts }: { facts: IssuingFacts }) {
  const { t, lang } = useLang();
  const template = explorerTemplate(facts.network);
  const name = explorerName(facts.network);
  return (
    <ol className="issuing-rows" data-testid="issuing-rows">
      <li data-done={facts.verified || undefined} data-testid="issuing-verified">
        <span lang={lang}>{t('issuing.verified')}</span>
      </li>
      <li data-done={Boolean(facts.tx) || undefined} data-testid="issuing-paid">
        <span lang={lang}>{facts.paidBySponsor ? t('issuing.sponsorPaid') : t('issuing.youPaid')}</span>
        {facts.tx ? (
          <Hash
            value={facts.tx}
            kind="transaction hash"
            {...(template ? { explorerHref: template.replace('{hash}', facts.tx) } : {})}
            {...(name ? { explorerName: name } : {})}
          />
        ) : null}
      </li>
      <li data-done={Boolean(facts.arkivKey) || undefined} data-testid="issuing-arkiv">
        <span lang={lang}>{t('issuing.arkiv')}</span>
        {facts.arkivKey ? (
          <span className="mono-key" data-hash title={facts.arkivKey}>
            {shortKey(facts.arkivKey)}
          </span>
        ) : null}
      </li>
    </ol>
  );
}

export const shortKey = (key: string) => (key.length > 18 ? `${key.slice(0, 12)}…` : key);

/**
 * The one permitted flourish: 0 → target in 400 ms, once, on the bundle's first read. Reduced motion
 * (or any later visit) sets the number directly.
 */
export function useOdometer(target: number, run: boolean): { value: number; done: boolean } {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(run && !reduced ? 0 : target);
  const [done, setDone] = useState(!run || reduced);
  useEffect(() => {
    if (!run || reduced) {
      setValue(target);
      setDone(true);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const step = (now: number) => {
      const p = Math.min(1, (now - start) / 400);
      setValue(Math.round(target * (1 - (1 - p) * (1 - p))));
      if (p < 1) frame = requestAnimationFrame(step);
      else setDone(true);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [run, reduced, target]);
  return { value, done };
}
