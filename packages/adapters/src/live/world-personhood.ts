/**
 * WorldCloudPersonhood (INTERFACES §3.3; A-25, A-26; T-19, T-22, T-24, T-38, T-80): IDKit 4 cloud verify —
 * `POST {baseUrl}/api/v4/verify/{rp_id}` with the IDKit result unchanged; success only when the verifier says
 * success for every credential, for OUR action, in OUR environment, bound to OUR signal.
 */
import { httpJson } from '@ethglobal/protocol/http';
import { personhoodProofSchema, verificationLevelFromIdentifier } from '@ethglobal/protocol/schemas';
import { z } from 'zod';

import { AdapterError } from '../errors.js';
import { nullifierHex, signalHash } from '../personhood-proof.js';
import { guard } from './errors.js';
import { checkedBaseUrl, joinUrl, withFetch } from './http.js';

import type { Personhood, PersonhoodContext, PersonhoodProof, PersonhoodResult } from '../types.js';

export const WORLD_VERIFY_BASE_URL = 'https://developer.world.org';

const resultItem = z.object({ identifier: z.string().max(40), success: z.boolean() }).loose();
const okBody = z
  .object({
    success: z.literal(true),
    action: z.string().max(64),
    nullifier: z.string().max(80),
    created_at: z.string().max(40).optional(),
    environment: z.enum(['production', 'staging', 'sandbox']),
    session_id: z.string().optional(),
    results: z.array(resultItem).max(8).optional(),
  })
  .loose();
const errorBody = z
  .object({
    success: z.literal(false),
    code: z.string().max(64),
    detail: z.string().max(500).optional(),
    results: z.array(resultItem).max(8).optional(),
  })
  .loose();
const verifyBody = z.union([okBody, errorBody]);

/** 400 codes that mean "this human already verified for this action" (World one-per-action rule, T-24). */
const ALREADY = new Set(['nullifier_replayed', 'max_verifications_reached', 'already_verified', 'exceeded_max_verifications']);
/** 400 codes that are OUR configuration, not the human's proof: logged loudly, surfaced as unavailable. */
const CONFIG = new Set(['app_not_migrated', 'unknown_rp', 'inactive_rp', 'invalid_rp_signature', 'rp_signature_expired']);

export interface WorldCloudPersonhoodOptions {
  rpId: string;
  action: string;
  environment: 'production' | 'staging';
  fetch?: typeof fetch;
  baseUrl?: string;
  logger?: Pick<Console, 'warn'>;
}

const invalid = (message: string, details?: Record<string, unknown>): AdapterError =>
  new AdapterError('personhood', 'invalid_proof', message, details);

export class WorldCloudPersonhood implements Personhood {
  readonly #opts: WorldCloudPersonhoodOptions;
  readonly #url: string;

  constructor(opts: WorldCloudPersonhoodOptions) {
    if (!/^(rp|app)_[A-Za-z0-9]{1,64}$/.test(opts.rpId)) throw new Error('WORLD_RP_ID must look like rp_…');
    this.#opts = opts;
    const base = checkedBaseUrl(opts.baseUrl ?? WORLD_VERIFY_BASE_URL);
    this.#url = joinUrl(base, `/api/v4/verify/${encodeURIComponent(opts.rpId)}`);
  }

  async verify(proof: PersonhoodProof, context: PersonhoodContext): Promise<PersonhoodResult> {
    if (context.action !== this.#opts.action) {
      throw new AdapterError('personhood', 'invalid_action', 'action does not match WORLD_ACTION');
    }
    const parsed = personhoodProofSchema.safeParse(proof);
    if (!parsed.success) throw invalid('not an IDKit 4 uniqueness result');
    const expected = context.signal === undefined ? undefined : signalHash(context.signal);
    const bound = (hash: string) => expected === undefined || hash.toLowerCase() === expected;
    // Check our binding before spending the human's one-time proof at the verifier (T-19, T-24).
    if (!parsed.data.responses.every((r) => bound(r.signal_hash))) {
      throw invalid('signal_hash does not bind the challenge signal');
    }

    const { data } = await guard('personhood', () =>
      httpJson(this.#url, {
        method: 'POST',
        body: proof, // the IDKit result unchanged — never rebuilt from the parsed copy (A-25)
        ...withFetch(this.#opts.fetch),
        schema: verifyBody,
        allowStatus: [400],
      }),
    );
    if (!data.success) throw this.#refused(data.code);

    if (data.session_id !== undefined) throw invalid('session results are not accepted');
    if (data.environment !== this.#opts.environment) {
      throw invalid(`verifier answered for environment ${data.environment}`, { environment: data.environment });
    }
    if (data.action !== this.#opts.action) throw invalid('verifier answered for another action');
    const results = data.results ?? [];
    if (results.some((r) => !r.success)) throw invalid('not every credential verified');
    // The verifier's identifier wins over what the proof claims (T-22).
    const identifier = results[0]?.identifier ?? parsed.data.responses[0]!.identifier;
    const level = verificationLevelFromIdentifier(identifier);
    if (!level) throw invalid(`unknown credential identifier ${identifier}`);
    const nullifierHash = nullifierHex(data.nullifier);
    if (!nullifierHash) {
      throw new AdapterError('personhood', 'invalid_response', 'verifier nullifier is not a field element');
    }
    const claimed = parsed.data.responses.map((r) => nullifierHex(r.nullifier));
    if (!claimed.includes(nullifierHash)) {
      throw new AdapterError('personhood', 'invalid_response', 'verifier nullifier differs from the proof');
    }
    return { nullifierHash, level };
  }

  #refused(code: string): AdapterError {
    if (ALREADY.has(code)) {
      return new AdapterError('personhood', 'already_verified', 'this person already verified for this action', { code });
    }
    if (CONFIG.has(code)) {
      this.#opts.logger?.warn(`world: verifier refused our configuration (${code}); check WORLD_RP_ID / Portal`);
      return new AdapterError('personhood', 'unavailable', `world verifier configuration error: ${code}`, { code });
    }
    return invalid(`verifier rejected the proof: ${code}`, { code });
  }
}
