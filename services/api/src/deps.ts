/**
 * buildDeps(env) → everything a route needs (brief §1). MODE=local: `createAdapters('local')` mocks, Anvil (or an
 * injected DataDrop double), the self-run facilitator over MockUSDC3009 or the mock rail; zero network beyond the
 * local node. MODE=live: `createLiveAdapters(liveConfigSchema.parse(env))`.
 */
import { createWalletClient, getAddress, http, type Address } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { createAdapters, type Adapters, type PaymentRail } from '@ethglobal/adapters';
import {
  createLiveAdapters,
  createRpContextSigner,
  liveConfigSchema,
  SelfRunFacilitator,
} from '@ethglobal/adapters/live';
import { hexToBytes, keccak256 } from '@ethglobal/crypto';
import { createViemRelayer } from '@ethglobal/eip3009';
import type { Decision, OctroiDeps } from '@ethglobal/octroi';
import {
  AgentPolicyStore,
  CampaignStore,
  EntitlementStore,
  GiftStore,
  NonceStore,
  ReceiptStore,
} from '@ethglobal/octroi/store';
import { MAX_MB_PER_PURCHASE, STEP_MB, isHederaNetwork, type Hex } from '@ethglobal/protocol/ids';
import type { AcceptTemplate, RpContext } from '@ethglobal/protocol/schemas';

import { buildAcceptTemplates, loadAddresses } from './accepts.js';
import { Admission, KeyedMutex, WindowLimiter } from './admission.js';
import { AnomalyGuard } from './anomaly.js';
import { LedgerHealth, MeCache, observedLedger } from './cache.js';
import {
  createChainIdResolver,
  createDataDropClient,
  createPublic,
  LOCAL_CHAIN_ID,
  type ChainIdResolver,
  type DataDropClient,
} from './chain.js';
import { evmNetworks, parseEnv, resolveFacilitator, type Env } from './env.js';
import { createLogger, type Logger } from './logger.js';
import { Metrics } from './metrics.js';

export type ServeFreeDecision = Extract<Decision, { kind: 'serve-free' }>;

export interface Stores {
  entitlements: EntitlementStore;
  nonces: NonceStore;
  gifts: GiftStore;
  campaigns: CampaignStore;
  receipts: ReceiptStore;
  policies: AgentPolicyStore;
}

export interface RpSigner {
  issue(): Promise<RpContext>;
}

/** The self-run facilitator behind /facilitator/* plus the relayer it signs with (A-30). */
export interface Facilitator {
  rail: PaymentRail;
  relayer: Address;
}

export interface Deps {
  env: Env;
  logger: Logger;
  now: () => number;
  adapters: Adapters;
  stores: Stores;
  octroi: OctroiDeps;
  dataDrop: DataDropClient;
  rpSigner: RpSigner;
  facilitator: Facilitator | undefined;
  accepts: AcceptTemplate[];
  secret: Uint8Array;
  sealKey: Uint8Array;
  chainId: number;
  getChainId: ChainIdResolver;
  cache: MeCache;
  health: LedgerHealth;
  admission: Admission;
  anomaly: AnomalyGuard;
  metrics: Metrics;
  mutex: KeyedMutex;
  nonceCache: Set<string>;
  /** Pending-profile retries: the session key the LPA must be sealed to (in memory; AP6.3). */
  pendingDelivery: Map<string, { sessionPubKey: Hex; nonce: Hex }>;
  /** Polls of reseller.usage per ICCID hash (≤ 1/min, shared by ?refresh=1 and webhooks). */
  usagePolls: WindowLimiter;
  /** Order retries for pending-profile entitlements (≤ 1/min per key). */
  orderRetries: WindowLimiter;
  /** Today's treasury outflow (TREASURY_MAX_USD6_PER_DAY). */
  treasuryDay: { day: number; spentUsd6: bigint };
  /**
   * Verified-but-unserved free claims (T-24, AP5.3): the decision of a human whose chain step failed after
   * verify, keyed by the session key the challenge MAC binds; a retry from that session completes it.
   */
  intents: Map<string, { decision: ServeFreeDecision; campaignId: string; exp: number }>;
  /** The audit key is shown once on the first authenticated dashboard read (AP13.4). */
  auditShown: Set<string>;
  /** Set when deps seeded a campaign (tests and the local seed). */
  seedCampaignId?: Hex;
}

export interface DepsOverrides {
  now?: () => number;
  logger?: Logger;
  dataDrop?: DataDropClient;
  adapters?: Partial<Adapters>;
  /** Replaces the payment rail (the facilitator routes keep theirs unless `facilitator` is given). */
  payments?: PaymentRail;
  facilitator?: Facilitator;
  rpSigner?: RpSigner;
  getChainId?: ChainIdResolver;
  fetch?: typeof fetch;
  /** Local: does ANVIL_RPC_URL answer? (decides X402_FACILITATOR when unset). */
  anvilAnswers?: () => Promise<boolean>;
}

