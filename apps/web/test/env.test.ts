import { afterEach, describe, expect, it, vi } from 'vitest';

const NAMES = [
  'NEXT_PUBLIC_CHAIN_ID',
  'NEXT_PUBLIC_MODE',
  'NEXT_PUBLIC_EXPLORER_EVM',
  'NEXT_PUBLIC_EXPLORER_HEDERA',
] as const;

// lib/env.ts reads process.env at module load: stub, drop the module cache, import afresh.
async function load(env: Partial<Record<(typeof NAMES)[number], string | undefined>>) {
  vi.resetModules();
  for (const name of NAMES) vi.stubEnv(name, env[name]);
  return import('../lib/env');
}

describe('IS_TESTNET and the explorer defaults follow NEXT_PUBLIC_CHAIN_ID', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['31337', true],
    ['84532', true],
    ['296', true],
    ['295', false],
    ['8453', false],
    ['424242', true], // unknown chain: fail-safe, the strip stays
    [undefined, true], // unset: Base Sepolia
  ])('chain %s → IS_TESTNET %s', async (id, testnet) => {
    expect((await load({ NEXT_PUBLIC_CHAIN_ID: id })).IS_TESTNET).toBe(testnet);
  });

  it('explorer defaults are keyed by chain id; a non-empty env value wins', async () => {
    let { config } = await load({ NEXT_PUBLIC_CHAIN_ID: '295' });
    expect(config.explorerHedera).toBe('https://hashscan.io/mainnet');
    expect(config.explorerEvm).toBe('');
    ({ config } = await load({ NEXT_PUBLIC_CHAIN_ID: '8453', NEXT_PUBLIC_EXPLORER_EVM: '' }));
    expect(config.explorerEvm).toBe('https://basescan.org');
    expect(config.explorerHedera).toBe('https://hashscan.io/mainnet');
    ({ config } = await load({ NEXT_PUBLIC_CHAIN_ID: '84532' }));
    expect(config.explorerEvm).toBe('https://sepolia.basescan.org');
    expect(config.explorerHedera).toBe('https://hashscan.io/testnet');
    ({ config } = await load({ NEXT_PUBLIC_MODE: 'local' }));
    expect(config.chainId).toBe(31337);
    expect(config.explorerEvm).toBe('');
    ({ config } = await load({
      NEXT_PUBLIC_CHAIN_ID: '8453',
      NEXT_PUBLIC_EXPLORER_EVM: 'https://evm.test',
      NEXT_PUBLIC_EXPLORER_HEDERA: 'https://hedera.test',
    }));
    expect(config.explorerEvm).toBe('https://evm.test');
    expect(config.explorerHedera).toBe('https://hedera.test');
  });
});
