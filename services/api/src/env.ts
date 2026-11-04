import { bytesToHex } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';

import { anvilAccounts } from '@ethglobal/adapters';
import { RABDI_CHAIN_ID, TIRAMISU_CHAIN_ID } from '@ethglobal/adapters/live';
import { TESTNET_NETWORKS, WORLD_ACTION, isEvmNetwork } from '@ethglobal/protocol/ids';
import {
  caipNetworkSchema,
  digitsSchema,
  evmAddressSchema,
  hederaAccountSchema,
} from '@ethglobal/protocol/schemas';

export const logLevels = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;

/** The Arkiv DB-chains a live deployment may write to (A-23): rabdi (default) and tiramisu. */
export const ARKIV_CHAINS: readonly number[] = [RABDI_CHAIN_ID, TIRAMISU_CHAIN_ID];

const hexKey = z.string().regex(/^0x[0-9a-fA-F]{64}$/, '32-byte hex');
const flag = z
  .enum(['0', '1', 'true', 'false'])
  .default('false')
  .transform((v) => v === '1' || v === 'true');
const splitCsv = (v: string): string[] =>
  v
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
const csv = (fallback: string) => z.string().default(fallback).transform(splitCsv);
const csvOptional = z.string().transform(splitCsv).optional();

/**
 * Local-mode defaults are the public Anvil roles and fixed test secrets (INTERFACES §11, `anvilRoles`); live mode
 * must supply every key and is refused if it supplies a public one (T-52).
 */
/** Anvil's public development mnemonic; its keys are derived, never written down (T-52). */
const ANVIL_MNEMONIC = [
  'test',
  'test',
  'test',
  'test',
  'test',
  'test',
  'test',
  'test',
  'test',
  'test',
  'test',
  'junk',
].join(' ');
export const anvilKey = (index: number): string => {
  const key = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).getHdKey().privateKey;
  if (!key) throw new Error('anvil key derivation failed');
  return bytesToHex(key);
};

const LOCAL_SECRETS = {
  OCTROI_SECRET: `0x${'07'.repeat(32)}`,
  SERVER_SEAL_KEY: `0x${'05'.repeat(32)}`,
  // fixtures/world/rp-context-vector.json: a public test key, never a real WORLD_RP_SIGNING_KEY
  WORLD_RP_SIGNING_KEY: `0x${'11'.repeat(32)}`,
  WORLD_RP_ID: 'rp_local',
  WORLD_APP_ID: 'app_local',
} as const;

/** The public Anvil account the local agent pays from (anvilRoles.agent, #4). */
const LOCAL_AGENT_PAYER = anvilAccounts[4];
const LOCAL_CORS = ['http://127.0.0.1:3000', 'http://localhost:3000'];
const LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|\[::1\])(:\d+)?$/i;

/** anvilRoles: attestor #2, relayer #6, treasury #8, payout #1 (INTERFACES §3.4, A-31). */
function localDefaults() {
  return {
    ...LOCAL_SECRETS,
    CHAIN: 31337,
    CORS_ORIGINS: LOCAL_CORS,
    AGENT_PAYERS: [LOCAL_AGENT_PAYER],
    ATTESTOR_PRIVATE_KEY: anvilKey(2),
    RELAYER_PRIVATE_KEY: anvilKey(6),
    TREASURY_PRIVATE_KEY: anvilKey(8),
    PAYOUT_ADDRESS: anvilAccounts[1],
  };
}

const anvilAddresses = new Set(anvilAccounts.map((a) => a.toLowerCase()));
/** A key is public when it is one of our local secrets or controls an Anvil account. */
function isPublicKey(value: string): boolean {
  if (Object.values(LOCAL_SECRETS).some((s) => s.toLowerCase() === value.toLowerCase()))
    return true;
  try {
    return anvilAddresses.has(privateKeyToAccount(value as `0x${string}`).address.toLowerCase());
  } catch {
    return false;
  }
}

