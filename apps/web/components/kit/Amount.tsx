import type { ReactNode } from 'react';

export type AmountSize = 'xl' | 'display' | 'title' | 'heading' | 'body';

export interface AmountProps {
  /** The number; a number is grouped en-IN ("1,214"), a string is shown as given ("4.00", "1.5"). */
  value: number | string;
  /** "MB", "GB", "USDC"; drawn at 40 % on the baseline. A leading unit ("$") goes in `prefix`. */
  unit?: ReactNode;
  prefix?: ReactNode;
  size?: AmountSize;
  tone?: 'default' | 'positive' | 'negative' | 'warning';
  className?: string;
}

const grouped = new Intl.NumberFormat('en-IN');

/** Money and MB figures: number and unit split, tabular, 800 / 112; ticks once when the value changes. */
export function Amount({
  value,
  unit,
  prefix,
  size = 'display',
  tone = 'default',
  className,
}: AmountProps) {
  const text = typeof value === 'number' ? grouped.format(value) : value;
  return (
    <span
      className={`amount${className ? ` ${className}` : ''}`}
      data-size={size}
      data-tone={tone === 'default' ? undefined : tone}
    >
      {prefix ? <span className="amount__unit amount__unit--prefix">{prefix}</span> : null}
      <span className="amount__value" key={text}>
        {text}
      </span>
      {unit ? (
        <>
          {' '}
          <span className="amount__unit">{unit}</span>
        </>
      ) : null}
    </span>
  );
}
