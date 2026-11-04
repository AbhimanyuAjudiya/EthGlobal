import { describe, expect, it, vi } from 'vitest';

import { InMemoryLedger } from '@ethglobal/adapters';
import { fakeClock } from '@ethglobal/adapters/testing';

import { Admission, KeyedMutex, WindowLimiter } from '../../src/admission.js';
import { AnomalyGuard } from '../../src/anomaly.js';
import { LedgerHealth, MeCache, observedLedger } from '../../src/cache.js';
import { SerialQueue } from '../../src/chain.js';
import { createLogger } from '../../src/logger.js';
import { Metrics } from '../../src/metrics.js';
import { LocalClock } from '../../src/seed.js';
import { MemoryDataDrop } from '../doubles/datadrop.js';

describe('Admission (T-46)', () => {
  it('slots = claimsPerHour − claimsThisHour − inFlight; release is idempotent', () => {
    const a = new Admission();
    const r1 = a.take('0xAB', 2, 0);
    const r2 = a.take('0xab', 2, 0);
    expect(a.take('0xab', 2, 0)).toBeUndefined();
    expect(a.inFlight('0xab')).toBe(2);
    r1?.();
    r1?.();
    expect(a.inFlight('0xab')).toBe(1);
    r2?.();
    expect(a.take('0xab', 2, 2)).toBeUndefined();
    expect(a.inFlight('0xab')).toBe(0);
  });
});

describe('KeyedMutex, SerialQueue, WindowLimiter', () => {
  it('serialises per key and keeps going after a failure', async () => {
    const m = new KeyedMutex();
    const order: number[] = [];
    await Promise.all([
      m.run('k', async () => {
        await new Promise((r) => setTimeout(r, 5));
        order.push(1);
      }),
      m.run('k', async () => {
        order.push(2);
      }),
      m
        .run('k', async () => {
          throw new Error('x');
        })
        .catch(() => order.push(3)),
    ]);
    expect(order).toEqual([1, 2, 3]);
    const q = new SerialQueue();
    await expect(
      q.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    await expect(q.run(async () => 7)).resolves.toBe(7);
  });

  it('a sliding window answers Retry-After and prunes', () => {
    const clock = fakeClock();
    const w = new WindowLimiter(2, 60_000, clock.now);
    expect([w.hit('a').ok, w.hit('a').ok]).toEqual([true, true]);
    expect(w.hit('a')).toEqual({ ok: false, retryAfterS: 60 });
    clock.advance(60_000);
    expect(w.hit('a').ok).toBe(true);
  });
});

describe('MeCache, LedgerHealth, observedLedger (T-51)', () => {
  it('fresh within 60 s, stale after, expired hints, bounded', () => {
    const clock = fakeClock();
    const c = new MeCache(clock.now);
    const me = { expiresAt: clock.now() + 1000 } as Parameters<MeCache['remember']>[1];
    c.remember('k', me);
    expect(c.fresh('k')).toBe(me);
    clock.advance(60_000);
    expect(c.fresh('k')).toBeUndefined();
    expect(c.stale('k')).toBe(me);
    expect(c.expired('k')).toBe(true);
    c.invalidate('k');
    expect(c.stale('k')).toBeUndefined();
    for (let i = 0; i < 10_001; i++) c.seen(`k${i}`, 0);
    expect(c.expired('k0')).toBe(false);
  });

  it('degraded for 60 s after a ledger failure; raw failures become AdapterError(ledger, unavailable)', async () => {
    const clock = fakeClock();
    const health = new LedgerHealth(clock.now);
    const inner = new InMemoryLedger({ now: clock.now });
    vi.spyOn(inner, 'get').mockRejectedValue(new Error('down'));
    const observe = vi.fn();
    const ledger = observedLedger(inner, health, observe);
    await ledger.put({ payload: '{}' });
    await expect(ledger.get('x')).rejects.toMatchObject({ code: 'unavailable', adapter: 'ledger' });
    expect(health.degraded).toBe(true);
    clock.advance(60_000);
    expect(health.degraded).toBe(false);
    expect(observe).toHaveBeenCalledWith('get', expect.any(Number), false);
  });
});

describe('AnomalyGuard (T-01)', () => {
  it('80 % of cap in 10 min → pause(true) once; a failed pause is retried by the next claim', async () => {
    const clock = fakeClock();
    const dd = new MemoryDataDrop(clock.now);
    const id = `0x${'01'.repeat(32)}` as const;
    dd.create(id, {
      sponsor: '0x0000000000000000000000000000000000000001',
      pricePerClaim: 1n,
      budget: 100n,
      spent: 0n,
      claimsPerHour: 10,
      expiresAt: clock.now() + 1e9,
    });
    const guard = new AnomalyGuard(dd, createLogger('silent'), clock.now);
    const pause = vi.spyOn(dd, 'pause').mockRejectedValueOnce(new Error('rpc'));
    for (let i = 0; i < 8; i++) await guard.record(id, 10);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(await guard.record(id, 10)).toBe(true);
    expect(await guard.record(id, 10)).toBe(false);
    expect(dd.pauses).toEqual([{ id, paused: true }]);
    clock.advance(10 * 60_000);
    expect(await guard.record(id, 10)).toBe(false);
  });
});

describe('Metrics and LocalClock', () => {
  it('counts, times and summarises', async () => {
    const m = new Metrics();
    m.inc('x', { a: 'b' });
    await m.timed('t', async () => 1);
    await expect(
      m.timed('t', async () => {
        throw new Error('e');
      }),
    ).rejects.toThrow();
    for (let i = 0; i < 1001; i++) m.observe('h', i);
    const s = m.snapshot();
    expect(s.counters).toEqual({ 'x{a=b}': 1 });
    expect(s.histograms.t?.count).toBe(2);
    expect(s.histograms.h).toMatchObject({ count: 1000, p50: 501 });
  });

  it('LocalClock only moves forward by advance()', () => {
    const c = new LocalClock(() => 1000);
    c.advance(500);
    expect(c.now()).toBe(1500);
  });
});
