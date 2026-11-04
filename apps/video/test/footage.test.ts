/** footage/README.md (the capture checklist) names every file the compositions can use, and vice versa. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

import { FOOTAGE, SCREENS } from '../src/footage/manifest.ts';

const readme = readFileSync(join(import.meta.dirname, '../footage/README.md'), 'utf8');
const capture = readFileSync(join(import.meta.dirname, '../scripts/capture-screens.mjs'), 'utf8');

void test('every manifest file is listed in footage/README.md', () => {
  for (const spec of Object.values(FOOTAGE)) {
    assert.ok(readme.includes(`\`${spec.file}\``), `${spec.file} missing from the README table`);
  }
});

void test('manifest file names are unique and follow NN-/judge- naming', () => {
  const names = Object.values(FOOTAGE).map((s) => s.file);
  assert.equal(new Set(names).size, names.length);
  for (const n of names) assert.match(n, /^(0[1-4]|judge)-[a-z0-9-]+\.(mp4|wav)$/);
});

void test('the README carries a capture checklist for every video', () => {
  for (const h of ['Video 01', 'Video 02', 'Video 03', 'Video 04', 'Judge / sponsor video']) {
    assert.ok(readme.includes(`### ${h}`), `no checklist for ${h}`);
  }
});

void test('every headless capture is listed in the README and recorded by capture-screens.mjs', () => {
  for (const key of Object.keys(SCREENS)) {
    assert.ok(readme.includes(`| \`${key}\``), `${key} missing from the README screen table`);
    assert.ok(capture.includes(`'${key}'`), `capture-screens.mjs never records ${key}`);
  }
});
