/**
 * Red-team verification variants for the authz findings:
 *   RT-A-04 — the once-only registration / audit-key markers under another spelling of the same campaign id
 *             (upper-case hex) and under two concurrent registrations.
 *   RT-A-05 — the T-24 intent bound to the human: a stranger who knows only the victim's PUBLIC session key sends a
 *             /claim for ANOTHER campaign id with a junk proof. The intent must survive (the victim's one-time proof
 *             was already spent; losing the intent burns it — the T-24 harm itself).
 *   RT-A-06 — an expired card redeemed concurrently on both PIN routes with fresh session keys ⇒ no second LPA.
 */
import { describe, expect, it } from 'vitest';

import { fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

import { sponsorAuthorization, sponsorLogin } from '../support/client.js';
import { DAY, harness, redeemPin, seedCard, SPONSOR, SPONSOR_KEY } from '../support/harness.js';

describe('verify RT-A-04: once-only markers under another spelling / concurrency', () => {
  it('auditKey is not shown again via an upper-case spelling of the campaign id', async () => {
    const h = await harness();
    const bearer = await sponsorAuthorization(
      SPONSOR_KEY,
      h.deps.chainId,
      h.campaignId,
      h.clock.now(),
    );
    const first = (await (
      await h.get(`/sponsor/${h.campaignId}`, { authorization: bearer })
    ).json()) as {
      auditKey?: string;
    };
    expect(typeof first.auditKey).toBe('string');
    const upper: Hex = `0x${h.campaignId.slice(2).toUpperCase()}`;
    const upBearer = await sponsorAuthorization(SPONSOR_KEY, h.deps.chainId, upper, h.clock.now());
    for (const [id, auth] of [
      [upper, upBearer],
      [upper, bearer],
      [h.campaignId, upBearer],
    ] as const) {
      const res = await h.get(`/sponsor/${id}`, { authorization: auth });
      const body = (await res.clone().json()) as { auditKey?: string };
      expect(body.auditKey).toBeUndefined();
    }
  });

  it('POST /sponsor for the registered campaign with an upper-case id, twice concurrently ⇒ never 201', async () => {
    const h = await harness();
    const upper: Hex = `0x${h.campaignId.slice(2).toUpperCase()}`;
    const stored = (await h.deps.stores.campaigns.get(h.campaignId))!.payload;
    const login = await sponsorLogin(SPONSOR_KEY, h.deps.chainId, upper, h.clock.now());
    const body = {
      campaign: {
        id: upper,
        sponsor: SPONSOR,
        name: 'Rewritten',
        bundleMb: { orb: 300, document: 300, device: 0 },
        pricePerClaimUsd6: '500000',
        maxClaims: stored.maxClaims,
        claimsPerHour: stored.claimsPerHour,
        validityDays: 30,
        wholesaleUsd6PerGb: '0',
        idResaleUsd6: '500000',
        planId: 'in-3gb-30d',
        network: stored.network,
        contract: stored.contract,
        expiresAt: stored.expiresAt,
      },
      auth: { issuedAt: login.issuedAt, signature: login.signature },
    };
    const rs = await Promise.all([h.json('/sponsor', body), h.json('/sponsor', body)]);
    for (const r of rs) {
      expect(r.status).not.toBe(201);
      expect(((await r.json()) as { auditKey?: string }).auditKey).toBeUndefined();
    }
    expect((await h.deps.stores.campaigns.get(h.campaignId))!.payload.name).toBe(stored.name);
  });
});

describe('verify RT-A-05: a stranger with the victim’s public key cannot cancel the victim’s intent', () => {
  // Regression RT-A-05 (fixed): resumeIntent deleted the intent when the request's campaignId differed, before any proof
  // was checked and even for a campaign that does not exist. A mismatch now falls through without touching it.
  it('junk /claim for another campaign id with the victim’s session key ⇒ the victim still completes [RT-A-05]', async () => {
    const h = await harness();
    const victim = generateSessionKeypair();
    h.dataDrop.failNext.claim = true; // verified, then the chain step fails (T-24)
    const first = await h.claim({ seed: 'verify-a05-victim', keys: victim });
    expect(first.res.status).toBe(503);
    expect(h.deps.intents.size).toBe(1);
    const spk = bytesToHex(victim.publicKey);
    const challenge = await h.challengeFor('/claim', spk);
    const junk = fixtureProof('device', `0x${'00'.repeat(32)}`, 'verify-a05-attacker');
    const attack = await h.json('/claim', {
      proof: junk,
      campaignId: `0x${'de'.repeat(32)}`,
      challenge,
      sessionPubKey: spk,
    });
    expect(attack.status).not.toBe(201);
    expect(h.deps.intents.size).toBe(1);
    const retry = await h.claim({ seed: 'verify-a05-victim', keys: victim });
    expect(retry.res.status).toBe(201);
  });

  it('another human’s verified claim on the victim’s session key, failing on chain too, never replaces the victim’s intent [RT-A-05]', async () => {
    const h = await harness();
    const victim = generateSessionKeypair();
    h.dataDrop.failNext.claim = true;
    expect((await h.claim({ seed: 'verify-a05-victim2', keys: victim })).res.status).toBe(503);
    const spk = bytesToHex(victim.publicKey).toLowerCase();
    const before = h.deps.intents.get(spk);
    h.dataDrop.failNext.claim = true;
    expect((await h.claim({ seed: 'verify-a05-other', keys: victim })).res.status).toBe(503);
    expect(h.deps.intents.get(spk)).toEqual(before);
    expect((await h.claim({ seed: 'verify-a05-victim2', keys: victim })).res.status).toBe(201);
  });

  it('control: junk /claim for the SAME campaign leaves the intent and the victim completes', async () => {
    const h = await harness();
    const victim = generateSessionKeypair();
    h.dataDrop.failNext.claim = true;
    expect((await h.claim({ seed: 'verify-a05-ctl', keys: victim })).res.status).toBe(503);
    const spk = bytesToHex(victim.publicKey);
    const challenge = await h.challengeFor('/claim', spk);
    const junk = fixtureProof('device', `0x${'00'.repeat(32)}`, 'verify-a05-ctl-attacker');
    await h.json('/claim', {
      proof: junk,
      campaignId: h.campaignId,
      challenge,
      sessionPubKey: spk,
    });
    expect(h.deps.intents.size).toBe(1);
    expect((await h.claim({ seed: 'verify-a05-ctl', keys: victim })).res.status).toBe(201);
  });
});

describe('verify RT-A-06: an expired card never delivers a second LPA, even concurrently on both routes', () => {
  it('VALIDITY_DAYS=1, redeemed, +1 day: 4 concurrent redeems (2 per route) ⇒ no 201, no sealed LPA', async () => {
    const h = await harness({ env: { VALIDITY_DAYS: '1' } });
    const card = await seedCard(h, 300);
    expect((await redeemPin(h, card.pin, '/card/redeem')).status).toBe(201);
    h.clock.advance(DAY + 1_000);
    const rs = await Promise.all([
      redeemPin(h, card.pin, '/card/redeem'),
      redeemPin(h, card.pin, '/gift/claim'),
      redeemPin(h, card.pin, '/card/redeem'),
      redeemPin(h, card.pin, '/gift/claim'),
    ]);
    for (const r of rs) {
      expect(r.status).not.toBe(201);
      expect(((await r.json()) as { sealedLpa?: unknown }).sealedLpa).toBeUndefined();
    }
  });
});