export async function buildDeps(
  source: Env | Record<string, string | undefined>,
  overrides: DepsOverrides = {},
): Promise<Deps> {
  const env = isParsed(source) ? source : parseEnv(source);
  // live adapters read their own variables (HEDERA_*, ENS_*, ARKIV_*, …) from the raw environment
  const raw: Record<string, unknown> = isParsed(source) ? process.env : source;
  const now = overrides.now ?? Date.now;
  const logger = overrides.logger ?? createLogger(env.LOG_LEVEL);
  const metrics = new Metrics();
  const health = new LedgerHealth(now);

  const wired =
    env.MODE === 'live'
      ? await liveWiring(env, raw, now, logger, overrides)
      : await localWiring(env, now, overrides);
  const adapters: Adapters = { ...wired.adapters, ...overrides.adapters };
  if (overrides.payments) adapters.payments = overrides.payments;
  const ledger = observedLedger(adapters.ledger, health, (op, ms, ok) => {
    metrics.observe('ledger_ms', ms, { op });
    if (!ok) metrics.inc('ledger_errors_total', { op });
  });
  const stores: Stores = {
    entitlements: new EntitlementStore(ledger, now),
    nonces: new NonceStore(ledger, now),
    gifts: new GiftStore(ledger, now),
    campaigns: new CampaignStore(ledger, now),
    receipts: new ReceiptStore(ledger, now),
    policies: new AgentPolicyStore(ledger, now),
  };
  const secret = hexToBytes(env.OCTROI_SECRET as Hex);
  const nonceCache = new Set<string>();
  const accepts = buildAcceptTemplates({
    env,
    anvilUsdc: wired.anvilUsdc,
    hederaFeePayer: wired.hederaFeePayer,
  });
  const octroi: OctroiDeps = {
    ledger,
    // octroi calls through these objects, so spies on adapters.personhood / adapters.payments see every call
    personhood: adapters.personhood,
    payments: adapters.payments,
    secret,
    now,
    action: env.WORLD_ACTION,
    priceUsd6PerStep: env.PRICE_USD6_PER_STEP,
    stepMb: STEP_MB,
    maxMbPerPurchase: MAX_MB_PER_PURCHASE,
    validityDays: env.VALIDITY_DAYS,
    accepts,
    keccak256,
    planId: env.RESELLER_PLAN_ID,
    nonceCache,
  };
  const dataDrop = overrides.dataDrop ?? wired.dataDrop();
  return {
    env,
    logger,
    now,
    adapters,
    stores,
    octroi,
    dataDrop,
    rpSigner: overrides.rpSigner ?? wired.rpSigner,
    facilitator: overrides.facilitator ?? wired.facilitator,
    accepts,
    secret,
    sealKey: hexToBytes(env.SERVER_SEAL_KEY as Hex),
    chainId: env.MODE === 'live' ? env.CHAIN : LOCAL_CHAIN_ID,
    getChainId: overrides.getChainId ?? createChainIdResolver(env),
    cache: new MeCache(now),
    health,
    admission: new Admission(),
    anomaly: new AnomalyGuard(dataDrop, logger, now),
    metrics,
    mutex: new KeyedMutex(),
    nonceCache,
    pendingDelivery: new Map(),
    usagePolls: new WindowLimiter(1, 60_000, now),
    orderRetries: new WindowLimiter(1, 60_000, now),
    treasuryDay: { day: -1, spentUsd6: 0n },
    auditShown: new Set(),
    intents: new Map(),
  };
}

const isParsed = (source: Env | Record<string, unknown>): source is Env =>
  Array.isArray(source.X402_NETWORKS);

interface Wiring {
  adapters: Adapters;
  rpSigner: RpSigner;
  facilitator: Facilitator | undefined;
  dataDrop: () => DataDropClient;
  anvilUsdc: string | undefined;
  hederaFeePayer: string | undefined;
}

