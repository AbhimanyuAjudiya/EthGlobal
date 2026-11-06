/**
 * The one HTTP client (INTERFACES §1.11): timeout, JSON in and out, zod-validated responses, injectable
 * `fetch`. Raw `fetch` is allowed only here and in the fixture transport (eslint `no-restricted-syntax`).
 */
import type { z } from 'zod';

export type HttpErrorReason = 'status' | 'schema' | 'timeout' | 'network';

/** Logs may include errors: strip credentials/query strings and capability-bearing path components. */
export function safeHttpUrl(value: string): string {
  try {
    const url = new URL(value);
    const path = url.pathname.replace(
      /(\/(?:me|plan|install|receipts|agent\/(?:policy|pass))\/)[^/]+/gi,
      '$1[redacted]',
    );
    return `${url.origin}${path}`;
  } catch {
    return '[invalid URL]';
  }
}

/** `status` is 0 for timeouts and network failures; `reason` says which failure it was. */
export class HttpError extends Error {
  override readonly name = 'HttpError';

  constructor(
    readonly status: number,
    readonly body: unknown,
    readonly url: string,
    readonly reason: HttpErrorReason = 'status',
    options?: { cause?: unknown },
  ) {
    super(`HTTP ${reason}${status ? ` ${status}` : ''} from ${safeHttpUrl(url)}`, options);
  }
}

export interface HttpJsonOptions<T> {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  /** JSON-serialised; sets `content-type: application/json`. */
  body?: unknown;
  /** Sent as is (e.g. a Swarm upload); pass the content-type in `headers`. Exclusive with `body`. */
  rawBody?: Uint8Array | string;
  /** 'bytes' returns the body as a Uint8Array (no JSON parse, no schema). Default 'json'. */
  responseType?: 'json' | 'bytes';
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

async function readBytes(response: Response): Promise<Uint8Array> {
  return new Uint8Array(await response.arrayBuffer());
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
  } else if (opts.rawBody !== undefined) {
    init.method = opts.method ?? 'POST';
    init.body = opts.rawBody as BodyInit;
  }

  let response: Response;
  let body: unknown;
  try {
    // Unbound call: browsers reject `obj.fetch()` with "Illegal invocation".
    response = await doFetch.call(globalThis, url, init);
    body =
      opts.responseType === 'bytes' && response.ok
        ? await readBytes(response)
        : await readBody(response);
  } catch (error) {
    throw new HttpError(0, undefined, url, isTimeout(error) ? 'timeout' : 'network', {
      cause: error,
    });
  }

  if (!response.ok && !(opts.allowStatus ?? []).includes(response.status)) {
    throw new HttpError(response.status, body, url, 'status');
  }
  if (opts.schema === undefined || opts.responseType === 'bytes')
    return { status: response.status, headers: response.headers, data: body as T };
  const parsed = opts.schema.safeParse(body);
  if (!parsed.success) throw new HttpError(response.status, body, url, 'schema');
  return { status: response.status, headers: response.headers, data: parsed.data };
}
