import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { namehash } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { AdapterError } from '@ethglobal/adapters';
import { anvilKeys, fixtureProof } from '@ethglobal/adapters/testing';
import {
  bytesToHex,
  generateSessionKeypair,
  lpaAad,
  openLpa,
  randomBytes,
  type SealedBox,
} from '@ethglobal/crypto';
import type { Hex } from '@ethglobal/protocol/ids';
import { generatePin } from '@ethglobal/protocol/pin';
import type { DeliveryResponse, EntitledResponse } from '@ethglobal/protocol/schemas';

import { addressOf, signGiftClaim } from '../support/client.js';
import { buyGift, harness, seedCard, STRANGER_KEY } from '../support/harness.js';

describe('lost gift and card redemption responses', () => {
  it.each([false, true])(
    'recovers a free claim after losing its first response and restarting (pending=%s)',
    async (pending) => {
      const h = await harness({
        env: { STATE_FILE: join(mkdtempSync(join(tmpdir(), 'free-recovery-')), 'api.state') },
      });
      const keys = generateSessionKeypair();
      const sessionPubKey = bytesToHex(keys.publicKey);
      const token = randomUUID();
      const order = vi.spyOn(h.reseller, 'order');
      if (pending)
        order.mockRejectedValueOnce(new AdapterError('reseller', 'unavailable', 'offline'));
      let app = h.app;
      const send = async (privateKey: string | undefined, spk = sessionPubKey, forged = false) => {
        const challenge = await h.challengeFor('/claim', spk);
        const proof = fixtureProof(
          'orb',
          forged ? `0x${'00'.repeat(32)}` : (challenge.signal as Hex),
          'free-lost-response',
        );
        const response = await app.request('/claim', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-forwarded-for': '203.0.113.16',
            ...(privateKey ? { 'idempotency-key': privateKey } : {}),
          },
          body: JSON.stringify({ campaignId: h.campaignId, sessionPubKey: spk, challenge, proof }),
        });
        return { response, challenge };
      };
      const first = await send(token);
      expect(first.response.status).toBe(pending ? 202 : 201);
      app = (await h.restart()).app;
      expect((await send(undefined)).response.status).toBe(409);
      expect((await send(randomUUID())).response.status).toBe(409);
      expect(
        (await send(token, bytesToHex(generateSessionKeypair().publicKey))).response.status,
      ).toBe(409);
      expect((await send(token, sessionPubKey, true)).response.status).toBe(401);
      h.clock.advance(61_000);
      const retry = await send(token);
      expect(retry.response.status).toBe(pending ? 202 : 201);
      const metadata = (await retry.response.json()) as EntitledResponse;
      expect(metadata.sealedLpa).toBeUndefined();
      expect(order).toHaveBeenCalledTimes(1);
      const delivered = await app.request(
        `/me/${encodeURIComponent(metadata.entitlementKey)}/delivery`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.17' },
          body: JSON.stringify({ sessionPubKey }),
        },
      );
      expect(delivered.status).toBe(200);
      const delivery = (await delivered.json()) as DeliveryResponse;
      if (delivery.status !== 'ready') throw new Error('delivery not ready');
      expect(delivery.nonce).toBe(first.challenge.nonce);
      expect(delivery.nonce).not.toBe(retry.challenge.nonce);
      expect(
        openLpa(
          delivery.sealedLpa as SealedBox,
          keys.secretKey,
          lpaAad(delivery.nonce as Hex, metadata.entitlementKey),
        ),
      ).toMatch(/^LPA:/);
      expect(h.reseller.orders()).toHaveLength(1);
      expect(h.dataDrop.claimedEvents).toHaveLength(1);
      const orderCalls = order.mock.calls.length;
      h.clock.advance(metadata.expiresAt - h.clock.now() + 1);
      expect((await send(token)).response.status).toBe(409);
      expect(await h.deps.stores.entitlements.getByKey(metadata.entitlementKey)).toBeNull();
      expect(order).toHaveBeenCalledTimes(orderCalls);
    },
  );

  it.each([
    ['/card/redeem', false],
    ['/gift/claim', true],
  ] as const)(
    '%s recovers with the original private token/session after losing a %s response',
    async (path, pending) => {
      const h = await harness({ env: { VALIDITY_DAYS: '1' } });
      const gift = path === '/card/redeem' ? await seedCard(h) : await buyGift(h);
      const keys = generateSessionKeypair();
      const sessionPubKey = bytesToHex(keys.publicKey);
      const recoveryKey = randomUUID();
      const order = vi.spyOn(h.reseller, 'order');
      if (pending)
        order.mockRejectedValueOnce(new AdapterError('reseller', 'unavailable', 'offline'));
      const send = async (token: string | undefined, pin = gift.pin, spk = sessionPubKey) => {
        const challenge = await h.challengeFor(path, spk);
        const response = await h.request(path, {
          method: 'POST',
          ip: '203.0.113.14',
          headers: {
            'content-type': 'application/json',
            ...(token ? { 'idempotency-key': token } : {}),
          },
          body: JSON.stringify({ pin, sessionPubKey: spk, challenge }),
        });
        return { response, challenge };
      };
      const first = await send(recoveryKey);
      expect(first.response.status).toBe(pending ? 202 : 201);
      // Deliberately never consume the original response: the browser does not yet know the plan capability.
      expect((await send(undefined)).response.status).toBe(path === '/card/redeem' ? 410 : 409);
      expect((await send(randomUUID())).response.status).toBe(path === '/card/redeem' ? 410 : 409);
      expect((await send(recoveryKey, generatePin(randomBytes))).response.status).toBe(401);
      expect(
        (await send(recoveryKey, gift.pin, bytesToHex(generateSessionKeypair().publicKey))).response
          .status,
      ).toBe(path === '/card/redeem' ? 410 : 409);
      h.clock.advance(61_000);
      const retried = await send(recoveryKey);
      expect(retried.response.status).toBe(pending ? 202 : 201);
      const metadata = (await retried.response.json()) as EntitledResponse;
      expect(metadata.sealedLpa).toBeUndefined();
      expect(order).toHaveBeenCalledTimes(1);
      const delivered = await h.json(
        `/me/${encodeURIComponent(metadata.entitlementKey)}/delivery`,
        { sessionPubKey },
      );
      expect(delivered.status).toBe(200);
      const delivery = (await delivered.json()) as DeliveryResponse;
      if (delivery.status !== 'ready') throw new Error('delivery not ready');
      expect(delivery.nonce).toBe(first.challenge.nonce);
      expect(delivery.nonce).not.toBe(retried.challenge.nonce);
      expect(
        openLpa(
          delivery.sealedLpa as SealedBox,
          keys.secretKey,
          lpaAad(delivery.nonce as Hex, metadata.entitlementKey),
        ),
      ).toMatch(/^LPA:/);
      expect(h.reseller.orders()).toHaveLength(1);
      expect(h.dataDrop.claimedEvents).toHaveLength(path === '/card/redeem' ? 1 : 0);
      const orderCalls = order.mock.calls.length;
      h.clock.advance(metadata.expiresAt - h.clock.now() + 1);
      expect((await send(recoveryKey)).response.status).toBe(path === '/card/redeem' ? 410 : 409);
      expect(await h.deps.stores.entitlements.getByKey(metadata.entitlementKey)).toBeNull();
      expect(order).toHaveBeenCalledTimes(orderCalls);
    },
  );

  it('requires the original private token and a newly valid recipient signature for wallet recovery', async () => {
    const h = await harness();
    const gift = await buyGift(h);
    const sessionPubKey = bytesToHex(generateSessionKeypair().publicKey);
    const recoveryKey = randomUUID();
    const send = async (signer: Hex, token: string | undefined) => {
      const challenge = await h.challengeFor('/gift/claim', sessionPubKey);
      const signature = await signGiftClaim(signer, h.deps.chainId, {
        giftId: gift.giftId as Hex,
        namehash: namehash('bob.eth'),
        nonce: challenge.nonce as Hex,
      });
      return h.request('/gift/claim', {
        method: 'POST',
        ip: '203.0.113.15',
        headers: {
          'content-type': 'application/json',
          ...(token ? { 'idempotency-key': token } : {}),
        },
        body: JSON.stringify({
          giftId: gift.giftId,
          recipient: addressOf(signer),
          signature,
          challenge,
          sessionPubKey,
        }),
      });
    };
    expect((await send(anvilKeys[1], recoveryKey)).status).toBe(201);
    expect((await send(STRANGER_KEY, recoveryKey)).status).toBe(401);
    expect((await send(anvilKeys[1], undefined)).status).toBe(409);
    const recovered = await send(anvilKeys[1], recoveryKey);
    expect(recovered.status).toBe(201);
    expect(((await recovered.json()) as EntitledResponse).sealedLpa).toBeUndefined();
    expect(h.reseller.orders()).toHaveLength(1);
  });

  it('does not add a recovery credential retroactively to a legacy redemption', async () => {
    const h = await harness();
    const card = await seedCard(h);
    const sessionPubKey = bytesToHex(generateSessionKeypair().publicKey);
    const send = async (token?: string) =>
      h.json(
        '/card/redeem',
        {
          pin: card.pin,
          sessionPubKey,
          challenge: await h.challengeFor('/card/redeem', sessionPubKey),
        },
        token ? { 'idempotency-key': token } : {},
      );
    expect((await send()).status).toBe(201);
    expect((await send(randomUUID())).status).toBe(410);
    expect(h.reseller.orders()).toHaveLength(1);
  });
});
