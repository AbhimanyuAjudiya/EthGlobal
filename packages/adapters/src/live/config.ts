/**
 * liveConfigSchema (INTERFACES §3.3, §11): zod over process.env for MODE=live. Every missing or unsafe variable is
 * reported at construction, all at once — not at 02:00 on stage (L15). Empty strings count as unset. Secrets come
 * out wrapped in Secret (never serialised). Refusals: RESELLER=megaesim (A-28), Kaolin (A-23), X402_FACILITATOR=mock
 * (T-85), a facilitator host outside the allow-list (T-42, A-30), Anvil's public keys outside chain 31337.
 */
import { getAddress, isAddress, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { base, baseSepolia } from 'viem/chains';
import { z } from 'zod';

import { NETWORKS, TESTNET_NETWORKS, usdcAssetFor } from '@ethglobal/protocol/ids';

import { KAOLIN_CHAIN_ID, RABDI_CHAIN_ID, TIRAMISU_CHAIN_ID } from './arkiv-sdk.js';
import { ESIMACCESS_BASE_URL, ESIMACCESS_WEBHOOK_IPS } from './esimaccess-reseller.js';
import { HEDERA_MIRROR } from './hcs-log.js';
import { DEFAULT_FACILITATOR_URL, FACILITATOR_HOSTS } from './remote-facilitator.js';
import { Secret } from './secret.js';
import { WORLD_VERIFY_BASE_URL } from './world-personhood.js';
import { anvilKeys } from '../testing/anvil.js';

import type { HederaSdkOptions } from './hedera-sdk.js';

const ANVIL_KEYS: ReadonlySet<string> = new Set(anvilKeys.map((k) => k.toLowerCase()));
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/, '32-byte 0x-hex');
const url = z.url();
const hederaId = z.string().regex(/^0\.0\.\d{1,12}$/, 'Hedera id 0.0.x');
const list = (s: string): string[] =>
  s
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
const opt = <T extends z.ZodType>(t: T) => t.optional();

const envShape = z.object({
  CHAIN: z.coerce.number().int().positive(),
  RPC_URL: url,
  BASE_SEPOLIA_RPC_URL: opt(url),
  BASE_MAINNET_RPC_URL: opt(url),
  /** Optional USDC override for the self-run facilitator / treasury (Anvil: MockUSDC3009); Base and Hedera are known. */
  USDC_ADDRESS: opt(z.string()),
  // x402
  X402_FACILITATOR: z.enum(['self', 'remote', 'mock']).default('remote'),
  X402_FACILITATOR_URL_EVM: url.default(DEFAULT_FACILITATOR_URL),
  X402_FACILITATOR_URL_HEDERA: url.default(DEFAULT_FACILITATOR_URL),
  X402_NETWORKS: z.string().default(NETWORKS.baseSepolia),
  X402_HEDERA_FEE_PAYER: opt(hederaId),
  RELAYER_PRIVATE_KEY: opt(hex32),
  SALES_ENABLED: z.enum(['true', 'false']).default('false'),
  LEGAL_MEMO_OK: z.enum(['true', 'false']).default('false'),
  // ledger
  ARKIV_CHAIN_ID: z.coerce.number().int().positive().default(RABDI_CHAIN_ID),
  ARKIV_RPC_URL: url.default('https://rpc.rabdi.db-chain.testnet.arkiv.network'),
  ARKIV_ACCESS_KEY: z.string().max(200).default(''),
  ARKIV_PRIVATE_KEY: opt(hex32),
  ARKIV_WRITER_ADDRESS: opt(z.string()),
  ARKIV_BLOCK_TIME_MS: z.coerce.number().int().positive().default(2000),
  // world
  WORLD_APP_ID: z.string().max(80).default(''),
  WORLD_RP_ID: z.string().regex(/^(rp|app)_[A-Za-z0-9]{1,64}$/, 'rp_…'),
  WORLD_RP_SIGNING_KEY: opt(hex32),
  WORLD_ACTION: z.string().min(1).max(64).default('recharge-welcome'),
  WORLD_ENVIRONMENT: z.enum(['production', 'staging']).default('production'),
  WORLD_VERIFY_BASE_URL: url.default(WORLD_VERIFY_BASE_URL),
  // reseller
  RESELLER: z.enum(['mock', 'esimaccess', 'megaesim', 'inventory']).default('esimaccess'),
  RESELLER_FALLBACK: z.enum(['inventory', 'none']).default('inventory'),
  ESIMACCESS_ACCESS_CODE: opt(z.string().min(1)),
  ESIMACCESS_SIGNING_KEY: opt(z.string().min(1)),
  ESIMACCESS_WEBHOOK_TOKEN: opt(z.string().min(16, 'at least 16 characters')),
  ESIMACCESS_BASE_URL: url.default(ESIMACCESS_BASE_URL),
  ESIMACCESS_WEBHOOK_IPS: z.string().default(ESIMACCESS_WEBHOOK_IPS.join(',')),
  INVENTORY_FILE: z.string().default('fixtures/inventory.enc'),
  INVENTORY_SEAL_KEY: opt(hex32),
  // hedera / hcs
  HEDERA_ACCOUNT_ID: hederaId,
  HEDERA_PRIVATE_KEY: z
    .string()
    .regex(/^(0x)?[0-9a-fA-F]{64}$|^30[0-9a-fA-F]{60,}$/, 'ECDSA private key hex'),
  HCS_TOPIC_ID: hederaId,
  /** testnet | mainnet; default: the hedera:* network in X402_NETWORKS, else testnet. Must agree with what is sold. */
  HEDERA_NETWORK: opt(z.enum(['testnet', 'mainnet'])),
  /** Default: the mirror node of HEDERA_NETWORK. */
  HEDERA_MIRROR_URL: opt(url),
  // ens / swarm / treasury
  ENS_RPC_URL: url,
  ENS_FALLBACK_RPC_URL: opt(url),
  SWARM_BEE_URL: opt(url),
  SWARM_POSTAGE_BATCH: opt(z.string().regex(/^[0-9a-fA-F]{64}$/, '64 hex')),
  TREASURY_PRIVATE_KEY: hex32,
  TREASURY_HEDERA_ACCOUNT: opt(hederaId),
  TREASURY_HEDERA_PRIVATE_KEY: opt(z.string().min(64)),
});

