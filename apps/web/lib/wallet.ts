/**
 * The paying wallet as the screens see it. Connecting is RainbowKit + wagmi (lib/wagmi.ts); in MODE=local the
 * labelled demo wallet is a wagmi connector whose EIP-1193 provider signs in this app's local-only route handler
 * (/api/demo-wallet) with a key from the server's environment, so no private key ever reaches the browser bundle
 * (T-63) and web never imports adapters.
 */
import {
  createPublicClient,
  custom,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type TypedDataDefinition,
  type WalletClient,
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
/** The chain id of an `eip155:<id>` network (an EVM accepts entry's). */
export const chainIdOf = (network: string): number => Number(network.slice('eip155:'.length));

/**
 * The app's Wallet over a wagmi wallet client (lib/wagmi.ts): RainbowKit connects, wagmi hands over the client, and
 * pay402 / sponsor / redeem keep signing through this one interface. `chainId` is the wallet's chain, which may differ
 * from the one an action signs on: callers switch first (useEnsureChain in lib/hooks.ts).
 */
export function walletFor(
  client: WalletClient,
  kind: Wallet['kind'],
  name: string,
  address: Address,
  chainId: number,
): Wallet {
  return {
    kind,
    name,
    address,
    chainId,
    network: caip2(chainId),
    signTypedData: (td) => client.signTypedData({ ...td, account: address }),
    sendTransaction: ({ to, data }) =>
      client.sendTransaction({ account: address, to, data, chain: null } as never),
    // Local: Anvil directly (1 s blocks); live: the wallet's own RPC.
    reader:
      process.env.NEXT_PUBLIC_MODE === 'local'
        ? createPublicClient({ transport: http(config.anvilRpcUrl), pollingInterval: 250 })
        : createPublicClient({ transport: custom(client), pollingInterval: 1000 }),
  };
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
