import { cx } from './format';

import type { ReactNode } from 'react';

export interface RuledRow {
  label: ReactNode;
  value: ReactNode;
  /** Only the amount of a failed payment wears --negative; nothing else is tinted. */
  tone?: 'default' | 'negative';
}

/** Two-column ruled lines, label left, figure right in tabular mono: the receipt idiom. */
export function RuledList({ rows, className }: { rows: readonly RuledRow[]; className?: string }) {
  return (
    <dl className={cx('ruled', className)}>
      {rows.map((row, index) => (
        <div className="ruled__row" key={index} data-tone={row.tone}>
          <dt className="ruled__label">{row.label}</dt>
          <dd className="ruled__value">{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
