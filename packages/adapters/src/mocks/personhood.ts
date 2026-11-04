import {
  personhoodProofSchema,
  verificationLevelFromIdentifier,
} from '@ethglobal/protocol/schemas';

import { AdapterError } from '../errors.js';
import { nullifierHex, signalHash } from '../personhood-proof.js';

import type { Personhood, PersonhoodContext, PersonhoodProof, PersonhoodResult } from '../types.js';

export interface MockPersonhoodOptions {
  /** When set and a signal is given, every response's signal_hash must equal hashToField(signal) (T-19). */
  expectSignal?: boolean;
  /** The World environment production trusts (T-80); a V4 result for another environment is rejected. */
  environment?: 'production' | 'staging';
}

const invalid = (message: string): AdapterError =>
  new AdapterError('personhood', 'invalid_proof', message);

/**
 * Accepts any well-formed IDKit 4 result and enforces World ID's one-verification-per-(action, nullifier)
 * rule. It does not check the ZK proof; with `expectSignal` it checks the signal binding as the live verifier
 * does. The level comes from the credential identifier through protocol's one mapping.
 */
export class MockPersonhood implements Personhood {
  readonly #seen = new Set<string>();
  readonly #expectSignal: boolean;
  readonly #environment: string;

  constructor(options: MockPersonhoodOptions = {}) {
    this.#expectSignal = options.expectSignal ?? false;
    this.#environment = options.environment ?? 'production';
  }

  async verify(proof: PersonhoodProof, context: PersonhoodContext): Promise<PersonhoodResult> {
    if (!context.action) {
      throw new AdapterError('personhood', 'invalid_action', 'action is required');
    }
    const parsed = personhoodProofSchema.safeParse(proof);
    if (!parsed.success) throw invalid('not an IDKit 4 uniqueness result');
    const environment = (parsed.data as { environment?: unknown }).environment;
    if (environment !== undefined && environment !== this.#environment) {
      throw invalid(`proof is for environment ${JSON.stringify(environment)}`);
    }
    const [first] = parsed.data.responses;
    const level = first && verificationLevelFromIdentifier(first.identifier);
    const nullifierHash = first && nullifierHex(first.nullifier);
    if (!level) throw invalid('unknown credential identifier');
    if (!nullifierHash) throw invalid('malformed nullifier');
    if (this.#expectSignal && context.signal !== undefined) {
      const expected = signalHash(context.signal);
      if (!parsed.data.responses.every((r) => r.signal_hash.toLowerCase() === expected)) {
        throw invalid('signal_hash does not bind the challenge signal');
      }
    }
    const id = `${context.action}:${nullifierHash}`;
    if (this.#seen.has(id)) {
      throw new AdapterError(
        'personhood',
        'already_verified',
        'this person already verified for this action',
      );
    }
    this.#seen.add(id);
    return { nullifierHash, level };
  }
}
