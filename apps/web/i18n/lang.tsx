'use client';

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { LANG_NAMES, LANGS, t, type Lang, type Params, type StringKey } from './strings';

const STORAGE_KEY = 'recharge.lang';
const listeners = new Set<() => void>();

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return LANGS.includes(stored as Lang) ? (stored as Lang) : 'en';
  } catch {
    return 'en';
  }
}

function writeLang(lang: Lang) {
  try {
    localStorage.setItem(STORAGE_KEY, lang);
  } catch {
    // per-viewer convenience only
  }
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

interface LangValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: StringKey, params?: Params) => string;
}

const LangContext = createContext<LangValue>({
  lang: 'en',
  setLang: () => undefined,
  t: (key, params) => t(key, params),
});

export function LangProvider({ children }: { children: ReactNode }) {
  const lang = useSyncExternalStore(subscribe, readLang, () => 'en');
  const translate = useCallback((key: StringKey, params?: Params) => t(key, params, lang), [lang]);
  const value = useMemo(() => ({ lang, setLang: writeLang, t: translate }), [lang, translate]);
  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);

/** A translated string in its own `lang` span, so Devanagari gets its leading and screen readers its voice. */
export function T({ k, params, className }: { k: StringKey; params?: Params; className?: string }) {
  const { lang, t: tr } = useLang();
  return (
    <span lang={lang} className={className}>
      {tr(k, params)}
    </span>
  );
}

export function LangSwitch() {
  const { lang, setLang, t: tr } = useLang();
  return (
    <div className="lang-switch" role="group" aria-label={tr('lang.label')}>
      {LANGS.map((code) => (
        <button
          key={code}
          type="button"
          lang={code}
          aria-pressed={code === lang}
          onClick={() => setLang(code)}
        >
          {LANG_NAMES[code]}
        </button>
      ))}
    </div>
  );
}
