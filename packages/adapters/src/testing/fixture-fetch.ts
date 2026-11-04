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
  /** Headers the request must carry (names case-insensitive); the value `"*"` means "present, any value". */
  expectHeaders?: Record<string, string>;
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

interface SeenRequest {
  method: string;
  url: string;
  body: string | undefined;
  headers: Record<string, string>;
}

/**
 * Thrown on a request no exchange matches, carrying what was asked (headers omitted: they may hold credentials)
 * and the three nearest recorded URLs, so a wrong path, query or header fails the test with a useful message.
 */
export class FixtureMiss extends Error {
  override readonly name = 'FixtureMiss';
  readonly code = 'fixture_miss';
  readonly request: { method: string; url: string; body: string | undefined };

  constructor(
    request: { method: string; url: string; body: string | undefined },
    readonly nearest: readonly string[] = [],
    reason = '',
  ) {
    super(
      `fixture miss: ${request.method} ${request.url}${reason ? ` (${reason})` : ''}${
        request.body === undefined ? '' : `\n  body: ${request.body.slice(0, 500)}`
      }${nearest.length ? `\n  nearest recorded: ${nearest.join(' | ')}` : ''}`,
    );
    this.request = request;
  }
}

/** Levenshtein distance, for the nearest-URL hint only. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) {
      row[j] = Math.min(
        row[j - 1]! + 1,
        prev[j]! + 1,
        prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length]!;
}

function headersMatch(
  expected: Record<string, string> | undefined,
  got: Record<string, string>,
): boolean {
  return Object.entries(expected ?? {}).every(([name, value]) => {
    const actual = got[name.toLowerCase()];
    return actual !== undefined && (value === '*' || actual === value);
  });
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

/** JSON-RPC ids are a per-client counter: never part of the match (a recording works for any client). */
function withoutRpcId(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutRpcId);
  if (value && typeof value === 'object' && 'jsonrpc' in value) {
    const { id: _id, ...rest } = value as Record<string, unknown>;
    return rest;
  }
  return value;
}

function canonicalBody(body: unknown, jsonRpc = false): string | undefined {
  if (body === undefined || body === null || body === '') return undefined;
  const strip = (v: unknown) => (jsonRpc ? withoutRpcId(v) : v);
  if (typeof body !== 'string') return canonicalJson(strip(body));
  try {
    return canonicalJson(strip(JSON.parse(body)));
  } catch {
    return body;
  }
}

const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

function toResponse(recorded: RecordedResponse, rpcId?: unknown): Response {
  const headers = new Headers(recorded.headers);
  let body: string | null = null;
  if (!NULL_BODY_STATUS.has(recorded.status) && recorded.body !== undefined) {
    if (typeof recorded.body === 'string') body = recorded.body;
    else {
      const value =
        rpcId !== undefined &&
        recorded.body !== null &&
        typeof recorded.body === 'object' &&
        'jsonrpc' in recorded.body
          ? { ...recorded.body, id: rpcId }
          : recorded.body;
      body = JSON.stringify(value);
      if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    }
  }
  return new Response(body, { status: recorded.status, headers });
}

const lowerHeaders = (headers: ConstructorParameters<typeof Headers>[0]): Record<string, string> =>
  Object.fromEntries([...new Headers(headers).entries()].map(([k, v]) => [k.toLowerCase(), v]));

async function describeRequest(
  input: string | URL | Request,
  init?: RequestInit,
): Promise<SeenRequest> {
  if (input instanceof Request) {
    const text = await input.text();
    return {
      method: input.method.toUpperCase(),
      url: input.url,
      body: text === '' ? undefined : text,
      headers: lowerHeaders(input.headers),
    };
  }
  const body = typeof init?.body === 'string' ? init.body : undefined;
  return {
    method: (init?.method ?? 'GET').toUpperCase(),
    url: String(input),
    body,
    headers: lowerHeaders(init?.headers),
  };
}

/**
 * Replays `<repo>/fixtures/<relPath>`. Matches method + URL (path + sorted query) and, with `strictBody`, the
 * canonical JSON body. `jsonRpc` compares bodies without the JSON-RPC `id` and echoes the caller's id in the
 * response (viem transports over recorded eth_call exchanges). Exchanges are consumed in order; once every match is
 * used, the last match repeats. Throws FixtureMiss({ method, url, body }) on an unmatched request.
 */
export function fixtureFetch(
  relPath: string,
  opts: { strictBody?: boolean; jsonRpc?: boolean } = {},
): typeof fetch {
  const recording = loadFixture<Recording>(relPath);
  if (!Array.isArray(recording.exchanges))
    throw new Error(`${relPath}: not a recording (no exchanges[])`);
  const used = new Set<number>();
  return async (input: string | URL | Request, init?: RequestInit) => {
    const seen = await describeRequest(input, init);
    const req = { method: seen.method, url: seen.url, body: seen.body };
    const key = urlKey(req.url);
    const strict = opts.strictBody === true || opts.jsonRpc === true;
    const wantBody = canonicalBody(req.body, opts.jsonRpc);
    const sameRoute = recording.exchanges
      .map((exchange, index) => ({ exchange, index }))
      .filter(
        ({ exchange: { request } }) =>
          request.method.toUpperCase() === req.method &&
          urlKey(request.url) === key &&
          (!strict || canonicalBody(request.body, opts.jsonRpc) === wantBody),
      );
    const matches = sameRoute.filter(({ exchange: { request } }) =>
      headersMatch(request.expectHeaders, seen.headers),
    );
    const pick = matches.find(({ index }) => !used.has(index)) ?? matches.at(-1);
    if (!pick) {
      const nearest = [
        ...new Set(
          recording.exchanges.map(
            (e) => `${e.request.method.toUpperCase()} ${urlKey(e.request.url)}`,
          ),
        ),
      ]
        .sort((a, b) => distance(a, `${req.method} ${key}`) - distance(b, `${req.method} ${key}`))
        .slice(0, 3);
      throw new FixtureMiss(req, nearest, sameRoute.length ? 'expected headers missing' : '');
    }
    used.add(pick.index);
    const rpcId =
      opts.jsonRpc && seen.body ? (JSON.parse(seen.body) as { id?: unknown }).id : undefined;
    return toResponse(pick.exchange.response, rpcId);
  };
}
