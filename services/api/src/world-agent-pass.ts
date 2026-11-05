/**
 * World ID Agent Pass (docs/WORLD_AGENT_PASS.md): auth.world.org as an OpenID Connect provider, used through the
 * Device Authorization Grant (RFC 8628, the headless-agent flow of https://auth.world.org/docs/guides/oidc) as the
 * human checkpoint that arms an agent policy's spending authority (step-up guide, "Human checkpoints").
 *
 * The API is the confidential client: it starts the device attempt, hands the caller only `user_code` and the
 * verification URL (the device code never leaves this process, its logs or the model), polls the token endpoint with
 * the registered client authentication, and validates the ID token here — RS256 against the cached JWKS (kid
 * rotation refetches once), `iss`, `aud`, `exp`, `nonce` when present (device tokens omit it, the docs say to accept
 * that), `acr` in the accepted set, `auth_time` within WORLD_AGENT_PASS_MAX_AGE_S — then binds `(iss, sub)` to the
 * policy, marks the token consumed (one use) and arms the policy until `auth_time + WORLD_AGENT_PASS_VALID_S`. All
 * of it in `deps.state` (STATE_FILE in live), never memory only.
 *
 * MODE=local may run against `LocalIdp`, a labelled in-process IdP with the same four endpoints and a generated RSA
 * key, so the approve / deny / expire paths run without the network (the "simulated" flag is on every view).
 */
import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as signBytes,
  verify as verifyBytes,
  type JsonWebKey,
  type KeyObject,
} from 'node:crypto';

import { Hono } from 'hono';
import { z } from 'zod';

import { Secret } from '@ethglobal/adapters/live';
import { HttpError, httpJson } from '@ethglobal/protocol/http';
import type { AgentPassPoll, AgentPassStart, AgentPassView } from '@ethglobal/protocol/schemas';

import { fail } from './errors.js';

import type { Env } from './env.js';
import type { Logger } from './logger.js';
import type { DurableMap, DurableState } from './state.js';

export const DEVICE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';
const CLIENT_ASSERTION_TYPE = 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer';
const FORM = { 'content-type': 'application/x-www-form-urlencoded' };
/** Clock tolerance on `exp`, `iat` and a future `auth_time` (step-up guide: "a small, explicit clock tolerance"). */
const SKEW_S = 60;
/** A second `start` within this window returns the pending attempt instead of a new device code. */
const START_REUSE_MS = 30_000;
/** The docs' default polling interval when the IdP sends none. */
const DEFAULT_INTERVAL_S = 5;
/** Everything else in a token error is "stop polling" (oidc guide, poll response table). */
const KEEP_POLLING = new Set(['authorization_pending', 'slow_down']);

export interface AgentPassConfig {
  issuer: string;
  clientId: string;
  clientSecret: Secret | undefined;
  /** private_key_jwt when set (RFC 7523); else client_secret_post. */
  privateKeyJwk: Secret | undefined;
  maxAgeS: number;
  validS: number;
  acr: string[];
}

// ── OIDC client (discovery, device authorization, token, JWKS) ──────────────────────────────────────────────

const discoverySchema = z.object({
  issuer: z.string(),
  token_endpoint: z.url(),
  device_authorization_endpoint: z.url(),
  jwks_uri: z.url(),
});
type Discovery = z.infer<typeof discoverySchema>;

const deviceResponseSchema = z.object({
  device_code: z.string().min(1),
  user_code: z.string().min(1).max(64),
  verification_uri: z.string().min(1).max(2048),
  verification_uri_complete: z.string().max(2048).optional(),
  expires_in: z.int().positive(),
  interval: z.int().positive().optional(),
});
const tokenResponseSchema = z.union([
  z.object({ id_token: z.string().min(1) }),
  z.object({ error: z.string().min(1).max(64) }),
]);
const jwksSchema = z.object({ keys: z.array(z.record(z.string(), z.unknown())) });
const rsaJwkSchema = z.object({
  kty: z.literal('RSA'),
  kid: z.string().optional(),
  n: z.string(),
  e: z.string(),
});

const b64url = (bytes: Uint8Array | string): string => Buffer.from(bytes).toString('base64url');
const fromB64url = (text: string): Buffer => Buffer.from(text, 'base64url');

