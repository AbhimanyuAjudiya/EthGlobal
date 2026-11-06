import type { HTMLAttributes, ReactNode } from 'react';

export type PillTone = 'neutral' | 'brand' | 'positive' | 'warning' | 'negative';

export interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: PillTone;
  /** A leading status dot. */
  dot?: boolean;
  children: ReactNode;
}

/** 28 px status pill in label weight: Issuing / Ready / Live / Paused. */
export function Pill({ tone = 'neutral', dot = false, className, children, ...rest }: PillProps) {
  return (
    <span className={`pill${className ? ` ${className}` : ''}`} data-tone={tone} {...rest}>
      {dot ? <span className="pill__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
