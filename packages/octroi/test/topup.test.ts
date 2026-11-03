import { describe, expect, it } from 'vitest';

import { entitlement as e, T0 } from './helpers.js';
import { policyFromWire, policyToWire, shouldTopUp, type TopUpPolicy } from '../src/index.js';

const STEP = 400_000n;
const p = (over: Partial<TopUpPolicy> = {}): TopUpPolicy => ({
  maxUsd6PerDay: 10_000_000n,
  thresholdMb: 60,
  stepMb: 100,
  paused: false,
  topUpOnExpiry: true,
  expiryLeadS: 3600,
  ...over,
});

describe('shouldTopUp', () => {
  it('buys at 20 % remaining', () => {
    const at20 = e({ mbTotal: 300, mbUsed: 240 });
    expect(shouldTopUp(at20, p(), 0n, T0, STEP)).toEqual({
      buy: true,
      mb: 100,
      reason: 'threshold',
      costUsd6: STEP,
    });
  });

  it('buys at expiry lead once per expiresAt (O13)', () => {
    const soon = e({ mbUsed: 0, expiresAt: T0 + 1_800_000 });
    expect(shouldTopUp(soon, p(), 0n, T0, STEP)).toMatchObject({ buy: true, reason: 'expiry' });
    expect(shouldTopUp(soon, p(), 0n, T0, STEP, soon.expiresAt)).toEqual({
      buy: false,
      reason: 'already-bought-for-expiry',
    });
    expect(shouldTopUp(soon, p(), 0n, T0, STEP, soon.expiresAt - 1)).toMatchObject({ buy: true });
    expect(shouldTopUp(soon, p({ topUpOnExpiry: false }), 0n, T0, STEP)).toEqual({
      buy: false,
      reason: 'ok',
    });
    expect(shouldTopUp(e({ mbUsed: 0, expiresAt: T0 + 3_600_001 }), p(), 0n, T0, STEP).buy).toBe(
      false,
    );
  });

  it('never exceeds maxUsd6PerDay', () => {
    expect(shouldTopUp(e(), p(), 9_610_000n, T0, STEP)).toEqual({ buy: false, reason: 'cap' });
    expect(shouldTopUp(e(), p(), 9_600_000n, T0, STEP).buy).toBe(true); // exactly reaching the cap
    expect(shouldTopUp(e(), p({ stepMb: 300 }), 8_900_000n, T0, 1_200_000n)).toEqual({
      buy: false,
      reason: 'cap',
    });
  });

  it('paused stops it', () => {
    expect(shouldTopUp(e({ mbUsed: 300 }), p({ paused: true }), 0n, T0, STEP)).toEqual({
      buy: false,
      reason: 'paused',
    });
  });

  it('expired entity → expired', () => {
    expect(shouldTopUp(e({ expiresAt: T0 }), p(), 0n, T0, STEP)).toEqual({
      buy: false,
      reason: 'expired',
    });
  });

  it('threshold off-by-one: remaining == threshold buys, remaining == threshold+1 does not', () => {
    expect(shouldTopUp(e({ mbUsed: 240 }), p(), 0n, T0, STEP).buy).toBe(true);
    expect(shouldTopUp(e({ mbUsed: 239 }), p(), 0n, T0, STEP)).toEqual({
      buy: false,
      reason: 'ok',
    });
  });
});

describe('policy wire', () => {
  it('round-trips and validates', () => {
    const wire = policyToWire(p());
    expect(wire.maxUsd6PerDay).toBe('10000000');
    expect(policyFromWire(wire)).toEqual(p());
    expect(() => policyToWire(p({ stepMb: 150 }))).toThrow(
      expect.objectContaining({ code: 'invalid_request' }),
    );
    expect(() => policyFromWire({ ...wire, maxUsd6PerDay: '1.5' })).toThrow();
  });
});
