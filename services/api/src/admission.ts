/** Releases a reservation; `committed` = the reserved thing happened (a claim mined, a top-up receipt written). */
export type Release = (committed?: boolean) => void;

/** How long a commit is subtracted from reads that started before it (far longer than any counter read). */
const COMMIT_MEMORY_MS = 5 * 60_000;

/**
 * Synchronous reservations against a counter that lives elsewhere (T-46, T-24, RT-A-02, RT-A-03): the chain's
 * per-hour claims and remaining budget, or today's top-up receipts. A request takes `mark()` BEFORE it reads the
 * counter, then `take(id, limit, used, mark)`: slots = limit − used − inFlight − commitsSince(mark). A commit that
 * finished after the read began is not in `used` yet, so it is still subtracted; one that finished before is.
 * The check-and-increment never awaits, so concurrent requests cannot race past it.
 */
export class Admission {
  readonly #inFlight = new Map<string, number>();
  readonly #commits = new Map<string, { seq: number; at: number }[]>();
  #seq = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** A position in time to pass to `take` (taken before the counter is read). */
  mark(): number {
    return ++this.#seq;
  }

  /** A release function, or undefined when no slot is left. Never awaits. */
  take(key: string, limit: number, used: number, mark = 0): Release | undefined {
    return this.takeMany(key, 1, limit, used, mark);
  }

  /**
   * `n` slots at once, all or none (a card batch, RT-P-08): shares the key — and so the in-flight count and the
   * commits — with the single-slot claims of the same campaign. Never awaits.
   */
  takeMany(key: string, n: number, limit: number, used: number, mark = 0): Release | undefined {
    const id = key.toLowerCase();
    const inFlight = this.#inFlight.get(id) ?? 0;
    if (!(n >= 1) || limit - used - inFlight - this.#committedSince(id, mark) < n) return undefined;
    this.#inFlight.set(id, inFlight + n);
    let released = false;
    return (committed = false) => {
      if (released) return;
      released = true;
      const left = (this.#inFlight.get(id) ?? n) - n;
      if (left <= 0) this.#inFlight.delete(id);
      else this.#inFlight.set(id, left);
      if (committed) {
        const at = this.now();
        const kept = (this.#commits.get(id) ?? []).filter((c) => at - c.at < COMMIT_MEMORY_MS);
        const added = Array.from({ length: n }, () => ({ seq: ++this.#seq, at }));
        this.#commits.set(id, [...kept, ...added]);
      }
    };
  }

  inFlight(key: string): number {
    return this.#inFlight.get(key.toLowerCase()) ?? 0;
  }

  #committedSince(id: string, mark: number): number {
    const at = this.now();
    const commits = (this.#commits.get(id) ?? []).filter((c) => at - c.at < COMMIT_MEMORY_MS);
    if (commits.length === 0) this.#commits.delete(id);
    else this.#commits.set(id, commits);
    return commits.filter((c) => c.seq > mark).length;
  }
}

/** One holder per key at a time (per-giftId reclaim, per-claim-key fulfilment). */
export class KeyedMutex {
  readonly #tails = new Map<string, Promise<void>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.#tails.get(key) ?? Promise.resolve();
    let done!: () => void;
    const current = new Promise<void>((resolve) => (done = resolve));
    const tail = previous.then(() => current);
    this.#tails.set(key, tail);
    await previous;
    try {
      return await task();
    } finally {
      done();
      if (this.#tails.get(key) === tail) this.#tails.delete(key);
    }
  }
}

/** Sliding-window counter: `hit(key)` is true while fewer than `limit` hits fell in the last `windowMs`. */
export class WindowLimiter {
  readonly #hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number,
  ) {}

  /** Records the hit when allowed; returns the seconds to wait otherwise. */
  hit(key: string): { ok: true } | { ok: false; retryAfterS: number } {
    const now = this.now();
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.#hits.set(key, recent);
      const oldest = recent[0] ?? now;
      return {
        ok: false,
        retryAfterS: Math.max(1, Math.ceil((oldest + this.windowMs - now) / 1000)),
      };
    }
    recent.push(now);
    this.#hits.set(key, recent);
    if (this.#hits.size > 50_000) this.#prune(now);
    return { ok: true };
  }

  #prune(now: number): void {
    for (const [key, hits] of this.#hits) {
      if (hits.every((t) => now - t >= this.windowMs)) this.#hits.delete(key);
    }
  }
}
