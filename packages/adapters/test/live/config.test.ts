import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import { EsimAccessReseller } from '../../src/live/esimaccess-reseller.js';
import { FallbackReseller } from '../../src/live/fallback-reseller.js';
import {
  createLiveAdapters,
  liveConfigSchema,
  parseLiveConfig,
  sealInventory,
  type HederaClientLike,
} from '../../src/live/index.js';
import { RemoteFacilitator } from '../../src/live/remote-facilitator.js';
import { SelfRunFacilitator } from '../../src/live/self-run-facilitator.js';
import { SwarmBlobStore } from '../../src/live/swarm-blobs.js';
import { anvilKeys, loadFixture, T0, fixtureFetch } from '../../src/testing/index.js';

import type { InventoryEntry } from '../../src/live/inventory-reseller.js';

const k = (b: string) => `0x${b.repeat(32)}`;
const SEAL = k('5e');

function inventoryFile(): string {
  const file = join(mkdtempSync(join(tmpdir(), 'live-')), 'inventory.enc');
  const { entries } = loadFixture<{ entries: InventoryEntry[] }>('inventory.example.json');
  writeFileSync(file, sealInventory(entries, Buffer.from(SEAL.slice(2), 'hex')));
  return file;
}

const env = (
  over: Record<string, string | undefined> = {},
): Record<string, string | undefined> => ({
  CHAIN: '84532',
  RPC_URL: 'https://sepolia.base.example/rpc',
  X402_FACILITATOR: 'remote',
  X402_NETWORKS: 'eip155:84532,hedera:testnet',
  X402_HEDERA_FEE_PAYER: '0.0.9185802',
  ARKIV_PRIVATE_KEY: k('a1'),
  ARKIV_ACCESS_KEY: 'access-key',
  WORLD_APP_ID: 'app_recharge',
  WORLD_RP_ID: 'rp_recharge0test',
  WORLD_RP_SIGNING_KEY: k('b2'),
  RESELLER: 'esimaccess',
  ESIMACCESS_ACCESS_CODE: 'live-access-code',
  ESIMACCESS_WEBHOOK_TOKEN: 'a-long-webhook-token-value',
  INVENTORY_FILE: inventoryFile(),
  INVENTORY_SEAL_KEY: SEAL,
  HEDERA_ACCOUNT_ID: '0.0.6006',
  HEDERA_PRIVATE_KEY: k('c3'),
  HCS_TOPIC_ID: '0.0.4242',
  ENS_RPC_URL: 'https://eth.example.test/rpc',
  SWARM_BEE_URL: 'http://localhost:1633',
  SWARM_POSTAGE_BATCH: 'cd'.repeat(32),
  TREASURY_PRIVATE_KEY: k('d4'),
  TREASURY_HEDERA_ACCOUNT: '0.0.7007',
  TREASURY_HEDERA_PRIVATE_KEY: k('e5'),
  UNRELATED: '',
  ...over,
});

const fakeHedera = (): HederaClientLike => ({
  submitTopicMessage: vi.fn(),
  transferToken: vi.fn(),
  tokenBalance: vi.fn(),
});

