import { describe, expect, it, vi } from 'vitest';

import { fixtureProof } from '@ethglobal/adapters/testing';
import type { PersonhoodProof } from '@ethglobal/protocol/schemas';

import { campaign, claimChallenge, deps, freeReq, NULLIFIER } from './fixture.js';
import { decide, sizeBundle } from '../../src/index.js';

describe('attack: O5 tier escalation (T-22)', () => {
  it('tier comes from the verifier, never from the body (v2 field and IDKit 4 identifier both forged)', async () => {
    const d = deps();
    vi.spyOn(d.personhood, 'verify').mockResolvedValue({
      nullifierHash: NULLIFIER,
      level: 'device',
    });
    const ch = claimChallenge(d);
    const p = fixtureProof('device', ch.signal);
    const forged = {
      ...p,
      verification_level: 'orb',
      responses: p.responses.map((x) => ({
        ...x,
        identifier: 'proof_of_human',
        issuer_schema_id: 1,
      })),
    } as unknown as PersonhoodProof;
    const r = await decide(freeReq(d, { challenge: ch, proof: forged }), d);
    if (r.kind !== 'payment-required') throw new Error(r.kind);
    expect(r.body.accepts[0]!.amount).toBe('4000000'); // device: no gift, the human price of 1 GB
  });

  it('an unknown level from a misbehaving verifier → none → payment-required', async () => {
    const d = deps();
    vi.spyOn(d.personhood, 'verify').mockResolvedValue({
      nullifierHash: NULLIFIER,
      level: 'selfie' as 'device',
    });
    expect((await decide(freeReq(d), d)).kind).toBe('payment-required');
  });
});

describe('attack: O6 sizeBundle (T-23; A-1)', () => {
  it.each([
    [2_500_000n, {}, 160],
    [1_140_000n, {}, 300],
    [0n, {}, 300],
    [1_140_000n, { bundleMb: { orb: 5000, document: 5000, device: 0 as const } }, 350], // EV binds under the 1 GB cap
    [1_140_000n, { bundleMb: { orb: 100, document: 300, device: 0 as const } }, 100],
  ])('wholesale %s with %j → %i MB', (wholesaleUsd6PerGb, over, mb) => {
    expect(sizeBundle(campaign({ wholesaleUsd6PerGb, ...over }), 'orb')).toBe(mb);
  });
});
