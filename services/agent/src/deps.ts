/**
 * Wiring (agent.md §1 `deps.ts`): config → { reads, plans, payers, buyer, receipts, journal, state, uaid }.
 * Local: API-backed reads, the Anvil EVM payer, MockConsensusLog. Live: Arkiv reads pinned to AGENT_LEDGER_WRITER, the
 * Hedera Agent Kit wallet (dynamic import — never loaded in local mode), the optional Base Sepolia EVM payer.
 * Every seam is injectable so tests and the integration run use the same assembly.
 */
import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { mnemonicToAccount, privateKeyToAccount } from 'viem/accounts';

import { MockConsensusLog, type ConsensusLog } from '@ethglobal/adapters';

import { Buyer } from './buyer.js';
import { ANVIL_AGENT_INDEX, ConfigError, type AgentConfig } from './config.js';
import { resolveUaid, type Hcs14Fn } from './identity.js';
import { AgentState, Journal } from './journal.js';
import { createLogger, type Log } from './log.js';
import { MAX_WATCHED_KEYS } from './loop.js';
import { createNotifier, type PhrasingModel } from './notifier.js';
import { EvmPayer } from './payers/evm.js';
import { ApiReads, LedgerReads, PlansCache, type AgentReads } from './reads.js';
import { ReceiptWriter } from './receipts.js';

import type { Payer } from './payers/types.js';
import type { AgentDeps } from './tick.js';

/** Anvil's public test mnemonic (the same one scripts/dev-chain.sh starts Anvil with). */
export const ANVIL_MNEMONIC = 'test test test test test test test test test test test junk';

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

async function evmPayer(
  config: AgentConfig,
  opts: BuildOptions,
  log: Log,
): Promise<EvmPayer | undefined> {
  const entry = config.allowList.find((a) => a.network.startsWith('eip155:'));
  if (!entry) return undefined;
  if (config.mode === 'live' && !config.evmPrivateKey) return undefined;
  const account = config.evmPrivateKey
    ? privateKeyToAccount(config.evmPrivateKey)
    : mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: ANVIL_AGENT_INDEX });
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
      mirrorUrl: config.mirrorUrl,
      now,
      fetch: fetchFn,
    });
    closers.push(() => kit.close());
    const association = await kit.wallet.ensureAssociated();
    log.info(
      { event: 'decision', what: 'hedera-association', association },
      'agent: Hedera USDC association',
    );
    hederaPayer = kit.payer;
    consensus ??= kit.consensus;
  }
  if (consensus === undefined) {
    if (config.mode === 'live')
      throw new ConfigError('live needs the Agent Kit consensus log (AGENT_HEDERA_*)');
    consensus = new MockConsensusLog({ now });
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
    compute: hcs14,
    log,
  });
  const notifier = createNotifier(config.llm, {
    ...(opts.llm ? { model: opts.llm } : {}),
    fetch: fetchFn,
  });

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
    receipts: new ReceiptWriter({ consensus, topic: config.hcsTopic, uaid, now, log }),
    journal: new Journal(config.stateDir),
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