describe('liveConfigSchema (L15)', () => {
  it('parses a full live env; secrets never serialise', () => {
    const config = parseLiveConfig(env());
    expect(config.chain).toEqual({
      id: 84532,
      network: 'eip155:84532',
      rpcUrl: 'https://sepolia.base.example/rpc',
      usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    });
    expect(config.ledger).toMatchObject({ chainId: 7794095, blockTimeMs: 2000 });
    expect(config.ledger.writer).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(config.payments).toMatchObject({
      facilitator: 'remote',
      networks: ['eip155:84532', 'hedera:testnet'],
      evmUrl: 'https://x402.org/facilitator',
    });
    const dump = JSON.stringify(config) + inspect(config, { depth: 10 });
    for (const secret of [
      'a1'.repeat(32),
      'b2'.repeat(32),
      'c3'.repeat(32),
      'd4'.repeat(32),
      'live-access-code',
      'a-long-webhook-token-value',
      SEAL.slice(2),
    ]) {
      expect(dump).not.toContain(secret);
    }
  });

  it('parse({}) fails naming every missing variable at once', () => {
    let message = '';
    try {
      parseLiveConfig({});
    } catch (e) {
      message = (e as Error).message;
    }
    for (const name of [
      'CHAIN',
      'RPC_URL',
      'WORLD_RP_ID',
      'HEDERA_ACCOUNT_ID',
      'HCS_TOPIC_ID',
      'ENS_RPC_URL',
      'TREASURY_PRIVATE_KEY',
    ]) {
      expect(message).toContain(name);
    }
  });

  it.each([
    [{ RESELLER: 'megaesim' }, 'A-28'],
    [{ ARKIV_CHAIN_ID: '60138453025' }, 'Kaolin'],
    [{ ARKIV_CHAIN_ID: '1' }, '7794095'],
    [{ X402_FACILITATOR: 'mock' }, 'T-85'],
    [{ X402_FACILITATOR_URL_EVM: 'https://evil.example/facilitator' }, 'allowed facilitator host'],
    [{ X402_NETWORKS: 'eip155:8453' }, 'T-52'],
    [{ X402_NETWORKS: '' + ',' }, 'at least one network'],
    [{ X402_FACILITATOR: 'self' }, 'RELAYER_PRIVATE_KEY'],
    [
      { X402_FACILITATOR: 'self', RELAYER_PRIVATE_KEY: k('f6'), X402_NETWORKS: 'eip155:31337' },
      'self-run facilitator serves eip155:84532',
    ],
    [{ ARKIV_PRIVATE_KEY: undefined }, 'ARKIV_WRITER_ADDRESS'],
    [{ ARKIV_WRITER_ADDRESS: '0x1234' }, 'not an address'],
    [{ ARKIV_WRITER_ADDRESS: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' }, 'does not match'],
    [{ ESIMACCESS_ACCESS_CODE: undefined }, 'ESIMACCESS_ACCESS_CODE'],
    [{ ESIMACCESS_WEBHOOK_TOKEN: undefined }, 'ESIMACCESS_WEBHOOK_TOKEN'],
    [{ INVENTORY_SEAL_KEY: undefined }, 'INVENTORY_SEAL_KEY'],
    [{ TREASURY_HEDERA_ACCOUNT: undefined }, 'A-31'],
    [{ SWARM_POSTAGE_BATCH: undefined }, 'go together'],
    [{ TREASURY_PRIVATE_KEY: anvilKeys[8] }, "Anvil's public keys"],
    [{ CHAIN: '1' }, 'USDC_ADDRESS'],
    [{ USDC_ADDRESS: 'nope' }, 'USDC_ADDRESS'],
  ])('refuses %j', (over, expected) => {
    expect(() => parseLiveConfig(env(over))).toThrow(expected);
    expect(liveConfigSchema.safeParse(env(over)).success).toBe(false);
  });

  it('accepts Anvil keys on chain 31337 with a USDC_ADDRESS override, a read-only writer, and tiramisu', () => {
    const config = parseLiveConfig(
      env({
        CHAIN: '31337',
        USDC_ADDRESS: '0x34A1D3fff3958843C43aD80F30b94c510645C316',
        X402_FACILITATOR: 'self',
        X402_NETWORKS: 'eip155:31337',
        RELAYER_PRIVATE_KEY: anvilKeys[6],
        TREASURY_PRIVATE_KEY: anvilKeys[8],
        ARKIV_PRIVATE_KEY: undefined,
        ARKIV_WRITER_ADDRESS: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
        ARKIV_CHAIN_ID: '7738577',
        TREASURY_HEDERA_ACCOUNT: undefined,
        TREASURY_HEDERA_PRIVATE_KEY: undefined,
        SWARM_BEE_URL: undefined,
        SWARM_POSTAGE_BATCH: undefined,
        RESELLER: 'inventory',
        RESELLER_FALLBACK: 'none',
      }),
    );
    expect(config.ledger.privateKey).toBeUndefined();
    expect(config.treasury.hedera).toBeUndefined();
    expect(config.reseller.primary).toBe('inventory');
  });
});

describe('createLiveAdapters', () => {
  it('builds a full bundle from a valid env without touching the network', () => {
    const fetch = vi.fn();
    const warn = vi.fn();
    const adapters = createLiveAdapters(parseLiveConfig(env()), {
      fetch,
      now: () => T0,
      logger: { info: vi.fn(), warn },
      hederaClient: fakeHedera,
    });
    expect(adapters.mode).toBe('live');
    for (const port of [
      'ledger',
      'personhood',
      'payments',
      'inference',
      'names',
      'reseller',
      'consensus',
      'blobs',
      'treasury',
    ] as const) {
      expect(adapters[port]).toBeDefined();
    }
    expect(adapters.reseller).toBeInstanceOf(FallbackReseller);
    expect((adapters.reseller as FallbackReseller).primary).toBeInstanceOf(EsimAccessReseller);
    expect(adapters.blobs).toBeInstanceOf(SwarmBlobStore);
    expect(adapters.rpContext).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('feePayer comes from the Hedera facilitator and is pinned; rp_context issues', async () => {
    const adapters = createLiveAdapters(parseLiveConfig(env()), {
      fetch: fixtureFetch('facilitator/x402org/supported.json'),
      now: () => T0,
      logger: { info: vi.fn(), warn: vi.fn() },
      hederaClient: fakeHedera,
    });
    await expect(adapters.feePayer('hedera:testnet')).resolves.toBe('0.0.9185802');
    await expect(adapters.feePayer('eip155:1')).rejects.toThrow(/no remote facilitator/);
    await expect(adapters.rpContext!.issue()).resolves.toMatchObject({
      rp_id: 'rp_recharge0test',
      created_at: T0 / 1000,
    });
  });

  it('self-run facilitator on Anvil, inventory-only reseller, memory blobs, no Hedera treasury', () => {
    const warn = vi.fn();
    const adapters = createLiveAdapters(
      parseLiveConfig(
        env({
          CHAIN: '31337',
          USDC_ADDRESS: '0x34A1D3fff3958843C43aD80F30b94c510645C316',
          X402_FACILITATOR: 'self',
          X402_NETWORKS: 'eip155:31337',
          RELAYER_PRIVATE_KEY: anvilKeys[6],
          TREASURY_PRIVATE_KEY: anvilKeys[8],
          TREASURY_HEDERA_ACCOUNT: undefined,
          TREASURY_HEDERA_PRIVATE_KEY: undefined,
          SWARM_BEE_URL: undefined,
          SWARM_POSTAGE_BATCH: undefined,
          RESELLER: 'mock',
          WORLD_RP_SIGNING_KEY: undefined,
        }),
      ),
      { logger: { info: vi.fn(), warn }, hederaClient: fakeHedera },
    );
    expect(adapters.rpContext).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/RESELLER=mock/));
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/SWARM_BEE_URL/));
    expect(typeof adapters.payments.verify).toBe('function');
    expect(SelfRunFacilitator).toBeDefined();
    expect(RemoteFacilitator).toBeDefined();
  });
});
