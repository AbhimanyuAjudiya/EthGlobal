/**
 * buildDeps(env) → everything a route needs (brief §1). MODE=local: `createAdapters('local')` mocks, Anvil (or an
 * injected DataDrop double), the self-run facilitator over MockUSDC3009 or the mock rail; zero network beyond the
 * local node. MODE=live: `createLiveAdapters(liveConfigSchema.parse(env))`.
 */
import { createWalletClient, getAddress, http, type Address } from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';

import {
  createAdapters,
  MockCampaignNames,
  type Adapters,
  type CampaignNames,
  type PaymentRail,
} from '@ethglobal/adapters';
import {
  createEnsCampaigns,
  createLiveAdapters,
  createRpContextSigner,
  liveConfigSchema,
  SelfRunFacilitator,
} from '@ethglobal/adapters/live';
import { hexToBytes, keccak256 } from '@ethglobal/crypto';
import { createViemRelayer, type Relayer } from '@ethglobal/eip3009';
import type { Decision, Entitlement, OctroiDeps } from '@ethglobal/octroi';
import {
  AgentPolicyStore,
  CampaignStore,
  ClaimStore,
  EntitlementStore,
  GiftStore,
  NonceStore,
  ReceiptStore,
} from '@ethglobal/octroi/store';
import { MAX_MB_PER_PURCHASE, STEP_MB, isHederaNetwork, type Hex } from '@ethglobal/protocol/ids';
import type { AcceptTemplate, RpContext } from '@ethglobal/protocol/schemas';

import { addressesSlug, buildAcceptTemplates, loadAddresses } from './accepts.js';
import { Admission, KeyedMutex, WindowLimiter } from './admission.js';
import { AnomalyGuard } from './anomaly.js';
import { LedgerHealth, MeCache, observedLedger } from './cache.js';
import {
  createChainIdResolver,
  createDataDropClient,
  createPublic,
  LOCAL_CHAIN_ID,
  SerialQueue,
  type ChainIdResolver,
  type DataDropClient,
} from './chain.js';
import { evmNetworks, parseEnv, resolveFacilitator, type Env } from './env.js';
import { EnsJobs } from './flows/ens.js';
import { createLogger, type Logger } from './logger.js';
import { Metrics } from './metrics.js';
import { DurableState, type DurableMap } from './state.js';
import { createAgentPass, type AgentPass } from './world-agent-pass.js';

import type { FulfilContext } from './flows/fulfil.js';
import type { PaidOperation, TopUpIntent } from './flows/payments.js';
import type { ReceiptOutboxEntry } from './flows/record.js';
import type { RefundJob } from './flows/refund-recovery.js';

export type ServeFreeDecision = Extract<Decision, { kind: 'serve-free' }>;

export interface Stores {
  entitlements: EntitlementStore;
  nonces: NonceStore;
  gifts: GiftStore;
  campaigns: CampaignStore;
  receipts: ReceiptStore;
  policies: AgentPolicyStore;
  /** Claim locks and once-only markers (A-33, A-42): gift delivered, campaign registered, audit key shown. */
  claims: ClaimStore;
}

/** A pending-profile entitlement's delivery target: the session key the LPA is sealed to and its AAD nonce. */
export interface PendingDelivery {
  sessionPubKey: Hex;
  nonce: Hex;
  /** Private redemption retry credential; the public session key alone is never enough to recover a capability. */
  recoveryKeyHash?: Hex;
  /** Persisted before an order starts, so boot can create/resume even after a crash between writes. */
  entitlement?: Entitlement;
  context?: FulfilContext;
}

