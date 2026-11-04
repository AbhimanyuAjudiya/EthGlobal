/**
 * Where Hedera lives in the agent (live only — loaded by `deps.ts` through a dynamic import when MODE=live and
 * AGENT_HEDERA_ACCOUNT_ID is set; never imported in local mode).
 *
 * - The x402 payload comes from `@x402/hedera/exact/client` (`createClientHederaSigner` + `ExactHederaScheme`):
 *   `{ transaction: <base64 partially-signed TransferTransaction> }` whose transactionId.accountId is the facilitator's
 *   `extra.feePayer` (A-20). The Agent Kit does not speak x402 (A-22).
 * - The Hedera Agent Kit (`@hashgraph/hedera-agent-kit@4.2.0`, `HederaAgentAPI` + core account/token/consensus plugins,
 *   `AgentMode.AUTONOMOUS`) is the agent's wallet and HCS tool layer, **driven by code only** (T-84): `run(method,
 *   args)` with arguments computed here, for the boot-time USDC association and the HCS receipt. No framework toolkit,
 *   no tool list for a model: no model ever holds a tool; no transfer tool is ever called (the payment is the x402 payload).
 * - Hedera SDK symbols come through `@x402/hedera`'s re-exports of `@hiero-ledger/sdk@2.90.1` (one SDK copy).
 */
import { AgentMode, HederaAgentAPI, ToolDiscovery } from '@hashgraph/hedera-agent-kit';
import {
  ASSOCIATE_TOKEN_TOOL,
  coreAccountPlugin,
  coreConsensusPlugin,
  coreTokenPlugin,
  SUBMIT_TOPIC_MESSAGE_TOOL,
} from '@hashgraph/hedera-agent-kit/plugins';
import {
  AccountId,
  Client,
  createClientHederaSigner,
  inspectHederaTransaction,
  PrivateKey,
  type InspectedHederaTransaction,
} from '@x402/hedera';
import { ExactHederaScheme } from '@x402/hedera/exact/client';
import { z } from 'zod';

import type { ConsensusLog } from '@ethglobal/adapters';
import { httpJson } from '@ethglobal/protocol/http';
import { HEDERA_MAX_TIMEOUT_S, NETWORKS, USDC_ASSET } from '@ethglobal/protocol/ids';
import type {
  PaymentPayload,
  PaymentRequirements,
  PaymentResource,
} from '@ethglobal/protocol/schemas';

import { chooseFirstAcceptable, PayerRefusal, type Payer } from './types.js';

const HEDERA_USDC = USDC_ASSET[NETWORKS.hederaTestnet];
const HEDERA_ID = /^0\.0\.\d{1,12}$/;

/** The slice of `ExactHederaScheme` the payer uses. */
export interface HederaPaymentScheme {
  createPaymentPayload(
    x402Version: number,
    requirements: Omit<PaymentRequirements, 'extra' | 'network'> & {
      network: `${string}:${string}`;
      extra: Record<string, unknown>;
    },
  ): Promise<{ x402Version: number; payload: Record<string, unknown> }>;
}

/** The slice of `HederaAgentAPI` the agent drives: `run(method, args)` with code-computed arguments only. */
export interface AgentKitApi {
  run(method: string, args: unknown): Promise<string>;
}

export interface HederaPayerOptions {
  accountId: string;
  scheme: HederaPaymentScheme;
  balance: () => Promise<bigint>;
  inspect?: (transactionBase64: string) => InspectedHederaTransaction;
}

const feePayerOf = (req: PaymentRequirements): string | undefined => {
  const v = req.extra?.feePayer;
  return typeof v === 'string' && HEDERA_ID.test(v) ? v : undefined;
};

/** HederaPayer — pays the `hedera:testnet` exact scheme with the agent's account (the Agent Kit wallet's account). */
export class HederaPayer implements Payer {
  readonly network = NETWORKS.hederaTestnet;
  readonly #opts: HederaPayerOptions;

