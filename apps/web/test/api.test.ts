import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { api, ApiError, ENTITLE_TIMEOUT_MS } from '../lib/api';

const KEY = `ent-${'a'.repeat(40)}`;
const CHALLENGE = {
  nonce: `0x${'1'.repeat(64)}`,
  audience: 'recharge',
  path: '/claim',
  exp: 2_000_000_000_000,
  signal: `0x${'2'.repeat(64)}`,
} as const;
const CLAIM = {
  proof: {},
  campaignId: `0x${'3'.repeat(64)}`,
  challenge: CHALLENGE,
  sessionPubKey: `0x${'4'.repeat(64)}`,
} as const;
/** The API's 202 body for a claim whose eSIM order failed: the key and the pending status, no sealed LPA (T-25). */
const PENDING = {
  entitlementKey: KEY,
  kind: 'free',
  status: 'pending-profile',
  tier: 'orb',
  mbTotal: 300,
  expiresAt: 2_000_000_000_000,
  validityDays: 7,
  claimTx: `0x${'5'.repeat(64)}`,
  receipt: { arkivKey: `0x${'ab'.repeat(32)}` },
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('api — the entitling routes wait for the API’s worst case (RT-W-13)', () => {
  const fetchMock = vi.fn<typeof fetch>();
  beforeEach(() => vi.stubGlobal('fetch', fetchMock));
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
    fetchMock.mockReset();
  });

  it('/claim, /card/redeem and /gift/claim get ENTITLE_TIMEOUT_MS (≥ 120 s); a cheap call keeps 30 s', async () => {
    expect(ENTITLE_TIMEOUT_MS).toBeGreaterThanOrEqual(120_000);
    const timeout = vi.spyOn(AbortSignal, 'timeout');
    fetchMock.mockImplementation(() => Promise.resolve(json(202, PENDING)));
    await api.claim(CLAIM);
    await api.redeemCard({
      pin: '1'.repeat(16),
      challenge: CHALLENGE,
      sessionPubKey: CLAIM.sessionPubKey,
    });
    await api.giftClaim({ pin: '1'.repeat(16), challenge: CHALLENGE });
    fetchMock.mockImplementation(() => Promise.resolve(json(200, { ok: true })));
    await api.health();
    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
      ENTITLE_TIMEOUT_MS,
      ENTITLE_TIMEOUT_MS,
      ENTITLE_TIMEOUT_MS,
      30_000,
    ]);
  });

  it('a 202 that lands after 64.5 s is a success: the plan key and pending-profile, no LPA', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(json(202, PENDING)), 64_500)),
    );
    const claim = api.claim(CLAIM);
    await vi.advanceTimersByTimeAsync(64_500);
    const res = await claim;
    expect(res.status).toBe(202);
    expect(res.data.entitlementKey).toBe(KEY);
    expect(res.data.status).toBe('pending-profile');
    expect(res.data.sealedLpa).toBeUndefined();
    expect(res.data.claimTx).toBe(PENDING.claimTx);
  });

  it('the transport timing out is ApiError(0, "network"): the code the sheet turns into "may have gone through"', async () => {
    fetchMock.mockRejectedValue(
      new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
    );
    const err: unknown = await api.claim(CLAIM).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'network' });
  });
});