/** A verified-but-unserved free claim (T-24), bound to the human's nullifier (RT-A-05). */
export interface ClaimIntent {
  decision: ServeFreeDecision;
  recoveryKeyHash?: Hex;
  campaignId: string;
  /** HMAC(secret, 'intent' ‖ nullifier): a resume needs a proof of the same human. */
  nullifierTag: Hex;
  /** The first attempt's challenge signal: a retry may resend that proof instead of proving again. */
  signal: Hex;
  claimTx?: Hex;
  reserved?: boolean;
  reservation?: {
    token: Hex;
    keys: string[];
    locks: { key: string; scope: 'free-live' | 'free-campaign'; expiresAt: number }[];
  };
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
  /** Sealed durable process state (STATE_FILE; memory-only without it). */
  state: DurableState;
  /** Pending-profile retries by entitlement key (durable, RT-A-11; AP6.3). */
  pendingDelivery: DurableMap<PendingDelivery>;
  paidOperations: DurableMap<PaidOperation>;
  topUpIntents: DurableMap<TopUpIntent>;
  receiptOutbox: DurableMap<ReceiptOutboxEntry>;
  refundJobs: DurableMap<RefundJob>;
  /** Polls of reseller.usage per ICCID hash (≤ 1/min, shared by ?refresh=1 and webhooks). */
  usagePolls: WindowLimiter;
  /** Order retries for pending-profile entitlements (≤ 1/min per key). */
  orderRetries: WindowLimiter;
  /** Re-binds of a pending-profile delivery to a new session key (≤ 3/hour per entitlement, RT-A-17). */
  rebinds: WindowLimiter;
  /**
   * Verified-but-unserved free claims (T-24, AP5.3): the decision of a human whose chain step failed after
   * verify, keyed by the session key the challenge MAC binds; a retry from that session with a proof of the same
   * human completes it (durable, RT-A-11; retained through the original entitlement/campaign lifetime).
   */
  intents: DurableMap<ClaimIntent>;
  /** World ID Agent Pass (docs/WORLD_AGENT_PASS.md); undefined = off (no WORLD_AGENT_PASS_CLIENT_ID). */
  agentPass: AgentPass | undefined;
  /** ENSv2 campaign names (flows/ens.ts, ens/README.md); undefined = off (ENS_ENABLED unset). */
  ens: EnsJobs | undefined;
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
  /** The ENS registrar (tests); turns the ENS job on whatever ENS_ENABLED says. */
  ensNames?: CampaignNames;
  /** The ENS job's retry waits (tests). */
  ensRetryMs?: readonly number[];
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
    claims: new ClaimStore(ledger, now),
  };
  const sealKey = hexToBytes(env.SERVER_SEAL_KEY as Hex);
  const state = new DurableState({
    ...(env.STATE_FILE === undefined ? {} : { file: env.STATE_FILE }),
    sealKey,
    now,
  });
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
  const ensNames =
    overrides.ensNames ?? (env.ENS_ENABLED ? ensRegistrar(env, now, overrides.fetch) : undefined);
  const deps: Deps = {
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
    sealKey,
    chainId: env.MODE === 'live' ? env.CHAIN : LOCAL_CHAIN_ID,
    getChainId: overrides.getChainId ?? createChainIdResolver(env),
    cache: new MeCache(now),
    health,
    admission: new Admission(now),
    anomaly: new AnomalyGuard(dataDrop, logger, now),
    metrics,
    mutex: new KeyedMutex(),
    nonceCache,
    state,
    pendingDelivery: state.map<PendingDelivery>('pending-delivery'),
    paidOperations: state.map<PaidOperation>('paid-operations'),
    topUpIntents: state.map<TopUpIntent>('topup-intents'),
    receiptOutbox: state.map<ReceiptOutboxEntry>('receipt-outbox'),
    refundJobs: state.map<RefundJob>('refund-jobs'),
    usagePolls: new WindowLimiter(1, 60_000, now),
    orderRetries: new WindowLimiter(1, 60_000, now),
    rebinds: new WindowLimiter(3, 3_600_000, now),
    intents: state.map<ClaimIntent>('intents'),
    agentPass: createAgentPass(env, {
      ...(overrides.fetch === undefined ? {} : { fetch: overrides.fetch }),
      now,
      logger,
      state,
    }),
    ens: undefined,
  };
  if (ensNames) deps.ens = new EnsJobs(deps, ensNames, overrides.ensRetryMs);
  return deps;
}

/**
 * The ENSv2 registrar (ens/README.md): live signs with the ATTESTOR key — the registrar of ENS_USER_REGISTRY — on
 * Sepolia over ENS_SEPOLIA_RPC_URL; MODE=local keeps the names in memory.
 */
function ensRegistrar(env: Env, now: () => number, fetchFn?: typeof fetch): CampaignNames {
  if (env.MODE !== 'live') return new MockCampaignNames({ parent: env.ENS_PARENT_NAME, now });
  return createEnsCampaigns({
    rpcUrl: env.ENS_SEPOLIA_RPC_URL,
    privateKey: env.ATTESTOR_PRIVATE_KEY as Hex,
    parent: env.ENS_PARENT_NAME,
    userRegistry: getAddress(env.ENS_USER_REGISTRY ?? ''),
    factory: getAddress(env.ENS_VERIFIABLE_FACTORY),
    resolverImpl: getAddress(env.ENS_RESOLVER_IMPL),
    ...(fetchFn === undefined ? {} : { fetch: fetchFn }),
    now,
  });
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
    // the mock rail has no /supported: when hedera:* is advertised locally, the pinned fee payer is the fee payer
    hederaFeePayer: env.X402_HEDERA_FEE_PAYER,
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
  const slug = addressesSlug(env.CHAIN);
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

/**
 * One relayer transaction at a time (RT-A-12, T-75): viem's nonce manager plus the same SerialQueue the attestor
 * uses (chain.ts), so two concurrent settlements — two buyers, or a stranger's /facilitator/settle racing a buyer —
 * never sign with one nonce. `submit` resolves after the receipt, so the queue also orders simulate → send.
 */
export function serialRelayer(relayer: Relayer): Relayer {
  const queue = new SerialQueue();
  return {
    ...(relayer.address === undefined ? {} : { address: relayer.address }),
    submit: (token, data) => queue.run(() => relayer.submit(token, data)),
  };
}

function selfRun(
  env: Env,
  rpcUrl: string,
  chainId: number,
  token: string,
  now: () => number,
): Facilitator {
  const publicClient = createPublic(rpcUrl, chainId);
  const account = privateKeyToAccount(env.RELAYER_PRIVATE_KEY as Hex, { nonceManager });
  const walletClient = createWalletClient({
    account,
    chain: publicClient.chain,
    transport: http(rpcUrl),
  });
  const rail = new SelfRunFacilitator({
    publicClient,
    relayer: serialRelayer(createViemRelayer({ walletClient, publicClient, simulate: true })),
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
