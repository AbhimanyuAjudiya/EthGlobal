/** Small, clock-injected limiters: a per-second request pacer (eSIM Access 8 req/s) and a per-key window (T-16). */

/** Waits so that at most `perSecond` calls start in any rolling second. `sleep` is injectable for tests. */
export class Pacer {
  readonly #starts: number[] = [];
  #chain: Promise<void> = Promise.resolve();

  constructor(
    readonly perSecond: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number) => Promise<void> = (ms) =>
      new Promise((resolve) => setTimeout(resolve, ms)),
  ) {}

  /** Resolves when the next call may start. Calls are admitted in order. */
  acquire(): Promise<void> {
    const turn = this.#chain.then(async () => {
      for (;;) {
        const t = this.now();
        while (this.#starts.length && t - this.#starts[0]! >= 1000) this.#starts.shift();
        if (this.#starts.length < this.perSecond) {
          this.#starts.push(t);
          return;
        }
        await this.sleep(1000 - (t - this.#starts[0]!));
      }
    });
    this.#chain = turn;
    return turn;
  }
}

/** At most `limit` hits per key per `windowMs`; `hit` returns false once the key is over. */
export class KeyedWindow {
  readonly #hits = new Map<string, number[]>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  hit(key: string, now: number): boolean {
    const recent = (this.#hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.#hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.#hits.set(key, recent);
    return true;
  }
}
