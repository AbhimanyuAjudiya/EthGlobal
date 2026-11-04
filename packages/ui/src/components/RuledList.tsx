import { cx } from './format';

import type { ReactNode } from 'react';

export interface RuledRow {
  label: ReactNode;
  value: ReactNode;
  /** Only the amount of a failed payment wears --negative; nothing else is tinted. */
  tone?: 'default' | 'negative';
  /**
   * Amounts, hashes, PINs and times sit in tabular mono; sentences ("Valid with your plan until …") stay in the
   * text face, which also sets Devanagari properly (RT design review #6, RT-W-08).
   */
  mono?: boolean;
}

/** Two-column ruled lines, label left, value right (figures in tabular mono): the receipt idiom. */
export function RuledList({ rows, className }: { rows: readonly RuledRow[]; className?: string }) {
  return (
    <dl className={cx('ruled', className)}>
      {rows.map((row, index) => (
        <div className="ruled__row" key={index} data-tone={row.tone}>
          <dt className="ruled__label">{row.label}</dt>
          <dd className={cx('ruled__value', row.mono && 'ruled__value--mono')}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
