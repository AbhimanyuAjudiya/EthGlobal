/** Webhook MAC check (T-34) and the replay window every reseller adapter shares. */
import { hexToBytes, timingSafeEqual } from './bytes.js';
import { hmacSha256 } from './hash.js';

export const DEFAULT_WEBHOOK_WINDOW_S = 300;
/** Timestamps above this are milliseconds (or garbage) and are rejected. */
const MAX_SECONDS = 1e11;
const HEX_SIG = /^(?:0x)?[0-9a-fA-F]{64}$/;
const B64_SIG = /^[A-Za-z0-9+/_-]{43}=?$/;

function decodeSignature(signature: string): Uint8Array | null {
  if (HEX_SIG.test(signature)) {
    return hexToBytes(signature.startsWith('0x') ? (signature as `0x${string}`) : `0x${signature}`);
  }
  if (B64_SIG.test(signature)) {
    const std = signature.replace(/-/g, '+').replace(/_/g, '/');
    try {
      return Uint8Array.from(atob(std.endsWith('=') ? std : `${std}=`), (c) => c.charCodeAt(0));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Webhook MAC check (T-34): `signature` is hex or base64 HMAC-SHA256(secret, canonical). `timestamp` is unix SECONDS;
 * values > 1e11 (milliseconds) are rejected; |now/1000 − timestamp| ≤ windowSec in both directions; constant-time compare.
 * Providers with their own scheme build `canonical` themselves; the default canonical is `${timestamp}.${rawBody}`.
 * Pure: replay is the caller's ReplayGuard.
 */
export function verifyWebhookSignature(
  secret: Uint8Array,
  canonical: string,
  signature: string,
  timestamp: number,
  nowMs: number,
  windowSec: number = DEFAULT_WEBHOOK_WINDOW_S,
): boolean {
  if (!Number.isSafeInteger(timestamp) || timestamp <= 0 || timestamp > MAX_SECONDS) return false;
  if (Math.abs(nowMs / 1000 - timestamp) > windowSec) return false;
  const given = decodeSignature(signature.trim());
  if (given === null) return false;
  return timingSafeEqual(given, hmacSha256(secret, canonical));
}

/**
 * Remembers event ids for `windowSec × 2` (longer than any timestamp the MAC check accepts) so a captured,
 * validly signed delivery cannot be replayed inside the skew window. One instance per webhook source.
 */
export class ReplayGuard {
  readonly #seen = new Map<string, number>();
  readonly #ttlMs: number;

  constructor(windowSec: number = DEFAULT_WEBHOOK_WINDOW_S) {
    this.#ttlMs = windowSec * 2 * 1000;
  }

  /** True the first time `id` is seen within the window (and records it); false for a replay. */
  accept(id: string, nowMs: number): boolean {
    for (const [key, at] of this.#seen) {
      if (nowMs - at > this.#ttlMs) this.#seen.delete(key);
    }
    if (this.#seen.has(id)) return false;
    this.#seen.set(id, nowMs);
    return true;
  }
}
