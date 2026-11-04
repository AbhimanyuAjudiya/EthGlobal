'use client';

import { useEffect, useState } from 'react';

import { themes, typePairings, type Theme, type TypePairing } from '@ethglobal/ui';

type ThemeChoice = Theme | 'system';
const themeChoices: readonly ThemeChoice[] = ['system', ...themes];

const selectClass =
  'rounded-md border border-border-input bg-surface px-2 py-1 text-14 text-ink focus:outline-2 focus:outline-offset-2 focus:outline-focus';

/** Switches <html data-type> and <html data-theme> so every token on the page re-renders in context. */
export function TokenControls() {
  const [pairing, setPairing] = useState<TypePairing>('ledger');
  const [theme, setTheme] = useState<ThemeChoice>('system');

  useEffect(() => {
    document.documentElement.dataset.type = pairing;
  }, [pairing]);

  useEffect(() => {
    if (theme === 'system') {
      delete document.documentElement.dataset.theme;
    } else {
      document.documentElement.dataset.theme = theme;
    }
  }, [theme]);

  return (
    <form
      className="flex flex-wrap gap-4 text-14 text-ink-secondary"
      onSubmit={(event) => event.preventDefault()}
    >
      <label className="flex items-center gap-2">
        Type pairing
        <select
          className={selectClass}
          value={pairing}
          onChange={(event) => setPairing(event.target.value as TypePairing)}
        >
          {typePairings.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2">
        Theme
        <select
          className={selectClass}
          value={theme}
          onChange={(event) => setTheme(event.target.value as ThemeChoice)}
        >
          {themeChoices.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </label>
    </form>
  );
}
