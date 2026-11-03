/** The suite-wide epoch: Tue 3 Nov 2026 12:00 UTC (ms). */
export const T0 = Date.UTC(2026, 10, 3, 12);

/** A settable fake clock in ms; pass `now` to every module under test. */
export function fakeClock(start: number = T0): {
  now: () => number;
  advance(ms: number): void;
  set(ms: number): void;
} {
  let current = start;
  return {
    now: () => current,
    advance(ms: number) {
      current += ms;
    },
    set(ms: number) {
      current = ms;
    },
  };
}
