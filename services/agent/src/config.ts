/**
 * Agent configuration (INTERFACES §8, §11; T-56, T-79). The allow-list of `(network, asset, payTo[, feePayer])` is
 * the agent's own copy of what it will ever pay: pinned from /plans at install time, never read from a 402.
 */
import { privateKeyToAccount } from 'viem/accounts';
import { z } from 'zod';

// the public-account list is defined in the adapters' test-helper module; this root re-export keeps that module (it
// holds test keys) out of the agent's static imports (RT-G-05: it is imported only lazily, after the live guard)
import { anvilAccounts, isPublicDevAccount } from '@ethglobal/adapters';
import {
  caipNetworkSchema,
  digitsSchema,
  evmAddressSchema,
  hederaAccountSchema,
  hex32Schema,
} from '@ethglobal/protocol/schemas';

/**
 * Env booleans: '1' | 'true' | 'yes' ⇒ true; '' | '0' | 'false' | 'no' ⇒ false. INTERFACES §8 says
 * `z.coerce.boolean()`, which turns the documented `AGENT_DRY_RUN=0` into **true** (Boolean('0')); this is the fix.
 */
const envBoolean = z
  .union([z.boolean(), z.string()])
  .transform((v, ctx) => {
    if (typeof v === 'boolean') return v;
    const s = v.trim().toLowerCase();
    if (['1', 'true', 'yes'].includes(s)) return true;
    if (['', '0', 'false', 'no'].includes(s)) return false;
    ctx.addIssue({ code: 'custom', message: `not a boolean: "${v}"` });
    return z.NEVER;
  })
  .default(false);

/** Blank env values mean "unset" ('' in .env.example); strings are trimmed. */
const blank = (v: unknown): unknown =>
  typeof v === 'string' ? (v.trim() === '' ? undefined : v.trim()) : v;
const optional = <S extends z.ZodType>(schema: S) => z.preprocess(blank, schema.optional());
const optionalString = optional(z.string());

/** Verbatim from INTERFACES §8, plus the T-79 writer pin, the EVM RPC and the state directory. */
export const agentConfigSchema = z.object({
  MODE: z.enum(['local', 'live']).default('local'),
  AGENT_API_URL: z.url(),
  AGENT_WATCH_KEYS: z.string().default(''),
  AGENT_OWNER: optional(evmAddressSchema),
  /** Default 60 000 live, 5 000 local (applied in loadConfig). */
  AGENT_TICK_MS: optional(z.coerce.number().int().min(1_000)),
  AGENT_DRY_RUN: envBoolean,
  AGENT_ONCE: envBoolean,
  AGENT_PAYTO_ALLOWLIST: z.string(),
  AGENT_MAX_USD6_PER_STEP: digitsSchema.default('1000000'),
  AGENT_EVM_PRIVATE_KEY: optional(hex32Schema),
  AGENT_HEDERA_ACCOUNT_ID: optional(hederaAccountSchema),
  AGENT_HEDERA_PRIVATE_KEY: optionalString,
  AGENT_UAID: optional(z.string().max(200).startsWith('uaid:')),
  HCS_TOPIC_ID: optional(hederaAccountSchema),
  HEDERA_MIRROR_URL: optional(z.url()),
  LLM_PROVIDER: z.enum(['none', 'anthropic']).default('none'),
  /** T-79 (THREAT-MODEL §7 item 13): the Arkiv writer every ledger read trusts. Required in live. */
  AGENT_LEDGER_WRITER: optional(evmAddressSchema),
  /** EVM JSON-RPC for the EVM payer's domain/balance reads (local: Anvil; live: Base Sepolia). */
  AGENT_EVM_RPC_URL: optional(z.url()),
  /** Where `uaid`, `journal.jsonl`, `state.json` and `triggers/` live (git-ignored). */
  AGENT_STATE_DIR: z.string().default('.agent'),
  /** LLM phrasing only (T-55): model id and key, both required when LLM_PROVIDER=anthropic. */
  AGENT_LLM_MODEL: optionalString,
  ANTHROPIC_API_KEY: optionalString,
  /** Arkiv read client (live). */
  ARKIV_CHAIN_ID: optional(z.coerce.number().int().positive()),
  ARKIV_RPC_URL: optional(z.url()),
  ARKIV_ACCESS_KEY: z.string().default(''),
  ARKIV_BLOCK_TIME_MS: z.coerce.number().int().positive().default(2_000),
});
export type AgentEnv = z.infer<typeof agentConfigSchema>;

