import { clock, cx, DEFAULT_TIME_ZONE } from './format';
import { couponStrings, type CouponLang } from './strings';

export interface UsageAsOfProps {
  /** When the usage figure was measured (the API's usageAsOf, never the ledger read time), ms or Date. */
  at: number | Date;
  /** Zone the clock is shown in; IST by default. */
  timeZone?: string;
  /** The viewer's own zone; when it differs from `timeZone` the zone name is appended ("14:02 IST"). */
  viewerTimeZone?: string;
  lang?: CouponLang;
  /** warning once usage reaches 80 %: the line turns --warning, nothing else changes. */
  tone?: 'default' | 'warning';
  className?: string;
}

/** "usage as of 14:02" — 12 px Chivo Mono, 24-hour en-IN clock, a <time> with the ISO instant. */
export function UsageAsOf({
  at,
  timeZone = DEFAULT_TIME_ZONE,
  viewerTimeZone,
  lang = 'en',
  tone = 'default',
  className,
}: UsageAsOfProps) {
  const ms = typeof at === 'number' ? at : at.getTime();
  const showZone = viewerTimeZone !== undefined && viewerTimeZone !== timeZone;
  const time = clock(ms, timeZone, showZone);
  const text = couponStrings[lang].usageAsOf(time);
  return (
    <p className={cx('usage-as-of', className)} data-tone={tone} lang={lang}>
      <time dateTime={new Date(ms).toISOString()}>{text}</time>
    </p>
  );
}
