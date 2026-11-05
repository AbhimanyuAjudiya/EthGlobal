/**
 * The few strings the components set themselves, verbatim from design-references §6 where it has them. Everything
 * else (titles, amounts, fees, expiry) is passed in by the app, which owns i18n. Numerals, units and brand nouns
 * stay Latin. Every component that prints one of these takes `lang` (RT-W-08: Marathi used to fall back to English).
 */
import type { DurationUnits } from './format';

export type CouponLang = 'en' | 'hi' | 'mr';

export interface UiStrings {
  from: (sponsor: string) => string;
  human: string;
  usageAsOf: (time: string) => string;
  /** MbMeter's text twin: "212 MB left of 300 MB". */
  left: (left: string, of: string) => string;
  /** MbMeter when nothing is used yet, so the hero's number is not repeated: "Nothing used yet". */
  unused: () => string;
  dataLeft: string;
  receipt: { label: string; you: string; sponsor: string; networkFee: string };
  units: DurationUnits;
  copied: string;
  selectToCopy: string;
  /** "rub here" on the latex (Baloo 2), in this language. */
  rub: string;
  onchain: {
    declined: (wallet: string) => string;
    approveIn: (wallet: string) => string;
    cancel: string;
    sending: string;
    sendingSeen: string;
    slower: (elapsed: string, usual: string) => string;
    speedUp: string;
    cancelTx: string;
    confirmed: string;
    settling: string;
    available: string;
    pending: string;
    paidFinal: string;
    failed: string;
    failedNote: (reason: string, fee?: string) => string;
    tryAgain: string;
    cancelled: string;
    replaced: string;
    cancelNote: (fee?: string) => string;
    spedUp: string;
    replacement: string;
  };
}

