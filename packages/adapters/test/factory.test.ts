import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { ADAPTER_CODE_MAP } from '@ethglobal/protocol/errors';

import {
  ADAPTER_ERROR_CODES,
  createAdapters,
  MemoryBlobStore,
  MockConsensusLog,
  MockReseller,
  MockTreasury,
  parseAdapterMode,
  type AdapterName,
} from '../src/index.js';

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

  it('wires the local mocks and their options', async () => {
    const adapters = createAdapters('local', {
      personhood: { expectSignal: true },
      reseller: { failNextOrder: true },
    });
    expect(adapters.reseller).toBeInstanceOf(MockReseller);
    expect(adapters.consensus).toBeInstanceOf(MockConsensusLog);
    expect(adapters.blobs).toBeInstanceOf(MemoryBlobStore);
    expect(adapters.treasury).toBeInstanceOf(MockTreasury);
    await expect(adapters.reseller.order('in-1gb-7d', { idempotencyKey: 'k' })).rejects.toMatchObject({
      code: 'unavailable',
    });
    await expect(adapters.reseller.order('in-1gb-7d', { idempotencyKey: 'k' })).resolves.toMatchObject({
      provider: 'mock',
    });
  });

  it('every AdapterError code maps to an API error code (L15)', () => {
    for (const code of ADAPTER_ERROR_CODES) expect(ADAPTER_CODE_MAP[code]).toBeDefined();
  });

  it('the root barrel never imports ./live (browser-safe; no Hedera/Arkiv SDK)', () => {
    const src = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/from '\.\/live|@hiero-ledger|@x402\/hedera|@arkiv-network/);
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