type Env = z.infer<typeof envShape>;

/** The structured configuration createLiveAdapters consumes. */
export interface LiveConfig {
  chain: { id: number; network: string; rpcUrl: string; usdc: Address | undefined };
  payments: {
    facilitator: 'self' | 'remote';
    networks: string[];
    evmUrl: string;
    hederaUrl: string;
    hederaFeePayer: string | undefined;
    relayerKey: Secret<Hex> | undefined;
    /** One RPC and settlement asset for each advertised EVM payment network. */
    evmNetworks: { id: number; network: string; rpcUrl: string; usdc: Address }[];
  };
  ledger: {
    chainId: number;
    rpcUrl: string;
    accessKey: string;
    privateKey: Secret<Hex> | undefined;
    writer: Address;
    blockTimeMs: number;
  };
  world: {
    appId: string;
    rpId: string;
    action: string;
    environment: 'production' | 'staging';
    baseUrl: string;
    signingKey: Secret<Hex> | undefined;
  };
  reseller: {
    primary: 'mock' | 'esimaccess' | 'inventory';
    fallback: 'inventory' | 'none';
    esimaccess:
      | {
          accessCode: Secret;
          signingKey: Secret | undefined;
          webhookToken: Secret;
          baseUrl: string;
          webhookIps: string[];
        }
      | undefined;
    inventory: { file: string; sealKey: Secret<Hex> } | undefined;
  };
  hedera: {
    accountId: string;
    privateKey: Secret;
    topicId: string;
    network: HederaSdkOptions['network'];
    mirrorUrl: string;
  };
  ens: { rpcUrl: string; fallbackRpcUrl: string | undefined };
  swarm: { beeUrl: string; postageBatchId: string } | undefined;
  treasury: { evmKey: Secret<Hex>; hedera: { accountId: string; privateKey: Secret } | undefined };
}

