import {
  BaseError,
  ContractFunctionRevertedError,
  createPublicClient,
  createWalletClient,
  defineChain,
  getAddress,
  http,
  type Abi,
  type Address,
  type Chain,
  type PublicClient,
} from 'viem';
import { nonceManager, privateKeyToAccount } from 'viem/accounts';

import DataDropAbiJson from '@ethglobal/contracts/abi/DataDrop.json' with { type: 'json' };
import { DATADROP_ERRORS, type DataDropError } from '@ethglobal/protocol/events';
import type { Hex } from '@ethglobal/protocol/ids';

import type { Env } from './env.js';

export const LOCAL_CHAIN_ID = 31337;
export const DATADROP_ABI = DataDropAbiJson as Abi;

export type ChainIdResolver = () => Promise<number>;

/** Local mode never touches a node; live mode asks the configured RPC for its chain id. */
export function createChainIdResolver(env: Pick<Env, 'MODE' | 'RPC_URL'>): ChainIdResolver {
  if (env.MODE === 'local') {
    return () => Promise.resolve(LOCAL_CHAIN_ID);
  }
  const client = createPublicClient({
    transport: http(env.RPC_URL, { retryCount: 1, timeout: 5_000 }),
  });
  return () => client.getChainId();
}

/** `DataDrop.campaigns(id)` with money as bigint USDC base units and `expiresAt` in ms. */
export interface ChainCampaign {
  sponsor: Address;
  pricePerClaim: bigint;
  budget: bigint;
  spent: bigint;
  claimsPerHour: number;
  expiresAt: number;
  paused: boolean;
}

/** The attestor's view of DataDrop (INTERFACES §6.1). Reads are plain eth_calls; writes go through one queue. */
export interface DataDropClient {
  readonly address: Address;
  readonly attestor: Address;
  campaign(id: Hex): Promise<ChainCampaign>;
  claimed(id: Hex, claimKey: Hex): Promise<boolean>;
  claimsInHour(id: Hex, hourBucket: number): Promise<number>;
  currentHourBucket(): Promise<number>;
  /** Resolves after `CHAIN_CONFIRMATIONS`; a revert throws `ChainRevert`, anything else `ChainUnavailable`. */
  claim(id: Hex, claimKey: Hex): Promise<{ tx: Hex }>;
  /** Recovery after a claim mined but the response/intent update was interrupted. */
  claimTransaction?(id: Hex, claimKey: Hex): Promise<Hex | undefined>;
  pause(id: Hex, paused: boolean): Promise<{ tx: Hex }>;
}

/** A DataDrop custom error by name (`DATADROP_ERRORS` or one of the ABI's extra errors). */
export class ChainRevert extends Error {
  override readonly name = 'ChainRevert';
  constructor(readonly errorName: string) {
    super(`DataDrop reverted ${errorName}`);
  }
}

/** The node did not answer, or the transaction failed for a reason that is not a decodable revert. */
export class ChainUnavailable extends Error {
  override readonly name = 'ChainUnavailable';
}

/** True for the custom errors INTERFACES §1.10 names (the ABI has a few more, RT-C-01…07). */
export const isDataDropError = (name: string): name is DataDropError =>
  (DATADROP_ERRORS as readonly string[]).includes(name);

/** viem error → the DataDrop error name, or undefined when the failure is not a contract revert. */
export function decodeRevert(error: unknown): string | undefined {
  if (error instanceof ChainRevert) return error.errorName;
  if (!(error instanceof BaseError)) return undefined;
  const revert = error.walk((e) => e instanceof ContractFunctionRevertedError);
  if (revert instanceof ContractFunctionRevertedError) {
    const name: string | undefined = revert.data?.errorName;
    return name !== undefined && name !== '' ? name : undefined;
  }
  return undefined;
}

/** One in-flight transaction per attestor key (nonces stay sequential, T-01). */
export class SerialQueue {
  #tail: Promise<unknown> = Promise.resolve();

  run<T>(task: () => Promise<T>): Promise<T> {
    const next = this.#tail.then(task, task);
    this.#tail = next.catch(() => undefined);
    return next;
  }
}

export interface DataDropClientOptions {
  rpcUrl: string;
  chainId: number;
  address: Address;
  attestorKey: Hex;
  confirmations: number;
  gas: bigint;
}

