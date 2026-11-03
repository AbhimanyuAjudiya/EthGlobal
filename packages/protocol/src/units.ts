/**
 * Money and data units (INTERFACES §0.1, §1.2). Money is `bigint` micro-USD; data is integer decimal MB
 * (1 GB = 1000 MB). No floats on money paths, anywhere.
 */
import { RechargeError } from './errors.js';

export type Usd6 = bigint;
export const USD6_PER_USD = 1_000_000n;
const BYTES_PER_MB = 1_000_000;
const MB_PER_GB = 1000;
/** Same bound as `digitsSchema` (wire Usd6). */
const WIRE_DIGITS = /^\d{1,30}$/;
const DECIMAL_USD = /^(\d{1,24})(?:\.(\d{1,6}))?$/;

const invalid = (message: string, details?: unknown): RechargeError =>
  new RechargeError('invalid_request', message, details);

/** '0.40' → 400000n. Rejects negatives, >6 decimals, exponents, NaN. */
export function usd6(decimal: string): Usd6 {
  const match = DECIMAL_USD.exec(decimal);
  if (!match) throw invalid(`not a non-negative decimal with at most 6 places: "${decimal}"`);
  const [, whole = '0', fraction = ''] = match;
  return BigInt(whole) * USD6_PER_USD + BigInt(fraction.padEnd(6, '0'));
}

const usdGrouping = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/**
 * 400000n → '$0.40' (en-US grouping, exact; no floats). Two decimals always; sub-cent digits are shown
 * (trailing zeros trimmed) rather than rounded away, so the string never misstates an amount.
 * `{ unit: 'USDC' }` → '$0.40 USDC'.
 */
export function formatUsd6(value: Usd6, opts: { unit?: 'USDC' | '' } = {}): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / USD6_PER_USD;
  const fraction = (abs % USD6_PER_USD).toString().padStart(6, '0');
  const shown = fraction.slice(0, 2) + fraction.slice(2).replace(/0+$/, '');
  const unit = opts.unit ? ` ${opts.unit}` : '';
  return `${negative ? '-' : ''}$${usdGrouping.format(whole)}.${shown}${unit}`;
}

/** 400000n → '400000'. */
export function usd6ToWire(value: Usd6): string {
  if (value < 0n) throw invalid('Usd6 on the wire must be non-negative');
  const wire = value.toString();
  if (!WIRE_DIGITS.test(wire)) throw invalid('Usd6 exceeds the wire bound');
  return wire;
}

/** '400000' → 400000n; throws on anything but 1–30 ASCII digits. */
export function usd6FromWire(value: string): Usd6 {
  if (!WIRE_DIGITS.test(value)) throw invalid(`not a base-unit integer string: "${value}"`);
  return BigInt(value);
}

/** floor(bytes / 1e6). Reseller bytes → MB. */
export function mbFromBytes(bytes: number | bigint): number {
  if (typeof bytes === 'bigint') {
    if (bytes < 0n) throw invalid('bytes must be non-negative');
    return Number(bytes / BigInt(BYTES_PER_MB));
  }
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw invalid('bytes must be a non-negative safe integer');
  }
  return Math.floor(bytes / BYTES_PER_MB);
}

function assertNonNegativeInt(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw invalid(`${name} must be a non-negative integer`, { [name]: value });
  }
}

function assertStep(stepMb: number): void {
  if (!Number.isSafeInteger(stepMb) || stepMb <= 0) throw invalid('stepMb must be a positive integer');
}

/** mb × 1e6. */
export function bytesFromMb(mb: number): bigint {
  assertNonNegativeInt(mb, 'mb');
  return BigInt(mb) * BigInt(BYTES_PER_MB);
}

const NBSP = ' ';
const inGrouping = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/**
 * '300 MB' below 1000; '1.5 GB' at/above (one decimal, floored so data is never overstated, '.0' dropped:
 * '1 GB'); NBSP before the unit; en-IN grouping.
 */
export function formatMb(mb: number): string {
  assertNonNegativeInt(mb, 'mb');
  if (mb < MB_PER_GB) return `${inGrouping.format(mb)}${NBSP}MB`;
  const tenths = Math.floor(mb / (MB_PER_GB / 10));
  const whole = Math.floor(tenths / 10);
  const decimal = tenths % 10;
  return `${inGrouping.format(whole)}${decimal === 0 ? '' : `.${decimal}`}${NBSP}GB`;
}

/** Throws RechargeError('invalid_request') unless 0 < mb ≤ maxMb and mb is a multiple of stepMb. */
export function assertMbStep(mb: number, stepMb: number, maxMb: number): void {
  assertStep(stepMb);
  if (!Number.isSafeInteger(mb) || mb <= 0) throw invalid('mb must be a positive integer', { mb });
  if (mb % stepMb !== 0) throw invalid(`mb must be a multiple of ${stepMb}`, { mb, stepMb });
  if (mb > maxMb) throw invalid(`mb must not exceed ${maxMb}`, { mb, maxMb });
}

/** ceil(mb / stepMb) × priceUsd6PerStep; mb must already satisfy assertMbStep. */
export function priceUsd6(mb: number, stepMb: number, priceUsd6PerStep: Usd6): Usd6 {
  assertNonNegativeInt(mb, 'mb');
  assertStep(stepMb);
  if (priceUsd6PerStep < 0n) throw invalid('price must be non-negative');
  return BigInt(Math.ceil(mb / stepMb)) * priceUsd6PerStep;
}

export const SECONDS = { minute: 60, hour: 3_600, day: 86_400 } as const;

/**
 * Seconds from now until expiresAtMs, rounded up so an entity never dies before `expiresAtMs`, and never
 * below 1 (Ledger.expiresIn must be a positive integer).
 */
export function secondsUntil(expiresAtMs: number, nowMs: number): number {
  return Math.max(1, Math.ceil((expiresAtMs - nowMs) / 1000));
}

/** India first: every displayed clock defaults to IST. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

function clockParts(ms: number, tz: string): Record<string, string> {
  const parts = new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short',
  }).formatToParts(ms);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

/** 'usage as of 14:02' in `tz` (default IST). */
export function formatAsOf(ms: number, tz: string = DEFAULT_TIME_ZONE): string {
  const p = clockParts(ms, tz);
  return `usage as of ${p['hour']}:${p['minute']}`;
}

function remaining(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d > 0) return `${d} d ${h} h`;
  if (h > 0) return `${h} h ${m} m`;
  return m > 0 ? `${m} m` : 'under 1 m';
}

/** 'Expires in 6 d 22 h · Sun 15 Nov 09:12 IST'; 'Expired · …' once past. Durations are floored. */
export function formatExpiry(
  expiresAtMs: number,
  nowMs: number,
  tz: string = DEFAULT_TIME_ZONE,
): string {
  const p = clockParts(expiresAtMs, tz);
  const at = `${p['weekday']} ${p['day']} ${p['month']} ${p['hour']}:${p['minute']} ${p['timeZoneName']}`;
  const left = expiresAtMs - nowMs;
  return left > 0 ? `Expires in ${remaining(left)} · ${at}` : `Expired · ${at}`;
}
