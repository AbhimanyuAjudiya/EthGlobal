import { describe, expect, it } from 'vitest';

import { createAdapters, parseAdapterMode, type AdapterName } from '../src/index.js';

const ports: readonly AdapterName[] = [
  'ledger',
  'personhood',
  'payments',
  'inference',
  'names',
  'reseller',
  'consensus',
  'blobs',
  'treasury',
];

describe('createAdapters', () => {
  it('returns a complete local bundle', () => {
    const adapters = createAdapters('local');
    expect(adapters.mode).toBe('local');
    for (const name of ports) expect(adapters[name]).toBeDefined();
  });

  it('pending ports reject with not_implemented until their mocks land', async () => {
    const { reseller, blobs, consensus, treasury } = createAdapters('local');
    await expect(Promise.resolve().then(() => blobs.get('ref'))).rejects.toMatchObject({
      code: 'not_implemented',
      adapter: 'blobs',
    });
    await expect(Promise.resolve().then(() => consensus.read('0.0.1'))).rejects.toMatchObject({
      code: 'not_implemented',
    });
    await expect(
      Promise.resolve().then(() => treasury.balanceUsd6('eip155:31337')),
    ).rejects.toMatchObject({ code: 'not_implemented' });
    expect(() => reseller.verifyWebhook('{}', {}, 0)).toThrow(/not implemented/);
  });

  it('shares the injected clock between ledger and payments', async () => {
    let now = Date.UTC(2026, 0, 1);
    const adapters = createAdapters('local', { now: () => now });
    const { key } = await adapters.ledger.put({ payload: 'x', expiresIn: 1 });
    now += 1001;
    await expect(adapters.ledger.get(key)).resolves.toBeNull();
  });

  it('refuses live mode and points at the live subpath', () => {
    expect(() => createAdapters('live')).toThrow(/@ethglobal\/adapters\/live/);
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
