/** `pnpm openapi` writes services/api/openapi.json; `pnpm openapi:check` fails when it differs from the generator. */
import { readFileSync, writeFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { openApiDocument } from '../src/openapi.js';

const file = new URL('../openapi.json', import.meta.url);
const generated = `${JSON.stringify(openApiDocument(), null, 2)}\n`;
if (process.argv.includes('--check')) {
  // compared as data: prettier may re-wrap the committed file
  const committed: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isDeepStrictEqual(committed, openApiDocument())) {
    console.error('openapi.json is stale: run pnpm --filter @ethglobal/api openapi');
    process.exit(1);
  }
  console.log('openapi.json is up to date');
} else {
  writeFileSync(file, generated);
  console.log('wrote openapi.json');
}
