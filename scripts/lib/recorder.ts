/**
 * The Wednesday fixture recorder's machinery (RT-P-10, OP6; scripts/record-fixture.ts is the CLI). Pure and
 * importable by tests:
 *
 *   recordingFetch(fetch)    wraps the real fetch the live adapters are given (`LiveDeps.fetch`, adapters'
 *                            `fetch?:` options) and keeps every request/response as a `Recording` exchange, the
 *                            format `fixtureFetch` (@ethglobal/adapters/testing) replays;
 *   redactRecording(rec)     replaces every known secret by a shape-preserving placeholder, by schema: header names,
 *                            URL query keys and path segments, JSON body keys (deep), and string patterns (LPAs);
 *   leftovers(text, seen)    the secrets that would still be written: every original value redactRecording
 *                            removed, every credential from the environment, and real-format LPAs/keys — the
 *                            recorder refuses to write when this is non-empty (and scan.sh must also be clean).
 */
import { resolve, sep } from 'node:path';

import type { RecordedRequest, RecordedResponse, Recording } from '@ethglobal/adapters/testing';

/** Header names (lower case) whose value is a credential or a bearer instrument. */
export const SECRET_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'rt-accesscode',
  'rt-signature',
  'x-api-key',
  'api-key',
  'payment-signature',
  // nosemgrep: recharge-x402-v1-primitive — redaction list: names the v1 header so a recording strips it
  'x-payment',
]);

/** URL query keys (lower case) that carry a credential (`?token=` of the eSIM Access webhook, API keys). */
export const SECRET_QUERY = new Set([
  'token',
  'key',
  'apikey',
  'api_key',
  'access_key',
  'accesskey',
  'accesscode',
  'signature',
  'sig',
]);

/** JSON keys (lower case, any depth) whose value is a secret, and the placeholder shape to use. */
export const SECRET_KEYS: Readonly<Record<string, 'hex' | 'lpa' | 'iccid' | 'url' | 'text'>> = {
  // eSIM Access (API-FACTS §5): the activation code, its QR/short URLs, the line id
  ac: 'lpa',
  lpa: 'lpa',
  activationcode: 'lpa',
  qrcodeurl: 'url',
  shorturl: 'url',
  iccid: 'iccid',
  accesscode: 'text',
  // World (IDKit 4 / rp_context): the RP signature and the person's nullifiers
  signature: 'hex',
  nullifier: 'hex',
  nullifier_hash: 'hex',
  nullifierhash: 'hex',
  proof: 'hex',
  merkle_root: 'hex',
  // generic credentials
  privatekey: 'hex',
  private_key: 'hex',
  secret: 'text',
  mnemonic: 'text',
  token: 'text',
  apikey: 'text',
  api_key: 'text',
  accesskey: 'text',
  access_key: 'text',
  password: 'text',
};

/** A real-format LPA (GSMA SGP.22 `LPA:1$<fqdn>$<matching id>`), anywhere in a string. */
const LPA_RE = /LPA:1\$[A-Za-z0-9.-]+\$[A-Za-z0-9._-]+/g;
/** Arkiv's RPC carries the access key as the last path segment (T-50). */
const ARKIV_HOST = /(^|\.)arkiv\.network$/i;

/** Environment variables whose values must never appear in a recording. */
export const SECRET_ENV =
  /(PRIVATE_KEY|SECRET|SIGNING_KEY|ACCESS_CODE|ACCESS_KEY|SEAL_KEY|TOKEN|POSTAGE_BATCH|MNEMONIC|API_KEY|PASSWORD)$/;

export interface Redactor {
  /** Every original value replaced so far (for the leftover check). */
  readonly removed: Set<string>;
  value(kind: 'hex' | 'lpa' | 'iccid' | 'url' | 'text', original: string): string;
}

/** Placeholders keep the shape a schema checks (hex length, ICCID digits, an LPA a parser accepts). */
export function redactor(): Redactor {
  const removed = new Set<string>();
  let n = 0;
  return {
    removed,
    value(kind, original) {
      if (original !== '') removed.add(original);
      n += 1;
      const id = String(n).padStart(4, '0');
      switch (kind) {
        case 'hex': {
          const hex = /^0x[0-9a-fA-F]+$/.test(original) ? original.length - 2 : 64;
          return `0x${id.padStart(hex, '0').slice(-hex)}`;
        }
        case 'lpa':
          return `LPA:1$smdp.example$REDACTED-${id}`;
        case 'iccid':
          return `8900000000000${id.padStart(6, '0')}`.slice(0, Math.max(19, original.length));
        case 'url':
          return `https://redacted.example/${id}`;
        case 'text':
          return `<redacted-${id}>`;
      }
    },
  };
}

function redactString(r: Redactor, s: string): string {
  return s.replace(LPA_RE, (m) => r.value('lpa', m));
}

