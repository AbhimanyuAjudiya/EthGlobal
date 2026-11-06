/**
 * `@ethglobal/adapters/live` (INTERFACES §3.3) — Node only; imported by services/* and scripts/ only, never by the
 * browser-safe root barrel. `createLiveAdapters(liveConfigSchema.parse(process.env))` builds the whole bundle;
 * nothing touches the network until a port method is called.
 */
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Chain,
  type PublicClient,
} from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';
import { mainnet, sepolia } from 'viem/chains';

import { createViemRelayer } from '@ethglobal/eip3009';
import { USDC_ASSET } from '@ethglobal/protocol/ids';

import { ArkivLedger } from './arkiv-ledger.js';
import { createArkivClient } from './arkiv-sdk.js';
import { EnsResolver } from './ens-resolver.js';
import { EsimAccessReseller } from './esimaccess-reseller.js';
import { EvmTreasury } from './evm-treasury.js';
import { FallbackReseller } from './fallback-reseller.js';
import { HcsLog } from './hcs-log.js';
import { createHederaClient, type HederaClientLike } from './hedera-sdk.js';
import { HederaTreasury } from './hedera-treasury.js';
import { InventoryReseller } from './inventory-reseller.js';
import { RemoteFacilitator, FACILITATOR_HOSTS } from './remote-facilitator.js';
import { RoutingPaymentRail } from './routing-rail.js';
import { RoutingTreasury } from './routing-treasury.js';
import { SelfRunFacilitator } from './self-run-facilitator.js';
import { SwarmBlobStore } from './swarm-blobs.js';
import { WorldCloudPersonhood } from './world-personhood.js';
import { createRpContextSigner } from './world-rp-context.js';
import { MemoryBlobStore } from '../mocks/blob-store.js';
import { MockInference } from '../mocks/inference.js';
import { MockReseller } from '../mocks/reseller.js';

import type { Adapters, PaymentRail, Reseller, Treasury } from '../types.js';
import type { LiveConfig } from './config.js';

export { liveConfigSchema, parseLiveConfig, type LiveConfig } from './config.js';
export { Secret } from './secret.js';
export { toAdapterError, guard } from './errors.js';
export {
  ArkivLedger,
  ARKIV_MAX_LIFETIME_BLOCKS,
  type ArkivClientLike,
  type ArkivExpiration,
  type ArkivRow,
  type ArkivWhere,
} from './arkiv-ledger.js';
export { createArkivClient, arkivChain, RABDI_CHAIN_ID, TIRAMISU_CHAIN_ID } from './arkiv-sdk.js';
export { WorldCloudPersonhood, WORLD_VERIFY_BASE_URL } from './world-personhood.js';
export { createRpContextSigner, rpContextSigner, RP_CONTEXT_TTL_S } from './world-rp-context.js';
export {
  RemoteFacilitator,
  FACILITATOR_HOSTS,
  DEFAULT_FACILITATOR_URL,
  plausibleTransaction,
} from './remote-facilitator.js';
export { SelfRunFacilitator } from './self-run-facilitator.js';
export { RoutingPaymentRail } from './routing-rail.js';
export {
  EsimAccessReseller,
  ESIMACCESS_BASE_URL,
  ESIMACCESS_WEBHOOK_IPS,
  WEBHOOK_IP_HEADER,
  WEBHOOK_TOKEN_HEADER,
} from './esimaccess-reseller.js';
export { MegaEsimReseller } from './megaesim-reseller.js';
export {
  InventoryReseller,
  sealInventory,
  INVENTORY_AAD,
  type InventoryEntry,
} from './inventory-reseller.js';
export { FallbackReseller } from './fallback-reseller.js';
export { HcsLog, HEDERA_MIRROR } from './hcs-log.js';
export { createHederaClient, type HederaClientLike } from './hedera-sdk.js';
export { hcs14Uaid, type Hcs14Input } from './hcs14.js';
export { EnsResolver, type EnsClient } from './ens-resolver.js';
export {
  EnsCampaigns,
  createEnsCampaigns,
  dnsName,
  textResource,
  API_RESOLVER_ROLES,
  ENS_SEPOLIA,
  FACTORY_ABI,
  RESOLVER_ABI,
  USER_REGISTRY_ABI,
  type EnsCampaignsConfig,
  type EnsCampaignsOptions,
} from './ens-campaigns.js';
export { SwarmBlobStore } from './swarm-blobs.js';
export { EvmTreasury } from './evm-treasury.js';
export { HederaTreasury } from './hedera-treasury.js';
export { RoutingTreasury } from './routing-treasury.js';

