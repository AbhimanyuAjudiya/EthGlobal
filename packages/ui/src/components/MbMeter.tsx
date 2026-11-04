import { cx, DEFAULT_TIME_ZONE, formatData } from './format';
import { uiStrings, type CouponLang } from './strings';
import { UsageAsOf } from './UsageAsOf';

export interface MbMeterProps {
  remainingMb: number;
  totalMb: number;
  /** When usage was measured; the meter moves only when this changes. */
  usageAsOf?: number;
  timeZone?: string;
  /** "simulated usage" when the figure comes from the demo clock (Q-USER-RECHARGE-2). */
  source?: string;
  lang?: CouponLang;
  /**
   * The one permitted fill: on the bundle's first read the bar fills once (--duration-spatial-in after
   * --duration-micro). Every later data tick snaps; the bar never animates on usage.
   */
  fillOnce?: boolean;
  /**
   * When nothing is used the text twin reads "300 MB · nothing used yet" instead of "300 MB left of 300 MB", so
   * a screen whose hero already says 300 MB does not say it three times (RT design review #8).
   */
  quietWhenFull?: boolean;
  className?: string;
}

/** Fraction used at which the meter and its "usage as of" line turn --warning (and nothing else does). */
export const WARNING_USED_FRACTION = 0.8;

/** Remaining data: a 4 px teal rule on --bg-sunken, draining left → right, with a text twin. */
export function MbMeter({
  remainingMb,
  totalMb,
  usageAsOf,
  timeZone = DEFAULT_TIME_ZONE,
  source,
  lang = 'en',
  fillOnce = false,
  quietWhenFull = false,
  className,
}: MbMeterProps) {
  const s = uiStrings[lang];
  const total = Math.max(0, totalMb);
  const remaining = Math.min(Math.max(0, remainingMb), total);
  const fraction = total === 0 ? 0 : remaining / total;
  const warning = total > 0 && 1 - fraction >= WARNING_USED_FRACTION;
  const left = formatData(remaining);
  const of = formatData(total);

  return (
    <div className={cx('mb-meter', className)} data-warning={warning || undefined}>
      <p className="mb-meter__text">
        <span className="mb-meter__left">
          {quietWhenFull && remaining === total && total > 0 ? s.unused(of) : s.left(left, of)}
        </span>
        {source ? <span className="mb-meter__source"> · {source}</span> : null}
      </p>
      <div
        className="mb-meter__track"
        role="meter"
        aria-label={s.dataLeft}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={remaining}
        aria-valuetext={s.left(left, of)}
      >
        <div
          className={cx('mb-meter__fill', fillOnce && 'mb-meter__fill--once')}
          style={{ transform: `scaleX(${fraction})` }}
        />
      </div>
      {usageAsOf !== undefined ? (
        <UsageAsOf
          at={usageAsOf}
          timeZone={timeZone}
          lang={lang}
          tone={warning ? 'warning' : 'default'}
        />
      ) : null}
    </div>
  );
}