  constructor(opts: HederaPayerOptions) {
    this.#opts = opts;
  }

  get accountId(): string {
    return this.#opts.accountId;
  }

  refusal(req: PaymentRequirements): string | undefined {
    if (req.network !== this.network) return 'network';
    if (req.asset !== HEDERA_USDC) return 'asset';
    if (feePayerOf(req) === undefined) return 'fee-payer';
    if (req.maxTimeoutSeconds > HEDERA_MAX_TIMEOUT_S) return 'timeout';
    return undefined;
  }

  choose(accepts: PaymentRequirements[]): PaymentRequirements | undefined {
    return chooseFirstAcceptable(this, accepts);
  }

  balanceUsd6(): Promise<bigint> {
    return this.#opts.balance();
  }

  /** The built transaction must be exactly what was agreed: fee payer, one token, two legs, no HBAR, no other ops. */
  #check(req: PaymentRequirements, tx: InspectedHederaTransaction): string | undefined {
    if (tx.transactionIdAccountId !== feePayerOf(req))
      return 'transactionId.accountId != extra.feePayer';
    if (tx.hasNonTransferOperations || tx.hbarTransfers.length > 0)
      return 'not a plain token transfer';
    const tokens = Object.keys(tx.tokenTransfers);
    const legs = tx.tokenTransfers[HEDERA_USDC] ?? [];
    if (tokens.length !== 1 || legs.length !== 2) return 'expected one token with two legs';
    const amount = BigInt(req.amount);
    const debit = legs.find((l) => l.accountId === this.#opts.accountId);
    const credit = legs.find((l) => l.accountId === req.payTo);
    if (debit === undefined || BigInt(debit.amount) !== -amount) return 'payer leg mismatch';
    if (credit === undefined || BigInt(credit.amount) !== amount) return 'payTo leg mismatch';
    return undefined;
  }

  async sign(
    req: PaymentRequirements,
    ctx: { resource: PaymentResource; now: number },
  ): Promise<PaymentPayload> {
    const refused = this.refusal(req);
    if (refused !== undefined)
      throw new PayerRefusal('payload-mismatch', `Hedera payer refuses: ${refused}`);
    const value = BigInt(req.amount);
    const balance = await this.balanceUsd6();
    if (balance < value) {
      throw new PayerRefusal('insufficient-balance', `balance ${balance} < value ${value}`);
    }
    const built = await this.#opts.scheme.createPaymentPayload(2, {
      ...req,
      network: req.network as `${string}:${string}`,
      extra: req.extra ?? {},
    });
    const transaction = built.payload.transaction;
    if (typeof transaction !== 'string') {
      throw new PayerRefusal('payload-mismatch', 'scheme returned no transaction');
    }
    const problem = this.#check(req, (this.#opts.inspect ?? inspectHederaTransaction)(transaction));
    if (problem !== undefined) throw new PayerRefusal('payload-mismatch', problem);
    return { x402Version: 2, resource: ctx.resource, accepted: req, payload: { transaction } };
  }
}

/** The local name requested for the live Hedera signer. */
export const HederaAgentKitSigner = HederaPayer;

const mirrorTokens = z.object({
  tokens: z.array(
    z
      .object({
        token_id: z.string(),
        balance: z.union([z.int().nonnegative(), z.string().regex(/^\d+$/)]),
      })
      .loose(),
  ),
});

/** The Agent Kit wallet, driven by code: association at boot, balance from the mirror node. */
export class AgentKitWallet {
  constructor(
    private readonly opts: {
      api: AgentKitApi;
      accountId: string;
      mirrorUrl: string;
      fetch?: typeof fetch;
    },
  ) {}

  /** null when the account is not associated with the token. */
  async tokenBalance(tokenId: string = HEDERA_USDC): Promise<bigint | null> {
    const base = this.opts.mirrorUrl.replace(/\/+$/, '');
    const { data } = await httpJson(
      `${base}/api/v1/accounts/${this.opts.accountId}/tokens?token.id=${tokenId}`,
      { schema: mirrorTokens, ...(this.opts.fetch ? { fetch: this.opts.fetch } : {}) },
    );
    const row = data.tokens.find((t) => t.token_id === tokenId);
    return row === undefined ? null : BigInt(row.balance);
  }

