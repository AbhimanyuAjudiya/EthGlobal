import { describe, expect, it } from 'vitest';

import { EsimAccessReseller } from '../../src/live/esimaccess-reseller.js';
import { fakeClock } from '../../src/testing/index.js';

const ICCID = '89852240000000000001';
function vendor(over: Record<string, unknown> = {}) {
  const clock = fakeClock();
  const profile = {
    iccid: ICCID,
    esimTranNo: 'profile-1',
    esimStatus: 'GOT_RESOURCE',
    smdpStatus: 'RELEASED',
    totalVolume: 1_000_000_000,
    orderUsage: 0,
    ...over,
  };
  const packages = [
    {
      packageCode: 'TOPUP-1GB',
      name: '1 GB',
      price: 10000,
      volume: 1_000_000_000,
      duration: 7,
      durationUnit: 'DAY',
      supportTopUpType: 2,
    },
  ];
  const calls: string[] = [];
  let rejectTopup = false;
  const reseller = new EsimAccessReseller({
    accessCode: 'test',
    webhookToken: 'test-token-0123456789',
    now: clock.now,
    sleep: async (ms) => clock.advance(ms),
    fetch: async (input) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const path = new URL(url).pathname;
      calls.push(path);
      if (path.endsWith('/esim/query'))
        return Response.json({ success: true, obj: { esimList: [profile] } });
      if (path.endsWith('/package/list'))
        return Response.json({ success: true, obj: { packageList: packages } });
      if (path.endsWith('/esim/topup'))
        return Response.json(
          rejectTopup ? { success: false, errorCode: '200002' } : { success: true, obj: {} },
        );
      throw new Error('unexpected mutation');
    },
  });
  return {
    reseller,
    profile,
    packages,
    calls,
    clock,
    refuseTopup: () => {
      rejectTopup = true;
    },
  };
}

describe('eSIM Access documented status and confirmed top-ups', () => {
  it('depleted profiles can reload; expiry, suspension, revoke and unsupported day-pass plans cannot', async () => {
    const depleted = vendor({
      esimStatus: 'USED_UP',
      smdpStatus: 'DISABLED',
      orderUsage: 1_000_000_000,
    });
    await expect(depleted.reseller.canTopUp(ICCID)).resolves.toBe(true);
    for (const esimStatus of ['UNUSED_EXPIRED', 'USED_EXPIRED', 'CANCEL', 'REVOKE', 'SUSPENDED']) {
      const v = vendor({ esimStatus });
      await expect(v.reseller.canTopUp(ICCID)).resolves.toBe(false);
      expect(v.calls).toHaveLength(1);
    }
    const elapsed = vendor({ expiredTime: new Date(depleted.clock.now() - 1000).toISOString() });
    await expect(elapsed.reseller.canTopUp(ICCID)).resolves.toBe(false);
    for (const support of [1, 3]) {
      const v = vendor();
      v.packages[0]!.supportTopUpType = support;
      await expect(v.reseller.canTopUp(ICCID)).resolves.toBe(false);
    }
  });

  it('downloaded, disabled, suspended, unknown or nonzero-usage profiles are never cancelled as unused', async () => {
    for (const over of [
      { smdpStatus: 'DOWNLOAD' },
      { smdpStatus: 'DISABLED' },
      { esimStatus: 'SUSPENDED' },
      { esimStatus: 'NEW_UNKNOWN_STATE' },
      { eid: '89000001' },
      { orderUsage: 1 },
    ]) {
      const v = vendor(over);
      await expect(v.reseller.cancel(ICCID, { idempotencyKey: 'cancel' })).rejects.toThrow();
      expect(v.calls.every((path) => path.endsWith('/esim/query'))).toBe(true);
    }
  });

  it('a successful top-up acknowledgement cannot credit capacity until the authoritative query confirms it', async () => {
    const v = vendor();
    const request = { idempotencyKey: 'one-purchase', totalMb: 2000 };
    await expect(v.reseller.topUp(ICCID, 1000, request)).rejects.toMatchObject({
      code: 'unavailable',
      details: { reason: 'pending_topup', requiredMb: 2000, confirmedMb: 1000 },
    });
    v.profile.totalVolume = 2_000_000_000;
    await expect(v.reseller.topUp(ICCID, 1000, request)).resolves.toMatchObject({ totalMb: 2000 });
    expect(v.calls.filter((path) => path.endsWith('/esim/topup'))).toHaveLength(1);
  });

  it('a non-duplicate vendor refusal propagates and never credits a top-up', async () => {
    const v = vendor();
    v.refuseTopup();
    await expect(
      v.reseller.topUp(ICCID, 1000, { idempotencyKey: 'refused', totalMb: 2000 }),
    ).rejects.toMatchObject({
      code: 'invalid_response',
      details: { vendorCode: '200002' },
    });
  });
});
