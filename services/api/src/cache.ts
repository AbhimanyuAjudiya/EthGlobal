import { AdapterError, isAdapterError, type Ledger } from '@ethglobal/adapters';
import { hmacKey, randomBytes } from '@ethglobal/crypto';
import { entitlementIndex, INDEX_PREFIX } from '@ethglobal/octroi';
import { RechargeError } from '@ethglobal/protocol/errors';
import { ENTITLEMENT_CACHE_S } from '@ethglobal/protocol/ids';
import type { MeResponse } from '@ethglobal/protocol/schemas';

const TTL_MS = ENTITLEMENT_CACHE_S * 1000;
const MAX_ENTRIES = 10_000;

interface Entry {
  me: MeResponse;
  at: number;
  /** Set explicitly by the caller that read the ledger; only such an entry is served while the ledger is down. */
  staleAllowed: boolean;
}

const isIndex = (key: string): boolean => key.startsWith(INDEX_PREFIX);

/**
 * The 60-s read cache of GET /me/:key (T-51) — the ONLY cached read; decide() paths always hit the ledger.
 * Also remembers the expiry of every entitlement it has seen (the top-up guard's 410, AP7.13).
 *
 * Keyed by the CAPABILITY, through a per-process keyed HMAC (RT-O-01): never by the ledger index, which anyone can
 * read off Arkiv. Every capability-facing method refuses an `hk:` index (a miss / no-op), so a ledger reader opens
 * nothing here. `invalidate` alone also takes an index (a usage webhook only knows the index of the entitlement it
 * patches): a side map index → slot, never consulted on a read, lets it hit the entry /me cached for the capability.
 */
export class MeCache {
  readonly #secret = randomBytes(32);
  readonly #entries = new Map<string, Entry>();
  readonly #expiries = new Map<string, number>();
  readonly #slotsByIndex = new Map<string, string>();

  constructor(private readonly now: () => number) {}

  /** HMAC(process secret, capability); undefined for an index (it is not a capability). */
  #slot(key: string): string | undefined {
    if (isIndex(key)) return undefined;
    return hmacKey(this.#secret, 'mecache', key);
  }

  #entry(key: string): Entry | undefined {
    const slot = this.#slot(key);
    return slot === undefined ? undefined : this.#entries.get(slot);
  }

  /** A fresh entry (younger than 60 s), or undefined. */
  fresh(key: string): MeResponse | undefined {
    const hit = this.#entry(key);
    return hit && this.now() - hit.at < TTL_MS ? hit.me : undefined;
  }

  /**
   * While the ledger is down (served with `degraded: true`): an entry remembered with `staleAllowed`, however old,
   * whose entitlement has not passed its expiry. Anything else is a miss (the read then fails closed, 503).
   */
  stale(key: string): MeResponse | undefined {
    const hit = this.#entry(key);
    return hit?.staleAllowed === true && hit.me.expiresAt > this.now() ? hit.me : undefined;
  }

  remember(key: string, me: MeResponse, opts: { staleAllowed?: boolean } = {}): void {
    const slot = this.#slot(key);
    if (slot === undefined) return;
    bounded(this.#entries, slot, { me, at: this.now(), staleAllowed: opts.staleAllowed === true });
    bounded(this.#slotsByIndex, entitlementIndex(key), slot);
    this.seen(key, me.expiresAt);
  }

  /** Write-through invalidation from fulfil, top-ups (capability) and webhooks (the ledger index). */
  invalidate(keyOrIndex: string): void {
    const slot = isIndex(keyOrIndex) ? this.#slotsByIndex.get(keyOrIndex) : this.#slot(keyOrIndex);
    if (slot !== undefined) this.#entries.delete(slot);
  }

  seen(key: string, expiresAt: number): void {
    const slot = this.#slot(key);
    if (slot !== undefined) bounded(this.#expiries, slot, expiresAt);
  }

  /** True when this capability was a live entitlement that has since passed its expiry (never for an index). */
  expired(key: string): boolean {
    const slot = this.#slot(key);
    const at = slot === undefined ? undefined : this.#expiries.get(slot);
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
        // A-32: a lost create-if-absent / compare-and-swap is the ledger ANSWERING (a replay or a retry), not
        // the ledger being down — counting it would mark the API degraded for 60 s after a normal replay
        if (isAdapterError(error) && error.code === 'conflict') {
          observe(op, performance.now() - started, true);
          throw error;
        }
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
