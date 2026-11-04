/**
 * Thin wrappers over @ethglobal/protocol/units (no second formatter): money with the unit that moves, MB/GB,
 * "usage as of", expiry from the entity's expiresAt, all in the viewer's zone with "IST" when it differs.
 */
import {
  DEFAULT_TIME_ZONE,
  formatExpiry,
  formatMb,
  formatUsd6,
  usd6FromWire,
} from '@ethglobal/protocol/units';

export { formatMb };

/** "$0.40" from a wire string ("400000") or bigint. */
export const money = (usd6: string | bigint): string =>
  formatUsd6(typeof usd6 === 'bigint' ? usd6 : usd6FromWire(usd6));

/** "$0.40 USDC" — the unit that moves, on buttons and receipts. */
export const moneyUsdc = (usd6: string | bigint): string =>
  formatUsd6(typeof usd6 === 'bigint' ? usd6 : usd6FromWire(usd6), { unit: 'USDC' });

/** Price of `mb` at `priceUsd6PerStep` per 100 MB, as a bigint (one price, no invented discounts). */
export const priceFor = (mb: number, priceUsd6PerStep: string, stepMb = 100): bigint =>
  (BigInt(mb) / BigInt(stepMb)) * usd6FromWire(priceUsd6PerStep);

export function viewerTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_TIME_ZONE;
  } catch {
    return DEFAULT_TIME_ZONE;
  }
}

/** "Expires in 6 d 22 h · Sun 15 Nov 09:12 IST", always from the entity's expiresAt. */
export const expiryLine = (expiresAt: number, now: number): string =>
  formatExpiry(expiresAt, now, DEFAULT_TIME_ZONE);

/** "Sun 15 Nov" in IST. */
export function dayLabel(ms: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: DEFAULT_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(ms);
}

/** "03:12" in IST, 24-hour. */
export function clockIst(ms: number): string {
  return new Intl.DateTimeFormat('en-IN', {
    timeZone: DEFAULT_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(ms);
}

/** Elapsed m:ss for "Waiting for World App · 0:42" and approval expiry "5:00". */
export function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** ICCIDs in groups of five. */
export const iccidGroups = (iccid: string): string => iccid.replace(/(\d{5})(?=\d)/g, '$1 ');
