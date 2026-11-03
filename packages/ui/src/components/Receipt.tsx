import { cx } from './format';
import { RuledList } from './RuledList';

import type { ReactNode } from 'react';

export interface ReceiptProps {
  /** "+100 MB · Sat 7 Nov 03:12 · Hedera · Final". */
  heading?: ReactNode;
  /** What the traveller paid: "$0.40" (or "$0.00" for a sponsored bundle). */
  you: string;
  /** What the sponsor paid; "—" when nobody did. */
  sponsor?: string;
  /** The true network fee, or "$0.00" when the facilitator pays it. */
  networkFee: string;
  /** Override the three labels, e.g. the printed card's "Bundle / Paid by Hedera / Network fee". */
  labels?: { you?: string; sponsor?: string; networkFee?: string };
  /** The failed-payment case: only the amount turns --negative. */
  failed?: boolean;
  className?: string;
}

/** Three ruled lines — you / sponsor / network fee — after the paper coupon's MRP block. */
export function Receipt({
  heading,
  you,
  sponsor = '—',
  networkFee,
  labels,
  failed = false,
  className,
}: ReceiptProps) {
  return (
    <section className={cx('receipt', className)} aria-label="Receipt">
      {heading ? <p className="receipt__heading">{heading}</p> : null}
      <RuledList
        rows={[
          { label: labels?.you ?? 'You', value: you, tone: failed ? 'negative' : 'default' },
          { label: labels?.sponsor ?? 'Sponsor', value: sponsor },
          { label: labels?.networkFee ?? 'Network fee', value: networkFee },
        ]}
      />
    </section>
  );
}
