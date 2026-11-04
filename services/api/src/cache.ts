import { AdapterError, isAdapterError, type Ledger } from '@ethglobal/adapters';
import { RechargeError } from '@ethglobal/protocol/errors';
import { ENTITLEMENT_CACHE_S } from '@ethglobal/protocol/ids';
import type { MeResponse } from '@ethglobal/protocol/schemas';

const TTL_MS = ENTITLEMENT_CACHE_S * 1000;
const MAX_ENTRIES = 10_000;

/**
 * The 60-s read cache of GET /me/:key (T-51) — the ONLY cached read; decide() paths always hit the ledger.
 * Also remembers the expiry of every entitlement it has seen, so a vanished entity reads as 410 (not 404).
 */
export class MeCache {
  readonly #entries = new Map<string, { me: MeResponse; at: number }>();
  readonly #expiries = new Map<string, number>();

  constructor(private readonly now: () => number) {}

  /** A fresh entry (younger than 60 s), or undefined. */
  fresh(key: string): MeResponse | undefined {
    const hit = this.#entries.get(key);
    return hit && this.now() - hit.at < TTL_MS ? hit.me : undefined;
  }

  /** Any entry, however old (served with `degraded: true` while the ledger is down). */
  stale(key: string): MeResponse | undefined {
    return this.#entries.get(key)?.me;
  }

  remember(key: string, me: MeResponse): void {
    bounded(this.#entries, key, { me, at: this.now() });
    this.seen(key, me.expiresAt);
  }

  /** Write-through invalidation from fulfil, top-ups and webhooks. */
  invalidate(key: string): void {
    this.#entries.delete(key);
  }

  seen(key: string, expiresAt: number): void {
    bounded(this.#expiries, key, expiresAt);
  }

  /** True when this key was a live entitlement that has since passed its expiry. */
  expired(key: string): boolean {
    const at = this.#expiries.get(key);
    return at !== undefined && at <= this.now();
  }
}

/** Insert-or-refresh with the oldest entry evicted beyond MAX_ENTRIES (process-local caches). */
export function bounded<V>(map: Map<string, V>, key: string, value: V): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_ENTRIES) {
    const oldest = map.keys().next().value;
    if (oldest !== undefined) map.delete(oldest);
  }
}

/** `degraded` = the ledger threw within the last 60 s (T-51): reads serve the cache, writes fail closed. */
export class LedgerHealth {
  #lastFailure: number | undefined;

  constructor(private readonly now: () => number) {}

  failed(): void {
    this.#lastFailure = this.now();
  }

  get degraded(): boolean {
    return this.#lastFailure !== undefined && this.now() - this.#lastFailure < TTL_MS;
  }
}

/** A transparent ledger wrapper that records failures and timings; it builds no annotations (rule 9 stays). */
export function observedLedger(
  ledger: Ledger,
  health: LedgerHealth,
  observe: (op: string, ms: number, ok: boolean) => void,
): Ledger {
  const wrap =
    <A extends unknown[], R>(op: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      const started = performance.now();
      try {
        const result = await fn(...args);
        observe(op, performance.now() - started, true);
        return result;
      } catch (error) {
        health.failed();
        observe(op, performance.now() - started, false);
        // a transport-level failure is the ledger being unavailable (503), never an internal error
        if (isAdapterError(error) || error instanceof RechargeError) throw error;
        throw new AdapterError('ledger', 'unavailable', 'ledger call failed');
      }
    };
  return {
    put: wrap('put', (input) => ledger.put(input)),
    get: wrap('get', (key) => ledger.get(key)),
    query: wrap('query', (query) => ledger.query(query)),
    update: wrap('update', (key, patch, expiresIn) => ledger.update(key, patch, expiresIn)),
  };
}
