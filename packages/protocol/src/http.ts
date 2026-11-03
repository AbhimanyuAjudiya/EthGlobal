/**
 * The one HTTP client (INTERFACES §1.11): timeout, JSON in and out, zod-validated responses, injectable
 * `fetch`. Raw `fetch` is allowed only here and in the fixture transport (eslint `no-restricted-syntax`).
 */
import type { z } from 'zod';

export type HttpErrorReason = 'status' | 'schema' | 'timeout' | 'network';

/** `status` is 0 for timeouts and network failures; `reason` says which failure it was. */
export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly url: string,
    readonly reason: HttpErrorReason = 'status',
  ) {
    super(`HTTP ${reason}${status ? ` ${status}` : ''} from ${url}`);
  }
}

export interface HttpJsonOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** JSON-serialised; sets `content-type: application/json`. */
  body?: unknown;
  /** Default 10_000. */
  timeoutMs?: number;
  /** Injected; the fixture transport in tests, a recording wrapper on Wed. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Response body validated when given (for every returned status, so pass a union if allowStatus bodies differ). */
  schema?: z.ZodType<T>;
  /** e.g. [402] to receive the body instead of throwing. */
  allowStatus?: number[];
}

export const DEFAULT_HTTP_TIMEOUT_MS = 10_000;

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
}

export async function httpJson<T = unknown>(
  url: string,
  opts: HttpJsonOptions<T> = {},
): Promise<{ status: number; headers: Headers; data: T }> {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const headers: Record<string, string> = { accept: 'application/json', ...opts.headers };
  const init: RequestInit = {
    method: opts.method ?? (opts.body === undefined ? 'GET' : 'POST'),
    headers,
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS),
  };
  if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }

  let response: Response;
  let body: unknown;
  try {
    // Unbound call: browsers reject `obj.fetch()` with "Illegal invocation".
    response = await doFetch.call(globalThis, url, init);
    body = await readBody(response);
  } catch (error) {
    throw new HttpError(0, undefined, url, isTimeout(error) ? 'timeout' : 'network');
  }

  if (!response.ok && !(opts.allowStatus ?? []).includes(response.status)) {
    throw new HttpError(response.status, body, url, 'status');
  }
  if (opts.schema === undefined) return { status: response.status, headers: response.headers, data: body as T };
  const parsed = opts.schema.safeParse(body);
  if (!parsed.success) throw new HttpError(response.status, body, url, 'schema');
  return { status: response.status, headers: response.headers, data: parsed.data };
}
