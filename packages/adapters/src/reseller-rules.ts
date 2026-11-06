/** Boundary rules every reseller applies to vendor data before it leaves the adapter (T-39). */
import { LPA_PATTERN } from '@ethglobal/protocol/schemas';

import { AdapterError } from './errors.js';

import type { EsimProfile } from './types.js';

export const PLAN_NAME_MAX = 64;
export const ICCID_PATTERN = /^\d{18,22}$/;

export function assertCountryCode(country: string): string {
  if (!/^[A-Z]{2}$/.test(country))
    throw new AdapterError('reseller', 'invalid_request', 'country must be an uppercase ISO2 code');
  return country;
}

/** Plain text, no markup or control characters, ≤ 64 chars (names are rendered, T-39). */
export const safePlanName = (name: string): string =>
  name
    .replace(/[\p{Cc}<>"'`]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, PLAN_NAME_MAX);

/** The LPA must match LPA_PATTERN before it leaves the adapter; anything else is invalid_response. */
export function assertLpa(lpa: string): string {
  if (lpa.length > 255 || !LPA_PATTERN.test(lpa)) {
    throw new AdapterError('reseller', 'invalid_response', 'activation code is not an LPA string');
  }
  return lpa;
}

export function assertIccid(iccid: string): string {
  if (!ICCID_PATTERN.test(iccid))
    throw new AdapterError('reseller', 'invalid_response', 'malformed ICCID');
  return iccid;
}

export function assertUsage(usedMb: number, totalMb: number): void {
  if (!(
    Number.isSafeInteger(usedMb) &&
    Number.isSafeInteger(totalMb) &&
    usedMb >= 0 &&
    usedMb <= totalMb
  )) {
    throw new AdapterError('reseller', 'invalid_response', 'usage outside [0, totalMb]');
  }
}

/** Header lookup that ignores case (Node lower-cases, fetch Headers too, tests may not). */
export const headerValue = (
  headers: Record<string, string | undefined>,
  name: string,
): string | undefined => Object.entries(headers).find(([k]) => k.toLowerCase() === name)?.[1];

export type ProfileStatus = EsimProfile['status'];