export const uiStrings: Readonly<Record<CouponLang, UiStrings>> = {
  en: {
    from: (sponsor) => `from ${sponsor}`,
    human: "because you're human",
    usageAsOf: (time) => `usage as of ${time}`,
    left: (left, of) => `${left} left of ${of}`,
    unused: () => 'Nothing used yet',
    dataLeft: 'Data left',
    receipt: { label: 'Receipt', you: 'You', sponsor: 'Sponsor', networkFee: 'Network fee' },
    units: { d: 'd', h: 'h', m: 'm', s: 's' },
    copied: 'Copied',
    selectToCopy: 'Select to copy',
    rub: 'rub here',
    onchain: {
      declined: (wallet) => `You declined in ${wallet}. Nothing was sent.`,
      approveIn: (wallet) => `Approve in ${wallet}…`,
      cancel: 'Cancel',
      sending: 'Sending',
      sendingSeen: 'Sending · seen by the network',
      slower: (elapsed, usual) =>
        `Slower than usual: ${elapsed}, usually ${usual}. Speed up, or cancel with a replacement.`,
      speedUp: 'Speed up',
      cancelTx: 'Cancel transaction',
      confirmed: 'Confirmed',
      settling: 'settling',
      available: 'Available',
      pending: 'Pending',
      paidFinal: 'Paid · Final',
      failed: "Didn't go through",
      failedNote: (reason, fee) =>
        `Didn't go through: ${reason}. ${fee ? `Nothing left your account except the ${fee} network fee.` : 'Nothing left your account.'}`,
      tryAgain: 'Try again',
      cancelled: 'Cancelled',
      replaced: 'Replaced',
      cancelNote: (fee) =>
        `Cancelled with a replacement. ${fee ? `Only the ${fee} network fee was charged.` : 'Only the network fee was charged.'}`,
      spedUp: 'Sped up with a replacement; it continues as ',
      replacement: 'Replacement',
    },
  },
  hi: {
    from: (sponsor) => `${sponsor} की ओर से`,
    human: 'क्योंकि आप इंसान हैं',
    usageAsOf: (time) => `${time} तक का उपयोग`,
    left: (left, of) => `${of} में से ${left} बचे`,
    unused: () => 'अभी कुछ इस्तेमाल नहीं हुआ',
    dataLeft: 'बचा डेटा',
    receipt: { label: 'रसीद', you: 'आप', sponsor: 'स्पॉन्सर', networkFee: 'नेटवर्क शुल्क' },
    units: { d: 'दिन', h: 'घंटे', m: 'मिनट', s: 'सेकंड' },
    copied: 'कॉपी हुआ',
    selectToCopy: 'कॉपी करने के लिए चुनें',
    rub: 'यहाँ रगड़ें',
    onchain: {
      declined: (wallet) => `आपने ${wallet} में मना किया। कुछ नहीं भेजा गया।`,
      approveIn: (wallet) => `${wallet} में मंज़ूरी दें…`,
      cancel: 'रद्द करें',
      sending: 'भेजा जा रहा है',
      sendingSeen: 'भेजा जा रहा है · नेटवर्क ने देख लिया',
      slower: (elapsed, usual) =>
        `सामान्य से धीमा: ${elapsed}, आमतौर पर ${usual}। तेज़ करें, या बदले लेन-देन से रद्द करें।`,
      speedUp: 'तेज़ करें',
      cancelTx: 'लेन-देन रद्द करें',
      confirmed: 'पुष्टि हुई',
      settling: 'निपट रहा है',
      available: 'उपलब्ध',
      pending: 'बाकी',
      paidFinal: 'भुगतान · अंतिम',
      failed: 'पूरा नहीं हुआ',
      failedNote: (reason, fee) =>
        `पूरा नहीं हुआ: ${reason}। ${fee ? `${fee} नेटवर्क शुल्क के सिवा आपके खाते से कुछ नहीं गया।` : 'आपके खाते से कुछ नहीं गया।'}`,
      tryAgain: 'फिर कोशिश करें',
      cancelled: 'रद्द हुआ',
      replaced: 'बदला गया',
      cancelNote: (fee) =>
        `बदले लेन-देन से रद्द हुआ। ${fee ? `सिर्फ़ ${fee} नेटवर्क शुल्क लगा।` : 'सिर्फ़ नेटवर्क शुल्क लगा।'}`,
      spedUp: 'बदले लेन-देन से तेज़ किया; अब यह चल रहा है: ',
      replacement: 'बदला लेन-देन',
    },
  },
  mr: {
    from: (sponsor) => `${sponsor} कडून`,
    human: 'कारण तुम्ही माणूस आहात',
    usageAsOf: (time) => `${time} पर्यंतचा वापर`,
    left: (left, of) => `${of} पैकी ${left} शिल्लक`,
    unused: () => 'अजून काहीही वापरले नाही',
    dataLeft: 'शिल्लक डेटा',
    receipt: { label: 'पावती', you: 'तुम्ही', sponsor: 'प्रायोजक', networkFee: 'नेटवर्क शुल्क' },
    units: { d: 'दिवस', h: 'तास', m: 'मिनिटे', s: 'सेकंद' },
    copied: 'कॉपी झाले',
    selectToCopy: 'कॉपी करण्यासाठी निवडा',
    rub: 'इथे घासा',
    onchain: {
      declined: (wallet) => `तुम्ही ${wallet} मध्ये नकार दिला. काहीही पाठवले नाही.`,
      approveIn: (wallet) => `${wallet} मध्ये मंजुरी द्या…`,
      cancel: 'रद्द करा',
      sending: 'पाठवत आहे',
      sendingSeen: 'पाठवत आहे · नेटवर्कने पाहिले',
      slower: (elapsed, usual) =>
        `नेहमीपेक्षा हळू: ${elapsed}, साधारण ${usual}. वेग वाढवा, किंवा बदली व्यवहाराने रद्द करा.`,
      speedUp: 'वेग वाढवा',
      cancelTx: 'व्यवहार रद्द करा',
      confirmed: 'पुष्टी झाली',
      settling: 'निकाली निघत आहे',
      available: 'उपलब्ध',
      pending: 'प्रलंबित',
      paidFinal: 'भरले · अंतिम',
      failed: 'पूर्ण झाले नाही',
      failedNote: (reason, fee) =>
        `पूर्ण झाले नाही: ${reason}. ${fee ? `${fee} नेटवर्क शुल्काशिवाय तुमच्या खात्यातून काही गेले नाही.` : 'तुमच्या खात्यातून काही गेले नाही.'}`,
      tryAgain: 'पुन्हा प्रयत्न करा',
      cancelled: 'रद्द झाले',
      replaced: 'बदलले',
      cancelNote: (fee) =>
        `बदली व्यवहाराने रद्द झाले. ${fee ? `फक्त ${fee} नेटवर्क शुल्क लागले.` : 'फक्त नेटवर्क शुल्क लागले.'}`,
      spedUp: 'बदली व्यवहाराने वेग वाढवला; आता हा चालू आहे: ',
      replacement: 'बदली व्यवहार',
    },
  },
};

/** The coupon's own lines (kept as the original name for the gallery and the tests). */
export const couponStrings = uiStrings;

/** Printed on the latex in both scripts, whatever the coupon's language. */
export const RUB_HERE = 'rub here · यहाँ रगड़ें';
export const RUB_HERE_LANGS = { en: 'rub here', hi: 'यहाँ रगड़ें' } as const;

export const SEP = ' · ';
