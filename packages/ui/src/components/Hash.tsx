'use client';

import { useEffect, useState } from 'react';

import { cx, shortHex } from './format';
import { Icon } from './icons';
import { uiStrings, type CouponLang } from './strings';

export interface HashProps {
  /** The full 0x value (transaction hash, address, key). Always shown short, always copyable. */
  value: string;
  /** What the value is, for the copy button's accessible name: "transaction hash", "address". */
  kind?: string;
  /** Explorer link for this value; omitted when the value has no public page. */
  explorerHref?: string;
  /** Explorer name shown beside the link icon: "HashScan", "Basescan". */
  explorerName?: string;
  lang?: CouponLang;
  className?: string;
}

type CopyState = 'idle' | 'copied' | 'failed';

/** `0x1a2b…9f3e` in Chivo Mono with slashed zero, a copy button and, when given, an explorer link. */
export function Hash({
  value,
  kind = 'hash',
  explorerHref,
  explorerName,
  lang = 'en',
  className,
}: HashProps) {
  const [copy, setCopy] = useState<CopyState>('idle');

  useEffect(() => {
    if (copy === 'idle') return;
    const timer = setTimeout(() => setCopy('idle'), 2000);
    return () => clearTimeout(timer);
  }, [copy]);

  const onCopy = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (!clipboard) {
      setCopy('failed');
      return;
    }
    clipboard.writeText(value).then(
      () => setCopy('copied'),
      () => setCopy('failed'),
    );
  };

  return (
    <span className={cx('hash', className)}>
      <span className="hash__value" data-hash title={value} lang="en">
        {shortHex(value)}
      </span>
      <button
        type="button"
        className="hash__copy"
        onClick={onCopy}
        aria-label={`Copy ${kind} ${value}`}
        data-copy={copy}
      >
        <Icon name={copy === 'copied' ? 'check' : 'copy'} />
        <span className="hash__copy-text" aria-live="polite">
          {copy === 'copied'
            ? uiStrings[lang].copied
            : copy === 'failed'
              ? uiStrings[lang].selectToCopy
              : ''}
        </span>
      </button>
      {explorerHref ? (
        <a className="hash__explorer" href={explorerHref} target="_blank" rel="noreferrer">
          <Icon name="external" />
          {explorerName ?? 'Explorer'}
        </a>
      ) : null}
    </span>
  );
}