export interface LiveDeps {
  /** Injected into every HTTP and JSON-RPC call (the Wednesday recorder wraps the real fetch). */
  fetch?: typeof fetch;
  now?: () => number;
  logger?: Pick<Console, 'info' | 'warn'>;
  /** Override the Hedera SDK binding (tests; the agent's own Agent Kit wallet). */
  hederaClient?: (opts: { accountId: string; privateKey: string }) => HederaClientLike;
}

export interface LiveAdapters extends Adapters {
  /** The backend rp_context signer for POST /world/rp-context; undefined without WORLD_RP_SIGNING_KEY. */
  rpContext: { issue(): ReturnType<ReturnType<typeof createRpContextSigner>['issue']> } | undefined;
  /** The Hedera fee payer the facilitator advertises, checked against X402_HEDERA_FEE_PAYER (call at boot, A-20). */
  feePayer(network: string): Promise<string>;
}

function evmChain(id: number, rpcUrl: string): Chain {
  return defineChain({
    id,
    name: `eip155:${id}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

export function createLiveAdapters(config: LiveConfig, deps: LiveDeps = {}): LiveAdapters {
  const now = deps.now ?? Date.now;
  const logger = deps.logger ?? console;
  const fetchFn = deps.fetch;
  const transport = (url: string) => http(url, fetchFn ? { fetchFn } : {});
  const hederaNetwork = config.hedera.network;
  const hedera = deps.hederaClient ?? ((o) => createHederaClient({ network: hederaNetwork, ...o }));

  const chain = evmChain(config.chain.id, config.chain.rpcUrl);
  const publicClient = createPublicClient({
    chain,
    transport: transport(config.chain.rpcUrl),
  }) as PublicClient;
  const wallet = (key: `0x${string}`) =>
    createWalletClient({
      chain,
      transport: transport(config.chain.rpcUrl),
      account: privateKeyToAccount(key, { nonceManager }),
    });
  const usdc = config.chain.usdc;
  const evmPayments = new Map(
    config.payments.evmNetworks.map((payment) => {
      const paymentChain = evmChain(payment.id, payment.rpcUrl);
      const paymentPublic = createPublicClient({
        chain: paymentChain,
        transport: transport(payment.rpcUrl),
      }) as PublicClient;
      return [
        payment.network,
        {
          ...payment,
          publicClient: paymentPublic,
          walletClient: createWalletClient({
            chain: paymentChain,
            transport: transport(payment.rpcUrl),
            account: privateKeyToAccount(config.treasury.evmKey.reveal(), { nonceManager }),
          }),
        },
      ] as const;
    }),
  );

  // ── payments: one rail per advertised network
  const rails: Record<string, PaymentRail> = {};
  const remotes = new Map<string, RemoteFacilitator>();
  const fetchOpt = fetchFn ? { fetch: fetchFn } : {};
  for (const network of config.payments.networks) {
    if (network.startsWith('eip155:') && config.payments.facilitator === 'self') {
      rails[network] = new SelfRunFacilitator({
        publicClient,
        relayer: createViemRelayer({
          walletClient: wallet(config.payments.relayerKey!.reveal()),
          publicClient,
          simulate: true,
        }),
        token: usdc!,
        chainId: config.chain.id,
        network,
        now,
      });
      continue;
    }
    const hederaNet = network.startsWith('hedera:');
    const remote = new RemoteFacilitator({
      url: hederaNet ? config.payments.hederaUrl : config.payments.evmUrl,
      ...fetchOpt,
      allowedHosts: [...FACILITATOR_HOSTS],
      networks: [network],
      ...(config.payments.hederaFeePayer
        ? { expectFeePayer: { [network]: config.payments.hederaFeePayer } }
        : {}),
      ...(hederaNet
        ? { mirrorUrl: config.hedera.mirrorUrl }
        : {
            evmReceipts: {
              receipt: async (hash) => {
                const r = await evmPayments
                  .get(network)!
                  .publicClient.getTransactionReceipt({ hash })
                  .catch(() => null);
                return r ? r.status : null;
              },
            },
          }),
      now,
      logger,
    });
    remotes.set(network, remote);
    rails[network] = remote;
  }

  // ── reseller chain: primary (+ inventory fallback)
  const inventory = config.reseller.inventory
    ? new InventoryReseller({
        file: config.reseller.inventory.file,
        sealKey: Uint8Array.from(
          Buffer.from(config.reseller.inventory.sealKey.reveal().slice(2), 'hex'),
        ),
        now,
      })
    : undefined;
  const e = config.reseller.esimaccess;
  let primary: Reseller;
  if (config.reseller.primary === 'esimaccess' && e) {
    primary = new EsimAccessReseller({
      accessCode: e.accessCode.reveal(),
      ...(e.signingKey ? { signingKey: e.signingKey.reveal() } : {}),
      webhookToken: e.webhookToken.reveal(),
      webhookIps: e.webhookIps,
      baseUrl: e.baseUrl,
      ...fetchOpt,
      now,
      logger,
    });
  } else if (config.reseller.primary === 'inventory' && inventory) {
    primary = inventory;
  } else {
    logger.warn('live: RESELLER=mock — profiles are simulated');
    primary = new MockReseller({ now });
  }
  const reseller =
    config.reseller.fallback === 'inventory' && inventory && primary !== inventory
      ? new FallbackReseller(primary, inventory, logger)
      : primary;

  // ── treasury: the separate refund wallets (A-31)
  const treasuries: Record<string, Treasury> = {};
  if (usdc) {
    treasuries[config.chain.network] = new EvmTreasury({
      walletClient: wallet(config.treasury.evmKey.reveal()),
      publicClient,
      token: usdc,
      network: config.chain.network,
    });
  }
  for (const payment of evmPayments.values()) {
    treasuries[payment.network] = new EvmTreasury({
      walletClient: payment.walletClient,
      publicClient: payment.publicClient,
      token: payment.usdc,
      network: payment.network,
    });
  }
  if (config.treasury.hedera) {
    const network = `hedera:${hederaNetwork}` as const;
    treasuries[network] = new HederaTreasury({
      client: hedera({
        accountId: config.treasury.hedera.accountId,
        privateKey: config.treasury.hedera.privateKey.reveal(),
      }),
      tokenId: USDC_ASSET[network],
      network,
      mirrorUrl: config.hedera.mirrorUrl,
      ...fetchOpt,
    });
  }

  const ens = (rpc: string, c: Chain) =>
    createPublicClient({ chain: c, transport: transport(rpc) });
  if (!config.swarm) logger.warn('live: no SWARM_BEE_URL — blobs are kept in memory');
  const w = config.world;

  return {
    mode: 'live',
    ledger: new ArkivLedger({
      client: createArkivClient({
        chainId: config.ledger.chainId,
        rpcUrl: config.ledger.rpcUrl,
        accessKey: config.ledger.accessKey,
        ...(config.ledger.privateKey ? { privateKey: config.ledger.privateKey.reveal() } : {}),
        ...(fetchFn ? { fetchFn } : {}),
      }),
      blockTimeMs: config.ledger.blockTimeMs,
      now,
      writer: config.ledger.writer,
      logger,
    }),
    personhood: new WorldCloudPersonhood({
      rpId: w.rpId,
      action: w.action,
      environment: w.environment,
      baseUrl: w.baseUrl,
      ...fetchOpt,
      logger,
    }),
    payments: new RoutingPaymentRail(rails),
    inference: new MockInference({ model: 'none' }),
    names: new EnsResolver({
      mainnetClient: ens(config.ens.rpcUrl, mainnet),
      ...(config.ens.fallbackRpcUrl
        ? { fallbackClient: ens(config.ens.fallbackRpcUrl, sepolia) }
        : {}),
    }),
    reseller,
    consensus: new HcsLog({
      client: hedera({
        accountId: config.hedera.accountId,
        privateKey: config.hedera.privateKey.reveal(),
      }),
      mirrorUrl: config.hedera.mirrorUrl,
      ...fetchOpt,
    }),
    blobs: config.swarm
      ? new SwarmBlobStore({ ...config.swarm, ...fetchOpt })
      : new MemoryBlobStore(),
    treasury: new RoutingTreasury(treasuries),
    rpContext: w.signingKey
      ? createRpContextSigner({
          appId: w.appId,
          rpId: w.rpId,
          action: w.action,
          environment: w.environment,
          signingKeyHex: w.signingKey,
          now,
        })
      : undefined,
    feePayer: async (network) => {
      const remote = remotes.get(network);
      if (!remote) throw new Error(`no remote facilitator for ${network}`);
      return remote.feePayer(network);
    },
  };
}
