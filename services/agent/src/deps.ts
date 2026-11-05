/**
 * Wiring (agent.md §1 `deps.ts`): config → { reads, plans, payers, buyer, receipts, journal, state, uaid }.
 * Local: API-backed reads, the Anvil EVM payer, MockConsensusLog. Live: Arkiv reads pinned to AGENT_LEDGER_WRITER, the
 * Hedera Agent Kit wallet (dynamic import — never loaded in local mode), the optional Base Sepolia EVM payer.
 * Every seam is injectable so tests and the integration run use the same assembly.
 */
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

import { MockConsensusLog, type ConsensusLog } from '@ethglobal/adapters';

import { Buyer } from './buyer.js';
import { ConfigError, type AgentConfig } from './config.js';
import { resolveUaid, type Hcs14Fn } from './identity.js';
import { AgentState, Journal } from './journal.js';
import { createLogger, type Log } from './log.js';
import { MAX_WATCHED_KEYS } from './loop.js';
import { createNotifier, type PhrasingModel } from './notifier.js';
import { PassClient } from './pass.js';
import { EvmPayer } from './payers/evm.js';
import { ApiReads, LedgerReads, PlansCache, type AgentReads } from './reads.js';
import { ReceiptWriter } from './receipts.js';

import type { Payer } from './payers/types.js';
import type { AgentDeps } from './tick.js';

export interface BuildOptions {
  fetch?: typeof fetch;
  now?: () => number;
  log?: Log;
  reads?: AgentReads;
  consensus?: ConsensusLog;
  payers?: Payer[];
  llm?: PhrasingModel;
  hcs14?: Hcs14Fn;
  publicClient?: PublicClient;
  sleep?: (ms: number) => Promise<void>;
}

export interface Agent {
  deps: AgentDeps;
  uaid: string;
  payers: Payer[];
  /** The keys one pass ticks: AGENT_WATCH_KEYS, else the policies naming AGENT_OWNER (bounded). */
  keys(): Promise<string[]>;
  close(): void;
}

/**
 * The EVM key: AGENT_EVM_PRIVATE_KEY, else — MODE=local only — Anvil's public agent key (anvilRoles.agent, #4) from
 * `@ethglobal/adapters/testing`, loaded by a dynamic import so live never loads the test keys (RT-G-05).
 */
async function evmKey(config: AgentConfig): Promise<`0x${string}` | undefined> {
  if (config.evmPrivateKey) return config.evmPrivateKey;
  if (config.mode !== 'local') return undefined;
  const { anvilKeys, anvilRoles } = await import('@ethglobal/adapters/testing');
  return anvilKeys[anvilRoles.agent];
}

async function evmPayer(
  config: AgentConfig,
  opts: BuildOptions,
  log: Log,
): Promise<EvmPayer | undefined> {
  const entry = config.allowList.find((a) => a.network.startsWith('eip155:'));
  if (!entry) return undefined;
  const key = await evmKey(config);
  if (key === undefined) return undefined;
  const account = privateKeyToAccount(key);
  const publicClient =
    opts.publicClient ??
    createPublicClient({
      transport: http(config.evmRpcUrl, opts.fetch ? { fetchFn: opts.fetch } : {}),
    });
  const payer = new EvmPayer({
    account,
    publicClient,
    network: entry.network,
    asset: entry.asset as Address,
  });
  try {
    return await payer.init();
  } catch (error) {
    log.warn(
      { event: 'degraded', what: 'evm-payer', error: String(error) },
      'agent: EVM payer unavailable',
    );
    return undefined;
  }
}

async function liveReads(
  config: AgentConfig,
  now: () => number,
  fetchFn?: typeof fetch,
): Promise<AgentReads> {
  if (!config.arkiv || !config.ledgerWriter)
    throw new ConfigError('live reads need ARKIV_* and AGENT_LEDGER_WRITER');
  const live = await import('@ethglobal/adapters/live');
  const ledger = new live.ArkivLedger({
    // read-only client: no ARKIV_PRIVATE_KEY on the agent host (the agent never writes the ledger)
    client: live.createArkivClient({
      chainId: config.arkiv.chainId,
      rpcUrl: config.arkiv.rpcUrl,
      accessKey: config.arkiv.accessKey,
      ...(fetchFn ? { fetchFn } : {}),
    }),
    blockTimeMs: config.arkiv.blockTimeMs,
    now,
    writer: config.ledgerWriter as Address,
  });
  return new LedgerReads(ledger, now);
}

