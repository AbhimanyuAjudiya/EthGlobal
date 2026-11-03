import { AdapterError } from '../errors.js';
import { isHex } from '../hash.js';
import {
  verificationLevels,
  type Personhood,
  type PersonhoodContext,
  type PersonhoodProof,
  type PersonhoodResult,
} from '../types.js';

const hexFields = ['proof', 'merkle_root', 'nullifier_hash'] as const;

/**
 * Accepts any well-formed IDKit result and enforces World ID's one-verification-per-(action, nullifier)
 * rule. It does not check the ZK proof or the signal binding; the live adapter does.
 */
export class MockPersonhood implements Personhood {
  readonly #seen = new Set<string>();

  async verify(proof: PersonhoodProof, context: PersonhoodContext): Promise<PersonhoodResult> {
    if (!context.action) {
      throw new AdapterError('personhood', 'invalid_action', 'action is required');
    }
    for (const field of hexFields) {
      if (!isHex(proof[field])) {
        throw new AdapterError(
          'personhood',
          'invalid_proof',
          `${field} must be a 0x-prefixed hex string`,
        );
      }
    }
    if (!verificationLevels.includes(proof.verification_level)) {
      throw new AdapterError('personhood', 'invalid_proof', `unknown verification_level`);
    }
    const nullifierHash = proof.nullifier_hash.toLowerCase() as PersonhoodResult['nullifierHash'];
    const id = `${context.action}:${nullifierHash}`;
    if (this.#seen.has(id)) {
      throw new AdapterError(
        'personhood',
        'already_verified',
        'this person already verified for this action',
      );
    }
    this.#seen.add(id);
    return { nullifierHash, level: proof.verification_level };
  }
}
