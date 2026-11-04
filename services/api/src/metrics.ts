/** In-process counters and histograms (ARCHITECTURE §10), served at GET /metrics.json. */
export class Metrics {
  readonly #counters = new Map<string, number>();
  readonly #histograms = new Map<string, number[]>();

  inc(name: string, labels: Record<string, string> = {}): void {
    const key = keyOf(name, labels);
    this.#counters.set(key, (this.#counters.get(key) ?? 0) + 1);
  }

  observe(name: string, ms: number, labels: Record<string, string> = {}): void {
    const key = keyOf(name, labels);
    const values = this.#histograms.get(key) ?? [];
    values.push(ms);
    if (values.length > 1000) values.shift();
    this.#histograms.set(key, values);
  }

  async timed<T>(
    name: string,
    fn: () => Promise<T>,
    labels: Record<string, string> = {},
  ): Promise<T> {
    const started = performance.now();
    try {
      return await fn();
    } finally {
      this.observe(name, performance.now() - started, labels);
    }
  }

  snapshot(): {
    counters: Record<string, number>;
    histograms: Record<string, { count: number; p50: number; p95: number }>;
  } {
    const histograms: Record<string, { count: number; p50: number; p95: number }> = {};
    for (const [key, values] of this.#histograms) {
      const sorted = [...values].sort((a, b) => a - b);
      histograms[key] = {
        count: sorted.length,
        p50: quantile(sorted, 0.5),
        p95: quantile(sorted, 0.95),
      };
    }
    return { counters: Object.fromEntries(this.#counters), histograms };
  }
}

const keyOf = (name: string, labels: Record<string, string>): string => {
  const parts = Object.entries(labels).map(([k, v]) => `${k}=${v}`);
  return parts.length === 0 ? name : `${name}{${parts.join(',')}}`;
};

const quantile = (sorted: number[], q: number): number =>
  sorted.length === 0
    ? 0
    : Math.round((sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0) * 100) /
      100;
