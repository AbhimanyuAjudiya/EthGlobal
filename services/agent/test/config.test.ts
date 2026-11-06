import { describe, expect, it } from 'vitest';

import { anvilKeys, publicDevAccounts, TEST_USDC } from '@ethglobal/adapters/testing';

import { ALLOW, FEE_PAYER, HEDERA_PAYOUT, MAINNET_ALLOW, MAINNET_USDC, PAYOUT } from './helpers.js';
import {
  ConfigError,
  hederaTerms,
  loadConfig,
  parseAllowList,
  parseWatchKeys,
} from '../src/config.js';

const base = { AGENT_API_URL: 'http://127.0.0.1:8787/', AGENT_PAYTO_ALLOWLIST: ALLOW };
const live = {
  ...base,
  MODE: 'live',
  AGENT_LEDGER_WRITER: '0x1804c8AB1F12E6bbf3894d4083f33e07309d1f38',
  HCS_TOPIC_ID: '0.0.7001',
  ARKIV_RPC_URL: 'https://rpc.rabdi.db-chain.testnet.arkiv.network',
  ARKIV_CHAIN_ID: '7794095',
  AGENT_HEDERA_ACCOUNT_ID: '0.0.5005',
  AGENT_HEDERA_PRIVATE_KEY: 'k',
  // a non-public owner (RT-G-04): never one of the Anvil/Hardhat default accounts, whose keys everyone holds
  AGENT_OWNER: '0x5eF1b7a6c3D2E9f0A1b2C3d4E5f60718293a4B5c',
};

