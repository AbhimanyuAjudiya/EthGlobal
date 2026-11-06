'use client';

import { useCallback, type ReactNode } from 'react';

import { Hash } from '@ethglobal/ui/components';

import { CopyButton } from './InstallSteps';
import { useProofShown } from './Shell';
import { useLang } from '../i18n/lang';
import { PARTNERS, type Partner, type Proof, type ProofItem } from '../lib/proof';

import type { StringKey } from '../i18n/strings';

const NAMES: Readonly<Record<Exclude<Partner, 'chain'>, string>> = {
  hedera: 'Hedera',
  base: 'Base',
  world: 'World',
  arkiv: 'Arkiv',
  ens: 'ENS',
  api: 'Recharge API',
};

/** A hash: short, copied whole, its explorer beside it; a command: wrapped, with its own copy; else text or a link. */
function Value({ item }: { item: ProofItem }) {
  const { t, lang } = useLang();
  if (item.kind === 'hash')
    return (
      <Hash
        value={item.value}
        kind={t(item.label)}
        {...(item.href ? { explorerHref: item.href } : {})}
        {...(item.site ? { explorerName: item.site } : {})}
        lang={lang}
      />
    );
  if (item.kind === 'code')
    return (
      <>
        <code className="proof__code" lang="en">
          {item.value}
        </code>
        <CopyButton value={item.value} label={t('proof.copyCommand')} testId="proof-copy-command" />
      </>
    );
  const text = item.kind === 'key' ? t(item.value as StringKey) : item.value;
  return item.href ? (
    <a className="proof__link" href={item.href} target="_blank" rel="noreferrer">
      {`${text} · ${item.site ?? ''}`}
    </a>
  ) : (
    <span>{text}</span>
  );
}

/**
 * The proof after an action (built and redacted by lib/proof.ts): one group per partner — Hedera, Base, World, Arkiv,
 * ENS — of label · short value · copy · link, then the raw response as JSON with a copy. Shown while "Show proof after
 * each action" is on (the menu; on by default on a testnet), as its own "Proof" disclosure: open from 560 px,
 * collapsed on a phone. `fallback` renders instead when the switch is off or there is nothing to prove. Generic: any
 * screen passes a `Proof` from `buildProof`.
 */
export function ProofPanel({
  proof,
  fallback = null,
}: {
  proof: Proof | undefined;
  fallback?: ReactNode;
}) {
  const { t, lang } = useLang();
  const shown = useProofShown();
  // opened once, when it appears, from 560 px (a phone starts folded); after that the person's toggle stands
  const openWide = useCallback((el: HTMLDetailsElement | null) => {
    if (el && window.matchMedia?.('(min-width: 560px)').matches) el.open = true;
  }, []);
  if (!shown || !proof) return fallback;
  const name = (p: Partner) => (p === 'chain' ? t('network.local') : NAMES[p]);
  const groups = PARTNERS.map((partner) => ({
    partner,
    items: proof.items.filter((item) => item.partner === partner),
  })).filter((group) => group.items.length > 0);
  return (
    <details
      ref={openWide}
      className="proof"
      data-testid="proof-panel"
      data-ok={proof.ok}
      lang={lang}
    >
      <summary>{[t('proof.title'), ...groups.map((g) => name(g.partner))].join(' · ')}</summary>
      {groups.map((group) => (
        // a heading per partner, no landmark: a reclaim list shows one panel per gift
        <section key={group.partner} className="proof__group">
          <h3 className="proof__partner">{name(group.partner)}</h3>
          <dl className="proof__items">
            {group.items.map((item, i) => (
              <div key={`${item.label}-${String(i)}`}>
                <dt>{t(item.label)}</dt>
                <dd>
                  <Value item={item} />
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <details className="proof__raw">
        <summary>{t('proof.raw')}</summary>
        <pre className="proof__json" lang="en" data-testid="proof-raw">
          {proof.raw}
        </pre>
        <CopyButton value={proof.raw} label={t('proof.copyRaw')} testId="proof-copy-raw" />
      </details>
    </details>
  );
}
