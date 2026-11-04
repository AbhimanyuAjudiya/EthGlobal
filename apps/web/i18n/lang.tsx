'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';

import { LANG_NAMES, LANGS, t, type Lang, type Params, type StringKey } from './strings';

const STORAGE_KEY = 'recharge.lang';
const listeners = new Set<() => void>();

const isLang = (value: unknown): value is Lang => LANGS.includes(value as Lang);

/** `?lang=hi` (a shared link, the visual baselines) wins over the stored choice and is remembered. */
function urlLang(): Lang | undefined {
  try {
    const value = new URLSearchParams(window.location.search).get('lang');
    return isLang(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function readLang(): Lang {
  const fromUrl = urlLang();
  if (fromUrl) return fromUrl;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return isLang(stored) ? stored : 'en';
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
  // an explicit choice beats the link's ?lang=
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.delete('lang');
      window.history.replaceState(window.history.state, '', url);
    }
  } catch {
    // no URL to tidy
  }
  for (const listener of listeners) listener();
}

const serverLang = (): Lang => 'en';

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
  const lang = useSyncExternalStore(subscribe, readLang, serverLang);
  // The page's own language follows the choice: every Devanagari string then sits under lang="hi"|"mr" (leading
  // 1.6 from fonts.css, the right screen-reader voice) — buttons, field labels, review rows, receipts included.
  // English-only islands (wordmark, hashes, the sponsor console) carry lang="en" themselves (RT-W-08).
  useEffect(() => {
    document.documentElement.lang = lang;
    const fromUrl = urlLang();
    if (fromUrl) {
      try {
        localStorage.setItem(STORAGE_KEY, fromUrl);
      } catch {
        // per-viewer convenience only
      }
    }
  }, [lang]);
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
