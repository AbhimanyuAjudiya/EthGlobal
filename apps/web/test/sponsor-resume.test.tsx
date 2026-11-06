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
  return {
    wallet,
    ensure: vi.fn(async () => wallet),
    login: vi.fn(),
    plans: vi.fn(),
    register:
      vi.fn<(body: { campaign: { id: string } }) => Promise<{ id: string; auditKey: string }>>(),
    validate: vi.fn(async () => undefined),
  };
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
  api: { plans: mocks.plans, validateSponsor: mocks.validate, registerSponsor: mocks.register },
}));
vi.mock('../lib/sponsor', async (original) => ({
  ...(await original<typeof SponsorModule>()),
  sponsorLogin: mocks.login,
}));
beforeEach(() => {
  localStorage.clear();
  mocks.wallet.reader.getBlock.mockResolvedValue({
    number: 42n,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  });
  mocks.wallet.reader.readContract.mockResolvedValue(`0x${'56'.repeat(20)}`);
  mocks.wallet.reader.getTransactionReceipt.mockResolvedValue({
    status: 'success',
    blockNumber: 42n,
  });
  mocks.wallet.sendTransaction
    .mockResolvedValueOnce(`0x${'a1'.repeat(32)}`)
    .mockResolvedValueOnce(`0x${'a2'.repeat(32)}`);
  mocks.plans.mockResolvedValue({
    sponsor: { minPricePerClaimUsd6: '1200000', maxCampaignDurationMs: 181 * 86400000 },
  });
  mocks.login.mockResolvedValue({ issuedAt: Date.now(), signature: '0xaa' });
  mocks.register.mockImplementation(async ({ campaign }) => ({
    id: campaign.id,
    auditKey: 'audit-key',
  }));
});
afterEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
describe('sponsor preflight and resumed registration', () => {
  it('validates metadata before approving or funding', async () => {
    render(<CampaignForm />);
    fireEvent.change(screen.getByTestId('campaign-validityDays'), { target: { value: '31' } });
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await waitFor(() => expect(mocks.plans).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(false),
    );
    expect(mocks.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(localStorage.getItem('recharge.sponsor.pending')).toBeNull();
  });
  it('resumes the same funded campaign after reload without a second approve or funding transaction', async () => {
    mocks.login.mockRejectedValueOnce(new Error('Wallet closed'));
    const first = render(<CampaignForm />);
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await screen.findByText('Wallet closed');
    const saved = JSON.parse(localStorage.getItem('recharge.sponsor.pending')!) as {
      createHash: string;
      campaign: { id: string };
    };
    expect(saved.createHash).toBeTruthy();
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(2);
    first.unmount();
    render(<CampaignForm />);
    await screen.findByText('Resume this campaign');
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await waitFor(() => expect(mocks.register).toHaveBeenCalled());
    expect(mocks.register.mock.calls[0]![0].campaign.id).toBe(saved.campaign.id);
    expect(mocks.wallet.sendTransaction).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(localStorage.getItem('recharge.sponsor.pending')).toBeNull());
  });
  it('does not approve or fund a provider plan rejected by server preflight', async () => {
    mocks.validate.mockRejectedValueOnce(new Error('Provider package cannot cover this campaign'));
    render(<CampaignForm />);
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await screen.findByText('Provider package cannot cover this campaign');
    expect(mocks.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(localStorage.getItem('recharge.sponsor.pending')).toBeNull();
  });
});
