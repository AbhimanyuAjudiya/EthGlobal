/**
 * Footage presence check, run in calculateMetadata so a missing capture becomes a placeholder slate instead of
 * a failed render. A one-byte ranged GET against the bundle's static server: 200/206 means the file is there.
 */
import { staticFile } from 'remotion';

import {
  FOOTAGE,
  footagePath,
  screenFile,
  screenPath,
  type FootageAvailability,
  type FootageKey,
  type ScreenAvailability,
  type ScreenKey,
  type ScreenTheme,
} from './manifest';

type Fetch = typeof globalThis.fetch;

async function exists(fetchImpl: Fetch, path: string): Promise<boolean> {
  try {
    const res = await fetchImpl(staticFile(path), { headers: { Range: 'bytes=0-0' } });
    await res.body?.cancel();
    // A static server that falls back to index.html must not count as "present".
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

/** footage/index.json, written by scripts/footage-index.sh before every render: one request instead of N. */
async function readIndex(fetchImpl: Fetch): Promise<Set<string> | null> {
  try {
    const res = await fetchImpl(staticFile('footage/index.json'));
    if (!res.ok) return null;
    const files: unknown = await res.json();
    return Array.isArray(files)
      ? new Set(files.filter((f): f is string => typeof f === 'string'))
      : null;
  } catch {
    return null;
  }
}

/**
 * `fetch` is injected (workspace rule: no bare fetch); calculateMetadata passes the page's own fetch, which can
 * only reach the bundle's static server.
 */
export async function probeFootage(
  keys: readonly FootageKey[],
  fetchImpl: Fetch,
): Promise<FootageAvailability> {
  const index = await readIndex(fetchImpl);
  if (index) {
    return Object.fromEntries(keys.map((k) => [k, index.has(FOOTAGE[k].file)]));
  }
  // Studio without an index: ask the static server per file (404s in the console are expected).
  const entries = await Promise.all(
    keys.map(async (k) => [k, await exists(fetchImpl, footagePath(k))] as const),
  );
  return Object.fromEntries(entries);
}

/** The headless captures (footage/screen/<key>-<theme>.mp4) present for `theme`. */
export async function probeScreens(
  keys: readonly ScreenKey[],
  theme: ScreenTheme,
  fetchImpl: Fetch,
): Promise<ScreenAvailability> {
  const index = await readIndex(fetchImpl);
  if (index) return Object.fromEntries(keys.map((k) => [k, index.has(screenFile(k, theme))]));
  const entries = await Promise.all(
    keys.map(async (k) => [k, await exists(fetchImpl, screenPath(k, theme))] as const),
  );
  return Object.fromEntries(entries);
}
