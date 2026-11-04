import { describe, expect, it } from 'vitest';

import { anvilAccounts } from '@ethglobal/adapters';

import { anvilKey, evmNetworks, parseEnv, resolveFacilitator } from '../src/env.js';

describe('env', () => {
  it('defaults to local on 8787 with the Anvil roles and local test secrets', () => {
    const env = parseEnv({});
    expect(env).toMatchObject({
      MODE: 'local',
      PORT: 8787,
      LOG_LEVEL: 'info',
      CHAIN: 31337,
      X402_NETWORKS: ['eip155:31337'],
      PAYOUT_ADDRESS: anvilAccounts[1],
    });
    expect(env.OCTROI_SECRET).toMatch(/^0x[0-9a-f]{64}$/);
    expect(env.PRICE_USD6_PER_STEP).toBe(400_000n);
    expect(env.TREASURY_MAX_USD6_PER_DAY).toBe(50_000_000n);
  });

  it('treats empty strings as unset and parses lists and flags', () => {
    const env = parseEnv({
      PORT: '',
      CORS_ORIGINS: 'https://a.test, https://b.test',
      TRUST_PROXY: '1',
      X402_NETWORKS: 'eip155:31337,eip155:84532',
    });
    expect(env.PORT).toBe(8787);
    expect(env.CORS_ORIGINS).toEqual(['https://a.test', 'https://b.test']);
    expect(env.TRUST_PROXY).toBe(true);
    expect(evmNetworks(env)).toEqual(['eip155:31337', 'eip155:84532']);
  });

  it('derives the Anvil keys from the public mnemonic (never written down)', () => {
    expect(parseEnv({}).ATTESTOR_PRIVATE_KEY).toBe(anvilKey(2));
    expect(anvilKey(0)).toMatch(/^0xac0974/);
  });

  it('rejects bad values in any mode', () => {
    expect(() => parseEnv({ MODE: 'staging' })).toThrow(/Invalid environment/);
    expect(() => parseEnv({ OCTROI_SECRET: '0x1234' })).toThrow(/OCTROI_SECRET/);
    expect(() => parseEnv({ X402_NETWORKS: 'eip155:8453' })).toThrow(/not a testnet/);
    expect(
      parseEnv({ X402_NETWORKS: 'eip155:8453', SALES_ENABLED: 'true', LEGAL_MEMO_OK: 'true' })
        .X402_NETWORKS,
    ).toEqual(['eip155:8453']);
  });

  it('X402_FACILITATOR defaults to self when ANVIL_RPC_URL answers, else mock; live is remote', async () => {
    expect(
      await resolveFacilitator({ MODE: 'local', X402_FACILITATOR: undefined }, async () => true),
    ).toBe('self');
    expect(
      await resolveFacilitator({ MODE: 'local', X402_FACILITATOR: undefined }, async () => false),
    ).toBe('mock');
    expect(
      await resolveFacilitator({ MODE: 'live', X402_FACILITATOR: undefined }, async () => true),
    ).toBe('remote');
    expect(
      await resolveFacilitator({ MODE: 'local', X402_FACILITATOR: 'mock' }, async () => true),
    ).toBe('mock');
  });
});
