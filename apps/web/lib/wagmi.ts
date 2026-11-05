/**
 * The EVM wallet layer: wagmi + RainbowKit (D-12 revised). Chains: Base Sepolia (84532) and Hedera testnet EVM (296),
 * the configured chain when it is a mainnet (8453 / 295), and Anvil (31337) only in MODE=local.
 *
 * Reads never leave for a public RPC: on the live chains the transport is the connected wallet's own EIP-1193
 * provider (what lib/wallet.ts `reader` did before), so csp.ts needs no RPC host; MODE=local reads Anvil directly.
 * WalletConnect (and the wallets that ride on it) are configured only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is
 * set; without it RainbowKit lists the EIP-6963 browser wallets plus the generic injected one, and never throws.
 * The MODE=local demo wallet is a wagmi connector per demo role, built only behind the literal MODE check below so a
 * live build folds it away; its transport (lib/local/demo-wallet.ts) is imported lazily behind the same check.
 */
import {
  connectorsForWallets,
  type Wallet as RkWallet,
  type WalletList,
} from '@rainbow-me/rainbowkit';
import { injectedWallet, rainbowWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { getAddress, type Address, type Chain } from 'viem';
import { base, baseSepolia, foundry, hedera, hederaTestnet } from 'viem/chains';
import { createConfig, createConnector, custom, http, type Config, type Transport } from 'wagmi';
import { getAccount } from 'wagmi/actions';

import { config as env } from './env';
import { DEMO_ROLE_INDEX, type DemoRole, type Eip1193 } from './wallet';

export const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '';

/** The chains the connect button and the switch offer; the app's own chain is always among them. */
export function appChains(): readonly [Chain, ...Chain[]] {
  const extra =
    process.env.NEXT_PUBLIC_MODE === 'local'
      ? [{ ...foundry, rpcUrls: { default: { http: [env.anvilRpcUrl] } } }]
      : env.chainId === base.id
        ? [base]
        : env.chainId === hedera.id
          ? [hedera]
          : [];
  return [baseSepolia, hederaTestnet, ...extra];
}

/** The id the demo connector for `role` registers under ("demo-human"). */
export const demoConnectorId = (role: DemoRole): string => `demo-${role}`;

/**
 * MODE=local only: the labelled demo wallet for `role` as a RainbowKit wallet. Its EIP-1193 provider signs in the
 * local-only route handler (/api/demo-wallet); no key reaches the browser (T-63).
 */
function demoWallet(role: DemoRole): () => RkWallet {
  const id = demoConnectorId(role);
  const name = `demo wallet · Anvil #${DEMO_ROLE_INDEX[role]}`;
  let provider: Promise<Eip1193> | undefined;
  const getProvider = (): Promise<Eip1193> => {
    if (process.env.NEXT_PUBLIC_MODE !== 'local')
      return Promise.reject(new Error('the demo wallet exists only in MODE=local'));
    return (provider ??= import('./local/demo-wallet').then((m) => m.demoProvider(role)));
  };
  const accounts = async (): Promise<readonly Address[]> =>
    ((await (await getProvider()).request({ method: 'eth_accounts' })) as string[]).map((a) =>
      getAddress(a),
    );
  const chain = async (): Promise<number> =>
    Number(await (await getProvider()).request({ method: 'eth_chainId' }));
  return () => ({
    id,
    name,
    iconBackground: '#fff',
    // a plain glyph, inline: no remote asset
    iconUrl:
      'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28"%3E%3Crect width="28" height="28" rx="6" fill="%23117878"/%3E%3C/svg%3E',
    createConnector: (details) =>
      createConnector<Eip1193>((cfg) => ({
        ...details,
        id,
        name,
        type: 'demo',
        async connect() {
          return { accounts: (await accounts()) as never, chainId: await chain() };
        },
        async disconnect() {
          // the route keeps no session
        },
        getAccounts: accounts,
        getChainId: chain,
        getProvider,
        isAuthorized: () => Promise.resolve(true),
        async switchChain({ chainId }) {
          const target = cfg.chains.find((c) => c.id === chainId);
          if (!target || chainId !== (await chain()))
            throw new Error('the demo wallet is Anvil only');
          return target;
        },
        onAccountsChanged: (list) =>
          cfg.emitter.emit('change', { accounts: list.map((a) => getAddress(a)) }),
        onChainChanged: (id) => cfg.emitter.emit('change', { chainId: Number(id) }),
        onDisconnect: () => cfg.emitter.emit('disconnect'),
      })),
  });
}

/** The wallet groups RainbowKit lists: WalletConnect ones only with a project id; the demo roles only in MODE=local. */
export function walletList(projectId = walletConnectProjectId): WalletList {
  const list: WalletList = [
    {
      groupName: 'Wallets',
      wallets: projectId ? [injectedWallet, rainbowWallet, walletConnectWallet] : [injectedWallet],
    },
  ];
  if (process.env.NEXT_PUBLIC_MODE === 'local')
    list.push({
      groupName: 'Local',
      wallets: (['human', 'sponsor', 'recipient'] as const).map(demoWallet),
    });
  return list;
}

/** EIP-1193 over whichever wallet is connected now; a read before any connection fails instead of leaving the page. */
function viaWallet(get: () => Config): Transport {
  return custom({
    async request({ method, params }: { method: string; params?: unknown }) {
      const connector = getAccount(get()).connector;
      if (!connector) throw new Error('no wallet connected');
      const provider = (await connector.getProvider()) as Eip1193;
      return provider.request({ method, ...(params === undefined ? {} : { params }) });
    },
  });
}

export function makeWagmiConfig(projectId = walletConnectProjectId): Config {
  const chains = appChains();
  // the wallet transport reads `wagmi` lazily, at request time, after it is assigned
  const wagmi: Config = createConfig({
    chains,
    // connectorsForWallets requires a string; without one no WalletConnect wallet is listed, so it is never used
    connectors: connectorsForWallets(walletList(projectId), { appName: 'Recharge', projectId }),
    ssr: true,
    transports: Object.fromEntries(
      chains.map((c) => [
        c.id,
        c.id === foundry.id ? http(env.anvilRpcUrl) : viaWallet(() => wagmi),
      ]),
    ),
  });
  return wagmi;
}
