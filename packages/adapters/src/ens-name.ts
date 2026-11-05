/** ENSIP-15 name normalisation (viem `normalize`), shared by the mock and the live resolver (T-43). */
import { normalize } from 'viem/ens';

import { AdapterError } from './errors.js';

/**
 * Trims, then ENSIP-15-normalises (lower-cases, maps, rejects disallowed and mixed-script names such as a
 * Cyrillic `а` in a Latin label). Throws AdapterError('names', 'invalid_name') for input that cannot be a name,
 * so the API answers 400 (bad input) rather than 404 (no such name).
 */
export function normalizeEnsName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '' || trimmed.length > 255 || !trimmed.includes('.')) {
    throw new AdapterError('names', 'invalid_name', 'not an ENS name');
  }
  // ENSIP-15 silently drops some invisible characters (U+200B…); a name that differs from another only by an
  // invisible character is a spoof, so refuse it outright (T-43).
  if (/[\p{Cf}\p{Cc}\p{Zl}\p{Zp}]/u.test(trimmed)) {
    throw new AdapterError('names', 'invalid_name', 'name contains invisible characters');
  }
  let normalized: string;
  try {
    normalized = normalize(trimmed);
  } catch {
    throw new AdapterError('names', 'invalid_name', 'name is not ENSIP-15 normalisable');
  }
  if (normalized.split('.').some((label) => label === '')) {
    throw new AdapterError('names', 'invalid_name', 'empty label');
  }
  return normalized;
}
