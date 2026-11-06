import { randomUUID } from 'node:crypto';

import { describe, expect, it, vi } from 'vitest';

import { anvilKeys } from '@ethglobal/adapters/testing';
import { concat, hexToBytes, keccak256 } from '@ethglobal/crypto';
import { buildAccepts, giftEntitlementKey } from '@ethglobal/octroi';
import { type Hex } from '@ethglobal/protocol/ids';
import { isValidPin } from '@ethglobal/protocol/pin';
import { isEvmExact, type GiftResponse, type PaymentPayload } from '@ethglobal/protocol/schemas';
import {
  decodePaymentRequired,
  encodePaymentPayload,
  PAYMENT_SIGNATURE_HEADER,
} from '@ethglobal/protocol/x402';

import { addressOf } from './support/client.js';
import {
  buyGift,
  claimGiftBySignature,
  DAY,
  errorOf,
  harness,
  hcsMessages,
  HUMAN_KEY,
  redeemPin,
  STRANGER_KEY,
} from './support/harness.js';

const BOB = anvilKeys[1];
const HEDERA_TX = '0.0.4242@1762171200.000000001';
const HEDERA_PAYER = '0.0.777';
const GIFT = { name: 'bob.eth', mb: 1000 };

/**
 * Anvil + hedera:testnet in accepts[] (the pinned fee payer stands in for the mock facilitator's /supported); the mock
 * rail answers a Hedera `{ transaction }` the way a facilitator does — valid, settled as HEDERA_TX by HEDERA_PAYER —
 * and keeps its EIP-3009 behaviour for EVM payloads.
 */
async function hederaHarness() {
  const h = await harness({
    env: {
      X402_NETWORKS: 'eip155:31337,hedera:testnet',
      PAYOUT_HEDERA_ACCOUNT: '0.0.5005',
      X402_HEDERA_FEE_PAYER: '0.0.9185802',
    },
  });
  const rail = h.adapters.payments;
  const verify = rail.verify.bind(rail);
  const settle = rail.settle.bind(rail);
  rail.verify = async (p, r) =>
    isEvmExact(p.payload) ? verify(p, r) : { isValid: true, payer: HEDERA_PAYER };
  rail.settle = async (p, r) =>
    isEvmExact(p.payload)
      ? settle(p, r)
      : { success: true, transaction: HEDERA_TX, network: r.network, payer: HEDERA_PAYER };
  return h;
}

describe('POST /gift', () => {
  it('unresolvable name → 404 before any 402, and the resolver is asked first', async () => {
    const h = await harness();
    const verify = vi.spyOn(h.adapters.payments, 'verify');
    const res = await h.json('/gift', { name: 'nobody.eth', mb: 1000 });
    expect([res.status, await errorOf(res), res.headers.get('PAYMENT-REQUIRED')]).toEqual([
      404,
      'name_unresolved',
      null,
    ]);
    expect(verify).not.toHaveBeenCalled();
  });

  it('bob.eth → 402 → pay → 201 with pin, serial, claimBy = now + 7 d; the escrow lives exactly the claim window', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    expect(isValidPin(gift.pin)).toBe(true);
    expect(gift).toMatchObject({
      serial: gift.giftId.slice(2, 10),
      name: 'bob.eth',
      mb: 1000,
      claimBy: h.clock.now() + 7 * DAY,
    });
    const [escrow] = await h.adapters.ledger.query({ annotations: { type: 'gift' } });
    expect(escrow?.expiresAt).toBe(gift.claimBy);
    expect(escrow?.payload).toMatch(/"pinKey"/);
    expect(escrow?.payload).not.toContain(gift.pin);
    expect(hcsMessages(h).at(-1)).toMatchObject({ t: 'gift', giftId: gift.giftId });
  });

  it('normalises names (ENSIP-15) and refuses unnormalisable ones', async () => {
    const h = await harness();
    expect((await h.json('/gift', { name: 'BOB.ETH', mb: 1000 })).status).toBe(402);
    expect((await h.json('/gift', { name: 'bo​b.eth', mb: 1000 })).status).toBe(400);
  });
});

