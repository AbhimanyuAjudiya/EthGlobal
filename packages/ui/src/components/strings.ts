/**
 * The few strings the components set themselves, verbatim from design-references §6. Everything else
 * (titles, amounts, fees, expiry) is passed in by the app, which owns i18n. Numerals stay Latin.
 */
export type CouponLang = 'en' | 'hi';

interface CouponStrings {
  from: (sponsor: string) => string;
  human: string;
  usageAsOf: (time: string) => string;
}

export const couponStrings: Readonly<Record<CouponLang, CouponStrings>> = {
  en: {
    from: (sponsor) => `from ${sponsor}`,
    human: "because you're human",
    usageAsOf: (time) => `usage as of ${time}`,
  },
  hi: {
    from: (sponsor) => `${sponsor} की ओर से`,
    human: 'क्योंकि आप इंसान हैं',
    usageAsOf: (time) => `${time} तक का उपयोग`,
  },
};

/** Printed on the latex in both scripts, whatever the coupon's language. */
export const RUB_HERE = 'rub here · यहाँ रगड़ें';
export const RUB_HERE_LANGS = { en: 'rub here', hi: 'यहाँ रगड़ें' } as const;

export const SEP = ' · ';