export async function buildAgent(config: AgentConfig, opts: BuildOptions = {}): Promise<Agent> {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? createLogger();
  const fetchFn = opts.fetch ?? globalThis.fetch;
  const closers: (() => void)[] = [];

  let hederaPayer: Payer | undefined;
  let consensus = opts.consensus;
  if (config.mode === 'live' && config.hedera && opts.payers === undefined) {
    const { createHederaAgentKit } = await import('./payers/hedera.js');
    const kit = createHederaAgentKit({
      ...config.hedera,
      network: config.hederaNetwork,
      ...(config.hederaAsset ? { asset: config.hederaAsset } : {}),
      mirrorUrl: config.mirrorUrl,
      now,
      fetch: fetchFn,
    });
    closers.push(() => kit.close());
    if (kit.payer) {
      const association = await kit.wallet.ensureAssociated(kit.payer.asset);
      log.info(
        {
          event: 'decision',
          what: 'hedera-association',
          association,
          network: kit.payer.network,
          asset: kit.payer.asset,
        },
        'agent: Hedera USDC association',
      );
      hederaPayer = kit.payer;
    } else {
      log.warn(
        { event: 'degraded', what: 'hedera-payer', network: config.hederaNetwork },
        'agent: AGENT_PAYTO_ALLOWLIST names no hedera:* terms — HCS receipts only, no Hedera payer',
      );
    }
    consensus ??= kit.consensus;
  }
  if (consensus === undefined) {
    if (config.mode === 'live')
      throw new ConfigError('live needs the Agent Kit consensus log (AGENT_HEDERA_*)');
    consensus = new MockConsensusLog({ now });
  }

  if (config.owner === undefined) {
    log.warn(
      { event: 'degraded', what: 'owner' },
      'agent: AGENT_OWNER unset (local only) — buying only under policies owned by the entitlement payer',
    );
  }

  const payers =
    opts.payers ??
    [hederaPayer, await evmPayer(config, opts, log)].filter((p): p is Payer => p !== undefined);
  if (payers.length === 0)
    log.warn({ event: 'degraded', what: 'payers' }, 'agent: no payer configured');

  const reads =
    opts.reads ??
    (config.mode === 'live'
      ? await liveReads(config, now, opts.fetch)
      : new ApiReads(config.apiUrl, fetchFn));
  const hcs14 = opts.hcs14 ?? (await import('@ethglobal/adapters/live')).hcs14Uaid;
  const uaid = await resolveUaid({
    stateDir: config.stateDir,
    ...(config.uaid ? { override: config.uaid } : {}),
    ...(config.hedera ? { hederaAccountId: config.hedera.accountId } : {}),
    network: config.hederaNetwork,
    compute: hcs14,
    log,
  });
  const notifier = createNotifier(config.llm, {
    ...(opts.llm ? { model: opts.llm } : {}),
    fetch: fetchFn,
  });

  const journal = new Journal(config.stateDir);
  const receipts = new ReceiptWriter({ consensus, topic: config.hcsTopic, uaid, now, log });
  const deps: AgentDeps = {
    reads,
    plans: new PlansCache({ apiUrl: config.apiUrl, fetch: fetchFn, now }),
    buyer: new Buyer({
      apiUrl: config.apiUrl,
      fetch: fetchFn,
      now,
      payers,
      allowList: config.allowList,
      maxUsd6PerStep: config.maxUsd6PerStep,
      reads,
      uaid,
      log,
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    }),
    receipts,
    journal,
    pass: new PassClient({
      apiUrl: config.apiUrl,
      fetch: fetchFn,
      now,
      log,
      journal,
      receipts,
      ...(opts.sleep ? { sleep: opts.sleep } : {}),
    }),
    state: new AgentState(config.stateDir),
    now,
    log,
    dryRun: config.dryRun,
    ...(config.owner ? { owner: config.owner } : {}),
    notifier,
    inFlight: new Set(),
    lastNotice: new Map(),
  };

  return {
    deps,
    uaid,
    payers,
    keys: async () => {
      if (config.watchKeys.length > 0) return config.watchKeys;
      if (config.owner === undefined) return [];
      return reads.watchKeys(config.owner, MAX_WATCHED_KEYS);
    },
    close: () => closers.forEach((c) => c()),
  };
}
