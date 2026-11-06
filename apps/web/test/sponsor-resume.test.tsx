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
    catalog: vi.fn(),
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
  api: {
    plans: mocks.plans,
    catalog: mocks.catalog,
    validateSponsor: mocks.validate,
    registerSponsor: mocks.register,
  },
}));
vi.mock('../lib/sponsor', async (original) => ({
  ...(await original<typeof SponsorModule>()),
  sponsorLogin: mocks.login,
}));
/** The one supported destination package the catalog mock offers. */
const PACKAGE = {
  id: 'in-1gb-7d',
  name: 'India 1 GB',
  mb: 1000,
  validityDays: 7,
  wholesaleUsd6: '1200000',
  activation: { startsOn: 'first-network', installWithinDays: 180 },
  cancellation: 'never-installed',
} as const;
const DAY = 86_400_000;
/** A datetime-local value in this device's time zone, as the form reads it back. */
const local = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** Name the campaign, pick IN → the one package, and date a `days`-long event starting in ten days. */
async function planEvent(days = 2) {
  const startsAt = Date.now() + 10 * DAY;
  const dates = {
    startsAt,
    endsAt: startsAt + days * DAY,
    claimUntil: startsAt + DAY,
    reclaimAfter: startsAt + days * DAY,
  };
  fireEvent.change(screen.getByTestId('campaign-name'), { target: { value: 'Mumbai Welcome' } });
  // India is the default destination: its packages load without a click
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: 'Destination' }).value).toBe('IN');
  fireEvent.click(await screen.findByRole('radio', { name: new RegExp(PACKAGE.name) }));
  for (const [key, at] of Object.entries(dates))
    fireEvent.change(screen.getByTestId(`campaign-${key}`), { target: { value: local(at) } });
  return dates;
}
beforeEach(() => {
  localStorage.clear();
  mocks.wallet.reader.getBlock.mockResolvedValue({
    number: 42n,
    timestamp: BigInt(Math.floor(Date.now() / 1000)),
  });
  // every read answers the USDC address, except the allowance, which starts at zero
  mocks.wallet.reader.readContract.mockImplementation(
    async ({ functionName }: { functionName: string }) =>
      functionName === 'allowance' ? 0n : `0x${'56'.repeat(20)}`,
  );
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
  mocks.catalog.mockResolvedValue({ country: 'IN', plans: [PACKAGE] });
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
  it('validates the package terms and the advertised floor before approving or funding', async () => {
    render(<CampaignForm />);
    const dates = await planEvent();
    // a ten-day event on a seven-day package never reaches the API
    const tenDays = local(dates.startsAt + 10 * DAY);
    fireEvent.change(screen.getByTestId('campaign-endsAt'), { target: { value: tenDays } });
    fireEvent.change(screen.getByTestId('campaign-reclaimAfter'), { target: { value: tenDays } });
    // GET /plans already ran once with the catalogue (the price prefill); the submit must not reach it
    const prefetched = mocks.plans.mock.calls.length;
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await screen.findByText(/Choose a package whose installation window and validity cover/, {
      selector: 'p',
    });
    expect(mocks.plans).toHaveBeenCalledTimes(prefetched);
    // dates back in range, but a claim priced under the advertised floor stops after GET /plans
    const twoDays = local(dates.endsAt);
    fireEvent.change(screen.getByTestId('campaign-endsAt'), { target: { value: twoDays } });
    fireEvent.change(screen.getByTestId('campaign-reclaimAfter'), { target: { value: twoDays } });
    fireEvent.change(screen.getByTestId('campaign-priceUsd'), { target: { value: '1.00' } });
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await screen.findByText(/Each claim must fund at least \$1\.20 USDC/, { selector: 'p' });
    expect(mocks.plans).toHaveBeenCalledTimes(prefetched + 1);
    await waitFor(() =>
      expect(screen.getByTestId('campaign-submit').hasAttribute('disabled')).toBe(false),
    );
    expect(mocks.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(localStorage.getItem('recharge.sponsor.pending')).toBeNull();
  });
  it('resumes the same funded campaign after reload without a second approve or funding transaction', async () => {
    mocks.login.mockRejectedValueOnce(new Error('Wallet closed'));
    const first = render(<CampaignForm />);
    await planEvent();
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
    await planEvent();
    fireEvent.click(screen.getByTestId('campaign-submit'));
    await screen.findByText('Provider package cannot cover this campaign');
    expect(mocks.wallet.sendTransaction).not.toHaveBeenCalled();
    expect(localStorage.getItem('recharge.sponsor.pending')).toBeNull();
  });
});
