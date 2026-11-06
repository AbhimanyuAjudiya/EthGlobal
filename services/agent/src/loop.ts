/**
 * The schedule (agent.md §3 "Loop"): every AGENT_TICK_MS (±10 % jitter) one sequential pass over the watched keys,
 * one tick per key, never two at once for a key. `--once` runs one pass; exit 0, or 2 if any tick threw.
 */
import { logEvent, safeError, type Log } from './log.js';
import { tick, type AgentDeps, type TickResult } from './tick.js';

/** Bound on keys discovered from the ledger per pass (AG5.4: per-tick work stays bounded). */
export const MAX_WATCHED_KEYS = 50;

export interface PassResult {
  results: TickResult[];
  errors: { key: string; error: string }[];
}

export async function runPass(
  deps: AgentDeps,
  keys: readonly string[],
  tickFn: typeof tick = tick,
): Promise<PassResult> {
  const results: TickResult[] = [];
  const errors: { key: string; error: string }[] = [];
  for (const key of keys) {
    try {
      results.push(await tickFn(deps, key));
    } catch (error) {
      const message = safeError(error);
      errors.push({ key, error: message });
      logEvent(deps.log, 'error', 'agent.tick', { error: message });
    }
  }
  return { results, errors };
}

/** tickMs ± 10 %; `random` in [0, 1). */
export const jitter = (tickMs: number, random: () => number = Math.random): number =>
  Math.round(tickMs * (0.9 + 0.2 * random()));

export async function runLoop(opts: {
  deps: AgentDeps;
  keys: () => Promise<string[]>;
  tickMs: number;
  log: Log;
  signal: AbortSignal;
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  tickFn?: typeof tick;
}): Promise<void> {
  const sleep =
    opts.sleep ??
    ((ms: number, signal: AbortSignal) =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          signal.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(finish, ms);
        signal.addEventListener('abort', finish, { once: true });
        if (signal.aborted) finish();
      }));
  while (!opts.signal.aborted) {
    try {
      await runPass(opts.deps, await opts.keys(), opts.tickFn);
    } catch (error) {
      logEvent(opts.log, 'error', 'agent.tick', {
        error: safeError(error),
      });
    }
    if (opts.signal.aborted) break;
    await sleep(jitter(opts.tickMs, opts.random), opts.signal);
  }
}
