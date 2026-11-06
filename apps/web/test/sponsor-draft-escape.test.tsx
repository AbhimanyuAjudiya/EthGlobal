// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CampaignForm } from '../components/CampaignForm';

import type * as ApiModule from '../lib/api';
import type * as EnvModule from '../lib/env';
import type * as SponsorModule from '../lib/sponsor';

const mocks = vi.hoisted(() => {
  const address = `0x${'12'.repeat(20)}` as const;
  const wallet = {
    address,
    name: 'Test wallet',
    network: 'eip155:31337',
    chainId: 31337,
    reader: { getBlock: vi.fn(), readContract: vi.fn(), getTransactionReceipt: vi.fn() },
    sendTransaction: vi.fn(),
  };
  return { wallet, ensure: vi.fn(async () => wallet), login: vi.fn(), register: vi.fn() };
});
vi.mock('@rainbow-me/rainbowkit', () => ({ useConnectModal: () => ({}) }));
vi.mock('../lib/hooks', () => ({
  useWallet: () => ({ wallet: mocks.wallet }),
  useEnsureChain: () => mocks.ensure,
  useHydrated: () => true,
  useClock: () => 10,
}));
vi.mock('../lib/env', async (original) => ({
  ...(await original<typeof EnvModule>()),
  config: { chainId: 31337, dataDropAddress: `0x${'34'.repeat(20)}` },
}));
vi.mock('../lib/api', async (original) => ({
  ...(await original<typeof ApiModule>()),
  api: { registerSponsor: mocks.register },
}));
vi.mock('../lib/sponsor', async (original) => ({
  ...(await original<typeof SponsorModule>()),
  sponsorLogin: mocks.login,
}));

const ID = `0x${'12'.repeat(20)}000000000001a1afb2298b00`;
/** A draft funded before the event release: approve and create done, no `event`, never registered. */
const legacyDraft = {
  draft: { name: 'Mumbai Welcome', budgetUsd: '12', priceUsd: '1.20', country: '', planId: '' },
  campaign: {
    id: ID,
    sponsor: mocks.wallet.address,
    name: 'Mumbai Welcome',
    bundleMb: { orb: 1000, document: 1000, device: 0 },
    pricePerClaimUsd6: '1200000',
    maxClaims: 10,
    claimsPerHour: 10,
    validityDays: 7,
    wholesaleUsd6PerGb: '1200000',
    idResaleUsd6: '1500000',
    planId: 'in-1gb-7d',
    network: 'eip155:31337',
    contract: `0x${'34'.repeat(20)}`,
    expiresAt: Date.now() + 6 * 86_400_000,
  },
  budget: '12000000',
  approveHash: `0x${'a1'.repeat(32)}`,
  createHash: `0x${'a2'.repeat(32)}`,
};

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('recharge.sponsor.pending', JSON.stringify(legacyDraft));
  vi.stubEnv('NEXT_PUBLIC_MODE', 'live');
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  localStorage.clear();
});

describe('a funded draft the live API can no longer register', () => {
  it('explains what remains of it and "Start a new campaign" frees the form without deleting it', async () => {
    render(<CampaignForm />);
    const stuck = await screen.findByTestId('draft-stuck');
    expect(stuck.textContent).toMatch(/funded before event terms were required/);
    expect(stuck.textContent).toMatch(/\$12\.00 USDC/);
    expect(screen.getByRole('button', { name: 'Pause campaign' }).hasAttribute('disabled')).toBe(
      false,
    );
    expect(
      screen.getByRole('button', { name: 'Refund unspent budget' }).hasAttribute('disabled'),
    ).toBe(false);
    expect(screen.getByTestId('campaign-name').hasAttribute('disabled')).toBe(true);
    expect(screen.getByTestId('campaign-submit').textContent).toBe('Resume this campaign');

    fireEvent.click(screen.getByTestId('campaign-start-new'));
    await waitFor(() => expect(screen.queryByTestId('draft-stuck')).toBeNull());
    expect(localStorage.getItem('recharge.sponsor.pending')).toBeNull();
    const archive: unknown = JSON.parse(
      localStorage.getItem('recharge.sponsor.pending.archive') ?? '',
    );
    expect(archive).toMatchObject([{ campaign: { id: ID } }]);
    const name = screen.getByTestId<HTMLInputElement>('campaign-name');
    expect(name.hasAttribute('disabled')).toBe(false);
    expect(name.value).toBe('');
    expect(screen.getByTestId('campaign-submit').textContent).toBe('Create campaign · $12.00 USDC');
    expect(mocks.register).not.toHaveBeenCalled();
  });
});