/** One allow-list entry: `<network>|<asset>|<payTo>` (+ `|<feePayer>` on hedera:*, A-20). */
export interface AllowedTerms {
  network: string;
  asset: string;
  payTo: string;
  feePayer?: string;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HEDERA_ID = /^0\.0\.\d{1,12}$/;

export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/** Comma list of pipe triples; EVM values compared lower-cased. Throws ConfigError on any malformed entry. */
export function parseAllowList(raw: string): AllowedTerms[] {
  const entries = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
  return entries.map((entry) => {
    const parts = entry.split('|').map((s) => s.trim());
    const [network = '', asset = '', payTo = '', feePayer] = parts;
    if (!caipNetworkSchema.safeParse(network).success) {
      throw new ConfigError(`allow-list entry "${entry}": bad network`);
    }
    if (network.startsWith('eip155:')) {
      if (parts.length !== 3 || !EVM_ADDRESS.test(asset) || !EVM_ADDRESS.test(payTo)) {
        throw new ConfigError(
          `allow-list entry "${entry}": expected eip155:<id>|<0xasset>|<0xpayTo>`,
        );
      }
      return { network, asset: asset.toLowerCase(), payTo: payTo.toLowerCase() };
    }
    if (network.startsWith('hedera:')) {
      if (
        parts.length !== 4 ||
        !HEDERA_ID.test(asset) ||
        !HEDERA_ID.test(payTo) ||
        !HEDERA_ID.test(feePayer ?? '')
      ) {
        throw new ConfigError(
          `allow-list entry "${entry}": expected hedera:<net>|<0.0.token>|<0.0.payTo>|<0.0.feePayer>`,
        );
      }
      return { network, asset, payTo, feePayer: feePayer! };
    }
    throw new ConfigError(`allow-list entry "${entry}": unsupported network ${network}`);
  });
}

export const parseWatchKeys = (raw: string): string[] => [
  ...new Set(
    raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s !== ''),
  ),
];

export interface AgentConfig {
  mode: 'local' | 'live';
  apiUrl: string;
  watchKeys: string[];
  owner?: string;
  tickMs: number;
  dryRun: boolean;
  once: boolean;
  allowList: AllowedTerms[];
  maxUsd6PerStep: bigint;
  evmPrivateKey?: `0x${string}`;
  evmRpcUrl: string;
  hedera?: { accountId: string; privateKey: string };
  uaid?: string;
  hcsTopic: string;
  mirrorUrl: string;
  llm: { provider: 'none' } | { provider: 'anthropic'; model: string; apiKey: string };
  ledgerWriter?: string;
  stateDir: string;
  arkiv?: { chainId: number; rpcUrl: string; accessKey: string; blockTimeMs: number };
}

/** The local topic id MockConsensusLog accepts; live requires HCS_TOPIC_ID. */
export const LOCAL_HCS_TOPIC = '0.0.1001';
export const DEFAULT_MIRROR_URL = 'https://testnet.mirrornode.hedera.com';
export const DEFAULT_ANVIL_RPC_URL = 'http://127.0.0.1:8545';

const isAnvilKey = (key: string): boolean => {
  const address = privateKeyToAccount(key as `0x${string}`).address.toLowerCase();
  return anvilAccounts.some((a) => a.toLowerCase() === address);
};

