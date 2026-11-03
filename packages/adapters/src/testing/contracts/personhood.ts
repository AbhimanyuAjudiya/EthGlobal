/**
 * describePersonhood: the World-ID-shaped port contract (L6; T-19, T-22, T-38, T-80). Subjects verify proofs built
 * with `fixtureProof(level, SUITE_SIGNAL, seed)` for the seeds below; the live subject replays a recording of
 * exactly those proofs (fixtures/world/contract-suite.json).
 */
import { WORLD_ACTION } from '@ethglobal/protocol/ids';
import { describe, expect, it } from 'vitest';

import { fixtureProof } from '../builders.js';

import type { Hex, Personhood, PersonhoodProof } from '../../types.js';

export const SUITE_SIGNAL: Hex = `0x${'5a'.repeat(32)}`;
export const OTHER_SIGNAL: Hex = `0x${'6b'.repeat(32)}`;
/** The proofs the suite sends, in order; a recording of a live subject must answer each. */
export const suiteProofs = {
  orb: fixtureProof('orb', SUITE_SIGNAL, 'suite-orb'),
  document: fixtureProof('document', SUITE_SIGNAL, 'suite-document'),
  device: fixtureProof('device', SUITE_SIGNAL, 'suite-device'),
  otherSignal: fixtureProof('orb', OTHER_SIGNAL, 'suite-other-signal'),
  staging: { ...fixtureProof('orb', SUITE_SIGNAL, 'suite-staging'), environment: 'staging' } as PersonhoodProof,
} as const;

export function describePersonhood(name: string, make: () => Promise<Personhood>): void {
  describe(`Personhood contract: ${name}`, () => {
    const context = { action: WORLD_ACTION, signal: SUITE_SIGNAL };

    it('an orb proof bound to the signal verifies once: level from the identifier, nullifier as hex32', async () => {
      const personhood = await make();
      const result = await personhood.verify(suiteProofs.orb, context);
      expect(result.level).toBe('orb');
      expect(result.nullifierHash).toMatch(/^0x[0-9a-f]{64}$/);
      await expect(personhood.verify(suiteProofs.orb, context)).rejects.toMatchObject({ code: 'already_verified' });
    });

    it('document (passport) and legacy device credentials map through the one identifier table', async () => {
      const personhood = await make();
      await expect(personhood.verify(suiteProofs.document, context)).resolves.toMatchObject({
        level: 'secure_document',
      });
      await expect(personhood.verify(suiteProofs.device, context)).resolves.toMatchObject({ level: 'device' });
    });

    it('a proof bound to another signal is rejected (O2, T-19)', async () => {
      const personhood = await make();
      await expect(personhood.verify(suiteProofs.otherSignal, context)).rejects.toMatchObject({
        code: 'invalid_proof',
      });
    });

    it('a staging (simulator) proof is rejected in production (T-80)', async () => {
      const personhood = await make();
      await expect(personhood.verify(suiteProofs.staging, context)).rejects.toMatchObject({ code: 'invalid_proof' });
    });

    it('malformed input and a session result never reach success', async () => {
      const personhood = await make();
      const bad = [
        {},
        { ...suiteProofs.orb, responses: [] },
        { ...suiteProofs.orb, session_id: 'session_x' },
        { ...suiteProofs.orb, protocol_version: '2.0' },
      ] as unknown as PersonhoodProof[];
      for (const proof of bad) {
        await expect(personhood.verify(proof, context)).rejects.toMatchObject({ code: 'invalid_proof' });
      }
    });
  });
}
