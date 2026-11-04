/**
 * Red team (wave 1, octroi): key/HMAC properties and what a public-ledger observer learns (T-18, T-29, T-37,
 * T-73, INTERFACES A-9). The tests once filed as findings (RT-O-01…09) are passing regressions named `… [RT-O-0N]`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import { InMemoryLedger, type Personhood } from '@ethglobal/adapters';
import { fakeClock, paymentPayload } from '@ethglobal/adapters/testing';
import { bytesToHex, concat, hexToBytes, hmacKey, hmacSha256, utf8 } from '@ethglobal/crypto';
import { RechargeError } from '@ethglobal/protocol/errors';
import { keys, type Hex } from '@ethglobal/protocol/ids';

import {
  auditKey,
  buildAccepts,
  campaignClaimKey,
  decide,
  EntitlementStore,
  onchainClaimKey,
  quotaKey,
  type Decision,
} from '../../src/index.js';
import { campaign, deps, freeReq, NULLIFIER, resource, SECRET, type TestDeps } from '../helpers.js';

const CAMPAIGN_B: Hex = `0x${'bc'.repeat(32)}`;
const hex32 = fc.uint8Array({ minLength: 32, maxLength: 32 }).map((b) => bytesToHex(b));
const orb = (nullifierHash: Hex = NULLIFIER): Personhood => ({
  verify: async () => ({ nullifierHash, level: 'orb' }),
});

/** Everything a stranger reading Arkiv sees: every payload and annotation of our writer (TB-5: PUBLIC). */
const publicDump = async (ledger: InMemoryLedger) => JSON.stringify(await ledger.query({}));

describe('attack: rt public-ledger observer (T-37, T-73, A-9)', () => {
  // Regression RT-O-01 (fixed)
  it('the /me/:key capability of a free entitlement does not appear on the public ledger [RT-O-01]', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const d: TestDeps = { ...deps({}, clock), ledger, personhood: orb() };
    const r = (await decide(freeReq(d), d)) as Extract<Decision, { kind: 'serve-free' }>;
    await new EntitlementStore(ledger, clock.now).create(r.entitlement);
    expect(await publicDump(ledger)).not.toContain(r.entitlement.key);
  });

  // Regression RT-O-01 (fixed)
  it('two campaigns claimed by one human (after the first bundle expired) share no ledger-visible identifier [RT-O-01]', async () => {
    const clock = fakeClock();
    const ledger = new InMemoryLedger({ now: clock.now });
    const d: TestDeps = { ...deps({}, clock), ledger, personhood: orb() };
    const store = new EntitlementStore(ledger, clock.now);
    const a = (await decide(
      freeReq(d, { campaign: campaign({ validityDays: 1, expiresAt: clock.now() + 30 * 864e5 }) }),
      d,
    )) as Extract<Decision, { kind: 'serve-free' }>;
    await store.create(a.entitlement);
    const seenA = await ledger.query({}); // Arkiv history is permanent; an indexer keeps every version
    clock.advance(2 * 864e5);
    const b = (await decide(
      freeReq(d, { campaign: campaign({ id: CAMPAIGN_B, expiresAt: clock.now() + 30 * 864e5 }) }),
      d,
    )) as Extract<Decision, { kind: 'serve-free' }>;
    expect(b.kind).toBe('serve-free');
    await store.create(b.entitlement);
    const seenB = await ledger.query({});
    const idsA = new Set(
      seenA.flatMap((e) =>
        Object.entries(e.annotations)
          .filter(([k]) => k === 'key')
          .map(([, v]) => v),
      ),
    );
    // Only what was written for B counts: A's own entities (its campaign claim record lives until campaign A
    // ends, A-33) are still A's — re-reading them links nothing new.
    const seenAKeys = new Set(seenA.map((e) => e.key));
    const shared = seenB
      .filter((e) => !seenAKeys.has(e.key))
      .flatMap((e) => Object.entries(e.annotations))
      .filter(([k, v]) => k === 'key' && idsA.has(v));
    expect(shared).toEqual([]); // the sponsor of A and B must not be able to join their claim lists
    // And the per-campaign published pseudonyms are, as intended, distinct:
    expect(a.campaignClaimKey).not.toBe(b.campaignClaimKey);
  });

  // Regression RT-O-01 (fixed)
  it('the capability of a paid entitlement is not derivable from the public payment (from, nonce) [RT-O-01]', async () => {
    const d = deps();
    const offer = buildAccepts(d, 100)[0]!;
    const payment = paymentPayload(offer);
    const r = (await decide({ resource, mb: 100, payment }, d)) as Extract<
      Decision,
      { kind: 'serve-paid' }
    >;
    expect(r.kind).toBe('serve-paid');
    // `from` and `nonce` are in the transferWithAuthorization calldata on a public chain.
    const { from, nonce } = (payment.payload as { authorization: { from: string; nonce: Hex } })
      .authorization;
    expect(r.entitlement.key).not.toBe(keys.entitlementPaid(from, nonce));
  });
});

