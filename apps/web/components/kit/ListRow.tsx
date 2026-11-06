'use client';

import Link from 'next/link';
import { useId, type ReactNode } from 'react';

import { KitIcon } from './icons';

export interface ListRowProps {
  /** An Avatar (initials or icon). */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned in label weight: "300 MB", "$4.00". */
  value?: ReactNode;
  valueTone?: 'default' | 'muted' | 'positive' | 'warning' | 'negative';
  /** Mono value (hashes, keys). */
  mono?: boolean;
  href?: string;
  /** Open `href` in a new tab (explorers). */
  external?: boolean;
  onClick?: () => void;
  /** chevron (default on links), switch (with `checked` / `onCheckedChange`), or any node (a Pill). */
  trailing?: ReactNode;
  checked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  lang?: string;
  'data-testid'?: string;
}

/** One row of a ListGroup: leading · title / subtitle · value · trailing; a link, a button, a switch or static. */
export function ListRow({
  leading,
  title,
  subtitle,
  value,
  valueTone = 'default',
  mono = false,
  href,
  external = false,
  onClick,
  trailing,
  checked,
  onCheckedChange,
  disabled,
  className,
  lang,
  'data-testid': testId,
}: ListRowProps) {
  const switchId = useId();
  const isSwitch = trailing === 'switch';
  const end =
    trailing === 'chevron' || (trailing === undefined && (href || onClick)) ? (
      <KitIcon name="chevron" className="kit-icon list-row__chevron" />
    ) : isSwitch ? (
      <input
        id={switchId}
        type="checkbox"
        role="switch"
        className="list-row__switch"
        checked={checked ?? false}
        disabled={disabled}
        onChange={(e) => onCheckedChange?.(e.target.checked)}
      />
    ) : (
      trailing
    );
  const body = (
    <>
      {leading ? <span className="list-row__leading">{leading}</span> : null}
      <span className="list-row__text">
        <span className="list-row__title">{title}</span>
        {subtitle ? <span className="list-row__subtitle">{subtitle}</span> : null}
      </span>
      {value !== undefined && value !== null ? (
        <span
          className={`list-row__value${mono ? ' list-row__value--mono' : ''}`}
          data-tone={valueTone === 'default' ? undefined : valueTone}
        >
          {value}
        </span>
      ) : null}
      {end}
    </>
  );
  const main =
    href && !disabled ? (
      external ? (
        <a className="list-row__main" href={href} target="_blank" rel="noreferrer">
          {body}
        </a>
      ) : (
        <Link className="list-row__main" href={href} prefetch={false}>
          {body}
        </Link>
      )
    ) : onClick ? (
      <button type="button" className="list-row__main" onClick={onClick} disabled={disabled}>
        {body}
      </button>
    ) : isSwitch ? (
      <label className="list-row__main" htmlFor={switchId}>
        {body}
      </label>
    ) : (
      <div className="list-row__main">{body}</div>
    );
  return (
    <li className={`list-row${className ? ` ${className}` : ''}`} lang={lang} data-testid={testId}>
      {main}
    </li>
  );
}