describe('POST /gift payment networks and private retries', () => {
  it('offers only networks with signed reclaim support even when native Hedera is enabled', async () => {
    const h = await hederaHarness();
    const quote = await h.json('/gift', GIFT);
    expect(quote.status).toBe(402);
    const { accepts } = decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED')!);
    expect(accepts.map((a) => a.network)).toEqual(['eip155:31337']);
  });

  it('rejects native Hedera payment before verification or settlement', async () => {
    const h = await hederaHarness();
    const verify = vi.spyOn(h.adapters.payments, 'verify');
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const template = buildAccepts(h.deps.octroi, 1000).find((a) => a.network === 'hedera:testnet')!;
    const payload: PaymentPayload = {
      x402Version: 2,
      accepted: template,
      payload: { transaction: Buffer.from('hts-transfer').toString('base64') },
    };
    const res = await h.json('/gift', GIFT, {
      'idempotency-key': randomUUID(),
      [PAYMENT_SIGNATURE_HEADER]: encodePaymentPayload(payload),
    });
    expect([res.status, await errorOf(res)]).toEqual([402, 'invalid_payment']);
    expect(verify).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
    expect(await h.adapters.ledger.query({ annotations: { type: 'gift' } })).toHaveLength(0);
  });

  it('requires a private recovery token before settlement and replays the same gift without a second charge', async () => {
    const h = await hederaHarness();
    const pay = await h.payFor(await h.json('/gift', GIFT));
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    expect((await h.json('/gift', GIFT, pay)).status).toBe(400);
    expect(settle).not.toHaveBeenCalled();
    const headers = { ...pay, 'idempotency-key': randomUUID() };
    const first = await h.json('/gift', GIFT, headers);
    expect(first.status).toBe(201);
    h.clock.advance(301_000);
    const again = await h.json('/gift', GIFT, headers);
    expect(again.status).toBe(201);
    expect(await again.text()).toBe(await first.text());
    expect(settle).toHaveBeenCalledTimes(1);
    const stolen = await h.json('/gift', GIFT, { ...pay, 'idempotency-key': randomUUID() });
    expect(stolen.status).not.toBe(201);
    expect(await stolen.text()).not.toContain('"pin"');
  });

  it('preserves the EVM gift id beside an enabled native Hedera rail', async () => {
    const h = await hederaHarness();
    const nonce: Hex = `0x${'5a'.repeat(32)}`;
    const res = await h.json('/gift', GIFT, {
      ...(await h.payFor(await h.json('/gift', GIFT), { nonce })),
      'idempotency-key': randomUUID(),
    });
    expect(res.status).toBe(201);
    const gift = (await res.json()) as GiftResponse;
    const payer = addressOf(HUMAN_KEY);
    expect(gift.giftId).toBe(
      keccak256(concat(hexToBytes(payer.toLowerCase() as Hex), hexToBytes(nonce))),
    );
    expect(gift.settlement).toMatchObject({ network: 'eip155:31337', payer });
  });
});

describe('POST /gift/claim', () => {
  it('by signature of the resolved address → 201 with a secret gift capability, gift claimed, HCS gift-claim', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    const res = await claimGiftBySignature(h, gift.giftId, BOB);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { entitlementKey: string }).entitlementKey).toBe(
      giftEntitlementKey(h.deps.secret, gift.giftId as Hex),
    );
    const [escrow] = await h.adapters.ledger.query({ annotations: { type: 'gift' } });
    expect(escrow?.annotations.state).toBe('claimed');
    expect(hcsMessages(h).at(-1)).toMatchObject({ t: 'gift-claim', giftId: gift.giftId });
  });

  it('by a wrong signer → 401; by PIN → 201; after claimBy → 410', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    expect((await claimGiftBySignature(h, gift.giftId, STRANGER_KEY)).status).toBe(401);
    expect((await redeemPin(h, gift.pin, '/gift/claim')).status).toBe(201);
    const late = await buyGift(h, 'alice.eth');
    h.clock.advance(7 * DAY + 1);
    expect((await claimGiftBySignature(h, late.giftId, anvilKeys[0], 'alice.eth')).status).toBe(
      410,
    );
  });
});
