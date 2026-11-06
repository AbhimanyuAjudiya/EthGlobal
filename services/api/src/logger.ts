import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

/**
 * pino `redact` is the safety net (T-50), not the control: no code path logs these values in the first place.
 * Request logs carry the path only, never the query string (`?token=`, T-82).
 */
export const REDACT_PATHS = [
  'lpa',
  '*.lpa',
  'sealedLpa',
  '*.sealedLpa',
  'pin',
  '*.pin',
  'ticketPass',
  '*.ticketPass',
  'pass',
  '*.pass',
  'ticketRefs',
  '*.ticketRefs',
  'proof',
  '*.proof',
  'nullifier',
  '*.nullifier',
  'nullifier_hash',
  '*.nullifier_hash',
  'nullifierHash',
  '*.nullifierHash',
  'signature',
  '*.signature',
  'signatureMap',
  '*.signatureMap',
  'auditKey',
  '*.auditKey',
  'iccid',
  '*.iccid',
  'token',
  '*.token',
  'authorization',
  '*.authorization',
  'headers',
  '*.headers',
  'secret',
  '*.secret',
];

/** JSON logs to stdout (or `destination` in tests); `pnpm dev` pipes them through pino-pretty. */
export function createLogger(level: string, destination?: DestinationStream): Logger {
  const options = {
    level,
    base: { service: 'api' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: '[redacted]' },
  };
  return destination ? pino(options, destination) : pino(options);
}
