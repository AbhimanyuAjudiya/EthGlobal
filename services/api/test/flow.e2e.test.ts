/**
 * BUILD-PLAN §4 I-1…I-18, in process (DECISION §6.5 loop): createApp + local adapters + the DataDrop double +
 * fakeClock. The Anvil-backed twin is scripts/e2e-local.sh → scripts/e2e-flow.ts (real MockUSDC3009 + DataDrop).
 * I-10 (agent) belongs to services/agent; I-19/I-20 are the web and red-team gates.
 */
import { namehash } from 'viem';
import { describe, expect, it } from 'vitest';

import { anvilAccounts, anvilKeys, fixtureProof, T0 } from '@ethglobal/adapters/testing';
import {
  bytesToHex,
  generateSessionKeypair,
  lpaAad,
  openLpa,
  sha256Hex,
  type SealedBox,
} from '@ethglobal/crypto';
import { isValidPin } from '@ethglobal/protocol/pin';
import {
  challengeSchema,
  entitledResponseSchema,
  giftReclaimResponseSchema,
  giftResponseSchema,
  meResponseSchema,
  paymentRequiredSchema,
  receiptsResponseSchema,
  rpContextSchema,
  sponsorViewSchema,
  topUpResponseSchema,
} from '@ethglobal/protocol/schemas';
import { decodePaymentRequired, decodePaymentResponse } from '@ethglobal/protocol/x402';

import {
  addressOf,
  signGiftClaim,
  signGiftReclaim,
  sponsorAuthorization,
} from './support/client.js';
import { DAY, harness, hcsMessages, HUMAN_KEY, SPONSOR_KEY } from './support/harness.js';

const BOB_KEY = anvilKeys[1];