function chainFor(chainId: number, rpcUrl: string): Chain {
  return defineChain({
    id: chainId,
    name: `chain-${chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

/** Anvil mines every second: poll receipts at 250 ms there (viem's default is 4 s); 2 s elsewhere. */
export const pollingIntervalFor = (chainId: number): number =>
  chainId === LOCAL_CHAIN_ID ? 250 : 2_000;

export function createPublic(rpcUrl: string, chainId: number): PublicClient {
  return createPublicClient({
    chain: chainFor(chainId, rpcUrl),
    pollingInterval: pollingIntervalFor(chainId),
    transport: http(rpcUrl, { retryCount: 1, timeout: 10_000 }),
  });
}

/** viem DataDrop client for the attestor (brief §4.4). Hedera's relay wants an explicit gas limit. */
export function createDataDropClient(opts: DataDropClientOptions): DataDropClient {
  const chain = chainFor(opts.chainId, opts.rpcUrl);
  const account = privateKeyToAccount(opts.attestorKey, { nonceManager });
  const publicClient = createPublic(opts.rpcUrl, opts.chainId);
  const wallet = createWalletClient({
    chain,
    account,
    transport: http(opts.rpcUrl, { retryCount: 0, timeout: 20_000 }),
  });
  const address = getAddress(opts.address);
  const queue = new SerialQueue();
  const read = async <T>(functionName: string, args: readonly unknown[]): Promise<T> => {
    try {
      return (await publicClient.readContract({
        address,
        abi: DATADROP_ABI,
        functionName,
        args,
      })) as T;
    } catch (error) {
      throw new ChainUnavailable(`DataDrop.${functionName} read failed`, { cause: error });
    }
  };
  const write = (functionName: 'claim' | 'pause', args: readonly unknown[]) =>
    queue.run(async () => {
      let request;
      try {
        ({ request } = await publicClient.simulateContract({
          account,
          address,
          abi: DATADROP_ABI,
          functionName,
          args,
          gas: opts.gas,
        }));
      } catch (error) {
        const name = decodeRevert(error);
        if (name !== undefined) throw new ChainRevert(name);
        throw new ChainUnavailable(`DataDrop.${functionName} simulation failed`, { cause: error });
      }
      try {
        const tx = await wallet.writeContract(request);
        const receipt = await publicClient.waitForTransactionReceipt({
          hash: tx,
          confirmations: opts.confirmations,
        });
        if (receipt.status !== 'success')
          throw new ChainUnavailable(`DataDrop.${functionName} reverted on-chain`);
        return { tx };
      } catch (error) {
        if (error instanceof ChainUnavailable) throw error;
        throw new ChainUnavailable(`DataDrop.${functionName} send failed`, { cause: error });
      }
    });

  return {
    address,
    attestor: account.address,
    async campaign(id) {
      const c = await read<{
        sponsor: Address;
        pricePerClaim: bigint;
        budget: bigint;
        spent: bigint;
        claimsPerHour: number;
        expiresAt: bigint;
        paused: boolean;
      }>('campaigns', [id]);
      return {
        sponsor: c.sponsor,
        pricePerClaim: c.pricePerClaim,
        budget: c.budget,
        spent: c.spent,
        claimsPerHour: Number(c.claimsPerHour),
        expiresAt: Number(c.expiresAt) * 1000,
        paused: c.paused,
      };
    },
    claimed: (id, claimKey) => read<boolean>('claimed', [id, claimKey]),
    async claimTransaction(id, claimKey) {
      try {
        const logs = await publicClient.getContractEvents({
          address,
          abi: DATADROP_ABI,
          eventName: 'Claimed',
          args: { id, claimKey },
          fromBlock: 0n,
          toBlock: 'latest',
        });
        return logs.at(-1)?.transactionHash ?? undefined;
      } catch (error) {
        throw new ChainUnavailable('claim recovery event read failed', { cause: error });
      }
    },
    claimsInHour: async (id, bucket) =>
      Number(await read<number>('claimsInHour', [id, BigInt(bucket)])),
    currentHourBucket: async () => Number(await read<bigint>('currentHourBucket', [])),
    claim: (id, claimKey) => write('claim', [id, claimKey]),
    pause: (id, paused) => write('pause', [id, paused]),
  };
}
