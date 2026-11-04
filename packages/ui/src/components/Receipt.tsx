import { cx } from './format';
import { RuledList } from './RuledList';
import { uiStrings, type CouponLang } from './strings';

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
  lang?: CouponLang;
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
  lang = 'en',
  className,
}: ReceiptProps) {
  const s = uiStrings[lang].receipt;
  return (
    <section className={cx('receipt', className)} aria-label={s.label}>
      {heading ? <p className="receipt__heading">{heading}</p> : null}
      <RuledList
        rows={[
          {
            label: labels?.you ?? s.you,
            value: you,
            tone: failed ? 'negative' : 'default',
            mono: true,
          },
          { label: labels?.sponsor ?? s.sponsor, value: sponsor, mono: true },
          { label: labels?.networkFee ?? s.networkFee, value: networkFee, mono: true },
        ]}
      />
    </section>
  );
}