describe('flow.e2e (BUILD-PLAN §4, in process)', () => {
  it('runs I-1…I-18 end to end', async () => {
    const started = performance.now();
    const h = await harness();
    const ledgerTypes = async (type: string) =>
      (await h.deps.adapters.ledger.query({ annotations: { type } })).length;

    // I-1 challenge: MAC-bound, exp = now + 120 s, no nonce entity
    const keys = generateSessionKeypair();
    const spk = bytesToHex(keys.publicKey);
    const ch = await h.challengeFor('/claim', spk);
    expect(challengeSchema.parse(ch).exp).toBe(T0 + 120_000);
    expect(await ledgerTypes('nonce')).toBe(0);

    // I-2 rp-context: ttl 300, signing key nowhere
    const rp = await h.json('/world/rp-context', { audience: 'recharge', path: '/claim' });
    const ctx = rpContextSchema.parse(await rp.json());
    expect(ctx.expires_at - ctx.created_at).toBe(300);

    // I-3 claim with an Orb proof: sealed LPA opens, Claimed on chain, HCS claim
    const res = await h.json('/claim', {
      proof: fixtureProof('orb', ch.signal as `0x${string}`, 'flow-human'),
      campaignId: h.campaignId,
      challenge: ch,
      sessionPubKey: spk,
    });
    expect(res.status).toBe(201);
    const claimed = entitledResponseSchema.parse(await res.json());
    const lpa = openLpa(
      claimed.sealedLpa as SealedBox,
      keys.secretKey,
      lpaAad(ch.nonce as `0x${string}`, claimed.entitlementKey),
    );
    expect(lpa).toMatch(/^LPA:1\$local\.test\$/);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    expect(claimed.claimTx).toBe(h.dataDrop.claimedEvents[0]?.tx);
    expect(claimed.receipt.hcs?.sequence).toBe(1);

    // I-4 the entitlement entity: key ent:v1:, expiresAt = now + 7 d, no clear ICCID/LPA/nullifier; a nonce entity
    const [entity] = await h.deps.adapters.ledger.query({ annotations: { type: 'entitlement' } });
    expect(entity?.annotations.key).toBe(claimed.entitlementKey);
    expect(entity?.annotations.expiresAt).toBe(T0 + 7 * DAY);
    expect(entity?.payload).toMatch(/"iccidHash"/);
    expect(entity?.payload).not.toMatch(/LPA:|"iccid"|nullifier/);
    expect(await ledgerTypes('nonce')).toBe(1);

    // I-5 replay: same human, fresh challenge ⇒ 409, nothing new on chain or at the reseller
    const replay = await h.claim({ seed: 'flow-human' });
    expect(replay.res.status).toBe(409);
    expect(h.dataDrop.claimedEvents).toHaveLength(1);
    expect(h.reseller.orders()).toHaveLength(1);

    // I-6 /me twice (cached), receipts without entitlementKeyHash
    const key = encodeURIComponent(claimed.entitlementKey);
    const me1 = meResponseSchema.parse(await (await h.get(`/me/${key}`)).json());
    const me2 = meResponseSchema.parse(await (await h.get(`/me/${key}`)).json());
    expect([me1.cached, me2.cached]).toEqual([false, true]);
    expect(me1.remainingMb).toBe(me1.mbTotal - me1.mbUsed);
    const receipts = await (await h.get(`/me/${key}/receipts`)).text();
    expect(receiptsResponseSchema.parse(JSON.parse(receipts)).receipts.map((r) => r.kind)).toEqual([
      'claim',
    ]);
    expect(receipts).not.toMatch(/entitlementKeyHash|sealedLpa/);

    // I-7 402: header decodes to the body; v2 amount, Anvil domain; nothing written
    const puts = (await h.deps.adapters.ledger.query()).length;
    const quote = await h.get(`/esim/topup?key=${key}&mb=100`);
    expect(quote.status).toBe(402);
    const body = paymentRequiredSchema.parse(await quote.clone().json());
    expect(decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED') ?? '')).toEqual(body);
    expect(body.accepts[0]).toMatchObject({
      scheme: 'exact',
      network: 'eip155:31337',
      amount: '400000',
      extra: { name: 'USD Coin', version: '2' },
    });
    expect(JSON.stringify(body)).not.toMatch(/maxAmountRequired/);
    expect((await h.deps.adapters.ledger.query()).length).toBe(puts);

    // I-8 pay: 200 + PAYMENT-RESPONSE; the same signature again ⇒ 402 invalid_payment
    const pay = await h.payFor(quote, { key: HUMAN_KEY });
    const paid = await h.get(`/esim/topup?key=${key}&mb=100`, pay);
    expect(paid.status).toBe(200);
    const topped = topUpResponseSchema.parse(await paid.json());
    expect(decodePaymentResponse(paid.headers.get('PAYMENT-RESPONSE') ?? '')).toMatchObject({
      success: true,
      payer: addressOf(HUMAN_KEY),
    });
    const again = await h.get(`/esim/topup?key=${key}&mb=100`, pay);
    expect([again.status, ((await again.json()) as { error: string }).error]).toEqual([
      402,
      'invalid_payment',
    ]);

    // I-9 effect: mbTotal +100, expiry max(old, now + 7 d), topup receipt, HCS settle
    expect(topped.mbTotal).toBe(claimed.mbTotal + 100);
    expect(topped.expiresAt).toBe(T0 + 7 * DAY);
    expect(hcsMessages(h).map((m) => m.t)).toEqual(['claim', 'settle']);

    // I-11 webhook: valid 204 + cache invalidated; replay 409; tampered 401; skew 401; decrease ignored
    const iccid = h.reseller.orders()[0]?.profile.iccid ?? '';
    const hook = (usedMb: number, at = h.clock.now()) =>
      h.reseller.signedWebhook(
        [{ provider: 'mock', eventId: `e-${usedMb}-${at}`, iccid, usedMb, totalMb: 400, asOf: at }],
        at,
      );
    const send = (d: { body: string; headers: Record<string, string> }) =>
      h.request('/webhooks/reseller/mock', { method: 'POST', headers: d.headers, body: d.body });
    const d1 = hook(42);
    expect((await send(d1)).status).toBe(204);
    const me3 = meResponseSchema.parse(await (await h.get(`/me/${key}`)).json());
    expect([me3.cached, me3.mbUsed, me3.usageSource]).toEqual([false, 42, 'webhook']);
    expect((await send(d1)).status).toBe(409);
    expect((await send({ ...hook(50), body: hook(50).body.replace('50', '51') })).status).toBe(401);
    expect((await send(hook(60, h.clock.now() - 301_000))).status).toBe(401);
    expect((await send(hook(10))).status).toBe(204);
    expect(
      meResponseSchema.parse(await (await h.get(`/me/${key}?refresh=1`)).json()).mbUsed,
    ).toBeGreaterThanOrEqual(42);

    // I-12 gift: unresolvable ⇒ 404 before any 402; bob.eth ⇒ 402 ⇒ pay ⇒ 201 with PIN, serial, claimBy
    const nobody = await h.json('/gift', { name: 'nobody.eth', mb: 1000 });
    expect([nobody.status, nobody.headers.get('PAYMENT-REQUIRED')]).toEqual([404, null]);
    const giftQuote = await h.json('/gift', { name: 'bob.eth', mb: 1000 });
    expect(giftQuote.status).toBe(402);
    const giftRes = await h.json('/gift', { name: 'bob.eth', mb: 1000 }, await h.payFor(giftQuote));
    expect(giftRes.status).toBe(201);
    const gift = giftResponseSchema.parse(await giftRes.json());
    expect(isValidPin(gift.pin)).toBe(true);
    expect(gift.serial).toBe(gift.giftId.slice(2, 10));
    expect(gift.claimBy).toBe(h.clock.now() + 7 * DAY);
    const [escrow] = await h.deps.adapters.ledger.query({ annotations: { type: 'gift' } });
    expect(escrow?.expiresAt).toBe(gift.claimBy);
    expect(escrow?.payload).not.toContain(gift.pin);

    // I-13 gift claim by bob's signature ⇒ giftent:; a second claim 409; another signer 401
    const bobKeys = generateSessionKeypair();
    const bobSpk = bytesToHex(bobKeys.publicKey);
    const gch = await h.challengeFor('/gift/claim', bobSpk);
    const signature = await signGiftClaim(BOB_KEY, h.deps.chainId, {
      giftId: gift.giftId as `0x${string}`,
      namehash: namehash('bob.eth'),
      nonce: gch.nonce as `0x${string}`,
    });
    const giftClaim = await h.json('/gift/claim', {
      giftId: gift.giftId,
      signature,
      recipient: anvilAccounts[1],
      challenge: gch,
      sessionPubKey: bobSpk,
    });
    expect(giftClaim.status).toBe(201);
    const giftEnt = entitledResponseSchema.parse(await giftClaim.json());
    expect(giftEnt.entitlementKey).toBe(`giftent:${gift.giftId}`);
    expect(hcsMessages(h).at(-1)?.t).toBe('gift-claim');
    const gch2 = await h.challengeFor('/gift/claim', bobSpk);
    const sig2 = await signGiftClaim(BOB_KEY, h.deps.chainId, {
      giftId: gift.giftId as `0x${string}`,
      namehash: namehash('bob.eth'),
      nonce: gch2.nonce as `0x${string}`,
    });
    expect(
      (
        await h.json('/gift/claim', {
          giftId: gift.giftId,
          signature: sig2,
          recipient: anvilAccounts[1],
          challenge: gch2,
          sessionPubKey: bobSpk,
        })
      ).status,
    ).toBe(409);

    // I-14 card: GET twice (identical, no change) → redeem ⇒ 201 + a second Claimed; again ⇒ 410
    const card = (await (
      await h.json('/gift', { name: 'card', mb: 300 }, { 'x-seed-card-campaign': h.campaignId })
    ).json()) as { serial: string; pin: string };
    const p1 = await (await h.get(`/card/${card.serial}`)).text();
    const p2 = await (await h.get(`/card/${card.serial}`)).text();
    expect(p1).toBe(p2);
    const cardKeys = bytesToHex(generateSessionKeypair().publicKey);
    const redeem = async () =>
      h.json('/card/redeem', {
        pin: card.pin,
        challenge: await h.challengeFor('/card/redeem', cardKeys),
        sessionPubKey: cardKeys,
      });
    expect((await redeem()).status).toBe(201);
    expect(h.dataDrop.claimedEvents).toHaveLength(2);
    expect((await redeem()).status).toBe(410);

    // I-15 sponsor dashboard: HMAC'd claim keys only, counters from the chain, the expiring list
    const shortLived = await h.claim({ seed: 'flow-90s', headers: { 'x-seed-validity-s': '90' } });
    expect(shortLived.res.status).toBe(201);
    const short = entitledResponseSchema.parse(await shortLived.res.json());
    const auth = await sponsorAuthorization(
      SPONSOR_KEY,
      h.deps.chainId,
      h.campaignId,
      h.clock.now(),
    );
    const view = sponsorViewSchema.parse(
      await (await h.get(`/sponsor/${h.campaignId}`, { authorization: auth })).json(),
    );
    expect(view.claims).toHaveLength(2);
    const nullifier = JSON.stringify(fixtureProof('orb', undefined, 'flow-human').responses[0]);
    for (const row of view.claims) expect(nullifier).not.toContain(row.campaignClaimKey.slice(2));
    expect(view.chain.spentUsd6).toBe('1500000');
    expect(view.expiring.map((e) => e.expiresAt)).toContain(short.expiresAt);

    // I-16 expiry: the 90-s entitlement is gone ⇒ 410, and the ledger no longer lists it
    await h.get(`/me/${encodeURIComponent(short.entitlementKey)}`);
    h.clock.advance(91_000);
    expect((await h.get(`/me/${encodeURIComponent(short.entitlementKey)}`)).status).toBe(410);
    const live = await h.deps.adapters.ledger.query({
      annotations: { type: 'entitlement', key: short.entitlementKey },
    });
    expect(live).toHaveLength(0);

    // I-17 reclaim: a second, unclaimed gift lapses ⇒ refund usd6 − fee once; again 409; the claimed gift 409
    const lapsedQuote = await h.json('/gift', { name: 'alice.eth', mb: 100 });
    const lapsed = giftResponseSchema.parse(
      await (
        await h.json('/gift', { name: 'alice.eth', mb: 100 }, await h.payFor(lapsedQuote))
      ).json(),
    );
    h.clock.advance(7 * DAY + 1000);
    const payer = addressOf(HUMAN_KEY);
    const reclaimOnce = async (giftId: string) => {
      const rch = await h.challengeFor(
        '/gift/reclaim',
        `0x${payer.slice(2).toLowerCase().padStart(64, '0')}`,
      );
      const sig = await signGiftReclaim(HUMAN_KEY, h.deps.chainId, {
        giftId: giftId as `0x${string}`,
        nonce: rch.nonce as `0x${string}`,
      });
      return h.json('/gift/reclaim', { giftId, payer, signature: sig, challenge: rch });
    };
    const refund = await reclaimOnce(lapsed.giftId);
    expect(refund.status).toBe(200);
    expect(giftReclaimResponseSchema.parse(await refund.json()).refundedUsd6).toBe('400000');
    expect(h.treasury.refunds()).toEqual([
      expect.objectContaining({ to: payer, usd6: 400_000n, memo: lapsed.giftId }),
    ]);
    expect(hcsMessages(h).at(-1)?.t).toBe('gift-reclaim');
    expect((await reclaimOnce(lapsed.giftId)).status).toBe(409);
    expect((await reclaimOnce(gift.giftId)).status).toBe(409);
    expect(h.treasury.refunds()).toHaveLength(1);

    // I-18 secrets scan of the ledger and logs
    const dump = JSON.stringify(await h.deps.adapters.ledger.query());
    const logs = h.lines.join('');
    for (const text of [dump, logs]) {
      expect(text).not.toMatch(/LPA:1\$/);
      expect(text).not.toContain(gift.pin);
      expect(text).not.toContain(sha256Hex('nullifier:flow-human').slice(2));
    }
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});
