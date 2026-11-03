import { describe, expect, it } from 'vitest';

import { createAdapters, parseAdapterMode } from '../src/index.js';

describe('createAdapters', () => {
  it('returns a complete local bundle', () => {
    const adapters = createAdapters('local');
    expect(adapters.mode).toBe('local');
    for (const name of ['ledger', 'personhood', 'payments', 'inference', 'names'] as const) {
      expect(adapters[name]).toBeDefined();
    }
  });

  it('shares the injected clock between ledger and payments', async () => {
    let now = Date.UTC(2026, 0, 1);
    const adapters = createAdapters('local', { now: () => now });
    const { key } = await adapters.ledger.put({ payload: 'x', expiresIn: 1 });
    now += 1001;
    await expect(adapters.ledger.get(key)).resolves.toBeNull();
  });

  it('refuses live mode until the live adapters exist', () => {
    expect(() => createAdapters('live')).toThrow(/not implemented/);
  });
});

describe('parseAdapterMode', () => {
  it('defaults to local and validates the value', () => {
    expect(parseAdapterMode(undefined)).toBe('local');
    expect(parseAdapterMode('')).toBe('local');
    expect(parseAdapterMode('live')).toBe('live');
    expect(() => parseAdapterMode('staging')).toThrow(/MODE must be one of/);
  });
});
