/**
 * Footage presence check, run in calculateMetadata so a missing capture becomes a placeholder slate instead of
 * a failed render. A one-byte ranged GET against the bundle's static server: 200/206 means the file is there.
 */
import { staticFile } from 'remotion';

import { footagePath, type FootageAvailability, type FootageKey } from './manifest';

async function exists(path: string): Promise<boolean> {
  try {
    const res = await fetch(staticFile(path), { headers: { Range: 'bytes=0-0' } });
    await res.body?.cancel();
    // A static server that falls back to index.html must not count as "present".
    return res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');
  } catch {
    return false;
  }
}

export async function probeFootage(keys: readonly FootageKey[]): Promise<FootageAvailability> {
  const entries = await Promise.all(
    keys.map(async (k) => [k, await exists(footagePath(k))] as const),
  );
  return Object.fromEntries(entries) as FootageAvailability;
}
