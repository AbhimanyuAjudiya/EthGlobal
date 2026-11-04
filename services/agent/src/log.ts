/**
 * Structured logging (ARCHITECTURE §9): pino JSON to stdout, `event` from LOG_EVENTS. The port is the pino call
 * shape so tests pass a recording sink and nothing here reaches for a global logger.
 */
import { pino } from 'pino';

import type { LogEvent } from '@ethglobal/protocol/events';

export interface Log {
  info(obj: Record<string, unknown>, msg?: string): void;
  warn(obj: Record<string, unknown>, msg?: string): void;
  error(obj: Record<string, unknown>, msg?: string): void;
}

/** One structured line; `event` is always one of LOG_EVENTS. */
export const logEvent = (
  log: Log,
  level: 'info' | 'warn' | 'error',
  event: LogEvent,
  fields: Record<string, unknown>,
  msg?: string,
): void => log[level]({ event, ...fields }, msg);

export function createLogger(level = 'info'): Log {
  return pino({ level, base: { service: 'agent' }, timestamp: pino.stdTimeFunctions.isoTime });
}

/** A sink that keeps every line (tests, and the `--once` summary). */
export function memoryLog(): Log & {
  lines: { level: string; obj: Record<string, unknown>; msg?: string }[];
} {
  const lines: { level: string; obj: Record<string, unknown>; msg?: string }[] = [];
  const at =
    (level: string) =>
    (obj: Record<string, unknown>, msg?: string): void => {
      lines.push({ level, obj, ...(msg === undefined ? {} : { msg }) });
    };
  return { lines, info: at('info'), warn: at('warn'), error: at('error') };
}
