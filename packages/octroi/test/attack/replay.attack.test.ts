import { describe, expect, it, vi } from 'vitest';

import { MockPersonhood, type LedgerPutInput } from '@ethglobal/adapters';
import { fixtureProof } from '@ethglobal/adapters/testing';
import { keys, WORLD_ACTION, type Hex } from '@ethglobal/protocol/ids';

import {
  campaign,
  claimChallenge,
  counters,
  deps,
  freeReq,
  ledgerWith,
  NULLIFIER,
  permissive,
  SECRET,
  SPK,
  T0,
} from './fixture.js';
import {
  auditKey,
  campaignClaimKey,
  challenge,
  consumeChallenge,
  decide,
  onchainClaimKey,
  quotaKey,
  signalFor,
} from '../../src/index.js';

describe('attack: O1 nullifier replay (T-18)', () => {
  it.each([
    ['a permissive verifier', () => permissive()],
    ['a one-shot verifier (IDKit 4)', () => new MockPersonhood({ expectSignal: true })],
  ])('second claim with the same nullifier is deny:replay with %s', async (_n, verifier) => {
    const d = deps({ personhood: verifier() });
    const first = await decide(freeReq(d), d);
    if (first.kind !== 'serve-free') throw new Error(first.kind);
    const viaLedger = await decide(freeReq(d, { existingEntitlement: first.entitlement }), d);
    expect(viaLedger).toMatchObject({ kind: 'deny', reason: 'replay' });
    const viaChain = await decide(freeReq(d, { counters: counters({ claimed: true }) }), d);
    expect(viaChain).toMatchObject({ kind: 'deny', reason: 'replay' });
  });

  it('claimKey and entitlement key are the documented constructions', async () => {
    const d = deps({ personhood: permissive() });
    const r = await decide(freeReq(d), d);
    const id = campaign().id as Hex;
    expect(r).toMatchObject({
      claimKey: onchainClaimKey(id, campaignClaimKey(auditKey(SECRET, id), NULLIFIER)),
      entitlement: { key: keys.entitlementFree(quotaKey(SECRET, NULLIFIER)) },
    });
  });
});

describe('attack: O2 proof not bound to our challenge (T-19)', () => {
  it('a proof minted for another challenge is invalid-proof', async () => {
    const d = deps();
    const chA = claimChallenge(d);
    const r = await decide(freeReq(d, { proof: fixtureProof('orb', chA.signal) }), d);
    expect(r).toMatchObject({ kind: 'deny', reason: 'invalid-proof' });
  });

  it('decide passes the signal recomputed from the nonce, not the echoed one', async () => {
    const d = deps();
    const spy = vi.spyOn(d.personhood, 'verify');
    const ch = claimChallenge(d);
    const lying = { ...ch, signal: claimChallenge(d).signal };
    expect(await decide(freeReq(d, { challenge: lying }), d)).toMatchObject({
      reason: 'invalid-proof',
    });
    expect(spy).not.toHaveBeenCalled(); // the consume refuses a signal that is not keccak(nonce‖audience)
    await decide(freeReq(d, { challenge: ch }), d);
    expect(spy).toHaveBeenCalledWith(expect.anything(), {
      action: WORLD_ACTION,
      signal: signalFor(ch.nonce, ch.audience),
    });
  });
});

describe('attack: O3 challenge forgery, replay, expiry, fail-closed, double-consume (T-20, T-32)', () => {
  const ch = () => challenge('recharge', '/claim', SPK, T0, SECRET);

  it('exp boundary', async () => {
    const d = deps();
    const c = ch();
    expect(c.exp).toBe(T0 + 120_000);
    expect(await consumeChallenge(d.ledger, new Set(), c, SPK, c.exp - 1, SECRET)).toBe('ok');
    expect(await consumeChallenge(d.ledger, new Set(), ch(), SPK, c.exp + 1, SECRET)).toBe(
      'expired',
    );
  });

  it('two concurrent consumes of one nonce with a slow put: exactly one ok', async () => {
    const d = deps();
    const slow = ledgerWith(d.ledger, {
      put: async (i: LedgerPutInput) => {
        await new Promise((r) => setTimeout(r, 5));
        return d.ledger.put(i);
      },
    });
    const set = new Set<string>();
    const c = ch();
    const rs = await Promise.all([
      consumeChallenge(slow, set, c, SPK, T0, SECRET),
      consumeChallenge(slow, set, c, SPK, T0, SECRET),
    ]);
    expect(rs.filter((r) => r === 'ok')).toHaveLength(1);
  });

  it('issuing writes nothing (D-3); consuming writes exactly one nonce entity with expiresIn 120', async () => {
    const d = deps();
    const c = ch();
    expect(await d.ledger.query({})).toHaveLength(0);
    await consumeChallenge(d.ledger, new Set(), c, SPK, T0, SECRET);
    const es = await d.ledger.query({ annotations: { type: 'nonce' } });
    expect(es).toHaveLength(1);
    expect(es[0]!.expiresAt).toBe(T0 + 120_000);
  });
});

describe('attack: O4 audience/path confusion (T-21)', () => {
  it('a /gift/claim challenge on the /claim lane is invalid-proof, and nothing is burned', async () => {
    const d = deps();
    const spy = vi.spyOn(d.personhood, 'verify');
    const gift = challenge('recharge', '/gift/claim', SPK, T0, SECRET);
    expect(await decide(freeReq(d, { challenge: gift }), d)).toMatchObject({
      kind: 'deny',
      reason: 'invalid-proof',
    });
    expect(spy).not.toHaveBeenCalled();
    // and the gift lane's own consume refuses a /claim challenge relabelled as /gift/claim (MAC)
    expect(
      await consumeChallenge(
        d.ledger,
        new Set(),
        { ...ch0(), path: '/gift/claim' },
        SPK,
        T0,
        SECRET,
      ),
    ).toBe('invalid');
  });
});
const ch0 = () => challenge('recharge', '/claim', SPK, T0, SECRET);
