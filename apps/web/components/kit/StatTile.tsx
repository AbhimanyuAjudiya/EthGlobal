import type { ReactNode } from 'react';

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** "+12 today"; tone from the sign of the change is the caller's call. */
  delta?: ReactNode;
  deltaTone?: 'neutral' | 'positive' | 'negative';
  hint?: ReactNode;
  'data-testid'?: string;
}

/** Console: a 24 px card, the value in display. */
export function StatTile({
  label,
  value,
  delta,
  deltaTone = 'neutral',
  hint,
  'data-testid': testId,
}: StatTileProps) {
  return (
    <div className="stat-tile" data-testid={testId}>
      <p className="stat-tile__label t-label">{label}</p>
      <p className="stat-tile__value">{value}</p>
      {delta ? (
        <p className="stat-tile__delta t-label" data-tone={deltaTone}>
          {delta}
        </p>
      ) : null}
      {hint ? <p className="stat-tile__hint t-caption">{hint}</p> : null}
    </div>
  );
}
