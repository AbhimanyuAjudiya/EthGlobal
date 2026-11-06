import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspect } from 'node:util';

import { describe, expect, it, vi } from 'vitest';

import type { PaymentPayload, PaymentRequirements } from '@ethglobal/protocol/schemas';

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
import {
  anvilKeys,
  loadFixture,
  T0,
  fixtureFetch,
  type Recording,
} from '../../src/testing/index.js';

import type { InventoryEntry } from '../../src/live/inventory-reseller.js';

const k = (b: string) => `0x${b.repeat(32)}`;
const SEAL = k('5e');
/** T-52: a mainnet network boots only with both flags. */
const SALES = { SALES_ENABLED: 'true', LEGAL_MEMO_OK: 'true' };

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

  it('facilitator host allow-list (A-30): api.blocky402.com is accepted, an unknown host refused', () => {
    expect(
      parseLiveConfig(env({ X402_FACILITATOR_URL_HEDERA: 'https://api.blocky402.com' })).payments
        .hederaUrl,
    ).toBe('https://api.blocky402.com');
    expect(() =>
      parseLiveConfig(
        env({ X402_FACILITATOR_URL_HEDERA: 'https://api.blocky402.com.evil.example' }),
      ),
    ).toThrow('allowed facilitator host');
  });

  it('Hedera network follows X402_NETWORKS: testnet by default, mainnet for hedera:mainnet, both → refused', () => {
    expect(parseLiveConfig(env()).hedera).toMatchObject({
      network: 'testnet',
      mirrorUrl: 'https://testnet.mirrornode.hedera.com',
    });
    const mainnet = parseLiveConfig(
      env({ ...SALES, CHAIN: '8453', X402_NETWORKS: 'eip155:8453,hedera:mainnet' }),
    );
    expect(mainnet.hedera).toMatchObject({
      network: 'mainnet',
      mirrorUrl: 'https://mainnet.mirrornode.hedera.com',
    });
    expect(mainnet.chain.usdc).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913');
    expect(
      parseLiveConfig(
        env({
          HEDERA_NETWORK: 'mainnet',
          X402_NETWORKS: 'eip155:84532',
          HEDERA_MIRROR_URL: 'https://mirror.example/',
        }),
      ).hedera,
    ).toMatchObject({ network: 'mainnet', mirrorUrl: 'https://mirror.example/' });
    for (const over of [
      { ...SALES, X402_NETWORKS: 'hedera:testnet,hedera:mainnet' },
      { HEDERA_NETWORK: 'mainnet' },
      { ...SALES, X402_NETWORKS: 'hedera:previewnet' },
    ]) {
      expect(() => parseLiveConfig(env(over))).toThrow('one Hedera network per deployment');
    }
  });

  it('USDC by chain id: 296 and 295 resolve the HTS long-zero alias; USDC_ADDRESS still overrides', () => {
    expect(parseLiveConfig(env({ CHAIN: '296' })).chain.usdc).toBe(
      '0x0000000000000000000000000000000000068cDa',
    );
    expect(
      parseLiveConfig(env({ ...SALES, CHAIN: '295', X402_NETWORKS: 'hedera:mainnet' })).chain.usdc,
    ).toBe('0x000000000000000000000000000000000006f89a');
    expect(
      parseLiveConfig(
        env({ CHAIN: '296', USDC_ADDRESS: '0x34A1D3fff3958843C43aD80F30b94c510645C316' }),
      ).chain.usdc,
    ).toBe('0x34A1D3fff3958843C43aD80F30b94c510645C316');
  });
});

describe('createLiveAdapters', () => {
  it('a pending Base settlement is confirmed on Base even when CHAIN selects Hedera EVM', async () => {
    const file = 'facilitator/x402org/settle-pending.json';
    const body = loadFixture<Recording>(file).exchanges.find((e) =>
      e.request.url.endsWith('/settle'),
    )!.request.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    const facilitator = fixtureFetch(file, { strictBody: true });
    const rpcUrls: string[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith('https://x402.org/')) return facilitator(input, init);
      rpcUrls.push(url);
      const rpc = JSON.parse(init?.body as string) as {
        id: number;
        method: string;
        params: string[];
      };
      expect(rpc.method).toBe('eth_getTransactionReceipt');
      return Response.json({
        jsonrpc: '2.0',
        id: rpc.id,
        result: {
          blockHash: `0x${'1'.repeat(64)}`,
          blockNumber: '0x1',
          transactionHash: rpc.params[0],
          transactionIndex: '0x0',
          status: '0x1',
          cumulativeGasUsed: '0x5208',
          gasUsed: '0x5208',
          effectiveGasPrice: '0x1',
          logs: [],
          logsBloom: `0x${'0'.repeat(512)}`,
          type: '0x2',
          from: body.paymentRequirements.payTo,
          to: body.paymentRequirements.asset,
          contractAddress: null,
        },
      });
    };
    const adapters = createLiveAdapters(
      parseLiveConfig(
        env({
          CHAIN: '296',
          RPC_URL: 'https://hedera-rpc.test',
          BASE_SEPOLIA_RPC_URL: 'https://base-rpc.test',
        }),
      ),
      {
        fetch: fetchFn,
        now: () => T0,
        hederaClient: fakeHedera,
        logger: { info: vi.fn(), warn: vi.fn() },
      },
    );
    await expect(
      adapters.payments.settle(body.paymentPayload, body.paymentRequirements),
    ).resolves.toMatchObject({
      success: true,
      network: 'eip155:84532',
    });
    expect(rpcUrls).toEqual(['https://base-rpc.test/']);
  });

  it('Base refunds use their own token and RPC when the application chain is Hedera EVM', async () => {
    const seen: { url: string; method: string; params: unknown[] }[] = [];
    const fetchFn: typeof fetch = async (input, init) => {
      const request = JSON.parse(init?.body as string) as {
        id: number;
        method: string;
        params: unknown[];
      };
      seen.push({
        url: typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
        method: request.method,
        params: request.params,
      });
      return Response.json({ jsonrpc: '2.0', id: request.id, result: `0x${'0'.repeat(63)}7` });
    };
    const adapters = createLiveAdapters(
      parseLiveConfig(
        env({
          CHAIN: '296',
          RPC_URL: 'https://hedera-rpc.test',
          BASE_SEPOLIA_RPC_URL: 'https://base-rpc.test',
        }),
      ),
      { fetch: fetchFn, hederaClient: fakeHedera, logger: { info: vi.fn(), warn: vi.fn() } },
    );
    await expect(adapters.treasury.balanceUsd6('eip155:84532')).resolves.toBe(7n);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ url: 'https://base-rpc.test/', method: 'eth_call' });
    expect(seen[0]?.params[0]).toMatchObject({ to: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' });
  });

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

  it('the Hedera treasury is keyed to the configured network: hedera:mainnet refunds USDC 0.0.456858', async () => {
    const tokenBalance = vi.fn(async () => 7n);
    const client: HederaClientLike = { ...fakeHedera(), tokenBalance };
    const adapters = createLiveAdapters(
      parseLiveConfig(
        env({ ...SALES, CHAIN: '8453', X402_NETWORKS: 'eip155:8453,hedera:mainnet' }),
      ),
      { logger: { info: vi.fn(), warn: vi.fn() }, hederaClient: () => client },
    );
    await expect(adapters.treasury.balanceUsd6('hedera:mainnet')).resolves.toBe(7n);
    expect(tokenBalance).toHaveBeenCalledWith('0.0.456858');
    await expect(adapters.treasury.balanceUsd6('hedera:testnet')).rejects.toMatchObject({
      code: 'unsupported_network',
    });
  });
});
