import { cx, dataAmount, DEFAULT_TIME_ZONE, NBSP, pinGroups } from './format';
import { RUB_HERE_LANGS, SEP, uiStrings, type CouponLang } from './strings';
import { UsageAsOf } from './UsageAsOf';

import type { ReactNode } from 'react';

/** One markup, three renderings (design-references §3): in-app card, push notification, paper card. */
export type CouponVariant = 'screen' | 'notification' | 'print';

export interface CouponQrSlot {
  /** `https://<host>/card/<serial>`: the serial is public, the PIN under latex is the value. */
  url: string;
  /** 22 mm on paper (ECC M); the screen variant scales it to the panel. */
  sizeMm: number;
  /** Accessible name for the rendered code. */
  label: string;
}

export interface CouponProps {
  /** Bundle size in MB; shown as "300 MB" below 1 GB and "1.5 GB" above, at 2× everything else. */
  mb: number;
  /** Who paid, named like a donor on a plaque: "Hedera". Omitted for a bundle the traveller paid for. */
  sponsor?: string;
  /** 16 digits (15 random + Verhoeff check). Rendered 4 × 4 in Chivo Mono; omitted until known. */
  pin?: string;
  /** When usage was measured (ms); renders "usage as of 14:02". */
  usageAsOf?: number;
  timeZone?: string;
  /** "Mumbai · 7 days". */
  validity?: string;
  /** Public 8-character serial printed in 7 pt mono. */
  serial?: string;
  /** Preformatted by the app from the protocol fact: "Expires 30 Nov 2026". */
  expires?: string;
  /** A state line that replaces nothing else: "Sponsor bundles finished for today · next batch 09:00 IST". */
  status?: string;
  /** Second notification line after the reason: "Install takes 2 minutes." */
  note?: string;
  lang?: CouponLang;
  variant?: CouponVariant;
  /** Where the QR points; with `renderQr` the coupon draws a QR slot. */
  qrUrl?: string;
  /** Render prop for the QR code; ui ships no encoder so the app chooses one. */
  renderQr?: (slot: CouponQrSlot) => ReactNode;
  /** Laid over the PIN panel (ScratchCard's latex). */
  pinCover?: ReactNode;
  /** True while the PIN is under latex: it stays rendered but is hidden from assistive tech. */
  pinConcealed?: boolean;
  /**
   * The live, unscratched coupon (design-references §1a): the silver latex panel with "rub here · यहाँ रगड़ें"
   * (Baloo 2) over a ghost 4 × 4 PIN row, before any PIN exists. Nothing under it is a real PIN.
   */
  sealed?: boolean;
  className?: string;
  id?: string;
}

const QR_MM = 22;

function Amount({ mb }: { mb: number }) {
  const { value, unit } = dataAmount(mb);
  return (
    <span className="coupon__amount">
      <span className="coupon__value">{value}</span>
      {NBSP}
      <span className="coupon__unit">{unit}</span>
    </span>
  );
}

/** The recharge coupon. Paper-light in both themes on purpose: it is an object. */
export function Coupon({
  mb,
  sponsor,
  pin,
  usageAsOf,
  timeZone = DEFAULT_TIME_ZONE,
  validity,
  serial,
  expires,
  status,
  note,
  lang = 'en',
  variant = 'screen',
  qrUrl,
  renderQr,
  pinCover,
  pinConcealed = false,
  sealed = false,
  className,
  id,
}: CouponProps) {
  const strings = uiStrings[lang];
  const from = sponsor ? strings.from(sponsor) : undefined;
  const label = [`Recharge coupon`, `${dataAmount(mb).value} ${dataAmount(mb).unit}`, from]
    .filter(Boolean)
    .join(', ');

  if (variant === 'notification') {
    return (
      <article
        className={cx('coupon', className)}
        data-color-scheme="light"
        data-variant="notification"
        lang={lang}
        id={id}
      >
        <p className="coupon__headline">
          <Amount mb={mb} />
          {from ? `${SEP}${from}` : null}
        </p>
        <p className="coupon__line">
          {strings.human}.{note ? ` ${note}` : null}
        </p>
      </article>
    );
  }

  const groups = pin ? pinGroups(pin) : undefined;
  const qr =
    qrUrl && renderQr
      ? renderQr({ url: qrUrl, sizeMm: QR_MM, label: `QR code for ${qrUrl}` })
      : null;

  return (
    <article
      className={cx('coupon', className)}
      data-color-scheme="light"
      data-variant={variant}
      lang={lang}
      aria-label={label}
      id={id}
    >
      {variant === 'print' || validity ? (
        <header className="coupon__head">
          {/* on screen the app header carries the wordmark; paper needs its own */}
          {variant === 'print' ? (
            <span className="coupon__wordmark" lang="en">
              Recharge
            </span>
          ) : null}
          {validity ? <span className="coupon__validity">{validity}</span> : null}
        </header>
      ) : null}

      <p className="coupon__headline">
        <Amount mb={mb} />
        <span className="coupon__line">
          <span className="ui-visually-hidden">{SEP}</span>
          {from ? `${from}${SEP}` : null}
          {strings.human}
        </span>
      </p>
      {variant === 'print' && lang !== 'hi' ? (
        <p className="coupon__line coupon__line--second" lang="hi">
          {uiStrings.hi.human}
        </p>
      ) : null}

      {groups || qr || sealed ? (
        <div className="coupon__body">
          {sealed && !groups ? (
            <div className="coupon__panel coupon__panel--sealed" data-concealed>
              <p className="coupon__pin coupon__pin--ghost" data-hash aria-hidden="true">
                0000 0000 0000 0000
              </p>
              <div className="coupon__latex" aria-hidden="true">
                <span className="coupon__rub">
                  <span lang="en">{RUB_HERE_LANGS.en}</span>
                  {SEP}
                  <span lang="hi">{RUB_HERE_LANGS.hi}</span>
                </span>
              </div>
            </div>
          ) : null}
          {groups ? (
            <div className="coupon__panel" data-concealed={pinConcealed || undefined}>
              <p className="coupon__pin" data-hash aria-hidden={pinConcealed || undefined}>
                <span className="ui-visually-hidden">PIN </span>
                {groups.join(' ')}
              </p>
              {pinCover}
            </div>
          ) : null}
          {qr ? (
            <div className="coupon__qr" data-qr={qrUrl}>
              {qr}
            </div>
          ) : null}
        </div>
      ) : null}

      {status ? (
        <p className="coupon__status" data-stub={variant === 'screen' || undefined}>
          {status}
        </p>
      ) : null}

      {usageAsOf !== undefined || serial || expires ? (
        <footer className="coupon__foot">
          {usageAsOf !== undefined ? (
            <UsageAsOf at={usageAsOf} timeZone={timeZone} lang={lang} />
          ) : null}
          {serial ? (
            <span className="coupon__serial" data-hash>
              {serial}
            </span>
          ) : null}
          {expires ? <span className="coupon__expires">{expires}</span> : null}
        </footer>
      ) : null}
    </article>
  );
}
