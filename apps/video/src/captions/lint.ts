/**
 * Caption lint (SCRIPTS.md §1 "Text on screen", §7 #4/#10, §8 "Captions"). Pure TS, no imports, so the Node
 * test runner can load it without the bundler. Errors fail the test; warnings are printed.
 */
import type { Caption, CaptionFile } from './types';

export const MIN_HOLD = 27;
export const MAX_HOLD = 90;
const PURCHASE = /\b(buy|buying|get yours|order now|top up now|checkout|purchase)\b/i;
const EMOJI = /\p{Extended_Pictographic}/u;

export interface LintResult {
  errors: string[];
  warnings: string[];
}

function words(text: string): number {
  return text.split(/\s+/).filter((w) => w !== '' && w !== '·').length;
}

function visibleTogether(a: Caption, b: Caption): boolean {
  if (a.when && b.when && (a.when === `!${b.when}` || b.when === `!${a.when}`)) return false;
  return a.from < b.to && b.from < a.to;
}

const REGION: Record<Caption['style'], 'upper' | 'lower'> = {
  hook: 'upper',
  footage: 'lower',
  ui: 'lower',
  note: 'lower',
};

export function lintCaptions(file: CaptionFile): LintResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const at = (c: Caption) => `${file.composition} f${c.from}–f${c.to} "${c.text}"`;
  for (const c of file.captions) {
    const hold = c.to - c.from;
    if (!Number.isInteger(c.from) || !Number.isInteger(c.to) || c.from < 0 || hold <= 0) {
      errors.push(`${at(c)}: bad frame range`);
    }
    if (c.to > file.durationInFrames) errors.push(`${at(c)}: ends after the composition`);
    if (hold < MIN_HOLD) errors.push(`${at(c)}: hold ${hold} < ${MIN_HOLD} frames`);
    if (hold > MAX_HOLD) errors.push(`${at(c)}: hold ${hold} > ${MAX_HOLD} frames`);
    if (EMOJI.test(c.text)) errors.push(`${at(c)}: emoji codepoint`);
    if (PURCHASE.test(c.text)) errors.push(`${at(c)}: purchase verb`);
    for (const m of c.mono ?? []) {
      if (!c.text.includes(m)) errors.push(`${at(c)}: mono span "${m}" not in text`);
    }
    const limit = c.lang === 'hi' ? 5 : 6;
    if (words(c.text) > limit) {
      warnings.push(`${at(c)}: ${words(c.text)} words > ${limit} (verbatim from SCRIPTS.md)`);
    }
  }
  file.captions.forEach((a, i) => {
    for (const b of file.captions.slice(i + 1)) {
      if (REGION[a.style] === REGION[b.style] && visibleTogether(a, b)) {
        errors.push(`${at(a)} overlaps ${at(b)}`);
      }
    }
  });
  return { errors, warnings };
}
