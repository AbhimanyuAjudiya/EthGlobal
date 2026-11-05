/** Loads files from `<repo>/fixtures` (INTERFACES §10). Node only. */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function findRepoRoot(from: string): string {
  let dir = from;
  for (;;) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('loadFixture: no pnpm-workspace.yaml above this module');
    dir = parent;
  }
}

let fixturesDir: string | undefined;

/** Absolute path of `<repo>/fixtures/<relPath>`; refuses paths that escape the fixtures directory. */
export function fixturePath(relPath: string): string {
  fixturesDir ??= join(findRepoRoot(dirname(fileURLToPath(import.meta.url))), 'fixtures');
  const full = resolve(fixturesDir, relPath);
  if (!full.startsWith(`${fixturesDir}/`))
    throw new Error(`loadFixture: ${relPath} escapes fixtures/`);
  return full;
}

/** Parsed JSON of `<repo>/fixtures/<relPath>`. */
export function loadFixture<T = unknown>(relPath: string): T {
  return JSON.parse(readFileSync(fixturePath(relPath), 'utf8')) as T;
}
