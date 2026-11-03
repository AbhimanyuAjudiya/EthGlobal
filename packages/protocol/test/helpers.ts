import fixture from '../../../fixtures/protocol/examples.json' with { type: 'json' };

import { RechargeError, type ErrorCode } from '../src/errors.js';

export const examples = fixture.examples as Record<string, unknown>;
export const variants = fixture.variants as Record<string, unknown>;

/** A deep copy of a fixture example, typed for the test. */
export function example<T = Record<string, unknown>>(name: string): T {
  const value = examples[name] ?? variants[name];
  if (value === undefined) throw new Error(`no fixture example "${name}"`);
  return structuredClone(value) as T;
}

/** Returns a deep copy of `value` with the dotted `path` set (or deleted when `next` is DELETE). */
export const DELETE = Symbol('delete');
export function mutate(value: unknown, path: string, next: unknown): unknown {
  const copy = structuredClone(value) as Record<string, unknown>;
  const parts = path.split('.');
  let cursor: Record<string, unknown> = copy;
  for (const part of parts.slice(0, -1)) cursor = cursor[part] as Record<string, unknown>;
  const last = parts.at(-1) ?? '';
  if (next === DELETE) delete cursor[last];
  else cursor[last] = next;
  return copy;
}

/** Asserts `fn` throws a RechargeError with `code` (and, when given, `details.reason`). */
export function expectRecharge(fn: () => unknown, code: ErrorCode, reason?: string): RechargeError {
  try {
    fn();
  } catch (error) {
    if (!(error instanceof RechargeError)) throw error;
    if (error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`);
    if (reason !== undefined && (error.details as { reason?: string } | undefined)?.reason !== reason) {
      throw new Error(`expected reason ${reason}, got ${JSON.stringify(error.details)}`);
    }
    return error;
  }
  throw new Error(`expected RechargeError(${code}), nothing was thrown`);
}
