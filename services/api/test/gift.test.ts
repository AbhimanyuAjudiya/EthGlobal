import { describe, expect, it, vi } from 'vitest';

import { anvilKeys } from '@ethglobal/adapters/testing';
import { concat, hexToBytes, keccak256, sha256Hex, utf8 } from '@ethglobal/crypto';
import { keys, type Hex } from '@ethglobal/protocol/ids';
import { isValidPin } from '@ethglobal/protocol/pin';
import {
  isEvmExact,
  type GiftResponse,
  type PaymentPayload,
  type SettleResult,
} from '@ethglobal/protocol/schemas';
import {
  decodePaymentRequired,
  decodePaymentResponse,
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
  type Harness,
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

/** POST /gift → 402 → the Hedera exact payload echoing the hedera:testnet entry (its `network` overridable) → POST. */
async function payGiftOnHedera(h: Harness, network = 'hedera:testnet') {
  const quote = await h.json('/gift', GIFT);
  expect(quote.status).toBe(402);
  const { accepts } = decodePaymentRequired(quote.headers.get('PAYMENT-REQUIRED')!);
  const accepted = accepts.find((a) => a.network === 'hedera:testnet')!;
  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: { ...accepted, network },
    payload: { transaction: Buffer.from('hts-transfer').toString('base64') },
  };
  const header = { [PAYMENT_SIGNATURE_HEADER]: encodePaymentPayload(payload) };
  return { header, res: await h.json('/gift', GIFT, header) };
}

const escrows = (h: Harness) => h.adapters.ledger.query({ annotations: { type: 'gift' } });

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

describe('POST /gift paid on Hedera (exact `{ transaction }`, hedera:testnet)', () => {
  it('402 offers hedera:testnet → pay → 201: the HTS settlement in the body and PAYMENT-RESPONSE, the escrow keyed by the transaction, PIN-claimable', async () => {
    const h = await hederaHarness();
    const { res } = await payGiftOnHedera(h);
    expect(res.status).toBe(201);
    const gift = (await res.json()) as GiftResponse;
    const settlement: SettleResult = {
      success: true,
      transaction: HEDERA_TX,
      network: 'hedera:testnet',
      payer: HEDERA_PAYER,
    };
    expect(gift.settlement).toEqual(settlement);
    expect(decodePaymentResponse(res.headers.get('PAYMENT-RESPONSE')!)).toEqual(settlement);
    // the Hedera twin of keccak256(payer ‖ EIP-3009 nonce): the nonce is sha256(transaction id), the payer its UTF-8
    expect(gift.giftId).toBe(
      keccak256(concat(utf8(HEDERA_PAYER), hexToBytes(sha256Hex(HEDERA_TX)))),
    );
    expect(isValidPin(gift.pin)).toBe(true);
    expect(gift).toMatchObject({
      serial: gift.giftId.slice(2, 10),
      name: 'bob.eth',
      mb: 1000,
      claimBy: h.clock.now() + 7 * DAY,
      receipt: { arkivKey: keys.gift(gift.giftId as Hex) },
    });
    const escrow = await h.deps.stores.gifts.bySerial(gift.serial);
    expect(escrow?.payload).toMatchObject({
      fundedBy: 'payment',
      payer: HEDERA_PAYER,
      network: 'hedera:testnet',
      paidTx: HEDERA_TX,
    });
    const receipts = await h.deps.stores.receipts.forEntitlement(
      sha256Hex(keys.gift(gift.giftId as Hex)),
    );
    expect(receipts).toMatchObject([
      {
        key: keys.receipt('hedera:testnet', HEDERA_TX),
        kind: 'gift',
        network: 'hedera:testnet',
        tx: HEDERA_TX,
        payer: HEDERA_PAYER,
      },
    ]);
    expect(hcsMessages(h).at(-1)).toMatchObject({ t: 'gift', giftId: gift.giftId, tx: HEDERA_TX });
    expect((await redeemPin(h, gift.pin, '/gift/claim')).status).toBe(201);
  });

  it('the same Hedera transaction presented again is refused by the settlement marker (409 replay), as a settled EVM payment is; one escrow', async () => {
    const h = await hederaHarness();
    const { header, res } = await payGiftOnHedera(h);
    expect(res.status).toBe(201);
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const replay = await h.json('/gift', GIFT, header);
    expect(await replay.json()).toMatchObject({
      error: 'replay',
      details: { detail: 'settlement' },
    });
    expect(replay.status).toBe(409);
    expect(settle).toHaveBeenCalledTimes(1); // the facilitator answered the same transaction; served once (RT-O-05)
    expect(await escrows(h)).toHaveLength(1);
    // the EVM twin, unchanged: a re-presented EIP-3009 authorization is refused by verify (nonce_already_used)
    const pay = await h.payFor(await h.json('/gift', GIFT));
    expect((await h.json('/gift', GIFT, pay)).status).toBe(201);
    const evmReplay = await h.json('/gift', GIFT, pay);
    expect([evmReplay.status, await errorOf(evmReplay)]).toEqual([402, 'invalid_payment']);
    expect(await escrows(h)).toHaveLength(2);
  });

  it('a Hedera payment echoing a network the 402 did not offer (hedera:mainnet) → 402 invalid_payment, never settled', async () => {
    const h = await hederaHarness();
    const settle = vi.spyOn(h.adapters.payments, 'settle');
    const { res } = await payGiftOnHedera(h, 'hedera:mainnet');
    expect([res.status, await errorOf(res)]).toEqual([402, 'invalid_payment']);
    expect(settle).not.toHaveBeenCalled();
    expect(await escrows(h)).toHaveLength(0);
  });

  it('an EVM gift beside the Hedera kind is byte-identical: giftId = keccak256(payer ‖ EIP-3009 nonce)', async () => {
    const h = await hederaHarness();
    const nonce: Hex = `0x${'5a'.repeat(32)}`;
    const res = await h.json('/gift', GIFT, await h.payFor(await h.json('/gift', GIFT), { nonce }));
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
  it('by signature of the resolved address → 201 giftent:<id>, gift claimed, HCS gift-claim', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    const res = await claimGiftBySignature(h, gift.giftId, BOB);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { entitlementKey: string }).entitlementKey).toBe(
      `giftent:${gift.giftId}`,
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