export const envSchema = z
  .object({
    /** local = Anvil + mock adapters, no network; live = real RPC and sponsor APIs. */
    MODE: z.enum(['local', 'live']).default('local'),
    PORT: z.coerce.number().int().min(1).max(65535).default(8787),
    LOG_LEVEL: z.enum(logLevels).default('info'),
    /** Chain id of DataDrop; local mode is always Anvil (31337); live must name it (RT-A-09). */
    CHAIN: z.coerce.number().int().positive().optional(),
    RPC_URL: z.url().optional(),
    ANVIL_RPC_URL: z.url().default('http://127.0.0.1:8545'),
    DATADROP_ADDRESS: evmAddressSchema.optional(),
    /** MockUSDC3009 on Anvil (else deploy/addresses.anvil.json). */
    USDC_ADDRESS: evmAddressSchema.optional(),
    CHAIN_CONFIRMATIONS: z.coerce.number().int().min(1).max(64).default(1),
    CLAIM_GAS_LIMIT: z.coerce.number().int().min(50_000).max(2_000_000).default(150_000),

    OCTROI_SECRET: hexKey.optional(),
    SERVER_SEAL_KEY: hexKey.optional(),
    ATTESTOR_PRIVATE_KEY: hexKey.optional(),
    RELAYER_PRIVATE_KEY: hexKey.optional(),
    TREASURY_PRIVATE_KEY: hexKey.optional(),
    ARKIV_PRIVATE_KEY: hexKey.optional(),
    ARKIV_CHAIN_ID: z.coerce.number().int().positive().default(7_794_095),
    PAYOUT_ADDRESS: evmAddressSchema.optional(),
    PAYOUT_HEDERA_ACCOUNT: hederaAccountSchema.optional(),
    X402_HEDERA_FEE_PAYER: hederaAccountSchema.optional(),
    TREASURY_MAX_USD6_PER_DAY: digitsSchema.default('50000000').transform(BigInt),
    GIFT_RECLAIM_FEE_USD6: digitsSchema.default('0').transform(BigInt),

    /** mock | self | remote; unset ⇒ self when ANVIL_RPC_URL answers, else mock (local only). */
    X402_FACILITATOR: z.enum(['mock', 'self', 'remote']).optional(),
    X402_NETWORKS: csv('eip155:31337').pipe(z.array(caipNetworkSchema).min(1).max(8)),
    PRICE_USD6_PER_STEP: digitsSchema.default('400000').transform(BigInt),
    VALIDITY_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    TOPUPS_PER_ICCID_PER_DAY: z.coerce.number().int().min(1).max(1000).default(20),
    SALES_ENABLED: flag,
    LEGAL_MEMO_OK: flag,
    TRUST_PROXY: flag,
    /** Exact browser origins; local default the PWA dev server, live default none (fail closed, RT-A-09). */
    CORS_ORIGINS: csvOptional,
    /** The campaign /plans advertises (default: the first live campaign in the ledger). */
    CAMPAIGN_ID: z
      .string()
      .regex(/^0x[0-9a-fA-F]{64}$/)
      .optional(),
    /** Payers whose X-Agent-Uaid header is recorded on receipts (T-77); local: Anvil #4; live default none. */
    AGENT_PAYERS: csvOptional,
    /** Sealed durable process state (state.ts, RT-A-11); required in live, memory-only when unset locally. */
    STATE_FILE: z.string().min(1).max(512).optional(),

    RESELLER: z.enum(['mock', 'esimaccess', 'megaesim', 'inventory']).default('mock'),
    /** Reseller plan for paid and gift bundles. */
    RESELLER_PLAN_ID: z.string().min(1).max(64).default('in-1gb-7d'),
    ESIMACCESS_WEBHOOK_TOKEN: z.string().min(16).optional(),
    MOCK_RESELLER_WEBHOOK_SECRET: z.string().min(16).optional(),

    WORLD_APP_ID: z.string().max(80).optional(),
    WORLD_RP_ID: z
      .string()
      .regex(/^(rp|app)_[A-Za-z0-9]{1,64}$/)
      .optional(),
    WORLD_RP_SIGNING_KEY: hexKey.optional(),
    WORLD_ACTION: z.string().min(1).max(64).default(WORLD_ACTION),
    WORLD_ENVIRONMENT: z.enum(['production', 'staging']).default('production'),

    /** One topic per deployment (INTERFACES §9); local: a mock topic id. */
    HCS_TOPIC_ID: hederaAccountSchema.default('0.0.1001'),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    const salesOk = env.SALES_ENABLED && env.LEGAL_MEMO_OK;
    for (const network of env.X402_NETWORKS) {
      if (!TESTNET_NETWORKS.includes(network) && !salesOk) {
        fail(
          'X402_NETWORKS',
          `${network} is not a testnet; needs SALES_ENABLED=true and LEGAL_MEMO_OK=true (T-52)`,
        );
      }
    }
    if (env.MODE !== 'live') return;
    if (env.RPC_URL === undefined) fail('RPC_URL', 'RPC_URL is required when MODE=live');
    // RT-A-09: nothing local is inherited — the Anvil domain, a localhost origin, a public agent payer
    if (env.CHAIN === undefined) fail('CHAIN', 'CHAIN is required when MODE=live');
    else if (env.CHAIN === 31337) fail('CHAIN', 'CHAIN=31337 is the Anvil domain; refused in live');
    for (const origin of env.CORS_ORIGINS ?? []) {
      if (LOCALHOST_ORIGIN.test(origin))
        fail('CORS_ORIGINS', `${origin} is a local origin; refused in live (RT-A-09)`);
    }
    for (const payer of env.AGENT_PAYERS ?? []) {
      if (anvilAddresses.has(payer.toLowerCase()))
        fail('AGENT_PAYERS', `${payer} is a public Anvil account; refused in live (T-77)`);
    }
    if (env.STATE_FILE === undefined)
      fail('STATE_FILE', 'STATE_FILE is required when MODE=live (RT-A-11)');
    for (const name of [
      'OCTROI_SECRET',
      'SERVER_SEAL_KEY',
      'ATTESTOR_PRIVATE_KEY',
      'RELAYER_PRIVATE_KEY',
      'TREASURY_PRIVATE_KEY',
      'ARKIV_PRIVATE_KEY',
      'WORLD_RP_SIGNING_KEY',
    ] as const) {
      const value = env[name];
      if (value === undefined) fail(name, `${name} is required when MODE=live`);
      else if (isPublicKey(value))
        fail(name, `${name} is a public Anvil/test key; refused in live (T-52)`);
    }
    if (env.PAYOUT_ADDRESS === undefined)
      fail('PAYOUT_ADDRESS', 'PAYOUT_ADDRESS is required when MODE=live');
    if (env.WORLD_RP_ID === undefined)
      fail('WORLD_RP_ID', 'WORLD_RP_ID is required when MODE=live (A-25)');
    if (env.WORLD_APP_ID === undefined)
      fail('WORLD_APP_ID', 'WORLD_APP_ID is required when MODE=live (A-25)');
    if (env.WORLD_ENVIRONMENT !== 'production')
      fail('WORLD_ENVIRONMENT', 'WORLD_ENVIRONMENT must be production in live (T-80)');
    if (env.LOG_LEVEL === 'debug' || env.LOG_LEVEL === 'trace')
      fail('LOG_LEVEL', `LOG_LEVEL=${env.LOG_LEVEL} is refused in live (T-50)`);
    if (!ARKIV_CHAINS.includes(env.ARKIV_CHAIN_ID)) {
      fail(
        'ARKIV_CHAIN_ID',
        `ARKIV_CHAIN_ID=${env.ARKIV_CHAIN_ID} is not rabdi 7794095 or tiramisu 7738577 (A-23)`,
      );
    }
    if (env.RESELLER === 'megaesim')
      fail('RESELLER', 'RESELLER=megaesim is a fixture-only stub; refused in live (A-28)');
    if (env.X402_FACILITATOR === 'mock')
      fail('X402_FACILITATOR', 'X402_FACILITATOR=mock is refused in live (T-85)');
    if (env.RESELLER === 'esimaccess' && env.ESIMACCESS_WEBHOOK_TOKEN === undefined) {
      fail(
        'ESIMACCESS_WEBHOOK_TOKEN',
        'ESIMACCESS_WEBHOOK_TOKEN is required with RESELLER=esimaccess (A-27)',
      );
    }
  });

