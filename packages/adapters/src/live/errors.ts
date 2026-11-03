/** The one place that maps HTTP and SDK failures to AdapterError codes (adapters-live brief §3). */
import { HttpError } from '@ethglobal/protocol/http';

import { AdapterError, type AdapterErrorCode } from '../errors.js';

import type { AdapterName } from '../types.js';

/** Per-adapter override: a code for a given status/body, or undefined for the default mapping. */
export type StatusMapper = (status: number, body: unknown) => AdapterErrorCode | undefined;

function defaultStatusCode(status: number): AdapterErrorCode {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 404 || status >= 500) return 'unavailable';
  return 'invalid_response';
}

const isFixtureMiss = (error: unknown): error is Error & { code: 'fixture_miss' } =>
  error instanceof Error && (error as { code?: unknown }).code === 'fixture_miss';

/**
 * Any failure → AdapterError(adapter, code). Messages carry the status and reason only — never the body, the
 * headers or the URL (an RPC URL can carry an access key, a body an activation code).
 */
export function toAdapterError(adapter: AdapterName, error: unknown, mapStatus?: StatusMapper): AdapterError {
  if (error instanceof AdapterError) return error;
  if (isFixtureMiss(error)) return new AdapterError(adapter, 'fixture_miss', error.message);
  if (error instanceof HttpError) {
    if (isFixtureMiss(error.cause)) return new AdapterError(adapter, 'fixture_miss', error.cause.message);
    if (error.reason === 'timeout' || error.reason === 'network') {
      return new AdapterError(adapter, 'unavailable', `${adapter}: ${error.reason}`, { reason: error.reason });
    }
    if (error.reason === 'schema') {
      return new AdapterError(adapter, 'invalid_response', `${adapter}: unexpected response shape (HTTP ${error.status})`, {
        status: error.status,
      });
    }
    const code = mapStatus?.(error.status, error.body) ?? defaultStatusCode(error.status);
    return new AdapterError(adapter, code, `${adapter}: HTTP ${error.status}`, { status: error.status });
  }
  const name = error instanceof Error ? error.name : typeof error;
  return new AdapterError(adapter, 'unavailable', `${adapter}: ${name}`, { reason: name });
}

/** Runs `fn`, mapping any failure through toAdapterError. */
export async function guard<T>(adapter: AdapterName, fn: () => Promise<T>, mapStatus?: StatusMapper): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    throw toAdapterError(adapter, error, mapStatus);
  }
}