async function localWiring(env: Env, now: () => number, overrides: DepsOverrides): Promise<Wiring> {
  const addresses = loadAddresses('anvil');
  const usdc = env.USDC_ADDRESS ?? addresses?.usdc;
  const dataDropAddress = env.DATADROP_ADDRESS ?? addresses?.dataDrop;
  const webhookSecret = env.MOCK_RESELLER_WEBHOOK_SECRET;
  const adapters = createAdapters('local', {
    now,
    personhood: { expectSignal: true },
    ...(webhookSecret === undefined
      ? {}
      : { reseller: { webhookSecret: new TextEncoder().encode(webhookSecret) } }),
  });
  const choice = await resolveFacilitator(
    env,
    overrides.anvilAnswers ?? (() => anvilAnswers(env.ANVIL_RPC_URL)),
  );
  let facilitator: Facilitator | undefined;
  if (choice === 'self') {
    if (usdc === undefined)
      throw new Error('X402_FACILITATOR=self needs USDC_ADDRESS or deploy/addresses.anvil.json');
    facilitator = selfRun(env, env.ANVIL_RPC_URL, LOCAL_CHAIN_ID, usdc, now);
    adapters.payments = facilitator.rail;
  } else {
    facilitator = {
      rail: adapters.payments,
      relayer: privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex).address,
    };
  }
  return {
    adapters,
    rpSigner: rpSignerFor(env, now),
    facilitator,
    dataDrop: () => dataDropFor(env, env.ANVIL_RPC_URL, LOCAL_CHAIN_ID, dataDropAddress),
    anvilUsdc: usdc,
    hederaFeePayer: undefined,
  };
}

async function liveWiring(
  env: Env,
  raw: Record<string, unknown>,
  now: () => number,
  logger: Logger,
  overrides: DepsOverrides,
): Promise<Wiring> {
  const present = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''),
  );
  const config = liveConfigSchema.parse(present);
  const live = createLiveAdapters(config, {
    now,
    logger: {
      info: (m: unknown) => logger.info(String(m)),
      warn: (m: unknown) => logger.warn(String(m)),
    },
    ...(overrides.fetch === undefined ? {} : { fetch: overrides.fetch }),
  });
  if (!live.rpContext) throw new Error('WORLD_RP_SIGNING_KEY is required when MODE=live (A-25)');
  const hedera = env.X402_NETWORKS.find(isHederaNetwork);
  const hederaFeePayer = hedera === undefined ? undefined : await live.feePayer(hedera);
  const usdc = config.chain.usdc;
  const facilitator =
    env.X402_FACILITATOR === 'self' && usdc !== undefined && env.RPC_URL !== undefined
      ? selfRun(env, env.RPC_URL, env.CHAIN, usdc, now)
      : undefined;
  const slug = env.CHAIN === 296 ? 'hedera_testnet' : `chain${env.CHAIN}`;
  return {
    adapters: live,
    rpSigner: live.rpContext,
    facilitator,
    dataDrop: () =>
      dataDropFor(
        env,
        env.RPC_URL ?? '',
        env.CHAIN,
        env.DATADROP_ADDRESS ?? loadAddresses(slug)?.dataDrop,
      ),
    anvilUsdc: undefined,
    hederaFeePayer,
  };
}

function rpSignerFor(env: Env, now: () => number): RpSigner {
  return createRpContextSigner({
    appId: env.WORLD_APP_ID,
    rpId: env.WORLD_RP_ID,
    action: env.WORLD_ACTION,
    environment: env.WORLD_ENVIRONMENT,
    signingKeyHex: env.WORLD_RP_SIGNING_KEY as Hex,
    now,
  });
}

function selfRun(
  env: Env,
  rpcUrl: string,
  chainId: number,
  token: string,
  now: () => number,
): Facilitator {
  const publicClient = createPublic(rpcUrl, chainId);
  const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex);
  const walletClient = createWalletClient({
    account,
    chain: publicClient.chain,
    transport: http(rpcUrl),
  });
  const rail = new SelfRunFacilitator({
    publicClient,
    relayer: createViemRelayer({ walletClient, publicClient, simulate: true }),
    token: getAddress(token),
    chainId,
    network: `eip155:${chainId}`,
    now,
  });
  return { rail, relayer: account.address };
}

function dataDropFor(
  env: Env,
  rpcUrl: string,
  chainId: number,
  address: string | undefined,
): DataDropClient {
  if (address === undefined)
    throw new Error('DataDrop address unknown: set DATADROP_ADDRESS or deploy the contracts');
  return createDataDropClient({
    rpcUrl,
    chainId,
    address: getAddress(address),
    attestorKey: env.ATTESTOR_PRIVATE_KEY as Hex,
    confirmations: env.CHAIN_CONFIRMATIONS,
    gas: BigInt(env.CLAIM_GAS_LIMIT),
  });
}

async function anvilAnswers(rpcUrl: string): Promise<boolean> {
  try {
    await createPublic(rpcUrl, LOCAL_CHAIN_ID).getChainId();
    return true;
  } catch {
    return false;
  }
}

/** The EVM networks the self-run facilitator may settle (A-30: X402_NETWORKS ∩ EVM). */
export const facilitatorNetworks = (deps: Pick<Deps, 'env'>): string[] => evmNetworks(deps.env);
