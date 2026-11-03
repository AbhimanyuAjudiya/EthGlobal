import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canTransition,
  colorTokens,
  fontTokens,
  motionTokens,
  onchainActionStates,
  onchainActionTransitions,
  typePairings,
  typeScale,
} from './index.js';

const read = (file: string) => readFileSync(path.join(import.meta.dirname, file), 'utf8');
const tokensCss = read('tokens.css');
const fontsCss = read('fonts.css');
const tailwindCss = read('tailwind.css');

describe('tokens.css', () => {
  it.each([...colorTokens, ...motionTokens, ...typeScale.map((step) => `text-${step}`)])(
    'declares --%s',
    (token) => {
      expect(tokensCss).toMatch(new RegExp(`^\\s*--${token}:`, 'm'));
    },
  );

  it('declares every colour token once, with a light and a dark value', () => {
    for (const token of colorTokens) {
      const declarations = tokensCss.match(new RegExp(`^\\s*--${token}:.*$`, 'gm')) ?? [];
      expect(declarations, token).toHaveLength(1);
      if (token !== 'focus') expect(declarations[0], token).toContain('light-dark(');
    }
  });

  it('supports the manual theme toggle and the system preference', () => {
    expect(tokensCss).toContain('color-scheme: light dark');
    expect(tokensCss).toContain(":root[data-theme='light']");
    expect(tokensCss).toContain(":root[data-theme='dark']");
  });
});

describe('fonts.css', () => {
  it.each(typePairings)('defines the %s pairing', (pairing) => {
    const block = new RegExp(`\\[data-type='${pairing}'\\]\\s*\\{([^}]*)\\}`).exec(fontsCss);
    expect(block, pairing).not.toBeNull();
    for (const font of fontTokens) expect(block?.[1], `${pairing} ${font}`).toContain(`--${font}:`);
  });

  it('loads fonts with display=swap and sets tabular numerals on html', () => {
    const imports =
      fontsCss.match(/@import url\('https:\/\/fonts\.googleapis\.com[^']+'\);/g) ?? [];
    expect(imports.length).toBeGreaterThanOrEqual(3);
    for (const line of imports) expect(line).toContain('display=swap');
    expect(fontsCss).toMatch(/html\s*\{[^}]*font-variant-numeric: tabular-nums/);
  });
});

describe('tailwind.css', () => {
  it.each(colorTokens)('bridges --%s into the Tailwind theme', (token) => {
    expect(tailwindCss).toContain(`var(--${token})`);
  });
});

describe('onchain action state machine', () => {
  it('has eight states and every transition targets a known state', () => {
    expect(onchainActionStates).toHaveLength(8);
    for (const [from, targets] of Object.entries(onchainActionTransitions)) {
      expect(onchainActionStates).toContain(from);
      for (const to of targets) expect(onchainActionStates).toContain(to);
    }
  });

  it('keeps finalized and replaced terminal, and lets a wallet rejection return to idle', () => {
    expect(onchainActionTransitions.finalized).toEqual([]);
    expect(onchainActionTransitions.replaced).toEqual([]);
    expect(canTransition('signing', 'idle')).toBe(true);
    expect(canTransition('finalized', 'idle')).toBe(false);
  });
});
