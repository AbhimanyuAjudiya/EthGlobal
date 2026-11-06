// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook } from '@testing-library/react';
import { http } from 'viem';
import { baseSepolia, hederaTestnet } from 'viem/chains';
import { describe, expect, it } from 'vitest';
import { createConfig, WagmiProvider } from 'wagmi';
import { connect, getAccount } from 'wagmi/actions';
import { mock } from 'wagmi/connectors';

import { useEnsureChain, WrongChainError } from '../lib/hooks';

import type { Wallet } from '../lib/wallet';
import type { ReactNode } from 'react';

const ADDRESS = '0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc';

/** A wagmi config whose one (mock) wallet sits on Base Sepolia; `refuse` makes it decline every chain switch. */
async function setup(refuse = false) {
  const config = createConfig({
    chains: [baseSepolia, hederaTestnet],
    connectors: [mock({ accounts: [ADDRESS], features: { switchChainError: refuse } })],
    transports: { [baseSepolia.id]: http(), [hederaTestnet.id]: http() },
    // nothing persisted, so mounting the provider does not rehydrate an empty (disconnected) state over it
    storage: null,
  });
  const [connector] = config.connectors;
  if (!connector) throw new Error('no mock connector');
  await connect(config, { connector, chainId: baseSepolia.id });
  const queries = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <WagmiProvider config={config} reconnectOnMount={false}>
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
  const { result } = renderHook(() => useEnsureChain(), { wrapper });
  const wallet = {
    kind: 'injected',
    name: 'Mock',
    address: ADDRESS,
    chainId: baseSepolia.id,
    network: 'eip155:84532',
  } as unknown as Wallet;
  return { config, ensureChain: result.current, wallet };
}

describe('useEnsureChain — switch right before a signature on another chain', () => {
  it('already there: no switch, the same wallet', async () => {
    const { config, ensureChain, wallet } = await setup();
    expect(await ensureChain(wallet, baseSepolia.id)).toBe(wallet);
    expect(getAccount(config).chainId).toBe(baseSepolia.id);
  });

  it('elsewhere: switches the wallet (296 for the Recharge domain) and hands back the wallet on that chain', async () => {
    const { config, ensureChain, wallet } = await setup();
    const switched = await ensureChain(wallet, hederaTestnet.id);
    expect(getAccount(config).chainId).toBe(hederaTestnet.id);
    expect(switched).toMatchObject({ address: ADDRESS, chainId: 296, network: 'eip155:296' });
  });

  it('a refused switch is WrongChainError with the chain as the wallet names it, never a silent decline', async () => {
    const { ensureChain, wallet } = await setup(true);
    const error = await ensureChain(wallet, hederaTestnet.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(WrongChainError);
    expect((error as WrongChainError).message).toBe(
      'Switch to Hedera Testnet in your wallet to continue',
    );
    // not a 4001: the screens show the plain message instead of treating it as "you declined"
    expect((error as { code?: number }).code).toBeUndefined();
  });
});
