/**
 * eSIM hand-off links (web.md §4, T-62). The iOS universal link is built only from an LPA held in memory or
 * IndexedDB that matches LPA_PATTERN; no URL parameter ever reaches it. Android has no web-triggered install:
 * the activation code is copied, and the settings intent is offered as an unverified secondary link.
 */

import { LPA_PATTERN, lpaSchema } from '@ethglobal/protocol/schemas';

export { LPA_PATTERN };
export const isLpa = (value: unknown): value is string => lpaSchema.safeParse(value).success;

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
