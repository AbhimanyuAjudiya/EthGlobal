import { describe, expect, it } from 'vitest';

import { MockPersonhood } from '../src/mocks/personhood.js';

import type { PersonhoodProof } from '../src/types.js';

const proof: PersonhoodProof = {
  proof: '0x1234',
  merkle_root: '0xabcd',
  nullifier_hash: '0xBEEF',
  verification_level: 'orb',
};

describe('MockPersonhood', () => {
  it('returns the nullifier and level for a well-formed proof', async () => {
    const result = await new MockPersonhood().verify(proof, { action: 'claim' });
    expect(result).toEqual({ nullifierHash: '0xbeef', level: 'orb' });
  });

  it('rejects the same nullifier twice for one action, but allows another action', async () => {
    const personhood = new MockPersonhood();
    await personhood.verify(proof, { action: 'claim' });
    await expect(personhood.verify(proof, { action: 'claim' })).rejects.toMatchObject({
      code: 'already_verified',
    });
    await expect(personhood.verify(proof, { action: 'vote' })).resolves.toMatchObject({
      level: 'orb',
    });
  });

  it('rejects malformed input', async () => {
    const personhood = new MockPersonhood();
    await expect(
      personhood.verify({ ...proof, proof: 'nope' as never }, { action: 'claim' }),
    ).rejects.toMatchObject({ code: 'invalid_proof' });
    await expect(
      personhood.verify({ ...proof, verification_level: 'retina' as never }, { action: 'claim' }),
    ).rejects.toMatchObject({ code: 'invalid_proof' });
    await expect(personhood.verify(proof, { action: '' })).rejects.toMatchObject({
      code: 'invalid_action',
    });
  });
});