describe('attack: rt key derivation properties (T-18, T-29)', () => {
  // Property: per-campaign pseudonyms are unlinkable by equality for any nullifier set (A-9).
  it('campaignClaimKey / onchainClaimKey sets for two campaigns are disjoint for 200 random nullifiers', () => {
    fc.assert(
      fc.property(fc.uniqueArray(hex32, { minLength: 1, maxLength: 20 }), (ns) => {
        const aA = auditKey(SECRET, campaign().id as Hex);
        const aB = auditKey(SECRET, CAMPAIGN_B);
        const A = ns.map((n) => campaignClaimKey(aA, n));
        const B = new Set(ns.map((n) => campaignClaimKey(aB, n)));
        expect(A.some((k) => B.has(k))).toBe(false);
        const oA = ns.map((n) => onchainClaimKey(campaign().id as Hex, campaignClaimKey(aA, n)));
        expect(
          new Set([...oA, ...ns.map((n) => onchainClaimKey(CAMPAIGN_B, campaignClaimKey(aB, n)))])
            .size,
        ).toBe(2 * ns.length);
      }),
      { numRuns: 200 },
    );
  });

  // Property: a sponsor holding auditKey_A cannot derive auditKey_B or the global quotaKey; nothing it holds
  // is a prefix/suffix of either (no length-extension surface: HMAC, not H(secret ‖ m)).
  it('audit keys of different campaigns are independent and differ from quotaKey material', () => {
    const aA = bytesToHex(auditKey(SECRET, campaign().id as Hex));
    const aB = bytesToHex(auditKey(SECRET, CAMPAIGN_B));
    expect(aA).not.toBe(aB);
    expect(quotaKey(SECRET, NULLIFIER)).not.toBe(
      campaignClaimKey(auditKey(SECRET, campaign().id as Hex), NULLIFIER),
    );
    // Domain separation for the SAME 32 bytes: 'quota'‖x vs 'audit'‖x.
    expect(quotaKey(SECRET, CAMPAIGN_B)).not.toBe(aB);
  });

  // Property: the concatenation convention (no separators) cannot be abused across the octroi domains: the
  // messages 'quota'‖32B and 'audit'‖32B never equal a challenge-tag message (≥ 16+1+1+6+8+32 = 64 bytes).
  it('no cross-domain message equality: quota/audit (37 B) vs challenge tag input (≥ 64 B)', () => {
    const quotaMsg = concat(utf8('quota'), hexToBytes(NULLIFIER));
    expect(quotaMsg.length).toBe(37);
    expect(bytesToHex(hmacSha256(SECRET, quotaMsg))).toBe(quotaKey(SECRET, NULLIFIER));
    expect(hmacKey(SECRET, 'quot', concat(utf8('a'), hexToBytes(NULLIFIER)))).toBe(
      quotaKey(SECRET, NULLIFIER),
    );
    // ↑ recorded: hmacKey concatenates parts; only the fixed 5-byte domains keep the octroi messages apart.
  });

  // Property: hex case of the nullifier is not a second identity (a re-cased nullifier cannot mint a new quota key).
  it('quotaKey / campaignClaimKey are case-insensitive in the nullifier and campaign id', () => {
    fc.assert(
      fc.property(hex32, (n) => {
        const up: Hex = `0x${n.slice(2).toUpperCase()}`;
        expect(quotaKey(SECRET, up)).toBe(quotaKey(SECRET, n));
        expect(campaignClaimKey(auditKey(SECRET, up), up)).toBe(
          campaignClaimKey(auditKey(SECRET, n), n),
        );
      }),
      { numRuns: 200 },
    );
  });

  // Property: no output contains the nullifier, any 8-byte window of it, or its reversal.
  it('no 8-byte window of the nullifier survives in quotaKey / cck / onchainClaimKey', () => {
    fc.assert(
      fc.property(hex32, (n) => {
        const outs = [
          quotaKey(SECRET, n),
          campaignClaimKey(auditKey(SECRET, campaign().id as Hex), n),
          onchainClaimKey(
            campaign().id as Hex,
            campaignClaimKey(auditKey(SECRET, campaign().id as Hex), n),
          ),
        ].join('');
        const body = n.slice(2).toLowerCase();
        for (let i = 0; i + 16 <= body.length; i += 16)
          expect(outs).not.toContain(body.slice(i, i + 16));
      }),
      { numRuns: 200 },
    );
  });

  // Property: malformed key inputs throw RechargeError (typed), never a raw TypeError.
  it.each(['0x', '0x1234', `0x${'zz'.repeat(32)}`, `${'c3'.repeat(32)}`, `0x${'c3'.repeat(33)}`])(
    'quotaKey(%j) → RechargeError(invalid_request)',
    (n) => {
      expect(() => quotaKey(SECRET, n as Hex)).toThrow(RechargeError);
    },
  );
});
