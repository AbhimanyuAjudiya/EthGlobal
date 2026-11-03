/**
 * The fixture transport (INTERFACES §10): replays recorded HTTP exchanges as an injectable `fetch`. One of the
 * two places allowed to deal in raw fetch semantics (the other is protocol's `httpJson`).
 */
import { canonicalJson } from '@ethglobal/protocol/typed-data';

import { loadFixture } from './fixtures.js';

export interface RecordedRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface RecordedResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}
export interface Recording {
  name: string;
  recordedAt: string;
  source?: 'docs' | 'live';
  exchanges: { request: RecordedRequest; response: RecordedResponse }[];
}

/** Thrown on a request no exchange matches, carrying what was asked so the request shape is asserted. */
export class FixtureMiss extends Error {
  override readonly name = 'FixtureMiss';
  readonly code = 'fixture_miss';

  constructor(readonly request: { method: string; url: string; body: string | undefined }) {
    super(`fixture miss: ${request.method} ${request.url}`);
  }
}

/** Path plus sorted query: hosts are ignored so a recording works against any base URL. */
function urlKey(url: string): string {
  const u = new URL(url, 'http://fixture.invalid');
  const query = [...u.searchParams.entries()].sort(([a, x], [b, y]) =>
    a === b ? x.localeCompare(y) : a.localeCompare(b),
  );
  const search = new URLSearchParams(query).toString();
  return `${u.pathname}${search ? `?${search}` : ''}`;
}

function canonicalBody(body: unknown): string | undefined {
  if (body === undefined || body === null || body === '') return undefined;
  if (typeof body !== 'string') return canonicalJson(body);
  try {
    return canonicalJson(JSON.parse(body));
  } catch {
    return body;
  }
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

function toResponse(recorded: RecordedResponse): Response {
  const headers = new Headers(recorded.headers);
  let body: string | null = null;
  if (!NULL_BODY_STATUS.has(recorded.status) && recorded.body !== undefined) {
    if (typeof recorded.body === 'string') body = recorded.body;
    else {
      body = JSON.stringify(recorded.body);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  }
  return new Response(body, { status: recorded.status, headers });
}

async function describeRequest(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<{ method: string; url: string; body: string | undefined }> {
  if (input instanceof Request) {
    const text = await input.text();
    return {
      method: input.method.toUpperCase(),
      url: input.url,
      body: text === '' ? undefined : text,
    };
  }
  const body = typeof init?.body === 'string' ? init.body : undefined;
  return { method: (init?.method ?? 'GET').toUpperCase(), url: String(input), body };
}

/**
 * Replays `<repo>/fixtures/<relPath>`. Matches method + URL (path + sorted query) and, with `strictBody`, the
 * canonical JSON body. Exchanges are consumed in order; once every match is used, the last match repeats.
 * Throws FixtureMiss({ method, url, body }) on an unmatched request.
 */
export function fixtureFetch(relPath: string, opts: { strictBody?: boolean } = {}): typeof fetch {
  const recording = loadFixture<Recording>(relPath);
  if (!Array.isArray(recording.exchanges))
    throw new Error(`${relPath}: not a recording (no exchanges[])`);
  const used = new Set<number>();
  return async (input: string | URL | Request, init?: RequestInit) => {
    const req = await describeRequest(input, init);
    const key = urlKey(req.url);
    const wantBody = canonicalBody(req.body);
    const matches = recording.exchanges
      .map((exchange, index) => ({ exchange, index }))
      .filter(
        ({ exchange: { request } }) =>
          request.method.toUpperCase() === req.method &&
          urlKey(request.url) === key &&
          (!opts.strictBody || canonicalBody(request.body) === wantBody),
      );
    const pick = matches.find(({ index }) => !used.has(index)) ?? matches.at(-1);
    if (!pick) throw new FixtureMiss(req);
    used.add(pick.index);
    return toResponse(pick.exchange.response);
  };
}
