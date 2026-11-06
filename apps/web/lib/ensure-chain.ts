import { getAccount, switchChain } from 'wagmi/actions';

import type { Config } from 'wagmi';

/**
 * Puts the connected wallet on `chainId` before a transaction there (the wallet is asked to add the chain when it
 * does not know it); a no-op when it is already on it. The chain must be one of lib/wagmi.ts `appChains()`.
 */
export async function ensureChain(chainId: number, config: Config): Promise<void> {
  if (getAccount(config).chainId === chainId) return;
  await switchChain(config, { chainId });
}
