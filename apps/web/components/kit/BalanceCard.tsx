import { Amount } from './Amount';

import type { ReactNode } from 'react';

export interface BalanceCardProps {
  /** The hero number: "300", "1.5", 1214. */
  amount: number | string;
  unit: ReactNode;
  /** The caption row: "from Hedera", "usage as of 14:02". */
  caption?: ReactNode;
  /** A line beside the amount: "free · 1,214 of 2,000 left". */
  note?: ReactNode;
  /** Data used of total, drawn as a 6 px bar of what is left; ≥ 80 % used turns it warning. */
  meter?: { used: number; total: number; label?: string };
  /** A Pill at the top right (Issuing / Ready / Expired). */
  status?: ReactNode;
  /** A caption above the amount ("Data left"). */
  eyebrow?: ReactNode;
  /** brand = the --gradient-card top edge; surface = plain. */
  tone?: 'brand' | 'surface';
  /** Extra content under the caption (a hash row, a countdown). */
  children?: ReactNode;
  id?: string;
  lang?: string;
  'aria-label'?: string;
}

/** The hero card: 24 px radius, amount in display-xl, a 6 px rounded progress bar, the caption row. */
export function BalanceCard({
  amount,
  unit,
  caption,
  note,
  meter,
  status,
  eyebrow,
  tone = 'brand',
  children,
  id,
  lang,
  'aria-label': label,
}: BalanceCardProps) {
  const total = meter ? Math.max(0, meter.total) : 0;
  const used = meter ? Math.min(Math.max(0, meter.used), total) : 0;
  const left = total === 0 ? 0 : (total - used) / total;
  return (
    <section className="balance-card" data-tone={tone} id={id} lang={lang} aria-label={label}>
      {eyebrow || status ? (
        <div className="balance-card__top">
          {eyebrow ? <p className="balance-card__eyebrow t-label">{eyebrow}</p> : <span />}
          {status}
        </div>
      ) : null}
      <p className="balance-card__amount">
        <Amount value={amount} unit={unit} size="xl" />
        {note ? <span className="balance-card__note t-label">{note}</span> : null}
      </p>
      {meter ? (
        <div
          className="balance-card__meter"
          role="meter"
          aria-label={meter.label}
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={total - used}
          data-warning={total > 0 && used / total >= 0.8 ? true : undefined}
        >
          <div className="balance-card__fill" style={{ width: `${left * 100}%` }} />
        </div>
      ) : null}
      {caption ? <div className="balance-card__caption t-caption">{caption}</div> : null}
      {children}
    </section>
  );
}
