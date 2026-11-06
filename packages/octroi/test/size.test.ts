import { describe, expect, it } from 'vitest';

import { campaign } from './helpers.js';
import { sizeBundle, type Campaign } from '../src/index.js';

const at = (wholesaleUsd6PerGb: bigint, over: Partial<Campaign> = {}) =>
  sizeBundle(campaign({ wholesaleUsd6PerGb, ...over }), 'orb');

describe('sizeBundle', () => {
  it('caps at the configured size, and at 1 GB (MAX_BUNDLE_MB)', () => {
    expect(at(1_140_000n)).toBe(300); // evMb = 350, configured 300
    expect(at(1_000n, { bundleMb: { orb: 300, document: 300, device: 0 } })).toBe(300);
    expect(at(1_000n, { bundleMb: { orb: 1000, document: 300, device: 0 } })).toBe(1000);
  });

  it('shrinks with wholesale ($2.50/GB → 160)', () => {
    expect(at(2_500_000n)).toBe(160); // 0.4 / 0.0025 is 159.999… in floats
    expect(at(5_000_000n)).toBe(80);
  });

  it('honours a smaller configured bundle', () => {
    expect(at(1_140_000n, { bundleMb: { orb: 100, document: 300, device: 0 } })).toBe(100);
    expect(
      sizeBundle(campaign({ bundleMb: { orb: 300, document: 0, device: 0 } }), 'document'),
    ).toBe(0);
  });

  it('device and none → 0', () => {
    expect(sizeBundle(campaign(), 'device')).toBe(0);
    expect(sizeBundle(campaign(), 'none')).toBe(0);
  });

  it('zero or negative wholesale uses the cap only', () => {
    expect(at(0n)).toBe(300);
    expect(at(-5n)).toBe(300);
    expect(at(0n, { bundleMb: { orb: 5000, document: 300, device: 0 } })).toBe(1000);
  });

  it('a non-positive ID resale price sizes to 0', () => {
    expect(at(1_000_000n, { idResaleUsd6: 0n })).toBe(0);
    expect(at(1_000_000n, { idResaleUsd6: -1n })).toBe(0);
  });

  it('a non-integer configured size is refused (0), never a float', () => {
    expect(at(1_000_000n, { bundleMb: { orb: 150.5, document: 0, device: 0 } })).toBe(0);
  });

  it('never a float (result is an integer for 10⁴ random inputs)', () => {
    let seed = 42n;
    const next = (mod: bigint) => {
      seed = (seed * 6_364_136_223_846_793_005n + 1n) % 2n ** 63n;
      return seed % mod;
    };
    for (let i = 0; i < 10_000; i += 1) {
      const mb = sizeBundle(
        {
          bundleMb: { orb: 300, document: 300, device: 0 },
          idResaleUsd6: next(10_000_000n),
          wholesaleUsd6PerGb: next(50_000_000n) - 1n,
        },
        i % 2 ? 'orb' : 'document',
      );
      expect(Number.isInteger(mb) && mb >= 0 && mb <= 300).toBe(true);
    }
  });
});
