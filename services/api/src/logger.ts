import { pino, type Logger } from 'pino';

export type { Logger };

/** JSON logs to stdout; `pnpm dev` pipes them through pino-pretty. */
export function createLogger(level: string): Logger {
  return pino({ level, base: { service: 'api' }, timestamp: pino.stdTimeFunctions.isoTime });
}
