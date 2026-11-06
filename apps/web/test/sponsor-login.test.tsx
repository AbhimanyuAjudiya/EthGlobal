// @vitest-environment jsdom
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SponsorTable } from '../components/SponsorTable';

import type * as ApiModule from '../lib/api';
import type * as SponsorModule from '../lib/sponsor';

const mocks = vi.hoisted(() => {
  const wallet = { address: `0x${'ab'.repeat(20)}`, network: 'eip155:31337' };
  return {
    wallet,
    ensure: vi.fn(async () => wallet),
    login: vi.fn(),
    sponsor: vi.fn(async () => {
      throw new Error('Temporary outage');
    }),
  };
});
vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
vi.mock('../lib/hooks', () => ({
  useWallet: () => ({ wallet: mocks.wallet }),
  useEnsureChain: () => mocks.ensure,
  useClock: () => 1,
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: { sponsor: mocks.sponsor },
}));
vi.mock('../lib/sponsor', async (original) => ({
  ...(await original<typeof SponsorModule>()),
  sponsorLogin: mocks.login,
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe('sponsor login recovery', () => {
  it('permits a second sign-in after the first wallet request was rejected', async () => {
    mocks.login.mockRejectedValueOnce({ code: 4001 }).mockResolvedValue({
      issuedAt: Date.now(),
      signature: '0xaa',
      sponsor: mocks.wallet.address,
    });
    render(<SponsorTable id={`0x${'12'.repeat(32)}`} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign in again' }));
    await waitFor(() => expect(mocks.login).toHaveBeenCalledTimes(2));
    await screen.findByText(/Temporary outage/);
  });
  it('expires the old bearer and offers a new wallet signature', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.login.mockResolvedValue({
      issuedAt: Date.now(),
      signature: '0xaa',
      sponsor: mocks.wallet.address,
    });
    render(<SponsorTable id={`0x${'34'.repeat(32)}`} />);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(55 * 60_000);
    });
    expect(screen.getByText(/Your sponsor sign-in expired/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign in again' }));
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.login).toHaveBeenCalledTimes(2);
  });
});
