import { KitIcon } from './icons';

import type { HTMLAttributes, ReactNode } from 'react';

export type NoticeTone = 'info' | 'warning' | 'negative' | 'positive';

export interface NoticeProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  tone?: NoticeTone;
  title?: ReactNode;
  children?: ReactNode;
  /** A link or quiet button under the text. */
  action?: ReactNode;
}

/** A tinted card with an icon: one factual sentence, an optional title and action. */
export function Notice({
  tone = 'info',
  title,
  children,
  action,
  className,
  ...rest
}: NoticeProps) {
  return (
    <div className={`notice${className ? ` ${className}` : ''}`} data-tone={tone} {...rest}>
      <KitIcon name={tone} className="kit-icon notice__icon" />
      <div className="notice__text">
        {title ? <p className="notice__title">{title}</p> : null}
        {children ? <div className="notice__body">{children}</div> : null}
        {action ? <div className="notice__action">{action}</div> : null}
      </div>
    </div>
  );
}
