/**
 * Typed UI strings (web.md §7). `en.json` defines the keys; `hi.json` and `mr.json` must carry every key
 * (test/i18n.test.ts). Brand nouns, units and numerals stay Latin; `{name}` placeholders are filled as text.
 */
import en from './en.json';
import hi from './hi.json';
import mr from './mr.json';

export type Lang = 'en' | 'hi' | 'mr';
export type StringKey = keyof typeof en;
export type Params = Readonly<Record<string, string | number>>;

export const LANGS: readonly Lang[] = ['en', 'hi', 'mr'];
export const LANG_NAMES: Readonly<Record<Lang, string>> = { en: 'EN', hi: 'हिं', mr: 'मरा' };

export const tables: Readonly<Record<Lang, Readonly<Record<string, string>>>> = { en, hi, mr };

export function t(key: StringKey, params?: Params, lang: Lang = 'en'): string {
  const template = tables[lang][key] ?? en[key];
  return params
    ? template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in params ? String(params[name]) : match,
      )
    : template;
}

/** The error copy for an API error code (falls back to the generic server line, never "Something went wrong"). */
export function errorKey(code: string): StringKey {
  const key = `error.${code}`;
  return (key in en ? key : 'error.internal_error') as StringKey;
}