  /** Associates the account with USDC once if the mirror shows no association (both parties must be, A-20). */
  async ensureAssociated(tokenId: string = HEDERA_USDC): Promise<'already' | 'associated'> {
    if ((await this.tokenBalance(tokenId)) !== null) return 'already';
    await this.opts.api.run(ASSOCIATE_TOKEN_TOOL, { tokenIds: [tokenId] });
    return 'associated';
  }
}

const kitOutput = z
  .object({
    raw: z
      .object({
        transactionId: z.string().optional(),
        topicSequenceNumber: z.union([z.int(), z.string().regex(/^\d+$/)]).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

/** HCS receipts through the Agent Kit's SUBMIT_TOPIC_MESSAGE_TOOL. Output shape `[verify Wed]`; sequence 0 = unknown. */
export class AgentKitConsensusLog implements ConsensusLog {
  constructor(
    private readonly api: AgentKitApi,
    private readonly now: () => number,
  ) {}

  async submit(
    topic: string,
    message: string,
  ): Promise<{ sequence: number; consensusAt: number; txId: string }> {
    const out = await this.api.run(SUBMIT_TOPIC_MESSAGE_TOOL, { topicId: topic, message });
    let parsed: z.infer<typeof kitOutput> = {};
    try {
      parsed = kitOutput.parse(JSON.parse(out));
    } catch {
      // the human-readable message form: "Message submitted successfully with transaction id 0.0.x@s.n"
    }
    const txId = parsed.raw?.transactionId ?? /(\d+\.\d+\.\d+@\d+\.\d+)/.exec(out)?.[1] ?? '';
    return {
      sequence: Number(parsed.raw?.topicSequenceNumber ?? 0),
      consensusAt: this.now(),
      txId,
    };
  }

  async read(): Promise<{ sequence: number; message: string; consensusAt: number }[]> {
    throw new Error('AgentKitConsensusLog is write-only; read topics with HcsLog (mirror node)');
  }
}

/** Builds the live Hedera stack from env values: one Client, the x402 payer, the Agent Kit wallet and HCS log. */
export function createHederaAgentKit(cfg: {
  accountId: string;
  privateKey: string;
  mirrorUrl: string;
  now: () => number;
  fetch?: typeof fetch;
}): {
  payer: HederaPayer;
  wallet: AgentKitWallet;
  consensus: AgentKitConsensusLog;
  api: AgentKitApi;
  close(): void;
} {
  const key = PrivateKey.fromStringECDSA(cfg.privateKey);
  const client = Client.forTestnet().setOperator(AccountId.fromString(cfg.accountId), key);
  const configuration = {
    plugins: [coreAccountPlugin, coreTokenPlugin, coreConsensusPlugin],
    context: { mode: AgentMode.AUTONOMOUS, accountId: cfg.accountId },
  };
  const tools = ToolDiscovery.createFromConfiguration(configuration).getAllTools(
    configuration.context,
    configuration,
  );
  const api = new HederaAgentAPI(client, configuration.context, tools);
  const wallet = new AgentKitWallet({
    api,
    accountId: cfg.accountId,
    mirrorUrl: cfg.mirrorUrl,
    ...(cfg.fetch ? { fetch: cfg.fetch } : {}),
  });
  const scheme = new ExactHederaScheme(
    createClientHederaSigner(cfg.accountId, key, { network: NETWORKS.hederaTestnet }),
  );
  const payer = new HederaPayer({
    accountId: cfg.accountId,
    scheme,
    balance: async () => (await wallet.tokenBalance()) ?? 0n,
  });
  return {
    payer,
    wallet,
    consensus: new AgentKitConsensusLog(api, cfg.now),
    api,
    close: () => client.close(),
  };
}