/** Deep JSON walk: secret keys by schema, every other string through the LPA pattern. */
export function redactJson(r: Redactor, value: unknown): unknown {
  if (typeof value === 'string') {
    // a JSON document inside a string (e.g. a webhook body kept verbatim)
    if (/^\s*[[{]/.test(value)) {
      try {
        return JSON.stringify(redactJson(r, JSON.parse(value)));
      } catch {
        // not JSON: fall through
      }
    }
    return redactString(r, value);
  }
  if (Array.isArray(value)) return value.map((v) => redactJson(r, v));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => {
        const kind = SECRET_KEYS[k.toLowerCase()];
        if (kind !== undefined && (typeof v === 'string' || typeof v === 'number'))
          return [k, r.value(kind, String(v))];
        if (kind === 'hex' && Array.isArray(v))
          return [k, v.map((x: unknown) => (typeof x === 'string' ? r.value('hex', x) : x))];
        return [k, redactJson(r, v)];
      }),
    );
  }
  return value;
}

export function redactUrl(r: Redactor, raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return redactString(r, raw);
  }
  for (const key of [...url.searchParams.keys()]) {
    if (SECRET_QUERY.has(key.toLowerCase()))
      url.searchParams.set(key, r.value('text', url.searchParams.get(key) ?? ''));
  }
  if (ARKIV_HOST.test(url.hostname)) {
    url.pathname = url.pathname
      .split('/')
      .map((seg) => (/^[A-Za-z0-9_-]{16,}$/.test(seg) ? r.value('text', seg) : seg))
      .join('/');
  }
  if (url.username !== '' || url.password !== '') {
    r.removed.add(url.username);
    r.removed.add(url.password);
    url.username = '';
    url.password = '';
  }
  return redactString(r, url.toString());
}

const redactHeaders = (r: Redactor, h: Record<string, string> | undefined) =>
  h === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(h).map(([k, v]) => [
          k,
          SECRET_HEADERS.has(k.toLowerCase()) ? r.value('text', v) : redactString(r, v),
        ]),
      );

/** A redacted deep copy of `rec`; `r.removed` then holds every original value it replaced. */
export function redactRecording(rec: Recording, r: Redactor = redactor()): Recording {
  return {
    ...rec,
    exchanges: rec.exchanges.map(({ request, response }) => {
      const req: RecordedRequest = { ...request, url: redactUrl(r, request.url) };
      const headers = redactHeaders(r, request.headers);
      if (headers !== undefined) req.headers = headers;
      if (request.body !== undefined) req.body = redactJson(r, request.body);
      const res: RecordedResponse = { status: response.status };
      const rh = redactHeaders(r, response.headers);
      if (rh !== undefined) res.headers = rh;
      if (response.body !== undefined) res.body = redactJson(r, response.body);
      return { request: req, response: res };
    }),
  };
}

/** Credential values from the environment (≥ 8 chars), by variable name. */
export const envSecrets = (env: NodeJS.ProcessEnv): string[] =>
  Object.entries(env)
    .filter(([k, v]) => SECRET_ENV.test(k) && typeof v === 'string' && v.length >= 8)
    .map(([, v]) => v!);

/**
 * What would still leak if `text` were written: each removed/env secret that occurs in it (reported by length
 * only, never the value), and any real-format LPA. Empty ⇔ safe to write.
 */
export function leftovers(text: string, secrets: Iterable<string>): string[] {
  const out: string[] = [];
  for (const s of new Set(secrets)) {
    if (s.length >= 6 && text.includes(s))
      out.push(`a redacted/env secret (${s.length} chars) still present`);
  }
  for (const m of text.matchAll(LPA_RE)) {
    if (!m[0].startsWith('LPA:1$smdp.example$')) out.push('a real-format LPA');
  }
  return out;
}

function headersOf(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((value, name) => {
    out[name] = value;
  });
  return out;
}

function parseBody(text: string): unknown {
  if (text === '') return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Wraps `inner` and records every exchange (bodies as JSON when they parse, else text). */
export function recordingFetch(inner: typeof fetch = fetch): {
  fetch: typeof fetch;
  exchanges: Recording['exchanges'];
} {
  const exchanges: Recording['exchanges'] = [];
  const wrapped = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const body =
      request.method === 'GET' || request.method === 'HEAD' ? '' : await request.clone().text();
    const response = await inner(input, init);
    const text = await response.clone().text();
    const req: RecordedRequest = {
      method: request.method,
      url: request.url,
      headers: headersOf(request.headers),
    };
    const parsed = parseBody(body);
    if (parsed !== undefined) req.body = parsed;
    const res: RecordedResponse = { status: response.status, headers: headersOf(response.headers) };
    const resBody = parseBody(text);
    if (resBody !== undefined) res.body = resBody;
    exchanges.push({ request: req, response: res });
    return response;
  };
  return { fetch: wrapped, exchanges };
}

/** `<fixtures>/<vendor>/live-<name>[.raw].json`, refused outside `fixtures` (vendor `a[/b]`, name `[a-z0-9-]`). */
export function fixtureTarget(fixtures: string, vendor: string, name: string, raw = false): string {
  if (!/^[a-z0-9-]+(\/[a-z0-9-]+)?$/.test(vendor))
    throw new Error(`vendor must be <dir>[/<dir>] of [a-z0-9-], got ${vendor}`);
  if (!/^[a-z0-9-]{1,40}$/.test(name)) throw new Error(`name must be [a-z0-9-]{1,40}, got ${name}`);
  const root = resolve(fixtures);
  const file = resolve(root, vendor, `live-${name}${raw ? '.raw' : ''}.json`);
  if (!file.startsWith(root + sep)) throw new Error(`refusing to write outside fixtures/: ${file}`);
  return file;
}
