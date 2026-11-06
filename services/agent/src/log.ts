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

/** Errors may contain capability URLs, RPC credentials, response bodies or signed payloads. */
export function safeError(error: unknown): string {
  if (!(error instanceof Error)) return 'UnknownError';
  const safeLabel = (value: unknown) =>
    typeof value === 'string' && /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(value) ? value : undefined;
  const fields = error as Error & { code?: unknown; status?: unknown; reason?: unknown };
  return [
    safeLabel(error.name) ?? 'Error',
    safeLabel(fields.code),
    safeLabel(fields.reason),
    typeof fields.status === 'number' && Number.isInteger(fields.status)
      ? `status=${fields.status}`
      : undefined,
  ]
    .filter(Boolean)
    .join(' ');
}

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
