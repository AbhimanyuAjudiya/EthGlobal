import type { ReactNode } from 'react';

export interface TicketProps {
  /** A Coupon or BoardingPass (they draw their own ticket), or any content for a plain ticket. */
  children: ReactNode;
  /** A brand-coloured stub under a perforation (plain tickets; Coupon / BoardingPass carry their own). */
  stub?: ReactNode;
  className?: string;
  id?: string;
  'aria-label'?: string;
}

/** The Ticket: a perforated 24 px card with a brand stub; centres a Coupon / BoardingPass in the column. */
export function Ticket({ children, stub, className, id, 'aria-label': label }: TicketProps) {
  if (stub === undefined)
    return (
      <div className={`ticket ticket--object${className ? ` ${className}` : ''}`} id={id}>
        {children}
      </div>
    );
  return (
    <article className={`ticket${className ? ` ${className}` : ''}`} id={id} aria-label={label}>
      <div className="ticket__body">{children}</div>
      <div className="ticket__perforation" aria-hidden="true" />
      <div className="ticket__stub">{stub}</div>
    </article>
  );
}
