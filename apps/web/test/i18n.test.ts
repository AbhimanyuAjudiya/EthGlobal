import { describe, expect, it } from 'vitest';

import { ERROR_CODES } from '@ethglobal/protocol/errors';

import en from '../i18n/en.json';
import hi from '../i18n/hi.json';
import mr from '../i18n/mr.json';
import { errorKey, t } from '../i18n/strings';

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}]/u;
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('i18n', () => {
  it('hi.json and mr.json carry every key of en.json, and nothing else', () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    expect(Object.keys(mr).sort()).toEqual(Object.keys(en).sort());
  });

  it('no string contains an emoji or an exclamation mark, in any language', () => {
    for (const table of [en, hi, mr])
      for (const [key, value] of Object.entries(table)) {
        expect(EMOJI.test(value), key).toBe(false);
        expect(value.includes('!'), key).toBe(false);
      }
  });

  it('every translation keeps the same placeholders', () => {
    for (const [key, value] of Object.entries(en)) {
      expect(placeholders((hi as Record<string, string>)[key] ?? ''), `hi ${key}`).toEqual(
        placeholders(value),
      );
      expect(placeholders((mr as Record<string, string>)[key] ?? ''), `mr ${key}`).toEqual(
        placeholders(value),
      );
    }
  });

  it('carries the design-references §6 table verbatim', () => {
    expect(t('verify.title', undefined, 'hi')).toBe('साबित करें कि आप एक इंसान हैं');
    expect(t('verify.title', undefined, 'mr')).toBe('तुम्ही एक माणूस आहात हे सिद्ध करा');
    expect(t('plan.install', undefined, 'hi')).toBe('eSIM इंस्टॉल करें · 2 मिनट');
    expect(t('plan.install', undefined, 'mr')).toBe('eSIM इंस्टॉल करा · 2 मिनिटे');
    expect(t('plan.add', { price: '$0.40' }, 'hi')).toBe('100 MB जोड़ें · $0.40');
    expect(t('plan.add', { price: '$0.40' }, 'mr')).toBe('100 MB जोडा · $0.40');
    expect(t('plan.reason', undefined, 'hi')).toBe('क्योंकि आप इंसान हैं');
    expect(t('plan.reason', undefined, 'mr')).toBe('कारण तुम्ही माणूस आहात');
    expect(t('error.settlement_failed', undefined, 'hi')).toContain('आपके खाते से कुछ नहीं गया।');
  });

  it('numerals and brand nouns stay Latin in Devanagari strings', () => {
    for (const table of [hi, mr])
      for (const value of Object.values(table)) expect(/[०-९]/.test(value)).toBe(false);
    expect(t('install.ios.5', undefined, 'hi')).toContain('Data Roaming');
  });

  it('every API error code has its own copy (no "Something went wrong")', () => {
    for (const code of Object.keys(ERROR_CODES)) expect(errorKey(code)).toBe(`error.${code}`);
    for (const value of Object.values(en)) expect(value).not.toMatch(/something went wrong/i);
  });

  it('Android strings never promise a one-tap install', () => {
    for (const [key, value] of Object.entries(en))
      if (key.startsWith('install.'))
        expect(value.toLowerCase(), key).not.toMatch(/one[ -]tap|instantly/);
  });

  it('fills placeholders as text', () => {
    expect(t('landing.left', { left: '1,214', max: '2,000', sponsor: 'Hedera' })).toBe(
      '1,214 of 2,000 sponsor bundles left · Hedera',
    );
  });
});
