import type { ReactNode } from 'react';

export interface ListGroupProps {
  /** A heading above the card (a receipts day). */
  title?: ReactNode;
  /** Right of the heading (the day's total). */
  meta?: ReactNode;
  /** ListRows. */
  children: ReactNode;
  /** The list's accessible name when there is no title. */
  label?: string;
  /** Rows without the card around them (inside a Card or a Sheet that already is one). */
  flush?: boolean;
  className?: string;
  'data-testid'?: string;
}

/** Rows of 56–64 px inside a Card, a 1 px hairline between them. */
export function ListGroup({
  title,
  meta,
  children,
  label,
  flush = false,
  className,
  'data-testid': testId,
}: ListGroupProps) {
  const list = (
    <ul className="list-group" aria-label={label}>
      {children}
    </ul>
  );
  return (
    <div className={`list-block${className ? ` ${className}` : ''}`} data-testid={testId}>
      {title || meta ? (
        <div className="list-block__head">
          {title ? <h3 className="list-block__title t-label">{title}</h3> : <span />}
          {meta ? <span className="list-block__meta t-label">{meta}</span> : null}
        </div>
      ) : null}
      {flush ? list : <div className="card">{list}</div>}
    </div>
  );
}
