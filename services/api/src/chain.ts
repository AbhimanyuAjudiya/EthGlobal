import { createPublicClient, http } from 'viem';

import type { Env } from './env.js';

export const LOCAL_CHAIN_ID = 31337;

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