/** A compact RS256 JWT over `claims` (the private_key_jwt assertion and the simulator's ID tokens). */
export function signJwt(
  claims: Record<string, unknown>,
  key: KeyObject,
  kid: string | undefined,
): string {
  const header = b64url(
    JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(kid === undefined ? {} : { kid }) }),
  );
  const payload = b64url(JSON.stringify(claims));
  const signature = signBytes('sha256', Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64url(signature)}`;
}

export class WorldOidcClient {
  #discovery: Promise<Discovery> | undefined;
  #keys = new Map<string, KeyObject>();
  #anyKey: KeyObject | undefined;

  constructor(
    private readonly cfg: AgentPassConfig,
    private readonly fetchFn: typeof fetch | undefined,
    private readonly now: () => number,
  ) {}

  #fetch(): { fetch?: typeof fetch } {
    return this.fetchFn === undefined ? {} : { fetch: this.fetchFn };
  }

  async discovery(): Promise<Discovery> {
    this.#discovery ??= httpJson(`${this.cfg.issuer}/.well-known/openid-configuration`, {
      ...this.#fetch(),
      schema: discoverySchema,
    }).then(({ data }) => {
      if (data.issuer !== this.cfg.issuer) throw new Error('discovery issuer mismatch');
      return data;
    });
    try {
      return await this.#discovery;
    } catch (error) {
      this.#discovery = undefined;
      throw error;
    }
  }

  /** The registered client authentication, form-encoded (never logged). */
  #auth(endpoint: string): Record<string, string> {
    const jwk = this.cfg.privateKeyJwk;
    if (jwk !== undefined) {
      const parsed = JSON.parse(jwk.reveal()) as JsonWebKey & { kid?: string };
      const key = createPrivateKey({ key: parsed, format: 'jwk' });
      const iat = Math.floor(this.now() / 1000);
      return {
        client_id: this.cfg.clientId,
        client_assertion_type: CLIENT_ASSERTION_TYPE,
        client_assertion: signJwt(
          {
            iss: this.cfg.clientId,
            sub: this.cfg.clientId,
            aud: endpoint,
            iat,
            exp: iat + 300,
            jti: randomUUID(),
          },
          key,
          parsed.kid,
        ),
      };
    }
    return {
      client_id: this.cfg.clientId,
      ...(this.cfg.clientSecret === undefined
        ? {}
        : { client_secret: this.cfg.clientSecret.reveal() }),
    };
  }

  async #post<T>(
    endpoint: string,
    fields: Record<string, string>,
    schema: z.ZodType<T>,
    allowStatus: number[],
  ): Promise<T> {
    const { data } = await httpJson(endpoint, {
      method: 'POST',
      headers: FORM,
      rawBody: new URLSearchParams({ ...this.#auth(endpoint), ...fields }).toString(),
      ...this.#fetch(),
      schema,
      allowStatus,
    });
    return data;
  }

  /** RFC 8628 §3.1 with the essential `acr` claims request of the step-up guide ("Accept Orb or Selfie Check"). */
  async deviceAuthorize(nonce: string) {
    const d = await this.discovery();
    return this.#post(
      d.device_authorization_endpoint,
      {
        scope: 'openid',
        nonce,
        claims: JSON.stringify({ id_token: { acr: { essential: true, values: this.cfg.acr } } }),
      },
      deviceResponseSchema,
      [],
    );
  }

  /** RFC 8628 §3.4; a 400 with an OAuth error is a normal answer here. */
  async token(deviceCode: string): Promise<{ idToken: string } | { error: string }> {
    const d = await this.discovery();
    const data = await this.#post(
      d.token_endpoint,
      { grant_type: DEVICE_GRANT, device_code: deviceCode },
      tokenResponseSchema,
      [400, 401, 403],
    );
    return 'id_token' in data ? { idToken: data.id_token } : { error: data.error };
  }

  /** The signing key for `kid` (any key when the token names none); an unknown kid refetches the JWKS once. */
  async key(kid: string | undefined): Promise<KeyObject | undefined> {
    const cached = kid === undefined ? this.#anyKey : this.#keys.get(kid);
    if (cached !== undefined) return cached;
    const d = await this.discovery();
    const { data } = await httpJson(d.jwks_uri, { ...this.#fetch(), schema: jwksSchema });
    this.#keys.clear();
    this.#anyKey = undefined;
    for (const raw of data.keys) {
      const jwk = rsaJwkSchema.safeParse(raw);
      if (!jwk.success) continue;
      const key = createPublicKey({ key: jwk.data, format: 'jwk' });
      if (jwk.data.kid !== undefined) this.#keys.set(jwk.data.kid, key);
      this.#anyKey ??= key;
    }
    return kid === undefined ? this.#anyKey : this.#keys.get(kid);
  }
}

// ── ID-token validation (the backend check; "do not treat an unvalidated client response as authorization") ──

const idTokenClaimsSchema = z.object({
  iss: z.string(),
  sub: z.string().min(1).max(256),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  iat: z.number(),
  auth_time: z.number(),
  acr: z.string(),
  amr: z.array(z.string()).optional(),
  nonce: z.string().optional(),
  jti: z.string().max(256).optional(),
});
export type IdTokenClaims = z.infer<typeof idTokenClaimsSchema>;

export type IdTokenFailure =
  | 'malformed'
  | 'alg'
  | 'unknown_kid'
  | 'signature'
  | 'claims'
  | 'iss'
  | 'aud'
  | 'expired'
  | 'iat'
  | 'nonce'
  | 'acr'
  | 'auth_time';

export async function verifyIdToken(
  token: string,
  opts: {
    key: (kid: string | undefined) => Promise<KeyObject | undefined>;
    issuer: string;
    clientId: string;
    nonce: string;
    acr: readonly string[];
    maxAgeS: number;
    nowS: number;
  },
): Promise<{ ok: true; claims: IdTokenClaims } | { ok: false; reason: IdTokenFailure }> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: unknown; kid?: unknown };
  let payload: unknown;
  try {
    header = JSON.parse(fromB64url(h).toString('utf8')) as { alg?: unknown; kid?: unknown };
    payload = JSON.parse(fromB64url(p).toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  // RS256 only (discovery: id_token_signing_alg_values_supported = [RS256]); `none` and HMAC never verify
  if (header.alg !== 'RS256') return { ok: false, reason: 'alg' };
  const kid = typeof header.kid === 'string' ? header.kid : undefined;
  const key = await opts.key(kid);
  if (key === undefined) return { ok: false, reason: 'unknown_kid' };
  if (!verifyBytes('sha256', Buffer.from(`${h}.${p}`), key, fromB64url(s)))
    return { ok: false, reason: 'signature' };
  const parsed = idTokenClaimsSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, reason: 'claims' };
  const c = parsed.data;
  if (c.iss !== opts.issuer) return { ok: false, reason: 'iss' };
  const aud = Array.isArray(c.aud) ? c.aud : [c.aud];
  if (!aud.includes(opts.clientId)) return { ok: false, reason: 'aud' };
  if (c.exp <= opts.nowS - SKEW_S) return { ok: false, reason: 'expired' };
  if (c.iat > opts.nowS + SKEW_S) return { ok: false, reason: 'iat' };
  // the device profile omits nonce ("accept its absence"); one that is present must be ours
  if (c.nonce !== undefined && c.nonce !== opts.nonce) return { ok: false, reason: 'nonce' };
  if (!opts.acr.includes(c.acr)) return { ok: false, reason: 'acr' };
  if (c.auth_time > opts.nowS + SKEW_S || opts.nowS - c.auth_time > opts.maxAgeS)
    return { ok: false, reason: 'auth_time' };
  return { ok: true, claims: c };
}

// ── The pass itself: durable attempts, grants, consumed tokens and approver bindings per policy key ─────────

interface Attempt {
  deviceCode: string;
  nonce: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete?: string;
  startedAt: number;
  expiresAt: number;
  intervalS: number;
  /** Set once the attempt ended without a grant; kept so the view can say why. */
  outcome?: { state: 'denied' | 'expired'; reason: string; at: number };
}
interface Grant {
  iss: string;
  sub: string;
  acr: string;
  authTime: number;
  until: number;
}
interface Approver {
  iss: string;
  sub: string;
}

/** How long a finished attempt stays readable (view: denied / expired) before the row is dropped. */
const OUTCOME_TTL_MS = 3_600_000;

export class AgentPass {
  readonly simulated: boolean;
  readonly sim: LocalIdp | undefined;
  readonly #attempts: DurableMap<Attempt>;
  readonly #grants: DurableMap<Grant>;
  readonly #consumed: DurableMap<true>;
  readonly #approvers: DurableMap<Approver>;

  constructor(
    private readonly opts: {
      cfg: AgentPassConfig;
      client: WorldOidcClient;
      state: DurableState;
      now: () => number;
      logger: Logger;
      sim?: LocalIdp;
    },
  ) {
    this.sim = opts.sim;
    this.simulated = opts.sim !== undefined;
    this.#attempts = opts.state.map<Attempt>('agent-pass-attempts');
    this.#grants = opts.state.map<Grant>('agent-pass-grants');
    this.#consumed = opts.state.map<true>('agent-pass-consumed');
    this.#approvers = opts.state.map<Approver>('agent-pass-approvers');
  }

  /** Starts (or, within 30 s, repeats) the device attempt for `key`; the device code stays here. */
  async start(key: string): Promise<AgentPassStart> {
    const now = this.opts.now();
    const current = this.#attempts.get(key);
    if (
      current !== undefined &&
      current.outcome === undefined &&
      current.expiresAt > now &&
      now - current.startedAt < START_REUSE_MS
    ) {
      return this.#startView(current, now);
    }
    const nonce = randomBytes(16).toString('hex');
    let d: Awaited<ReturnType<WorldOidcClient['deviceAuthorize']>>;
    try {
      d = await this.opts.client.deviceAuthorize(nonce);
    } catch (error) {
      // status and reason only: a World error body or URL never reaches the caller or the log (T-50)
      this.opts.logger.warn(
        {
          event: 'degraded',
          what: 'agent-pass-start',
          status: error instanceof HttpError ? error.status : 0,
          reason: error instanceof HttpError ? error.reason : 'error',
        },
        'agent pass: device authorization failed',
      );
      throw fail('idp_unavailable');
    }
    const attempt: Attempt = {
      deviceCode: d.device_code,
      nonce,
      userCode: d.user_code,
      verificationUri: d.verification_uri,
      ...(d.verification_uri_complete === undefined
        ? {}
        : { verificationUriComplete: d.verification_uri_complete }),
      startedAt: now,
      expiresAt: now + d.expires_in * 1000,
      intervalS: d.interval ?? DEFAULT_INTERVAL_S,
    };
    this.#attempts.set(key, attempt, attempt.expiresAt + OUTCOME_TTL_MS);
    this.opts.logger.info(
      { event: 'decision', what: 'agent-pass', state: 'pending', simulated: this.simulated },
      'agent pass: device attempt started',
    );
    return this.#startView(attempt, now);
  }

  #startView(a: Attempt, now: number): AgentPassStart {
    return {
      verification_uri: a.verificationUri,
      ...(a.verificationUriComplete === undefined
        ? {}
        : { verification_uri_complete: a.verificationUriComplete }),
      user_code: a.userCode,
      expires_in: Math.max(1, Math.ceil((a.expiresAt - now) / 1000)),
      interval: a.intervalS,
    };
  }

  /** One poll of the token endpoint; the state the caller must act on. */
  async poll(key: string): Promise<AgentPassPoll> {
    const now = this.opts.now();
    const a = this.#attempts.get(key);
    if (a === undefined) {
      const grant = this.#grants.get(key);
      if (grant !== undefined) return { state: 'approved', passUntil: grant.until };
      throw fail('not_found', { detail: 'no pass attempt for this policy' });
    }
    if (a.outcome !== undefined) return { state: a.outcome.state, reason: a.outcome.reason };
    if (now >= a.expiresAt) return this.#end(key, a, 'expired', 'expired_token');
    let answer: { idToken: string } | { error: string };
    try {
      answer = await this.opts.client.token(a.deviceCode);
    } catch (error) {
      // 503 = "temporary unavailability, never approval; end this attempt" (oidc guide); the rest waits
      if (error instanceof HttpError && error.status === 503)
        return this.#end(key, a, 'denied', 'unavailable');
      this.opts.logger.warn(
        {
          event: 'degraded',
          what: 'agent-pass-poll',
          status: error instanceof HttpError ? error.status : 0,
        },
        'agent pass: token poll failed; waiting',
      );
      return { state: 'pending', retryInS: a.intervalS + 5 };
    }
    if ('error' in answer) {
      if (answer.error === 'slow_down') {
        a.intervalS += 5;
        this.#attempts.set(key, a, a.expiresAt + OUTCOME_TTL_MS);
      }
      if (KEEP_POLLING.has(answer.error)) return { state: 'pending', retryInS: a.intervalS };
      return this.#end(
        key,
        a,
        answer.error === 'expired_token' ? 'expired' : 'denied',
        answer.error,
      );
    }
    const verified = await verifyIdToken(answer.idToken, {
      key: (kid) => this.opts.client.key(kid),
      issuer: this.opts.cfg.issuer,
      clientId: this.opts.cfg.clientId,
      nonce: a.nonce,
      acr: this.opts.cfg.acr,
      maxAgeS: this.opts.cfg.maxAgeS,
      nowS: Math.floor(now / 1000),
    });
    if (!verified.ok) return this.#invalid(key, a, verified.reason);
    const { claims } = verified;
    // one use: a token (its jti, else its hash) consumed once is never accepted again
    const consumedId = claims.jti ?? createHash('sha256').update(answer.idToken).digest('hex');
    if (this.#consumed.has(consumedId)) return this.#invalid(key, a, 'replay');
    // a policy keeps its first approver: a different World ID cannot arm it (step-up guide, "linked account")
    const approver = this.#approvers.get(key);
    if (approver !== undefined && (approver.iss !== claims.iss || approver.sub !== claims.sub))
      return this.#invalid(key, a, 'approver');
    const until = claims.auth_time * 1000 + this.opts.cfg.validS * 1000;
    // the writes happen with no await between them: consumed, bound and armed together or not at all
    this.#consumed.set(consumedId, true, Math.max(claims.exp * 1000, until) + SKEW_S * 1000);
    this.#approvers.set(key, { iss: claims.iss, sub: claims.sub });
    this.#grants.set(
      key,
      { iss: claims.iss, sub: claims.sub, acr: claims.acr, authTime: claims.auth_time, until },
      until,
    );
    this.#attempts.delete(key);
    this.opts.logger.info(
      {
        event: 'decision',
        what: 'agent-pass',
        state: 'approved',
        acr: claims.acr,
        amr: claims.amr,
      },
      'agent pass: policy armed',
    );
    return { state: 'approved', passUntil: until };
  }

  #invalid(key: string, a: Attempt, why: IdTokenFailure | 'replay' | 'approver'): AgentPassPoll {
    this.opts.logger.warn(
      { event: 'decision', what: 'agent-pass', state: 'denied', reason: 'invalid_pass', why },
      'agent pass: ID token rejected',
    );
    return this.#end(key, a, 'denied', 'invalid_pass');
  }

  #end(key: string, a: Attempt, state: 'denied' | 'expired', reason: string): AgentPassPoll {
    a.outcome = { state, reason, at: this.opts.now() };
    this.#attempts.set(key, a, this.opts.now() + OUTCOME_TTL_MS);
    this.opts.logger.info(
      { event: 'decision', what: 'agent-pass', state, reason },
      'agent pass: attempt ended without a grant',
    );
    return { state, reason };
  }

  /** The protected action's check: an unexpired grant for the policy. */
  armed(key: string): boolean {
    return this.#grants.get(key) !== undefined;
  }

  /** A changed policy needs a new approval (step-up guide: "Changes require new approval"). */
  revoke(key: string): void {
    this.#grants.delete(key);
  }

  view(key: string): AgentPassView {
    const flag = this.simulated ? { simulated: true } : {};
    const grant = this.#grants.get(key);
    if (grant !== undefined) return { state: 'armed', passUntil: grant.until, ...flag };
    const a = this.#attempts.get(key);
    if (a === undefined) return { state: 'none', ...flag };
    if (a.outcome !== undefined)
      return { state: a.outcome.state, reason: a.outcome.reason, ...flag };
    if (this.opts.now() >= a.expiresAt)
      return { state: 'expired', reason: 'expired_token', ...flag };
    return {
      state: 'pending',
      userCode: a.userCode,
      verificationUri: a.verificationUri,
      ...(a.verificationUriComplete === undefined
        ? {}
        : { verificationUriComplete: a.verificationUriComplete }),
      expiresAt: a.expiresAt,
      ...flag,
    };
  }
}

// ── MODE=local simulator: the same four endpoints behind an in-process fetch ────────────────────────────────

export type SimOutcome = 'pending' | 'approve' | 'deny' | 'expire';

/** What the next device attempt does; `tamper` bends the ID token so validation failures can be exercised. */
export interface SimScript {
  outcome: SimOutcome;
  expiresInS?: number;
  intervalS?: number;
  tamper?: {
    acr?: string;
    authTimeOffsetS?: number;
    nonce?: string;
    aud?: string;
    iss?: string;
    sub?: string;
    alg?: 'none';
    kid?: string;
  };
  /** Answer the token poll with the previously issued token again (one-use check). */
  replay?: boolean;
}

interface SimAttempt {
  userCode: string;
  createdAt: number;
  expiresInS: number;
  intervalS: number;
  script: SimScript;
  redeemed: boolean;
}

export class LocalIdp {
  static readonly ISSUER = 'https://agent-pass.simulated.invalid';
  readonly issuer: string;
  readonly fetch: typeof fetch;
  /** The NEXT attempt's script (POST /__local/agent-pass). */
  script: SimScript = { outcome: 'pending' };
  readonly #attempts = new Map<string, SimAttempt>();
  readonly #byUserCode = new Map<string, string>();
  #key!: { kid: string; privateKey: KeyObject; jwk: Record<string, unknown> };
  #lastToken: string | undefined;
  #issued = 0;

  constructor(
    private readonly opts: {
      now: () => number;
      clientId: string;
      clientSecret: string | undefined;
      /** The approval page: `${verificationBase}/<user_code>` (local: the API's own /__local route). */
      verificationBase: string;
      issuer?: string;
      acr?: string;
      sub?: string;
    },
  ) {
    this.issuer = opts.issuer ?? LocalIdp.ISSUER;
    this.rotateKey();
    const app = new Hono();
    app.get('/.well-known/openid-configuration', (c) =>
      c.json({
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/api/v1/authorize`,
        token_endpoint: `${this.issuer}/api/v1/token`,
        device_authorization_endpoint: `${this.issuer}/api/v1/device_authorization`,
        jwks_uri: `${this.issuer}/.well-known/jwks.json`,
        grant_types_supported: ['authorization_code', DEVICE_GRANT],
        id_token_signing_alg_values_supported: ['RS256'],
        simulated: true,
      }),
    );
    app.get('/.well-known/jwks.json', (c) => c.json({ keys: [this.#key.jwk] }));
    app.post('/api/v1/device_authorization', async (c) => {
      const form = await c.req.parseBody();
      if (!this.#authenticated(form)) return c.json({ error: 'invalid_client' }, 401);
      if (form.scope !== 'openid') return c.json({ error: 'invalid_scope' }, 400);
      const deviceCode = randomBytes(24).toString('base64url');
      const userCode = `${randomBytes(2).toString('hex').toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
      const script = this.script;
      this.script = { outcome: 'pending' };
      const attempt: SimAttempt = {
        userCode,
        createdAt: this.opts.now(),
        expiresInS: script.expiresInS ?? 300,
        intervalS: script.intervalS ?? 1,
        script,
        redeemed: false,
      };
      this.#attempts.set(deviceCode, attempt);
      this.#byUserCode.set(userCode, deviceCode);
      return c.json({
        device_code: deviceCode,
        user_code: userCode,
        verification_uri: `${this.opts.verificationBase}/${userCode}`,
        verification_uri_complete: `${this.opts.verificationBase}/${userCode}?outcome=approve`,
        expires_in: attempt.expiresInS,
        interval: attempt.intervalS,
      });
    });
    app.post('/api/v1/token', async (c) => {
      const form = await c.req.parseBody();
      if (!this.#authenticated(form)) return c.json({ error: 'invalid_client' }, 401);
      if (form.grant_type !== DEVICE_GRANT) return c.json({ error: 'unsupported_grant_type' }, 400);
      const code = typeof form.device_code === 'string' ? form.device_code : '';
      const a = this.#attempts.get(code);
      if (a === undefined || a.redeemed) return c.json({ error: 'invalid_grant' }, 400);
      if (a.script.replay && this.#lastToken !== undefined)
        return c.json({ id_token: this.#lastToken });
      const ageS = (this.opts.now() - a.createdAt) / 1000;
      if (a.script.outcome === 'expire' || ageS >= a.expiresInS)
        return c.json({ error: 'expired_token' }, 400);
      if (a.script.outcome === 'deny') return c.json({ error: 'access_denied' }, 400);
      if (a.script.outcome === 'pending') return c.json({ error: 'authorization_pending' }, 400);
      a.redeemed = true;
      this.#byUserCode.delete(a.userCode);
      return c.json({ id_token: this.#idToken(a.script) });
    });
    this.fetch = async (input: Parameters<typeof fetch>[0], init?: RequestInit) =>
      app.request(input instanceof URL ? input.toString() : input, init);
  }

  /** The human's page: resolves the attempt behind `userCode` (true when it was pending). */
  resolve(userCode: string, outcome: 'approve' | 'deny'): boolean {
    const code = this.#byUserCode.get(userCode);
    const a = code === undefined ? undefined : this.#attempts.get(code);
    if (a === undefined || a.redeemed || a.script.outcome !== 'pending') return false;
    a.script = { ...a.script, outcome };
    return true;
  }

  /** A new signing key with a new kid (the JWKS rotation the client must survive). */
  rotateKey(): void {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = `sim-${++this.#issued}-${randomBytes(4).toString('hex')}`;
    const jwk = publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
    this.#key = { kid, privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
  }

  #authenticated(form: Record<string, unknown>): boolean {
    if (form.client_id !== this.opts.clientId) return false;
    if (typeof form.client_assertion === 'string') return true; // private_key_jwt: shape only, locally
    return this.opts.clientSecret === undefined || form.client_secret === this.opts.clientSecret;
  }

  #idToken(script: SimScript): string {
    const t = script.tamper ?? {};
    const nowS = Math.floor(this.opts.now() / 1000);
    const claims = {
      iss: t.iss ?? this.issuer,
      sub: t.sub ?? this.opts.sub ?? 'sim-human-1',
      aud: t.aud ?? this.opts.clientId,
      exp: nowS + 300,
      iat: nowS,
      auth_time: nowS + (t.authTimeOffsetS ?? 0),
      acr: t.acr ?? this.opts.acr ?? 'https://world.org/oidc/acr/orb',
      amr: ['passkey'],
      jti: randomUUID(),
      ...(t.nonce === undefined ? {} : { nonce: t.nonce }),
      simulated: true,
    };
    const token =
      t.alg === 'none'
        ? `${b64url(JSON.stringify({ alg: 'none' }))}.${b64url(JSON.stringify(claims))}.`
        : signJwt(claims, this.#key.privateKey, t.kid ?? this.#key.kid);
    this.#lastToken = token;
    return token;
  }
}

// ── Wiring ─────────────────────────────────────────────────────────────────────────────────────────────────

/** `undefined` while WORLD_AGENT_PASS_CLIENT_ID is unset: the feature is off and nothing refuses `pass_required`. */
export function createAgentPass(
  env: Env,
  opts: { fetch?: typeof fetch; now: () => number; logger: Logger; state: DurableState },
): AgentPass | undefined {
  const clientId = env.WORLD_AGENT_PASS_CLIENT_ID;
  if (clientId === undefined) return undefined;
  const simulated = env.MODE === 'local' && clientId === 'simulated';
  const cfg: AgentPassConfig = {
    issuer: simulated ? LocalIdp.ISSUER : env.WORLD_AGENT_PASS_ISSUER,
    clientId,
    clientSecret:
      env.WORLD_AGENT_PASS_CLIENT_SECRET === undefined
        ? undefined
        : new Secret(env.WORLD_AGENT_PASS_CLIENT_SECRET),
    privateKeyJwk:
      env.WORLD_AGENT_PASS_PRIVATE_KEY_JWK === undefined
        ? undefined
        : new Secret(env.WORLD_AGENT_PASS_PRIVATE_KEY_JWK),
    maxAgeS: env.WORLD_AGENT_PASS_MAX_AGE_S,
    validS: env.WORLD_AGENT_PASS_VALID_S,
    acr: env.WORLD_AGENT_PASS_ACR,
  };
  const sim = simulated
    ? new LocalIdp({
        now: opts.now,
        clientId,
        clientSecret: env.WORLD_AGENT_PASS_CLIENT_SECRET,
        verificationBase: `http://127.0.0.1:${env.PORT}/__local/agent-pass`,
      })
    : undefined;
  if (sim !== undefined) {
    opts.logger.warn(
      { event: 'degraded', what: 'agent-pass' },
      'agent pass: SIMULATED World IdP (MODE=local)',
    );
  }
  return new AgentPass({
    cfg,
    client: new WorldOidcClient(cfg, sim?.fetch ?? opts.fetch, opts.now),
    state: opts.state,
    now: opts.now,
    logger: opts.logger,
    ...(sim === undefined ? {} : { sim }),
  });
}
