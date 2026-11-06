import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Hex } from '@ethglobal/protocol/ids';

import type { Wallet } from '../lib/wallet';

interface RequestBody {
  sessionPubKey: string;
  challenge: { nonce: string };
}

const mocks = vi.hoisted(() => ({
  storage: new Map<string, unknown>(),
  challenge: vi.fn(),
  redeemCard: vi.fn<(body: RequestBody, token?: string) => Promise<unknown>>(),
  giftClaim: vi.fn<(body: RequestBody, token?: string) => Promise<unknown>>(),
  recoverActivation: vi.fn(),
  deliver: vi.fn(async () => 'recovered-plan'),
}));
vi.mock('../lib/store', () => ({
  get: async (key: string) => mocks.storage.get(key),
  set: async (key: string, value: unknown) => {
    mocks.storage.set(key, structuredClone(value));
  },
  del: async (key: string) => {
    mocks.storage.delete(key);
  },
}));
vi.mock('../lib/api', () => ({ api: mocks }));
vi.mock('../lib/deliver', () => ({
  deliver: mocks.deliver,
  recoverActivation: mocks.recoverActivation,
}));
vi.mock('../lib/proof', () => ({ buildProof: () => ({}) }));

afterEach(() => {
  mocks.storage.clear();
  vi.clearAllMocks();
  vi.resetModules();
});

const firstNonce: Hex = `0x${'12'.repeat(32)}`;
const retryNonce: Hex = `0x${'34'.repeat(32)}`;

describe('redemption response loss', () => {
  it('concurrent preparation preserves one operation identity', async () => {
    mocks.challenge.mockResolvedValue({ nonce: firstNonce });
    const claim = await import('../lib/redeem');
    const [first, second] = await Promise.all([
      claim.prepareFreeClaim('same-campaign'),
      claim.prepareFreeClaim('same-campaign'),
    ]);
    expect(first.spk).toBe(second.spk);
    expect(first.recoveryToken).toBe(second.recoveryToken);
  });
  it('free claim preparation survives reload with the same private identity and a fresh proof challenge', async () => {
    mocks.challenge
      .mockResolvedValueOnce({ nonce: firstNonce })
      .mockResolvedValueOnce({ nonce: retryNonce });
    const first = await import('../lib/redeem');
    const original = await first.prepareFreeClaim('campaign-one');
    vi.resetModules();
    const reloaded = await import('../lib/redeem');
    const retry = await reloaded.prepareFreeClaim('campaign-one');
    expect(retry.spk).toBe(original.spk);
    expect(retry.recoveryToken).toBe(original.recoveryToken);
    expect(retry.recoveryToken).toMatch(/^[0-9a-f-]{36}$/);
    expect(retry.challenge.nonce).toBe(retryNonce);
  });
  it.each(['/card/redeem', '/gift/claim'] as const)(
    'reload of %s reuses its encrypted session and private token with a fresh challenge',
    async (route) => {
      const pin = '1234567890123456';
      mocks.challenge
        .mockResolvedValueOnce({ nonce: firstNonce })
        .mockResolvedValueOnce({ nonce: retryNonce });
      const send = route === '/card/redeem' ? mocks.redeemCard : mocks.giftClaim;
      send
        .mockRejectedValueOnce(new Error('response lost'))
        .mockResolvedValueOnce({ status: 201, data: { entitlementKey: 'recovered-plan' } });
      mocks.recoverActivation.mockResolvedValue(true);
      const first = await import('../lib/redeem');
      await expect(first.redeemPin(pin, route)).rejects.toThrow('response lost');
      const [original, token] = send.mock.calls[0]!;
      expect(token).toMatch(/^[0-9a-f-]{36}$/);
      const records = JSON.stringify([...mocks.storage]);
      expect(records).not.toContain(pin);
      expect(records).not.toContain('secretKey');
      vi.resetModules();
      const reloaded = await import('../lib/redeem');
      if (route === '/card/redeem') {
        expect(await reloaded.hasPendingCardRedemption(pin)).toBe(true);
        expect(await reloaded.hasPendingCardRedemption('different')).toBe(false);
      }
      expect(await reloaded.redeemPin(pin, route)).toBe('recovered-plan');
      const [retried, retriedToken] = send.mock.calls[1]!;
      expect(retriedToken).toBe(token);
      expect(retried.sessionPubKey).toBe(original.sessionPubKey);
      expect(retried.challenge.nonce).toBe(retryNonce);
      expect(mocks.recoverActivation).toHaveBeenCalledWith('recovered-plan');
      expect([...mocks.storage.keys()].filter((key) => key.startsWith('redemption:'))).toEqual([]);
    },
  );

  it('wallet gift retries sign the new challenge while retaining the original delivery identity', async () => {
    mocks.challenge
      .mockResolvedValueOnce({ nonce: firstNonce })
      .mockResolvedValueOnce({ nonce: retryNonce });
    mocks.giftClaim
      .mockRejectedValueOnce(new Error('response lost'))
      .mockResolvedValueOnce({ status: 202, data: { entitlementKey: 'recovered-plan' } });
    const sign = vi.fn(async (_body: unknown) => '0xab');
    const wallet = {
      address: `0x${'ab'.repeat(20)}`,
      signTypedData: sign,
    } as unknown as Wallet;
    const gift: Hex = `0x${'cd'.repeat(32)}`;
    const first = await import('../lib/redeem');
    await expect(first.claimGiftBySignature(wallet, gift, 'gift.eth')).rejects.toThrow(
      'response lost',
    );
    vi.resetModules();
    const reloaded = await import('../lib/redeem');
    await reloaded.claimGiftBySignature(wallet, gift, 'gift.eth');
    expect(mocks.giftClaim.mock.calls[1]![0].sessionPubKey).toBe(
      mocks.giftClaim.mock.calls[0]![0].sessionPubKey,
    );
    expect(mocks.giftClaim.mock.calls[1]![1]).toBe(mocks.giftClaim.mock.calls[0]![1]);
    expect(sign.mock.calls[1]![0]).toMatchObject({ message: { nonce: retryNonce } });
    expect(mocks.recoverActivation).not.toHaveBeenCalled();
  });
});
