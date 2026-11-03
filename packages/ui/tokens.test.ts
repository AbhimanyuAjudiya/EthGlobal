import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  canTransition,
  colorTokens,
  fontTokens,
  motionTokens,
  objectTokens,
  onchainActionStates,
  radiusTokens,
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

  it.each([...objectTokens, ...radiusTokens])(
    'declares --%s once, with one value in both themes',
    (token) => {
      const declarations = tokensCss.match(new RegExp(`^\\s*--${token}:.*$`, 'gm')) ?? [];
      expect(declarations).toHaveLength(1);
      expect(declarations[0]).not.toContain('light-dark(');
    },
  );

  it('lets a sub-tree pin its palette with data-color-scheme (the coupon is always light)', () => {
    expect(tokensCss).toContain("[data-color-scheme='light']");
    expect(tokensCss).toContain("[data-color-scheme='dark']");
    expect(tokensCss).toMatch(/:root,\s*\[data-color-scheme\]\s*\{/);
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

  it('loads every family in one swap-enabled Google Fonts request and sets tabular numerals on html', () => {
    const imports =
      fontsCss.match(/@import url\('https:\/\/fonts\.googleapis\.com[^']+'\);/g) ?? [];
    expect(imports).toHaveLength(1);
    const url = imports[0] ?? '';
    expect(url).toContain('display=swap');
    // Turbopack drops an external @import whose URL holds a literal comma; axes/ranges must use %2C.
    expect(url).not.toContain(',');
    for (const family of [
      'Eczar',
      'Schibsted+Grotesk',
      'Mukta',
      'IBM+Plex+Mono',
      'IBM+Plex+Sans:',
      'IBM+Plex+Sans+Devanagari',
      'Archivo',
      'Anek+Devanagari',
      'Chivo+Mono',
      'Baloo+2',
    ]) {
      expect(url, family).toContain(`family=${family}`);
    }
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

/*
 * CI grep for the design-foundations §1 ban list (DECISION §8.2): fails on any banned tell in a file under
 * packages/ui/src, the ui stylesheets, or apps/web/app.
 */
const repoRoot = path.join(import.meta.dirname, '../..');
const scanRoots = ['packages/ui/src', 'apps/web/app'];
const scanFiles = ['packages/ui/tokens.css', 'packages/ui/fonts.css', 'packages/ui/print.css'];
const scanned = /\.(?:tsx?|css|mdx?|json|html|svg)$/;
const skippedDirs = new Set(['node_modules', '.next', '__snapshots__']);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return skippedDirs.has(name) ? [] : walk(full);
    return scanned.test(name) ? [full] : [];
  });
}

/** Hues of oklch()/lch()/hsl() colours (the third or first channel), for the 260–300 purple ban. */
function hues(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(/\b(?:ok)?lch\(\s*[\d.]+%?\s+[\d.]+%?\s+([\d.]+)/g))
    out.push(Number(m[1]));
  for (const m of text.matchAll(/\bhsla?\(\s*([\d.]+)/g)) out.push(Number(m[1]));
  return out;
}

const bans: readonly { name: string; test: (text: string) => boolean }[] = [
  { name: 'gradient', test: (t) => /\b(?:linear|radial|conic)-gradient\(/.test(t) },
  { name: 'backdrop-filter / blur', test: (t) => /backdrop-filter|backdrop-blur|\bblur\(/.test(t) },
  {
    name: 'banned font family (Inter, Geist, Poppins, DM Sans, Space Grotesk)',
    test: (t) => /\b(?:Inter|Geist|Poppins|DM Sans|Space Grotesk)\b/.test(t),
  },
  { name: 'accent hue 260–300', test: (t) => hues(t).some((h) => h >= 260 && h <= 300) },
  { name: 'emoji', test: (t) => /[\p{Emoji_Presentation}\u{FE0F}]/u.test(t) },
  { name: 'hover:scale / shadow-xl', test: (t) => /hover:scale|shadow-xl/.test(t) },
  {
    name: 'hype copy',
    test: (t) => /\b(?:Supercharge|Seamless|Effortless|Unlock|Empower)\b/.test(t),
  },
];

describe('design bans (CI grep)', () => {
  const files = [
    ...scanRoots.flatMap((root) => walk(path.join(repoRoot, root))),
    ...scanFiles.map((file) => path.join(repoRoot, file)),
  ];

  it('scans the component and app sources', () => {
    expect(files.some((f) => f.endsWith('Coupon.tsx'))).toBe(true);
    expect(files.some((f) => f.endsWith(path.join('app', 'ui', 'page.tsx')))).toBe(true);
  });

  it('catches every tell in a planted sample (the grep itself works)', () => {
    const samples: Record<string, string> = {
      gradient: 'background: linear-gradient(red, blue)',
      'backdrop-filter / blur': 'backdrop-filter: blur(8px)',
      'banned font family (Inter, Geist, Poppins, DM Sans, Space Grotesk)': "font-family: 'Inter'",
      'accent hue 260–300': '--accent: oklch(0.55 0.2 285)',
      emoji: 'Sent \u{1F389}',
      'hover:scale / shadow-xl': 'hover:scale-105',
      'hype copy': 'Seamless payments',
    };
    for (const ban of bans) expect(ban.test(samples[ban.name] ?? ''), ban.name).toBe(true);
    for (const ban of bans) {
      expect(
        ban.test('--accent: oklch(0.52 0.085 195); 300 MB · rub here · यहाँ रगड़ें → ↗'),
        ban.name,
      ).toBe(false);
    }
  });

  it.each(bans.map((ban) => [ban.name, ban] as const))('no %s', (_name, ban) => {
    const offenders = files
      .filter((file) => ban.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(repoRoot, file));
    expect(offenders).toEqual([]);
  });
});
