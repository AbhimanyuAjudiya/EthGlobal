import { afterEach, describe, expect, it, vi } from 'vitest';

import { contentSecurityPolicy } from '../lib/csp';
import { appChains, walletList } from '../lib/wagmi';

const ids = (projectId?: string) =>
  walletList(projectId).map((g) => ({
    group: g.groupName,
    ids: g.wallets.map((w) => w({ projectId: projectId ?? '', appName: 'Recharge' }).id),
  }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('wallet list (lib/wagmi.ts)', () => {
  it('live without a WalletConnect project id: injected wallets only, so the modal never needs the relay', () => {
    vi.stubEnv('NEXT_PUBLIC_MODE', 'live');
    expect(ids('')).toEqual([{ group: 'Wallets', ids: ['injected'] }]);
  });

  it('live with a project id: WalletConnect and Rainbow join; still no demo wallet', () => {
    vi.stubEnv('NEXT_PUBLIC_MODE', 'live');
    expect(ids('test-project')).toEqual([
      { group: 'Wallets', ids: ['injected', 'rainbow', 'walletConnect'] },
    ]);
  });

  it('the demo connectors (one per role) exist only in MODE=local', () => {
    vi.stubEnv('NEXT_PUBLIC_MODE', 'local');
    expect(ids('')).toContainEqual({
      group: 'Local',
      ids: ['demo-human', 'demo-sponsor', 'demo-recipient'],
    });
  });

  it('chains: Base Sepolia, Hedera testnet and Sepolia (ENS branding); Anvil only in MODE=local', () => {
    vi.stubEnv('NEXT_PUBLIC_MODE', 'live');
    expect(appChains().map((c) => c.id)).toEqual([84532, 296, 11155111]);
    vi.stubEnv('NEXT_PUBLIC_MODE', 'local');
    expect(appChains().map((c) => c.id)).toEqual([84532, 296, 11155111, 31337]);
  });
});

describe('CSP and WalletConnect (lib/csp.ts)', () => {
  const directive = (csp: string, name: string) =>
    csp.split('; ').find((d) => d.startsWith(`${name} `)) ?? '';

  it('without a project id: no WalletConnect host anywhere', () => {
    vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', '');
    const csp = contentSecurityPolicy('n');
    expect(csp).not.toMatch(/walletconnect|web3modal/);
  });

  it('with a project id: the relay and the registry in connect-src, its logos in img-src, nothing more', () => {
    vi.stubEnv('NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID', 'test-project');
    const csp = contentSecurityPolicy('n');
    expect(directive(csp, 'connect-src')).toContain(
      'wss://relay.walletconnect.com wss://relay.walletconnect.org https://api.web3modal.org',
    );
    expect(directive(csp, 'img-src')).toBe(
      "img-src 'self' data: blob: https://metadata.ens.domains https://explorer-api.walletconnect.com",
    );
    expect(directive(csp, 'script-src')).not.toContain('unsafe-inline');
    expect(directive(csp, 'frame-src')).toBe('');
  });
});
