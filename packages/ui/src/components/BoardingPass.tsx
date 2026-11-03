import { Countdown } from './Countdown';
import { cx, dateTime, DEFAULT_TIME_ZONE, formatData, pinGroups } from './format';

import type { CouponQrSlot } from './Coupon';
import type { ReactNode } from 'react';

export type BoardingPassStatus = 'open' | 'claimed' | 'lapsed';

export interface BoardingPassProps {
  /** The ENS name the gift is addressed to: "rahul.eth". */
  to: string;
  /** "you" for the sender's own view, or the sender's name for the recipient. */
  from: string;
  mb: number;
  /** "MUMBAI". */
  city?: string;
  /** Claim deadline from the escrow entity (ms); drives VALID UNTIL and the countdown text. */
  claimBy: number;
  /** Pass to freeze time (tests, gallery); otherwise the countdown ticks once a minute. */
  now?: number;
  timeZone?: string;
  /** The stub's 16-digit PIN, 4 × 4 in Chivo Mono. */
  pin?: string;
  serial?: string;
  status?: BoardingPassStatus;
  qrUrl?: string;
  renderQr?: (slot: CouponQrSlot) => ReactNode;
  className?: string;
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="boarding-pass__field">
      <dt className="boarding-pass__label">{label}</dt>
      <dd className="boarding-pass__value">{children}</dd>
    </div>
  );
}

/** A gift as a boarding pass: landscape, perforated stub, real fields. No box, no ribbon. */
export function BoardingPass({
  to,
  from,
  mb,
  city = 'MUMBAI',
  claimBy,
  now,
  timeZone = DEFAULT_TIME_ZONE,
  pin,
  serial,
  status = 'open',
  qrUrl,
  renderQr,
  className,
}: BoardingPassProps) {
  const data = formatData(mb);
  const qr =
    qrUrl && renderQr ? renderQr({ url: qrUrl, sizeMm: 22, label: `QR code for ${qrUrl}` }) : null;

  return (
    <article
      className={cx('boarding-pass', className)}
      aria-label={`Gift of ${data} to ${to}`}
      data-status={status}
    >
      <div className="boarding-pass__main">
        <header className="boarding-pass__head">
          <span className="boarding-pass__wordmark">Recharge</span>
          <span className="boarding-pass__kind">Data gift</span>
        </header>
        <dl className="boarding-pass__fields">
          <Field label="To">
            <span className="boarding-pass__to">{to}</span>
          </Field>
          <Field label="From">{from}</Field>
          <Field label="Data">
            <span className="boarding-pass__data">{data}</span>
          </Field>
          <Field label="City">{city}</Field>
          <Field label="Valid until">{dateTime(claimBy, timeZone)}</Field>
        </dl>
        <p className="boarding-pass__window">
          {status === 'claimed' ? (
            `Claimed by ${to}`
          ) : (
            <Countdown
              until={claimBy}
              {...(now !== undefined ? { now } : {})}
              timeZone={timeZone}
              lead="Claim within"
              ended={status === 'lapsed' ? 'Gift lapsed' : 'Claim window closed'}
            />
          )}
        </p>
      </div>
      <div className="boarding-pass__perforation" aria-hidden="true" />
      <div className="boarding-pass__stub">
        {pin ? (
          <p className="boarding-pass__pin" data-hash>
            <span className="ui-visually-hidden">PIN </span>
            {pinGroups(pin).join(' ')}
          </p>
        ) : null}
        {qr ? <div className="boarding-pass__qr">{qr}</div> : null}
        {serial ? (
          <p className="boarding-pass__serial" data-hash>
            {serial}
          </p>
        ) : null}
      </div>
    </article>
  );
}
