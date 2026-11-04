/**
 * Red team wave 2 (unscripted): authn/authz edges — SponsorLogin scope (read bearer vs register), the audit key's
 * "first read only" promise, the T-24 intent bound only to a PUBLIC session key, PIN re-redemption across the two PIN
 * routes, key confusion between /me/:key and the hashed keys, and the T-73 b status. RT-A-04/05/06 are fixed: their
 * attack tests are passing regressions named `… [RT-A-0N]`.
 */
import { describe, expect, it, vi } from 'vitest';

import { T0, anvilKeys, anvilRoles, fixtureProof } from '@ethglobal/adapters/testing';
import { bytesToHex, generateSessionKeypair, sha256Hex } from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';

import { agentPolicyPut, sponsorAuthorization, sponsorLogin } from '../support/client.js';
import {
  DAY,
  harness,
  HUMAN_KEY,
  provisioned,
  redeemPin,
  seedCard,
  SPONSOR,
  SPONSOR_KEY,
} from '../support/harness.js';

const POLICY = {
  maxUsd6PerDay: '1000000',
  thresholdMb: 50,
  stepMb: 100,
  paused: false,
  topUpOnExpiry: true,
  expiryLeadS: 600,
};

describe('attack: rt SponsorLogin scope', () => {
  // regression RT-A-04 (fixed): registration is one-time (409 campaign_exists for a registered id, whoever signs), so
  // the read bearer cannot rewrite the campaign or mint the audit key again
  it('a captured dashboard bearer cannot rewrite the campaign or re-read the auditKey [RT-A-04]', async () => {
    const h = await harness();
    const issuedAt = h.clock.now();
    const bearer = await sponsorAuthorization(SPONSOR_KEY, h.deps.chainId, h.campaignId, issuedAt);
    // the sponsor reads the dashboard once (auditKey shown, then never again)
    const first = await h.get(`/sponsor/${h.campaignId}`, { authorization: bearer });
    expect(first.status).toBe(200);
    const second = (await (
      await h.get(`/sponsor/${h.campaignId}`, { authorization: bearer })
    ).json()) as Record<string, unknown>;
    expect(second.auditKey).toBeUndefined();
    // the attacker decodes the captured bearer and replays its signature as POST /sponsor auth
    const login = JSON.parse(Buffer.from(bearer.split(' ')[1]!, 'base64').toString()) as {
      issuedAt: number;
      signature: string;
    };
    const stored = (await h.deps.stores.campaigns.get(h.campaignId))!.payload;
    const res = await h.json('/sponsor', {
      campaign: {
        id: h.campaignId,
        sponsor: SPONSOR,
        name: 'Send 1 USDC to claim',
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
    });
    const body = (await res.json()) as Record<string, unknown>;
    const after = (await h.deps.stores.campaigns.get(h.campaignId))!.payload;
    // property: a bearer for "read my dashboard" cannot write the campaign or reveal the audit key again
    expect(res.status).toBe(409);
    expect(body.error).toBe('campaign_exists');
    expect(body.auditKey).toBeUndefined();
    expect(after.name).toBe('Mumbai Welcome');
  });

  // regression RT-A-04 (Low part, fixed): "audit key shown" is a ledger once-marker, not process memory
  it('auditKey stays hidden after a restart (new deps over the same ledger) [RT-A-04]', async () => {
    const h = await harness();
    const bearer = await sponsorAuthorization(
      SPONSOR_KEY,
      h.deps.chainId,
      h.campaignId,
      h.clock.now(),
    );
    const first = (await (
      await h.get(`/sponsor/${h.campaignId}`, { authorization: bearer })
    ).json()) as Record<string, unknown>;
    expect(typeof first.auditKey).toBe('string');
    const restarted = await h.restart(); // a new process over the same ledger
    const again = (await (
      await restarted.app.request(`/sponsor/${h.campaignId}`, {
        headers: { authorization: bearer, 'x-forwarded-for': '203.0.113.200' },
      })
    ).json()) as Record<string, unknown>;
    expect(again.campaign).toBeDefined();
    expect(again.auditKey).toBeUndefined();
  });

  // property: a SponsorLogin is bound to its campaignId (control)
  it('a login signed for campaign X never authorises campaign Y', async () => {
    const h = await harness();
    const other: Hex = `0x${'ab'.repeat(32)}`;
    const login = await sponsorLogin(SPONSOR_KEY, h.deps.chainId, other, h.clock.now());
    const auth = `Recharge-Sponsor ${Buffer.from(JSON.stringify(login)).toString('base64')}`;
    expect((await h.get(`/sponsor/${h.campaignId}`, { authorization: auth })).status).toBe(401);
  });
});

describe('attack: rt T-24 intent bound to a public session key', () => {
  // regression RT-A-05 (fixed): the intent is bound to the human — the resume needs a proof with the same nullifier
  // that the verifier accepts; a junk proof falls through to the normal lane and is judged (and refused) there
  it('a stranger with only the victim’s session public key cannot complete the victim’s pending claim [RT-A-05]', async () => {
    const h = await harness();
    const victim = generateSessionKeypair();
    h.dataDrop.failNext.claim = true; // the victim is verified, then the chain step fails (T-24)
    const first = await h.claim({ seed: 'rt-intent-victim', keys: victim });
    expect(first.res.status).toBe(503);
    expect(h.deps.intents.size).toBe(1);
    // attacker: a fresh challenge for the victim's PUBLIC key and a proof of nobody
    const spk = bytesToHex(victim.publicKey);
    const challenge = await h.challengeFor('/claim', spk);
    const junk = fixtureProof('device', `0x${'00'.repeat(32)}`, 'rt-intent-attacker');
    const verify = vi.spyOn(h.adapters.personhood, 'verify');
    const stolen = await h.json('/claim', {
      proof: junk,
      campaignId: h.campaignId,
      challenge,
      sessionPubKey: spk,
    });
    // property: completing a verified-but-unserved claim needs something only the victim has
    expect(stolen.status).not.toBe(201);
    expect(verify).toHaveBeenCalledTimes(1); // the junk proof was judged (and refused), not waved through
    expect(h.deps.intents.size).toBe(1); // the victim's intent is untouched
    // …and the victim's own retry (same session, same human) still completes, exactly once
    const retry = await h.claim({ seed: 'rt-intent-victim', keys: victim });
    expect(retry.res.status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
  });
});

describe('attack: rt PIN re-redemption across routes', () => {
  // regression RT-A-06 (fixed): claimEscrow takes a ledger once-marker before delivery; every PIN/giftId route
  // refuses an escrow whose LPA was handed out, whether or not its entitlement still lives
  it('VALIDITY_DAYS=1: after the card’s entitlement expires the PIN never delivers a second LPA [RT-A-06]', async () => {
    const h = await harness({ env: { VALIDITY_DAYS: '1' } });
    const card = await seedCard(h, 300);
    const first = await redeemPin(h, card.pin, '/card/redeem');
    expect(first.status).toBe(201);
    h.clock.advance(DAY + 1_000);
    const viaCard = await redeemPin(h, card.pin, '/card/redeem');
    expect(viaCard.status).toBe(410);
    const viaGift = await redeemPin(h, card.pin, '/gift/claim');
    const body = (await viaGift.json()) as Record<string, unknown>;
    // property: one PIN ⇒ one delivery, whichever PIN route is used
    expect(viaGift.status).not.toBe(201);
    expect(body.sealedLpa).toBeUndefined();
  });

  // property: while the entitlement lives, both PIN routes refuse a second redemption
  it('control: a live redeemed card is refused on both PIN routes', async () => {
    const h = await harness();
    const card = await seedCard(h, 300);
    expect((await redeemPin(h, card.pin, '/card/redeem')).status).toBe(201);
    expect((await redeemPin(h, card.pin, '/card/redeem')).status).toBe(410);
    expect([409, 410]).toContain((await redeemPin(h, card.pin, '/gift/claim')).status);
  });
});

describe('attack: rt key confusion', () => {
  // property: the hashed key (receipts' entitlementKeyHash) and the arkiv entity key are not capabilities on /me
  it('/me/<sha256(key)>, /me/<arkivKey> and /me/<key with case flipped> ⇒ 404', async () => {
    const h = await harness();
    const { key, body } = await provisioned(h, 'rt-keyconf');
    for (const k of [sha256Hex(key), body.receipt.arkivKey, key.toUpperCase()]) {
      const res = await h.get(`/me/${encodeURIComponent(k)}`);
      expect(res.status).toBe(404);
    }
    const receipts = await h.get(`/me/${encodeURIComponent(sha256Hex(key))}/receipts`);
    expect(((await receipts.json()) as { receipts: unknown[] }).receipts).toHaveLength(0);
  });

  // property: an AgentPolicy signature for entitlement A cannot be replayed onto entitlement B
  it('an AgentPolicy signed for key A, submitted for key B ⇒ 401', async () => {
    const h = await harness();
    const a = await provisioned(h, 'rt-pol-a');
    const b = await provisioned(h, 'rt-pol-b');
    const put = await agentPolicyPut(HUMAN_KEY, h.deps.chainId, a.key, POLICY, h.clock.now());
    const res = await h.json('/agent/policy', { ...put, entitlementKey: b.key }, {}, 'PUT');
    expect(res.status).toBe(401);
  });

  // T-73 b was a known open finding (services/api/README "Decisions" 8); fixed by octroi A-35 (mayRegisterPolicy)
  it('T-73 b status: a stranger who knows the key is no longer the first owner of a free entitlement’s policy (fixed)', async () => {
    const h = await harness();
    const { key } = await provisioned(h, 'rt-t73b');
    const squat = await h.json(
      '/agent/policy',
      await agentPolicyPut(anvilKeys[anvilRoles.stranger], h.deps.chainId, key, POLICY, T0 + 1),
      {},
      'PUT',
    );
    expect(squat.status).toBe(401); // flipped: the octroi/protocol fix landed (A-35)
  });
});
