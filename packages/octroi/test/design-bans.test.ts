import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = join(import.meta.dirname, '..', 'src');
const files = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith('.ts') ? [join(dir, e.name)] : [],
  );

describe('design bans (brief §7)', () => {
  it.each([
    ['Date.now', /\bDate\.now\b/],
    ['Math.random', /\bMath\.random\b/],
    ['fetch', /\bfetch\s*\(/],
    ['console', /\bconsole\./],
    ['floats on money (parseFloat / toFixed)', /\b(parseFloat|toFixed)\b/],
    ['the v1 x402 amount field', /maxAmountRequired/],
    ['/ 1024 (1 GB = 1000 MB)', /\/\s*1024\b/],
    ['ledger.get with a caller key (T-36)', /ledger\.get\(/],
    ['adapters live or services', /@ethglobal\/(adapters\/live|api|agent|ui|web)/],
  ])('src/ has no %s', (_name, pattern) => {
    const hits = files(SRC).filter((f) => pattern.test(readFileSync(f, 'utf8')));
    expect(hits).toEqual([]);
  });

  it('only store/ calls ledger.put/query/update', () => {
    const outside = files(SRC).filter((f) => !f.includes(`${join('src', 'store')}`));
    const hits = outside.filter(
      (f) =>
        /\.(put|query|update)\(\s*\{/.test(readFileSync(f, 'utf8')) &&
        /ledger\.(put|query|update)\(/.test(readFileSync(f, 'utf8')),
    );
    expect(hits).toEqual([]);
  });
});