function refine(env: Env, ctx: z.RefinementCtx): void {
  const issue = (path: keyof Env, message: string) =>
    ctx.addIssue({ code: 'custom', path: [path], message });
  const networks = list(env.X402_NETWORKS);
  if (networks.length === 0) issue('X402_NETWORKS', 'at least one network');
  const sales = env.SALES_ENABLED === 'true' && env.LEGAL_MEMO_OK === 'true';
  for (const n of networks) {
    if (!sales && !TESTNET_NETWORKS.includes(n))
      issue('X402_NETWORKS', `${n} is not a testnet network (T-52)`);
  }
  if (env.X402_FACILITATOR === 'mock') issue('X402_FACILITATOR', 'mock is refused in live (T-85)');
  for (const key of ['X402_FACILITATOR_URL_EVM', 'X402_FACILITATOR_URL_HEDERA'] as const) {
    const host = new URL(env[key]).hostname;
    if (!(FACILITATOR_HOSTS as readonly string[]).includes(host))
      issue(key, `${host} is not an allowed facilitator host (A-30)`);
  }
  const evm = networks.filter((n) => n.startsWith('eip155:'));
  for (const network of evm) {
    if (!paymentChain(env, network))
      issue('X402_NETWORKS', `no RPC and USDC configuration for ${network}`);
  }
  if (env.X402_FACILITATOR === 'self') {
    if (!env.RELAYER_PRIVATE_KEY)
      issue('RELAYER_PRIVATE_KEY', 'required with X402_FACILITATOR=self');
    for (const n of evm)
      if (n !== `eip155:${env.CHAIN}`)
        issue('X402_NETWORKS', `self-run facilitator serves eip155:${env.CHAIN} only, not ${n}`);
  }
  if (!usdcFor(env)) issue('USDC_ADDRESS', `no USDC address known for eip155:${env.CHAIN}`);
  if (!hederaNetworkOf(env))
    issue(
      'X402_NETWORKS',
      'one Hedera network per deployment: hedera:testnet or hedera:mainnet (HEDERA_NETWORK, when set, must agree)',
    );
  if (env.ARKIV_CHAIN_ID === KAOLIN_CHAIN_ID)
    issue('ARKIV_CHAIN_ID', 'Kaolin (60138453025) is retired (A-23): use rabdi 7794095');
  else if (env.ARKIV_CHAIN_ID !== RABDI_CHAIN_ID && env.ARKIV_CHAIN_ID !== TIRAMISU_CHAIN_ID) {
    issue('ARKIV_CHAIN_ID', 'must be 7794095 (rabdi) or 7738577 (tiramisu)');
  }
  if (!env.ARKIV_PRIVATE_KEY && !env.ARKIV_WRITER_ADDRESS)
    issue('ARKIV_PRIVATE_KEY', 'ARKIV_PRIVATE_KEY or ARKIV_WRITER_ADDRESS is required (T-79)');
  if (env.ARKIV_WRITER_ADDRESS && !isAddress(env.ARKIV_WRITER_ADDRESS, { strict: false }))
    issue('ARKIV_WRITER_ADDRESS', 'not an address');
  if (
    env.ARKIV_PRIVATE_KEY &&
    env.ARKIV_WRITER_ADDRESS &&
    isAddress(env.ARKIV_WRITER_ADDRESS, { strict: false })
  ) {
    if (
      privateKeyToAccount(env.ARKIV_PRIVATE_KEY as Hex).address !==
      getAddress(env.ARKIV_WRITER_ADDRESS)
    ) {
      issue('ARKIV_WRITER_ADDRESS', 'does not match ARKIV_PRIVATE_KEY');
    }
  }
  if (env.RESELLER === 'megaesim')
    issue('RESELLER', 'MegaeSIM has no public API (A-28): use esimaccess');
  if (env.RESELLER === 'esimaccess') {
    if (!env.ESIMACCESS_ACCESS_CODE)
      issue('ESIMACCESS_ACCESS_CODE', 'required with RESELLER=esimaccess');
    if (!env.ESIMACCESS_WEBHOOK_TOKEN)
      issue('ESIMACCESS_WEBHOOK_TOKEN', 'required with RESELLER=esimaccess');
  }
  if (
    (env.RESELLER === 'inventory' || env.RESELLER_FALLBACK === 'inventory') &&
    !env.INVENTORY_SEAL_KEY
  ) {
    issue('INVENTORY_SEAL_KEY', 'required for the inventory reseller');
  }
  if (
    networks.some((n) => n.startsWith('hedera:')) &&
    !(env.TREASURY_HEDERA_ACCOUNT && env.TREASURY_HEDERA_PRIVATE_KEY)
  ) {
    issue(
      'TREASURY_HEDERA_ACCOUNT',
      'a separate Hedera refund account is required when hedera:* is sold (A-31)',
    );
  }
  if (Boolean(env.SWARM_BEE_URL) !== Boolean(env.SWARM_POSTAGE_BATCH))
    issue('SWARM_POSTAGE_BATCH', 'SWARM_BEE_URL and SWARM_POSTAGE_BATCH go together');
  if (env.CHAIN !== 31337) {
    for (const key of [
      'RELAYER_PRIVATE_KEY',
      'ARKIV_PRIVATE_KEY',
      'TREASURY_PRIVATE_KEY',
      'WORLD_RP_SIGNING_KEY',
    ] as const) {
      const value = env[key];
      if (value && ANVIL_KEYS.has(value.toLowerCase()))
        issue(key, "is one of Anvil's public keys (never outside chain 31337)");
    }
  }
}

