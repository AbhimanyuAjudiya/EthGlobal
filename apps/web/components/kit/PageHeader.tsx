import type { ReactNode } from 'react';

export interface PageHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  /** title = 28 px PageHeader title; display = the 34–48 px line that carries the message. */
  size?: 'title' | 'display';
  lead?: ReactNode;
  /** One quiet action at the right of the title ("Download CSV", "New campaign"). */
  action?: ReactNode;
  /** The h1's id (tests and aria-labelledby point at it). */
  id?: string;
  lang?: string;
}

/** Eyebrow (caption) + title + lead (body-lg), left-aligned; the screen's one h1. */
export function PageHeader({
  eyebrow,
  title,
  size = 'title',
  lead,
  action,
  id,
  lang,
}: PageHeaderProps) {
  return (
    <header className="page-header" lang={lang}>
      {eyebrow ? <p className="page-header__eyebrow t-caption">{eyebrow}</p> : null}
      <div className="page-header__row">
        <h1
          id={id}
          className={`page-header__title ${size === 'display' ? 't-display' : 't-title'}`}
        >
          {title}
        </h1>
        {action ? <div className="page-header__action">{action}</div> : null}
      </div>
      {lead ? <p className="page-header__lead t-body-lg">{lead}</p> : null}
    </header>
  );
}
