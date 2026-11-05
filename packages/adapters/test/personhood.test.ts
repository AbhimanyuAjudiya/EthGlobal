import { describe, expect, it } from 'vitest';

import { personhoodProofSchema } from '@ethglobal/protocol/schemas';

import { MockPersonhood } from '../src/mocks/personhood.js';
import { nullifierHex, signalHash } from '../src/personhood-proof.js';
import { fixtureProof } from '../src/testing/index.js';

import type { PersonhoodProof } from '../src/types.js';

const SIGNAL = `0x${'51'.repeat(32)}` as const;

describe('MockPersonhood', () => {
  it.each([
    ['orb', 'orb'],
    ['document', 'secure_document'],
    ['secure_document', 'secure_document'],
    ['device', 'device'],
  ] as const)(
    'a %s fixture proof verifies at level %s with a hex32 nullifier',
    async (level, expected) => {
      const result = await new MockPersonhood().verify(fixtureProof(level), { action: 'claim' });
      expect(result.level).toBe(expected);
      expect(result.nullifierHash).toMatch(/^0x[0-9a-f]{64}$/);
    },
  );

  it('the same seed is the same human at every level (one nullifier)', async () => {
    const orb = await new MockPersonhood().verify(fixtureProof('orb', undefined, 's'), {
      action: 'a',
    });
    const device = await new MockPersonhood().verify(fixtureProof('device', undefined, 's'), {
      action: 'a',
    });
    expect(orb.nullifierHash).toBe(device.nullifierHash);
  });

  it('rejects the same nullifier twice for one action, but allows another action', async () => {
    const personhood = new MockPersonhood();
    await personhood.verify(fixtureProof('orb'), { action: 'claim' });
    await expect(personhood.verify(fixtureProof('orb'), { action: 'claim' })).rejects.toMatchObject(
      {
        code: 'already_verified',
      },
    );
    await expect(personhood.verify(fixtureProof('orb'), { action: 'vote' })).resolves.toMatchObject(
      { level: 'orb' },
    );
  });

  it('with expectSignal, requires signal_hash = hashToField(signal) (T-19)', async () => {
    const strict = new MockPersonhood({ expectSignal: true });
    await expect(
      strict.verify(fixtureProof('orb', SIGNAL, 'a'), { action: 'claim', signal: SIGNAL }),
    ).resolves.toBeDefined();
    await expect(
      strict.verify(fixtureProof('orb', `0x${'52'.repeat(32)}`, 'b'), {
        action: 'claim',
        signal: SIGNAL,
      }),
    ).rejects.toMatchObject({ code: 'invalid_proof' });
    await expect(
      new MockPersonhood().verify(fixtureProof('orb', undefined, 'c'), {
        action: 'claim',
        signal: SIGNAL,
      }),
    ).resolves.toBeDefined();
  });

  it('rejects malformed input, unknown identifiers, sessions and a missing action', async () => {
    const personhood = new MockPersonhood();
    const legacy = {
      proof: '0x12',
      merkle_root: '0xab',
      nullifier_hash: '0xbeef',
      verification_level: 'orb',
    };
    await expect(
      personhood.verify(legacy as unknown as PersonhoodProof, { action: 'claim' }),
    ).rejects.toMatchObject({
      code: 'invalid_proof',
    });
    const proof = fixtureProof('device');
    const retina = {
      ...proof,
      responses: proof.responses.map((r) => ({ ...r, identifier: 'retina' })),
    } as PersonhoodProof;
    await expect(personhood.verify(retina, { action: 'claim' })).rejects.toMatchObject({
      code: 'invalid_proof',
    });
    const session = { ...fixtureProof('orb'), session_id: 'session_1' } as PersonhoodProof;
    await expect(personhood.verify(session, { action: 'claim' })).rejects.toMatchObject({
      code: 'invalid_proof',
    });
    await expect(personhood.verify(fixtureProof('orb'), { action: '' })).rejects.toMatchObject({
      code: 'invalid_action',
    });
  });
});

describe('IDKit helpers', () => {
  it('fixture proofs are valid IDKit 4 results', () => {
    for (const level of ['orb', 'document', 'device'] as const) {
      expect(personhoodProofSchema.safeParse(fixtureProof(level, SIGNAL)).success).toBe(true);
    }
    expect(fixtureProof('orb').protocol_version).toBe('4.0');
    expect(fixtureProof('device').protocol_version).toBe('3.0');
  });

  it('signalHash: empty signal is the IDKit default; hex signals hash as bytes', () => {
    expect(signalHash('')).toBe(
      '0x00c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a4',
    );
    expect(signalHash('0x')).toBe(signalHash(''));
    expect(signalHash('hello')).toBe(
      '0x001c8aff950685c2ed4bc3174f3472287b56d9517b9c948127319a09a7a36dea',
    );
  });

  it('nullifierHex normalises decimal and hex, rejects the rest', () => {
    expect(nullifierHex('255')).toBe(`0x${'0'.repeat(62)}ff`);
    expect(nullifierHex('0xFF')).toBe(`0x${'0'.repeat(62)}ff`);
    expect(nullifierHex(`0x${'f'.repeat(64)}`)).toBe(`0x${'f'.repeat(64)}`);
    for (const bad of ['', '0x', '-1', '1e5', 'abc', (2n ** 256n).toString()])
      expect(nullifierHex(bad)).toBeUndefined();
  });
});
