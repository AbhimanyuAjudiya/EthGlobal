/**
 * eSIM hand-off links (web.md §4, T-62). The iOS universal link is built only from an LPA held in memory or
 * IndexedDB that matches LPA_PATTERN; no URL parameter ever reaches it. Android has no web-triggered install:
 * the activation code is copied, and the settings intent is offered as an unverified secondary link.
 */

/** `LPA:1$<SM-DP+ address>$<matching id>` with the optional `$<OID>$<confirmation flag>` (GSMA SGP.22 4.1). */
export const LPA_PATTERN =
  /^LPA:1\$[A-Za-z0-9](?:[A-Za-z0-9.-]{0,252})\$[A-Za-z0-9_.\-+/=]{1,255}(?:\$[0-9.]{0,64}(?:\$1)?)?$/;

export const isLpa = (value: unknown): value is string =>
  typeof value === 'string' && LPA_PATTERN.test(value);

/** Host lower-case exactly as Apple documents it; carddata is URL-encoded (`$` → %24). */
export const IOS_ESIM_SETUP = 'https://esimsetup.apple.com/esim_qrcode_provisioning';

export function iosUniversalLink(lpa: string): string {
  if (!isLpa(lpa)) throw new RangeError('not an LPA activation code');
  return `${IOS_ESIM_SETUP}?carddata=${encodeURIComponent(lpa)}`;
}

/** Opens the eSIM settings screen on some Android builds; unverified on real devices until Wednesday. */
export const ANDROID_EUICC_INTENT =
  'intent:#Intent;action=android.telephony.euicc.action.MANAGE_EMBEDDED_SUBSCRIPTIONS;end';

/** "LPA:1$smdp.example$ABC" → ["LPA:1", "smdp.example", "ABC"], for the split, copyable display. */
export function splitLpa(lpa: string): string[] {
  if (!isLpa(lpa)) throw new RangeError('not an LPA activation code');
  return lpa.split('$');
}
