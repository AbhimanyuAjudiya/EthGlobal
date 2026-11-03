/**
 * Display helpers the components need to split values into typographic parts. Amount, fee and expiry
 * *strings* come from the caller (the app formats them with @ethglobal/protocol/units); these helpers only
 * cover what a component must lay out itself: the MB/GB parts of the hero number, a 24-hour clock, the
 * 4 × 4 PIN groups and the short 0x form.
 */

const MB_PER_GB = 1000;
const enIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** The no-break space that sits between a number and its unit. */
export const NBSP = ' ';

export interface DataAmount {
  value: string;
  unit: 'MB' | 'GB';
}

/** 300 → { 300, MB }; 1500 → { 1.5, GB }. GB is floored to one decimal so data is never overstated. */
export function dataAmount(mb: number): DataAmount {
  const safe = Number.isFinite(mb) && mb > 0 ? Math.floor(mb) : 0;
  if (safe < MB_PER_GB) return { value: enIN.format(safe), unit: 'MB' };
  const tenths = Math.floor(safe / (MB_PER_GB / 10));
  const whole = enIN.format(Math.floor(tenths / 10));
  const decimal = tenths % 10;
  return { value: decimal === 0 ? whole : `${whole}.${decimal}`, unit: 'GB' };
}

export const formatData = (mb: number): string => {
  const { value, unit } = dataAmount(mb);
  return `${value}${NBSP}${unit}`;
};

/** India first: clocks default to IST. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

function parts(ms: number, timeZone: string, withDate: boolean): Record<string, string> {
  const formatted = new Intl.DateTimeFormat('en-IN', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
    ...(withDate ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
  }).formatToParts(ms);
  return Object.fromEntries(formatted.map((part) => [part.type, part.value]));
}

/** 24-hour "14:02" in `timeZone` (en-IN); `zone: true` appends the short zone name ("14:02 IST"). */
export function clock(ms: number, timeZone = DEFAULT_TIME_ZONE, zone = false): string {
  const p = parts(ms, timeZone, false);
  const time = `${p['hour'] ?? '00'}:${p['minute'] ?? '00'}`;
  return zone ? `${time} ${p['timeZoneName'] ?? ''}`.trim() : time;
}

/** "Sun 15 Nov 09:12 IST". */
export function dateTime(ms: number, timeZone = DEFAULT_TIME_ZONE): string {
  const p = parts(ms, timeZone, true);
  return `${p['weekday'] ?? ''} ${p['day'] ?? ''} ${p['month'] ?? ''} ${clock(ms, timeZone, true)}`;
}

/** "6 d 22 h", "3 h 12 m", and seconds only under an hour: "42 m 10 s". Floored; never negative. */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const d = Math.floor(total / 86_400);
  const h = Math.floor((total % 86_400) / 3_600);
  const m = Math.floor((total % 3_600) / 60);
  const s = total % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} m`;
  return `${m} m ${s} s`;
}

const PIN_PATTERN = /^\d{16}$/;

/** "4821993011275064" → ["4821", "9930", "1127", "5064"]. Spaces are ignored; anything else throws. */
export function pinGroups(pin: string): [string, string, string, string] {
  const digits = pin.replace(/\s+/g, '');
  if (!PIN_PATTERN.test(digits)) throw new RangeError('a PIN is 16 digits');
  return [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12), digits.slice(12, 16)];
}

/** "0x1a2b3c…9f3e" → "0x1a2b…9f3e"; short values are returned unchanged. */
export function shortHex(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 6)}…${value.slice(-4)}`;
}

/** Joins class names, dropping falsy entries. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(' ');
}