/** USDC on the Hedera EVM: the HTS token's long-zero alias (296 testnet 0.0.429274, 295 mainnet 0.0.456858). */
const HEDERA_EVM_USDC: Readonly<Record<number, string>> = {
  296: '0x0000000000000000000000000000000000068cDa',
  295: '0x000000000000000000000000000000000006f89a',
};

function usdcFor(env: Env): Address | undefined {
  if (env.USDC_ADDRESS)
    return isAddress(env.USDC_ADDRESS, { strict: false })
      ? getAddress(env.USDC_ADDRESS)
      : undefined;
  const known = usdcAssetFor(`eip155:${env.CHAIN}`) ?? HEDERA_EVM_USDC[env.CHAIN];
  return known ? getAddress(known) : undefined;
}

function paymentChain(
  env: Env,
  network: string,
): LiveConfig['payments']['evmNetworks'][number] | undefined {
  if (network === `eip155:${env.CHAIN}`) {
    const usdc = usdcFor(env);
    return usdc ? { id: env.CHAIN, network, rpcUrl: env.RPC_URL, usdc } : undefined;
  }
  const known =
    network === 'eip155:84532' ? baseSepolia : network === 'eip155:8453' ? base : undefined;
  const asset = usdcAssetFor(network);
  if (!known || !asset) return undefined;
  return {
    id: known.id,
    network,
    rpcUrl:
      (known.id === baseSepolia.id ? env.BASE_SEPOLIA_RPC_URL : env.BASE_MAINNET_RPC_URL) ??
      known.rpcUrls.default.http[0],
    usdc: getAddress(asset),
  };
}

/** The one Hedera network this deployment runs on; undefined when X402_NETWORKS and HEDERA_NETWORK disagree. */
function hederaNetworkOf(env: Env): HederaSdkOptions['network'] | undefined {
  const wanted = new Set<string>(
    list(env.X402_NETWORKS)
      .filter((n) => n.startsWith('hedera:'))
      .map((n) => n.slice('hedera:'.length)),
  );
  if (env.HEDERA_NETWORK) wanted.add(env.HEDERA_NETWORK);
  if (wanted.size === 0) return 'testnet';
  const [only] = wanted;
  return wanted.size === 1 && (only === 'testnet' || only === 'mainnet') ? only : undefined;
}

const secret = <T extends string>(value: T | undefined): Secret<T> | undefined =>
  value ? new Secret(value) : undefined;

