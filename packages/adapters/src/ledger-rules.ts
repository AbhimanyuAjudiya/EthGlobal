/** Ledger rules shared by InMemoryLedger and ArkivLedger so both ports behave identically (T-35). */
import { ANN } from '@ethglobal/protocol/ids';

import { AdapterError } from './errors.js';

import type { Annotations, LedgerEntity } from './types.js';

/** Arkiv's maximum entity lifetime: 7,884,000 blocks × 2 s (~182.5 days, A-24). */
export const MAX_LEDGER_EXPIRES_IN_S = 15_768_000;

/** `expiresIn` is a positive integer number of seconds, at most the ledger's maximum lifetime. */
export function assertExpiresIn(expiresIn: number | undefined): void {
  if (expiresIn === undefined) return;
  if (!(Number.isSafeInteger(expiresIn) && expiresIn > 0)) {
    throw new AdapterError('ledger', 'invalid_expiry', 'expiresIn must be a positive integer (seconds)');
  }
  if (expiresIn > MAX_LEDGER_EXPIRES_IN_S) {
    throw new AdapterError(
      'ledger',
      'invalid_request',
      `expiresIn ${expiresIn} s exceeds the ledger maximum of ${MAX_LEDGER_EXPIRES_IN_S} s`,
    );
  }
}

/** A numeric `expiresAt` annotation (ms) at or before `now` makes the entity dead even if the ledger still has it. */
export function annotationAlive(annotations: Annotations, now: number): boolean {
  const at = annotations[ANN.expiresAt];
  return typeof at !== 'number' || at > now;
}

/** AND-equality without coercion: `1` never matches `'1'`. */
export const matchesAnnotations = (entity: LedgerEntity, wanted: Annotations): boolean =>
  Object.entries(wanted).every(([name, value]) => entity.annotations[name] === value);

/** `limit` must be a non-negative integer when given. */
export function assertLimit(limit: number | undefined): void {
  if (limit !== undefined && !(Number.isSafeInteger(limit) && limit >= 0)) {
    throw new AdapterError('ledger', 'invalid_request', 'limit must be a non-negative integer');
  }
}
