import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title: ReactNode;
  body?: ReactNode;
  /** One pill (a ButtonLink). */
  action?: ReactNode;
  'data-testid'?: string;
}

/** Centred: one line, one sentence, one pill. */
export function EmptyState({ title, body, action, 'data-testid': testId }: EmptyStateProps) {
  return (
    <div className="empty-state" data-testid={testId}>
      <p className="empty-state__title t-heading">{title}</p>
      {body ? <p className="empty-state__body t-body">{body}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}