function toConfig(env: Env): LiveConfig {
  const networks = list(env.X402_NETWORKS);
  const hederaNetwork = hederaNetworkOf(env) ?? 'testnet'; // refine() already refused a disagreement
  const writer = env.ARKIV_WRITER_ADDRESS
    ? getAddress(env.ARKIV_WRITER_ADDRESS)
    : privateKeyToAccount(env.ARKIV_PRIVATE_KEY as Hex).address;
  return {
    chain: {
      id: env.CHAIN,
      network: `eip155:${env.CHAIN}`,
      rpcUrl: env.RPC_URL,
      usdc: usdcFor(env),
    },
    payments: {
      facilitator: env.X402_FACILITATOR as 'self' | 'remote',
      networks,
      evmUrl: env.X402_FACILITATOR_URL_EVM,
      hederaUrl: env.X402_FACILITATOR_URL_HEDERA,
      hederaFeePayer: env.X402_HEDERA_FEE_PAYER,
      relayerKey: secret(env.RELAYER_PRIVATE_KEY as Hex | undefined),
      evmNetworks: networks
        .filter((n) => n.startsWith('eip155:'))
        .map((n) => paymentChain(env, n)!),
    },
    ledger: {
      chainId: env.ARKIV_CHAIN_ID,
      rpcUrl: env.ARKIV_RPC_URL,
      accessKey: env.ARKIV_ACCESS_KEY,
      privateKey: secret(env.ARKIV_PRIVATE_KEY as Hex | undefined),
      writer,
      blockTimeMs: env.ARKIV_BLOCK_TIME_MS,
    },
    world: {
      appId: env.WORLD_APP_ID,
      rpId: env.WORLD_RP_ID,
      action: env.WORLD_ACTION,
      environment: env.WORLD_ENVIRONMENT,
      baseUrl: env.WORLD_VERIFY_BASE_URL,
      signingKey: secret(env.WORLD_RP_SIGNING_KEY as Hex | undefined),
    },
    reseller: {
      primary: env.RESELLER as 'mock' | 'esimaccess' | 'inventory',
      fallback: env.RESELLER_FALLBACK,
      esimaccess: env.ESIMACCESS_ACCESS_CODE
        ? {
            accessCode: new Secret(env.ESIMACCESS_ACCESS_CODE),
            signingKey: secret(env.ESIMACCESS_SIGNING_KEY),
            webhookToken: new Secret(env.ESIMACCESS_WEBHOOK_TOKEN ?? ''),
            baseUrl: env.ESIMACCESS_BASE_URL,
            webhookIps: list(env.ESIMACCESS_WEBHOOK_IPS),
          }
        : undefined,
      inventory: env.INVENTORY_SEAL_KEY
        ? { file: env.INVENTORY_FILE, sealKey: new Secret(env.INVENTORY_SEAL_KEY as Hex) }
        : undefined,
    },
    hedera: {
      accountId: env.HEDERA_ACCOUNT_ID,
      privateKey: new Secret(env.HEDERA_PRIVATE_KEY),
      topicId: env.HCS_TOPIC_ID,
      network: hederaNetwork,
      mirrorUrl: env.HEDERA_MIRROR_URL ?? HEDERA_MIRROR[hederaNetwork],
    },
    ens: { rpcUrl: env.ENS_RPC_URL, fallbackRpcUrl: env.ENS_FALLBACK_RPC_URL },
    swarm:
      env.SWARM_BEE_URL && env.SWARM_POSTAGE_BATCH
        ? { beeUrl: env.SWARM_BEE_URL, postageBatchId: env.SWARM_POSTAGE_BATCH }
        : undefined,
    treasury: {
      evmKey: new Secret(env.TREASURY_PRIVATE_KEY as Hex),
      hedera:
        env.TREASURY_HEDERA_ACCOUNT && env.TREASURY_HEDERA_PRIVATE_KEY
          ? {
              accountId: env.TREASURY_HEDERA_ACCOUNT,
              privateKey: new Secret(env.TREASURY_HEDERA_PRIVATE_KEY),
            }
          : undefined,
    },
  };
}

/** Empty strings (as left by .env templates) count as unset. */
const dropEmpty = (raw: unknown): unknown =>
  raw && typeof raw === 'object'
    ? Object.fromEntries(
        Object.entries(raw as Record<string, unknown>).filter(
          ([, v]) => v !== undefined && v !== '',
        ),
      )
    : raw;

export const liveConfigSchema: z.ZodType<LiveConfig, Record<string, string | undefined>> = z
  .preprocess(dropEmpty, envShape.superRefine(refine))
  .transform(toConfig) as unknown as z.ZodType<LiveConfig, Record<string, string | undefined>>;

/** Parses the environment or throws one Error naming every problem (never echoing a value). */
export function parseLiveConfig(
  source: Record<string, string | undefined> = process.env,
): LiveConfig {
  const result = liveConfigSchema.safeParse(source);
  if (!result.success) {
    const lines = result.error.issues.map((i) => `  ${i.path.join('.') || '(env)'}: ${i.message}`);
    throw new Error(`Invalid live configuration:\n${[...new Set(lines)].join('\n')}`);
  }
  return result.data;
}
