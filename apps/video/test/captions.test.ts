/**
 * Caption tracks: the lint from src/captions/lint.ts (hold 27–90 frames, no emoji, no purchase verb, no
 * overlaps, mono spans exist) and a verbatim check — every on-screen string must appear in SCRIPTS.md.
 */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { lintCaptions } from '../src/captions/lint.ts';

import type { CaptionFile } from '../src/captions/types.ts';

const dir = join(import.meta.dirname, '../src/captions/data');
const scripts = readFileSync(
  join(import.meta.dirname, '../../../marketing/videos/SCRIPTS.md'),
  'utf8',
);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

void test('there is one caption track per short', () => {
  assert.equal(files.length, 4);
});

for (const name of files) {
  const file = JSON.parse(readFileSync(join(dir, name), 'utf8')) as CaptionFile;

  void test(`${name}: lint`, () => {
    const { errors, warnings } = lintCaptions(file);
    for (const w of warnings) console.log(`  warn ${w}`);
    assert.deepEqual(errors, []);
  });

  void test(`${name}: every string is verbatim from SCRIPTS.md`, () => {
    for (const c of file.captions) {
      assert.ok(scripts.includes(`\`${c.text}\``), `not in SCRIPTS.md: "${c.text}"`);
    }
  });
}

void test('the lint catches what it claims to', () => {
  const bad: CaptionFile = {
    composition: 'X',
    source: 'test',
    durationInFrames: 100,
    captions: [
      { from: 0, to: 10, text: 'Buy now', style: 'ui', lang: 'en' },
      { from: 5, to: 60, text: 'Hello \u{1F680}', style: 'ui', lang: 'en', mono: ['zzz'] },
    ],
  };
  const { errors } = lintCaptions(bad);
  const all = errors.join('\n');
  for (const needle of ['hold 10', 'purchase verb', 'emoji', 'mono span', 'overlaps']) {
    assert.ok(all.includes(needle), `expected "${needle}" in:\n${all}`);
  }
});
