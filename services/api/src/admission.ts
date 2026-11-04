/**
 * Per-campaign admission (T-46, T-24): a free claim takes a slot BEFORE personhood.verify runs, so a burst larger
 * than the hourly cap is refused cheaply instead of burning one-time proofs. slots = claimsPerHour −
 * claimsInHour(bucket) − inFlight; the check-and-increment is synchronous, so concurrent requests cannot race it.
 */
export class Admission {
  readonly #inFlight = new Map<string, number>();

  /** A release function, or undefined when the hour is full. Never awaits. */
  take(
    campaignId: string,
    claimsPerHour: number,
    claimsThisHour: number,
  ): (() => void) | undefined {
    const id = campaignId.toLowerCase();
    const inFlight = this.#inFlight.get(id) ?? 0;
    if (claimsPerHour - claimsThisHour - inFlight <= 0) return undefined;
    this.#inFlight.set(id, inFlight + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const left = (this.#inFlight.get(id) ?? 1) - 1;
      if (left <= 0) this.#inFlight.delete(id);
      else this.#inFlight.set(id, left);
    };
  }

  inFlight(campaignId: string): number {
    return this.#inFlight.get(campaignId.toLowerCase()) ?? 0;
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
