/**
 * The design-foundations.md §1 / SCRIPTS.md §7–§8 grep over apps/video/src: no glass, no gradients, no banned
 * families, no emoji, no accent hue 260–300, no spring/bounce motion, and no colour literal that is not a
 * tokens.css custom property (the only literal allowed is the 60 % black caption shadow).
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const SRC = join(import.meta.dirname, '../src');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const sources = walk(SRC)
  .filter((p) => /\.(tsx?|css|json)$/.test(p))
  .map((p) => ({ p, text: readFileSync(p, 'utf8') }));

/** Strip comments so the rules (which name the banned things) can be documented in prose. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const RULES: [string, RegExp][] = [
  ['backdrop-filter / glass', /backdrop-filter|backdropFilter|blur\(/i],
  ['gradient', /gradient\(/i],
  ['banned font family', /\b(Inter|Geist|Poppins|DM Sans)\b/],
  ['emoji codepoint', /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]|\u{FE0F}/u],
  ['hue 260–300', /oklch\([^)]*\s(2[6-9]\d|300)(\.\d+)?\s*\)/i],
  ['spring()/bounce easing', /\bspring\(|Easing\.(bounce|elastic|back)/],
  ['confetti / success', /confetti|Success!/i],
  ['hex colour literal', /#[0-9a-fA-F]{3,8}\b(?![\w-])/],
  ['raw colour function', /\b(?:rgb|rgba|hsl|hsla|oklch|oklab)\((?!0 0 0 \/ 0\.6\))/],
];

for (const [name, re] of RULES) {
  void test(`no ${name} in apps/video/src`, () => {
    const hits = sources
      .filter(({ text }) => re.test(code(text)))
      .map(({ p }) => p.replace(SRC, 'src'));
    assert.deepEqual(hits, []);
  });
}

void test('the accent is referenced only as var(--accent)', () => {
  const hues = sources.flatMap(({ text }) =>
    [...code(text).matchAll(/oklch\([^)]*\)/g)].map((m) => m[0]),
  );
  assert.deepEqual(hues, []);
});
