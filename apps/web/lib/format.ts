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

const enIN = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

/** Day and month names in the reader's language, numerals Latin (same rule as @ethglobal/ui `dateLocale`). */
const dateLocale = (lang: string): string =>
  lang === 'hi' || lang === 'mr' ? `${lang}-IN-u-nu-latn` : 'en-IN';

/** protocol/units groups the dollars en-US; an India-first product groups them en-IN (web.md §8): 9,99,986.80. */
const regroup = (text: string): string =>
  text.replace(/\d[\d,]*(?=\.)/, (whole) => enIN.format(BigInt(whole.replace(/,/g, ''))));

const usd6Of = (usd6: string | bigint): bigint =>
  typeof usd6 === 'bigint' ? usd6 : usd6FromWire(usd6);

/** "$0.40" from a wire string ("400000") or bigint; "$9,99,986.80" (en-IN grouping). */
export const money = (usd6: string | bigint): string => regroup(formatUsd6(usd6Of(usd6)));

/** "$0.40 USDC" — the unit that moves, on buttons and receipts. */
export const moneyUsdc = (usd6: string | bigint): string =>
  regroup(formatUsd6(usd6Of(usd6), { unit: 'USDC' }));

/** "9,99,986.80 USDC" — a balance, no dollar sign. */
export const usdcBalance = (usd6: bigint): string => `${money(usd6).replace('$', '')} USDC`;

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

/** "Sun 15 Nov" in IST; "रवि 15 नव॰" for hi/mr (Latin numerals, RT-W-08). */
export function dayLabel(ms: number, lang = 'en'): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat(dateLocale(lang), {
      timeZone: DEFAULT_TIME_ZONE,
      weekday: 'short',
      day: 'numeric',
      month: 'short',
    })
      .formatToParts(ms)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.weekday ?? ''} ${parts.day ?? ''} ${parts.month ?? ''}`.trim();
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
