/**
 * Red-team verification variant for RT-G-05 (no test mnemonic / key in the agent): the regression scans `src/`. Here the
 * BUILT output — what `pnpm --filter @ethglobal/agent start` runs (`node dist/index.js`). The build is redone into a
 * temp dir (tsconfig.build.json, `--outDir`), because a checked-out `dist/` may predate the fix and `scan.sh` skips
 * `*\/dist/*`. Properties: no emitted file spells a test phrase or a 32-byte hex key, and the only reference to
 * `@ethglobal/adapters/testing` is the dynamic import behind the `mode !== 'local'` early return.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const PKG = join(import.meta.dirname, '../..');
const TSC = join(PKG, 'node_modules/.bin/tsc');

describe('verify RT-G-05: a fresh build of the agent carries no test secret', () => {
  it('tsc -p tsconfig.build.json → no phrase, no hex key; testing imported only lazily after the live guard', async () => {
    const out = mkdtempSync(join(tmpdir(), 'verify-g05-'));
    execFileSync(TSC, ['-p', join(PKG, 'tsconfig.build.json'), '--outDir', out], { stdio: 'pipe' });
    const files = (await readdir(out, { recursive: true })).filter((f) => f.endsWith('.js'));
    expect(files.length).toBeGreaterThan(5);
    const importers: string[] = [];
    for (const f of files) {
      const text = await readFile(join(out, f), 'utf8');
      expect(text, f).not.toMatch(/\b(?:test ){11}junk\b/);
      expect(text, f).not.toMatch(/0x[0-9a-f]{64}/i);
      if (text.includes('@ethglobal/adapters/testing')) {
        importers.push(f);
        expect(text).toMatch(
          /mode !== ['"]local['"]\)\s*return undefined;\s*const \{[^}]*\} = await import\(['"]@ethglobal\/adapters\/testing['"]\)/,
        );
        expect(text).not.toMatch(/^import .*@ethglobal\/adapters\/testing/m);
      }
    }
    expect(importers).toEqual(['deps.js']);
  }, 120_000);
});