type Parsed = z.infer<typeof envSchema>;

/** The validated environment with local defaults filled in (every key present in local mode). */
export type Env = Omit<
  Parsed,
  | keyof typeof LOCAL_SECRETS
  | 'ATTESTOR_PRIVATE_KEY'
  | 'RELAYER_PRIVATE_KEY'
  | 'TREASURY_PRIVATE_KEY'
  | 'PAYOUT_ADDRESS'
  | 'CHAIN'
  | 'CORS_ORIGINS'
  | 'AGENT_PAYERS'
> & {
  CHAIN: number;
  CORS_ORIGINS: string[];
  AGENT_PAYERS: string[];
  OCTROI_SECRET: string;
  SERVER_SEAL_KEY: string;
  ATTESTOR_PRIVATE_KEY: string;
  RELAYER_PRIVATE_KEY: string;
  TREASURY_PRIVATE_KEY: string;
  PAYOUT_ADDRESS: string;
  WORLD_RP_SIGNING_KEY: string;
  WORLD_RP_ID: string;
  WORLD_APP_ID: string;
};

/** Parses and validates the environment. Empty strings (as left by .env templates) count as unset. */
export function parseEnv(source: Record<string, string | undefined> = process.env): Env {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value !== ''),
  );
  const result = envSchema.safeParse(present);
  if (!result.success) {
    throw new Error(`Invalid environment:\n${z.prettifyError(result.error)}`);
  }
  const seeds = Object.keys(present).filter((key) => /^SEED_/i.test(key));
  if (result.data.MODE === 'live' && seeds.length > 0) {
    throw new Error(
      `Invalid environment:\n${seeds.map((k) => `✖ ${k}: seed hooks are local-only (T-85)`).join('\n')}`,
    );
  }
  const env = result.data;
  const withDefaults =
    env.MODE === 'local'
      ? { ...localDefaults(), ...stripUndefined(env) }
      : { ...env, CORS_ORIGINS: env.CORS_ORIGINS ?? [], AGENT_PAYERS: env.AGENT_PAYERS ?? [] };
  return withDefaults as Env;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/** EVM networks advertised in accepts[] (Hedera kinds come from a remote facilitator). */
export const evmNetworks = (env: Pick<Env, 'X402_NETWORKS'>): string[] =>
  env.X402_NETWORKS.filter(isEvmNetwork);

/** The facilitator choice: explicit, or (local) self when Anvil answers, else mock. */
export async function resolveFacilitator(
  env: Pick<Env, 'MODE' | 'X402_FACILITATOR'>,
  anvilAnswers: () => Promise<boolean>,
): Promise<'mock' | 'self' | 'remote'> {
  if (env.X402_FACILITATOR !== undefined) return env.X402_FACILITATOR;
  if (env.MODE === 'live') return 'remote';
  return (await anvilAnswers()) ? 'self' : 'mock';
}