/** Parses `process.env`-shaped input and applies the mode rules. Throws ConfigError (or a ZodError). */
export function loadConfig(env: Record<string, string | undefined>): AgentConfig {
  const e = agentConfigSchema.parse(env);
  const live = e.MODE === 'live';
  const allowList = parseAllowList(e.AGENT_PAYTO_ALLOWLIST);
  const problems: string[] = [];
  if (e.AGENT_HEDERA_ACCOUNT_ID !== undefined && e.AGENT_HEDERA_PRIVATE_KEY === undefined) {
    problems.push('AGENT_HEDERA_ACCOUNT_ID needs AGENT_HEDERA_PRIVATE_KEY');
  }
  if (e.LLM_PROVIDER === 'anthropic' && (!e.AGENT_LLM_MODEL || !e.ANTHROPIC_API_KEY)) {
    problems.push('LLM_PROVIDER=anthropic needs AGENT_LLM_MODEL and ANTHROPIC_API_KEY');
  }
  if (live) {
    if (allowList.length === 0)
      problems.push('AGENT_PAYTO_ALLOWLIST must not be empty in live (T-56)');
    if (!e.AGENT_LEDGER_WRITER) problems.push('AGENT_LEDGER_WRITER is required in live (T-79)');
    if (!e.AGENT_OWNER) {
      problems.push(
        'AGENT_OWNER is required in live: the agent pays only under policies that owner set (T-73 b, RT-G-04)',
      );
    } else if (isPublicDevAccount(e.AGENT_OWNER)) {
      // anyone holds a public Anvil/Hardhat key, so anyone could sign the policy as "the owner" (RT-G-04 variant)
      problems.push('AGENT_OWNER is a public Anvil/Hardhat account; refused in live (RT-G-04)');
    }
    if (!e.HCS_TOPIC_ID) problems.push('HCS_TOPIC_ID is required in live');
    if (!e.ARKIV_RPC_URL || e.ARKIV_CHAIN_ID === undefined) {
      problems.push(
        'ARKIV_RPC_URL and ARKIV_CHAIN_ID are required in live (the agent reads Arkiv, R2)',
      );
    }
    if (!e.AGENT_HEDERA_ACCOUNT_ID) {
      problems.push(
        'live needs the Hedera Agent Kit wallet (AGENT_HEDERA_ACCOUNT_ID/KEY): it pays hedera:testnet and submits the HCS receipts',
      );
    }
    if (e.AGENT_EVM_PRIVATE_KEY && isAnvilKey(e.AGENT_EVM_PRIVATE_KEY)) {
      problems.push('AGENT_EVM_PRIVATE_KEY is a public Anvil key; refused in live');
    }
    if (e.AGENT_EVM_PRIVATE_KEY && !e.AGENT_EVM_RPC_URL) {
      problems.push('AGENT_EVM_RPC_URL is required in live with an EVM key');
    }
  }
  if (problems.length > 0) throw new ConfigError(problems.join('; '));

  return {
    mode: e.MODE,
    apiUrl: e.AGENT_API_URL.replace(/\/+$/, ''),
    watchKeys: parseWatchKeys(e.AGENT_WATCH_KEYS),
    ...(e.AGENT_OWNER ? { owner: e.AGENT_OWNER.toLowerCase() } : {}),
    tickMs: e.AGENT_TICK_MS ?? (live ? 60_000 : 5_000),
    dryRun: e.AGENT_DRY_RUN,
    once: e.AGENT_ONCE,
    allowList,
    maxUsd6PerStep: BigInt(e.AGENT_MAX_USD6_PER_STEP),
    ...(e.AGENT_EVM_PRIVATE_KEY ? { evmPrivateKey: e.AGENT_EVM_PRIVATE_KEY as `0x${string}` } : {}),
    evmRpcUrl: e.AGENT_EVM_RPC_URL ?? DEFAULT_ANVIL_RPC_URL,
    ...(e.AGENT_HEDERA_ACCOUNT_ID && e.AGENT_HEDERA_PRIVATE_KEY
      ? { hedera: { accountId: e.AGENT_HEDERA_ACCOUNT_ID, privateKey: e.AGENT_HEDERA_PRIVATE_KEY } }
      : {}),
    ...(e.AGENT_UAID ? { uaid: e.AGENT_UAID } : {}),
    hcsTopic: e.HCS_TOPIC_ID ?? LOCAL_HCS_TOPIC,
    mirrorUrl: e.HEDERA_MIRROR_URL ?? DEFAULT_MIRROR_URL,
    llm:
      e.LLM_PROVIDER === 'anthropic'
        ? { provider: 'anthropic', model: e.AGENT_LLM_MODEL!, apiKey: e.ANTHROPIC_API_KEY! }
        : { provider: 'none' },
    ...(e.AGENT_LEDGER_WRITER ? { ledgerWriter: e.AGENT_LEDGER_WRITER.toLowerCase() } : {}),
    stateDir: e.AGENT_STATE_DIR,
    ...(e.ARKIV_RPC_URL && e.ARKIV_CHAIN_ID !== undefined
      ? {
          arkiv: {
            chainId: e.ARKIV_CHAIN_ID,
            rpcUrl: e.ARKIV_RPC_URL,
            accessKey: e.ARKIV_ACCESS_KEY,
            blockTimeMs: e.ARKIV_BLOCK_TIME_MS,
          },
        }
      : {}),
  };
}