describe('config', () => {
  it('allow-list parses network|asset|payTo triples', () => {
    expect(parseAllowList(ALLOW)).toEqual([
      { network: 'eip155:31337', asset: TEST_USDC.toLowerCase(), payTo: PAYOUT.toLowerCase() },
      { network: 'hedera:testnet', asset: '0.0.429274', payTo: HEDERA_PAYOUT, feePayer: FEE_PAYER },
    ]);
    expect(parseAllowList(' , ')).toEqual([]);
  });

  it('allow-list rejects malformed entries (hedera needs a fee payer; EVM needs addresses)', () => {
    for (const bad of [
      'eip155:31337|0x12|0x34',
      `eip155:31337|${TEST_USDC}`,
      'hedera:testnet|0.0.429274|0.0.6006',
      'hedera:testnet|0.0.429274|0.0.6006|alias',
      'solana:devnet|x|y',
      'nonsense',
    ]) {
      expect(() => parseAllowList(bad), bad).toThrow(ConfigError);
    }
  });

  it('empty allow-list in live is an error', () => {
    expect(() => loadConfig({ ...live, AGENT_PAYTO_ALLOWLIST: '' })).toThrow(/must not be empty/);
    expect(loadConfig(live).mode).toBe('live');
  });

  it('local defaults (tick 5 s)', () => {
    const c = loadConfig(base);
    expect(c).toMatchObject({
      mode: 'local',
      apiUrl: 'http://127.0.0.1:8787',
      tickMs: 5_000,
      dryRun: false,
      once: false,
      maxUsd6PerStep: 4_000_000n, // one 1 GB step at $0.40 per 100 MB
      hcsTopic: '0.0.1001',
      stateDir: '.agent',
      llm: { provider: 'none' },
      evmRpcUrl: 'http://127.0.0.1:8545',
      watchKeys: [],
    });
    expect(loadConfig(live).tickMs).toBe(60_000);
    expect(loadConfig({ ...base, AGENT_TICK_MS: '2000' }).tickMs).toBe(2_000);
    expect(() => loadConfig({ ...base, AGENT_TICK_MS: '10' })).toThrow();
  });

  it('env booleans: AGENT_DRY_RUN=0 is false (z.coerce.boolean would say true)', () => {
    expect(loadConfig({ ...base, AGENT_DRY_RUN: '0', AGENT_ONCE: '' })).toMatchObject({
      dryRun: false,
      once: false,
    });
    expect(loadConfig({ ...base, AGENT_DRY_RUN: '1', AGENT_ONCE: 'true' })).toMatchObject({
      dryRun: true,
      once: true,
    });
    expect(() => loadConfig({ ...base, AGENT_DRY_RUN: 'maybe' })).toThrow();
  });

  it('blank optional values are unset; owner and writer are lower-cased', () => {
    const c = loadConfig({ ...base, AGENT_OWNER: ' ', AGENT_UAID: '', AGENT_EVM_PRIVATE_KEY: '' });
    expect(c.owner).toBeUndefined();
    expect(c.uaid).toBeUndefined();
    expect(loadConfig({ ...base, AGENT_OWNER: PAYOUT }).owner).toBe(PAYOUT.toLowerCase());
    expect(loadConfig(live).ledgerWriter).toBe(live.AGENT_LEDGER_WRITER.toLowerCase());
    expect(loadConfig(live).arkiv).toEqual({
      chainId: 7794095,
      rpcUrl: live.ARKIV_RPC_URL,
      accessKey: '',
      blockTimeMs: 2_000,
    });
  });

  it('live refuses public Anvil keys, missing RPC, missing HCS topic, Arkiv or the Hedera wallet', () => {
    expect(() =>
      loadConfig({
        ...live,
        AGENT_EVM_PRIVATE_KEY: anvilKeys[4],
        AGENT_EVM_RPC_URL: 'https://sepolia.base.org',
      }),
    ).toThrow(/Anvil key/);
    expect(() => loadConfig({ ...live, AGENT_EVM_PRIVATE_KEY: `0x${'42'.repeat(32)}` })).toThrow(
      /AGENT_EVM_RPC_URL/,
    );
    expect(() => loadConfig({ ...live, HCS_TOPIC_ID: '' })).toThrow(/HCS_TOPIC_ID/);
    // RT-G-04: live never runs without a pinned policy owner
    expect(() => loadConfig({ ...live, AGENT_OWNER: '' })).toThrow(/AGENT_OWNER is required/);
    // RT-G-04 variant: nor under a public Anvil/Hardhat owner, in any case
    for (const owner of [...publicDevAccounts, publicDevAccounts[19]!.toLowerCase()]) {
      expect(() => loadConfig({ ...live, AGENT_OWNER: owner })).toThrow(/public Anvil\/Hardhat/);
    }
    expect(loadConfig({ ...base, AGENT_OWNER: publicDevAccounts[5]! }).mode).toBe('local');
    expect(() => loadConfig({ ...live, ARKIV_RPC_URL: '' })).toThrow(/ARKIV/);
    expect(() => loadConfig({ ...live, AGENT_HEDERA_ACCOUNT_ID: '' })).toThrow(
      /Hedera Agent Kit wallet/,
    );
    expect(() => loadConfig({ ...base, AGENT_HEDERA_ACCOUNT_ID: '0.0.5005' })).toThrow(
      /AGENT_HEDERA_PRIVATE_KEY/,
    );
    expect(
      loadConfig({
        ...live,
        AGENT_EVM_PRIVATE_KEY: `0x${'42'.repeat(32)}`,
        AGENT_EVM_RPC_URL: 'https://sepolia.base.org',
      }).evmPrivateKey,
    ).toBe(`0x${'42'.repeat(32)}`);
  });

  it('LLM_PROVIDER=anthropic needs a model and a key', () => {
    expect(() => loadConfig({ ...base, LLM_PROVIDER: 'anthropic' })).toThrow(/AGENT_LLM_MODEL/);
    expect(
      loadConfig({
        ...base,
        LLM_PROVIDER: 'anthropic',
        AGENT_LLM_MODEL: 'm',
        ANTHROPIC_API_KEY: 'k',
      }).llm,
    ).toEqual({ provider: 'anthropic', model: 'm', apiKey: 'k' });
  });

  it('Hedera network, token and mirror come from the allow-list; two Hedera networks refuse at boot', () => {
    // testnet entry (unchanged): testnet mirror, USDC 0.0.429274
    expect(loadConfig(base)).toMatchObject({
      hederaNetwork: 'hedera:testnet',
      hederaAsset: '0.0.429274',
      mirrorUrl: 'https://testnet.mirrornode.hedera.com',
    });
    // mainnet entry: mainnet mirror, USDC 0.0.456858
    expect(loadConfig({ ...base, AGENT_PAYTO_ALLOWLIST: MAINNET_ALLOW })).toMatchObject({
      hederaNetwork: 'hedera:mainnet',
      hederaAsset: MAINNET_USDC,
      mirrorUrl: 'https://mainnet.mirrornode.hedera.com',
    });
    expect(loadConfig({ ...live, AGENT_PAYTO_ALLOWLIST: MAINNET_ALLOW }).hederaNetwork).toBe(
      'hedera:mainnet',
    );
    // HEDERA_MIRROR_URL still overrides the per-network default
    expect(
      loadConfig({
        ...base,
        AGENT_PAYTO_ALLOWLIST: MAINNET_ALLOW,
        HEDERA_MIRROR_URL: 'https://mirror.test',
      }).mirrorUrl,
    ).toBe('https://mirror.test');
    // no hedera:* entry: no Hedera asset (no Hedera payer); the Client/UAID network stays testnet
    const evmOnly = loadConfig({ ...base, AGENT_PAYTO_ALLOWLIST: ALLOW.split(',')[0]! });
    expect(evmOnly.hederaNetwork).toBe('hedera:testnet');
    expect(evmOnly.hederaAsset).toBeUndefined();
    expect(hederaTerms([])).toBeUndefined();
    // both networks, or two tokens on one network, is a boot error
    expect(() =>
      loadConfig({ ...base, AGENT_PAYTO_ALLOWLIST: `${ALLOW},${MAINNET_ALLOW}` }),
    ).toThrow(/several Hedera networks.*one Hedera network per agent/);
    expect(() =>
      loadConfig({ ...live, AGENT_PAYTO_ALLOWLIST: `${ALLOW},${MAINNET_ALLOW}` }),
    ).toThrow(ConfigError);
    expect(() =>
      loadConfig({
        ...base,
        AGENT_PAYTO_ALLOWLIST: `${ALLOW},hedera:testnet|${MAINNET_USDC}|${HEDERA_PAYOUT}|${FEE_PAYER}`,
      }),
    ).toThrow(/several Hedera networks/);
    // the same (network, token) under two payTo accounts is one Hedera network
    expect(
      loadConfig({
        ...base,
        AGENT_PAYTO_ALLOWLIST: `${MAINNET_ALLOW},hedera:mainnet|${MAINNET_USDC}|0.0.7007|${FEE_PAYER}`,
      }).hederaAsset,
    ).toBe(MAINNET_USDC);
    // a Hedera network the agent has no Client/mirror for
    expect(() =>
      loadConfig({
        ...base,
        AGENT_PAYTO_ALLOWLIST: `hedera:previewnet|0.0.1|${HEDERA_PAYOUT}|${FEE_PAYER}`,
      }),
    ).toThrow(/unsupported Hedera network hedera:previewnet/);
  });

  it('watch keys are de-duplicated', () => {
    expect(parseWatchKeys('a, b,a,,')).toEqual(['a', 'b']);
  });
});
