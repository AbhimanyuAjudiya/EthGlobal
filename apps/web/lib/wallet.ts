/**
 * Wallets over EIP-1193 only (viem, no wagmi/RainbowKit — D-12): EIP-6963 discovery of injected wallets
 * (MetaMask, Coinbase Wallet) and, in MODE=local only, the labelled demo wallet — an EIP-1193 provider whose
 * signing runs in this app's local-only route handler (/api/demo-wallet) with a key from the server's
 * environment, so no private key ever reaches the browser bundle (T-63) and web never imports adapters.
 */
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type TypedDataDefinition,
} from 'viem';

import { config } from './env';

export interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}

export type DemoRole = 'human' | 'sponsor' | 'recipient';
/** Anvil indices behind the demo roles (the server derives the keys; these are labels). */
export const DEMO_ROLE_INDEX: Readonly<Record<DemoRole, number>> = {
  human: 5,
  sponsor: 3,
  recipient: 9,
};

/** The Anvil account index a demo wallet is labelled with ("demo wallet · Anvil #5" → 5); the human by default. */
export const demoIndex = (wallet: { name: string }): number =>
  Number(/#(\d+)/.exec(wallet.name)?.[1] ?? DEMO_ROLE_INDEX.human);

export interface Wallet {
  kind: 'injected' | 'demo';
  /** "MetaMask", "demo wallet · Anvil #5". */
  name: string;
  address: Address;
  chainId: number;
  /** CAIP-2 of the wallet's chain: "eip155:31337". */
  network: string;
  signTypedData(td: TypedDataDefinition): Promise<Hex>;
  sendTransaction(tx: { to: Address; data: Hex }): Promise<Hex>;
  reader: PublicClient;
}

export const caip2 = (chainId: number): string => `eip155:${chainId}`;

interface Announced {
  info: { name: string; rdns: string };
  provider: Eip1193;
}

/** EIP-6963: ask every injected wallet to announce itself; fall back to window.ethereum. */
export function discoverInjected(timeoutMs = 250): Promise<Announced[]> {
  if (typeof window === 'undefined') return Promise.resolve([]);
  return new Promise((resolve) => {
    const found: Announced[] = [];
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<Announced>).detail;
      if (detail?.provider && !found.some((f) => f.info.rdns === detail.info.rdns))
        found.push(detail);
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    setTimeout(() => {
      window.removeEventListener('eip6963:announceProvider', onAnnounce);
      const legacy = (window as unknown as { ethereum?: Eip1193 }).ethereum;
      if (found.length === 0 && legacy)
        found.push({ info: { name: 'Browser wallet', rdns: 'injected' }, provider: legacy });
      resolve(found);
    }, timeoutMs);
  });
}

function readerFor(provider: Eip1193): PublicClient {
  // Local: Anvil directly (1 s blocks); live: the wallet's own RPC.
  return process.env.NEXT_PUBLIC_MODE === 'local'
    ? createPublicClient({ transport: http(config.anvilRpcUrl), pollingInterval: 250 })
    : createPublicClient({ transport: custom(provider), pollingInterval: 1000 });
}

export async function connect(
  provider: Eip1193,
  kind: Wallet['kind'],
  name: string,
): Promise<Wallet> {
  const accounts = (await provider.request({ method: 'eth_requestAccounts' })) as Address[];
  const address = accounts[0];
  if (!address) throw new Error('no account');
  const chainId = Number(await provider.request({ method: 'eth_chainId' }));
  const client = createWalletClient({ account: address, transport: custom(provider) });
  return {
    kind,
    name,
    address,
    chainId,
    network: caip2(chainId),
    signTypedData: (td) => client.signTypedData({ ...td, account: address }),
    sendTransaction: ({ to, data }) =>
      client.sendTransaction({ account: address, to, data, chain: null } as never),
    reader: readerFor(provider),
  };
}

/**
 * MODE=local only: the labelled demo wallet. The transport lives in lib/local/demo-wallet.ts and is imported only
 * behind a literal `process.env.NEXT_PUBLIC_MODE === 'local'`, so a live build compiles it out (RT-W-12, T-63).
 */
export async function connectDemo(role: DemoRole): Promise<Wallet> {
  if (process.env.NEXT_PUBLIC_MODE === 'local') {
    const { demoProvider } = await import('./local/demo-wallet');
    return connect(demoProvider(role), 'demo', `demo wallet · Anvil #${DEMO_ROLE_INDEX[role]}`);
  }
  throw new Error('the demo wallet exists only in MODE=local');
}

/** True when the wallet declined (EIP-1193 4001) rather than failed. */
export const isUserRejection = (error: unknown): boolean => {
  const e = error as { code?: number; cause?: { code?: number }; name?: string } | undefined;
  return e?.code === 4001 || e?.cause?.code === 4001 || e?.name === 'UserRejectedRequestError';
};

/**
 * "Now" for anything the API or the chain checks against its own clock (EIP-3009 validBefore, SponsorLogin
 * issuedAt). Live: the wall clock. MODE=local: the latest block's timestamp, because the e2e harness moves the
 * API's local clock and Anvil's time together (POST /__local/clock + evm_increaseTime).
 */
export async function chainNow(wallet: Pick<Wallet, 'reader'>): Promise<number> {
  if (process.env.NEXT_PUBLIC_MODE !== 'local') return Date.now();
  try {
    const block = await wallet.reader.getBlock();
    return Math.max(Number(block.timestamp) * 1000, Date.now());
  } catch {
    return Date.now();
  }
}
